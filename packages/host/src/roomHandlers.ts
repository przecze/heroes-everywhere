// The lobby's messages, one handler each (rooms.ts message() checks them first: wellFormed.ts). A handler gets the
// host, the sender and its message; A player's mistake is a LobbyError, said back to them.
import { FACTIONS, RULE_KEYS, type RuleOverrides, canAct, parseRandomMapName, summarize } from "@heroes/core";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Bonus, HostClientMessage, Look, MyGame, RoomInfo, Slot } from "./protocol.ts";
import { type Client, DEADLINE_MAX_HOURS, MAX_ROOMS, PLAYABLE, type Room, type RoomsHost, VACATION_MAX_MS, alliesOnline, looking, seatOf } from "./roomTypes.ts";
import { back, nudge, reopened, startClock, tick } from "./roomTurns.ts";
import { recap, tellLook } from "./roomWatch.ts";
import { LobbyError, validClock } from "./wellFormed.ts";
import { knownLang, say } from "./words.ts";

type Handler<K extends HostClientMessage["t"]> = (h: RoomsHost, c: Client, m: Extract<HostClientMessage, { t: K }>) => unknown;

const HANDLERS: { [K in HostClientMessage["t"]]: Handler<K> } = {
  mpCreate: async (h, c, m) => {
    const name = (c.who?.name ?? m.name).trim();
    if (!name) throw new LobbyError("Pick a name first.");
    const map = await h.loadMap(m.map);
    // A random map names one human (the single-player choice): any of its colours can be a friend's here.
    const open = (p: (typeof map.players)[number]) => p.canHuman || (!!parseRandomMapName(m.map) && p.canComputer);
    const colors = map.players.map((p, i) => (open(p) ? i : -1)).filter((i) => i >= 0);
    const slots: Slot[] = map.players.flatMap((p, i) =>
      open(p) || p.canComputer
        ? [{ seat: i, human: open(p), computer: p.canComputer, ...(p.team !== undefined ? { team: p.team } : {}), factions: p.randomFaction ? FACTIONS.filter((_, f) => (p.allowedFactions ?? 0) & (1 << f)) : [] }]
        : [],
    );
    if (h.rooms.size >= MAX_ROOMS && !h.sweep()) throw new LobbyError("The server is full: try again later.");
    let id = h.code();
    while (h.rooms.has(id)) id = h.code();
    const info: RoomInfo = { id, map: m.map, host: name, started: false, colors, slots, players: [{ name, seat: colors[0] ?? 0, online: true, ...(c.who ? { key: c.who.key } : {}), ...(c.lang ? { lang: c.lang } : {}) }], turnMode: "simultaneous" };
    const r: Room = { info, clients: new Set(), server: null, active: h.time.now() };
    h.leave(c);
    h.rooms.set(id, r);
    c.name = name;
    c.room = r;
    r.clients.add(c);
    h.save(r);
    return h.broadcastRoom(r);
  },
  mpPeek: async (h, c, m) => {
    const r = h.room(m.room);
    r.info.players.forEach((p) => (p.online = [...r.clients].some((o) => o.name === p.name)));
    const mine = c.who && r.info.players.find((p) => p.key === c.who!.key)?.name;
    return c.send({ t: "mpPeek", room: r.info, ...(mine ? { mine } : {}), ...(c.who ? { you: c.who.name } : {}) });
  },
  mpJoin: async (h, c, m) => {
    const room = c.room;
    const r = h.room(m.room);
    // Someone known (an account): their own seat on any device, whatever name was typed.
    const mine = c.who && r.info.players.find((p) => p.key === c.who!.key);
    let name = mine ? mine.name : (c.who?.name ?? m.name).trim();
    if (!name) throw new LobbyError("Pick a name first.");
    const same = !mine && r.info.players.find((p) => p.name === name);
    if (same && same.key) {
      // Another person's seat: never taken by name. Someone known with the same name gets their own.
      if (!c.who) throw new LobbyError("That colour is someone else's: open the game on their device.");
      for (let i = 2; r.info.players.some((p) => p.name === name); i++) name = `${(c.who.name || "Player").slice(0, 36)} ${i}`;
    }
    // (Refused before anything changes: a refused player isn't left in the room.)
    let tookOver = -1;
    if (!r.info.players.some((p) => p.name === name)) {
      // A running game: an allied computer's colour is a friend's to take over (else it's closed).
      const ally = r.info.started && r.server?.state?.winner === undefined ? r.info.allies?.find((x) => r.server?.state?.players[x]?.alive !== false) : undefined;
      if (r.info.started && ally === undefined) throw new LobbyError("That game has already started.");
      const free = ally ?? r.info.colors.find((col) => !r.info.players.some((p) => p.seat === col));
      if (free === undefined) throw new LobbyError("The room is full.");
      if (room !== r) h.leave(c);
      r.info.players.push({ name, seat: free, online: true, ...(c.who ? { key: c.who.key } : {}) });
      if (ally !== undefined) {
        r.info.allies = r.info.allies!.filter((x) => x !== ally);
        if (!r.info.allies.length) delete r.info.allies;
        r.server!.setController(ally, "human");
        tookOver = ally;
      } else {
        // (Played by notification the host is seldom there when a friend comes: told, to start the game.)
        const host = r.info.players.find((p) => p.name === r.info.host);
        if (r.info.async && host?.key && !looking(r, host.name)) h.notify(host.key, { title: say(host.lang, "%1 has joined your game", name), body: say(host.lang, "Start game %1 when everyone is in.", r.info.id), url: `/#map?room=${r.info.id}`, tag: `turn-${r.info.id}` });
      }
    } else if (room !== r) h.leave(c);
    c.name = name;
    c.room = r;
    // (Their pings in the language this page speaks.)
    const seated = r.info.players.find((p) => p.name === name);
    if (seated && c.lang) seated.lang = c.lang;
    const wasEmpty = !r.clients.size;
    r.clients.add(c);
    if (wasEmpty) reopened(h, r, name);
    back(h, r, name);
    if (tookOver >= 0) h.tell(r, "%1 joins and takes over %2 from the allied computer.", name, { colour: tookOver });
    h.save(r);
    h.broadcastRoom(r);
    if (r.chat?.length) c.send({ t: "mpChat", lines: r.chat, history: true });
    // Rejoining a running game: this player's view of it, and the battle they're in.
    const seat = seatOf(r, name);
    if (r.server && seat >= 0) for (const msg of r.server.snapshot(seat)) c.send({ t: "game", msg });
    if (seat >= 0) recap(r, c, seat);
    // Where the allies here are looking (to follow them from the start).
    for (const o of alliesOnline(r, seat)) if (o.look) c.send({ t: "mpLook", seat: seatOf(r, o.name), look: o.look });
    await tick(h, r);
    return;
  },
  mpLeave: (h, c) => h.leave(c),
  mpSeat: async (h, c, m) => {
    const room = c.room;
    if (!room || room.info.started) return;
    if (!room.info.colors.includes(m.seat) || room.info.players.some((p) => p.seat === m.seat)) throw new LobbyError("Seat taken.");
    const me = room.info.players.find((p) => p.name === c.name);
    if (me) {
      me.seat = m.seat;
      if (room.info.allies?.includes(m.seat)) room.info.allies = room.info.allies.filter((x) => x !== m.seat);
      // (A town this colour can't have goes back to random.)
      if (me.faction && !room.info.slots?.find((x) => x.seat === m.seat)?.factions.includes(me.faction)) delete me.faction;
    }
    h.save(room);
    return h.broadcastRoom(room);
  },
  mpMode: async (h, c, m) => {
    const room = c.room;
    if (!room || room.info.started || room.info.host !== c.name) return;
    room.info.turnMode = m.turnMode === "sequential" ? "sequential" : "simultaneous";
    if (m.async !== undefined) room.info.async = !!m.async;
    if (m.allied !== undefined) room.info.allied = !!m.allied;
    if (m.simUntil !== undefined) room.info.simUntil = m.simUntil && m.simUntil > 0 ? Math.min(9999, Math.round(m.simUntil)) : null;
    if (m.noHota !== undefined) room.info.noHota = m.noHota || undefined;
    if (m.rules !== undefined) {
      // (Only HotA's own rules, each only turned off.)
      const rules: RuleOverrides = {};
      for (const k of RULE_KEYS) if (m.rules?.[k] === false) rules[k] = false;
      room.info.rules = Object.keys(rules).length ? rules : undefined;
    }
    if (m.deadline !== undefined) room.info.deadline = m.deadline && m.deadline > 0 ? Math.min(DEADLINE_MAX_HOURS, Math.round(m.deadline)) : null;
    // (Allies are on the friends' team: without one there's none.)
    if (room.info.allied === false) delete room.info.allies;
    h.save(room);
    return h.broadcastRoom(room);
  },
  mpAlly: async (h, c, m) => {
    const room = c.room;
    if (!room || room.info.started || room.info.host !== c.name) return;
    const slot = room.info.slots?.find((x) => x.seat === m.seat);
    if (!slot || (!slot.computer && !slot.human) || room.info.players.some((p) => p.seat === m.seat)) throw new LobbyError("That colour can't be an ally.");
    const allies = (room.info.allies ?? []).filter((x) => x !== m.seat);
    if (m.ally) allies.push(m.seat), (room.info.allied = true);
    if (allies.length) room.info.allies = allies.sort((a, b) => a - b);
    else delete room.info.allies;
    h.save(room);
    return h.broadcastRoom(room);
  },
  mpVacation: async (h, c, m) => {
    const room = c.room;
    const seat = room ? seatOf(room, c.name) : -1;
    if (!room?.server || seat < 0) throw new LobbyError("Join a running game first.");
    const until = m.until === null ? null : Number(m.until);
    if (until === null || until <= h.time.now()) {
      if (room.info.vacation?.[seat] === undefined) return;
      delete room.info.vacation[seat];
      h.tell(room, "%1 is back from vacation and plays %2 again.", c.name, { colour: seat });
    } else {
      (room.info.vacation ??= {})[seat] = Math.min(until, h.time.now() + VACATION_MAX_MS);
      h.tell(room, "%1 is on vacation until %2: the caretaker plays %3's turns meanwhile.", c.name, new Date(room.info.vacation[seat]).toISOString().slice(0, 10), { colour: seat });
    }
    h.save(room);
    h.broadcastRoom(room);
    return nudge(h, room);
  },
  mpClock: async (h, c, m) => {
    const room = c.room;
    if (!room || room.info.started || room.info.host !== c.name) return;
    room.info.clock = validClock(m.clock);
    h.save(room);
    return h.broadcastRoom(room);
  },
  mpPick: async (h, c, m) => {
    const room = c.room;
    if (!room || room.info.started) return;
    const me = room.info.players.find((p) => p.name === c.name);
    if (!me) return;
    if (m.faction !== undefined) {
      if (m.faction === null) delete me.faction;
      else if (room.info.slots?.find((x) => x.seat === me.seat)?.factions.includes(m.faction)) me.faction = m.faction;
      else throw new LobbyError("That town can't be picked for this colour.");
    }
    if (m.bonus !== undefined) {
      if (m.bonus === null) delete me.bonus;
      else if ((["gold", "resource", "artifact"] as Bonus[]).includes(m.bonus)) me.bonus = m.bonus;
    }
    h.save(room);
    return h.broadcastRoom(room);
  },
  mpMine: async (h, c, m) => {
    const key = c.who?.key;
    const games: MyGame[] = [];
    for (const r of key ? h.rooms.values() : []) {
      const me = r.info.players.find((p) => p.key === key);
      if (!me) continue;
      const s = r.server?.state;
      const waiting = s ? r.info.players.filter((p) => s.players[p.seat]?.controller === "human" && canAct(s, p.seat)) : [];
      games.push({
        room: { ...r.info, players: r.info.players.map((p) => ({ ...p, online: [...r.clients].some((o) => o.name === p.name) })) },
        seat: me.seat,
        day: s?.day ?? 0,
        myTurn: waiting.includes(me),
        waitingFor: waiting.filter((p) => p !== me).map((p) => p.name),
        over: s?.winner !== undefined,
        ...(s ? { summary: summarize(s, me.seat) } : {}),
      });
    }
    return c.send({ t: "mpMine", games: games.sort((a, b) => Number(b.myTurn) - Number(a.myTurn) || (h.rooms.get(b.room.id)?.active ?? 0) - (h.rooms.get(a.room.id)?.active ?? 0)) });
  },
  mpQuit: async (h, c, m) => {
    // Out for good: before the start just leaving; after it the computer plays the colour on.
    const r = h.rooms.get(String(m.room).trim().toUpperCase());
    const me = r && c.who && r.info.players.find((p) => p.key === c.who!.key);
    if (!r || !me) return;
    if (c.room === r) h.leave(c);
    for (const o of [...r.clients]) if (o.name === me.name) (r.clients.delete(o), (o.room = undefined));
    if (r.server) {
      r.server.setController(me.seat, "ai");
      r.info.players = r.info.players.filter((p) => p !== me);
      h.tell(r, "%1 has left the game: the computer plays %2 from now on.", me.name, { colour: me.seat });
      if (!r.info.players.length) h.drop(r);
      else (h.save(r), h.broadcastRoom(r), await nudge(h, r));
    } else {
      r.info.players = r.info.players.filter((p) => p !== me);
      if (!r.info.players.length) h.drop(r);
      else {
        if (r.info.host === me.name) r.info.host = r.info.players[0].name;
        h.save(r);
        h.broadcastRoom(r);
      }
    }
    return;
  },
  mpList: async (h, c, m) => {
    const online = (r: Room) => r.info.players.map((p) => ({ ...p, online: [...r.clients].some((o) => o.name === p.name) }));
    // Waiting rooms first, newest last; games in progress after them (to continue under your name).
    const rooms = [...h.rooms.values()].sort((a, b) => Number(a.info.started) - Number(b.info.started)).map((r) => ({ ...r.info, players: online(r) }));
    return c.send({ t: "mpRooms", rooms: rooms.slice(0, 50) });
  },
  mpChat: async (h, c, m) => {
    const room = c.room;
    if (!room) throw new LobbyError("Join a room first.");
    const text = String(m.text ?? "").trim().slice(0, 300);
    if (text) h.say(room, c.name, text);
    return;
  },
  mpStart: async (h, c, m) => {
    const room = c.room;
    if (!room || room.info.started) return;
    if (room.info.host !== c.name) throw new LobbyError("Only the host can start.");
    const map = await h.loadMap(room.info.map);
    const taken = new Set(room.info.players.map((p) => p.seat));
    const controllers = map.players.map((p, i) => (taken.has(i) ? "human" : p.canHuman || p.canComputer ? "ai" : "none") as "human" | "ai" | "none");
    room.info.started = true;
    if (parseRandomMapName(room.info.map)) {
      room.map = structuredClone(map);
      if (h.dir) writeFileSync(join(h.dir, `${room.info.id}.map`), JSON.stringify(room.map));
    }
    room.server = h.makeServer(room);
    h.broadcastRoom(room);
    // Friends allied: one team, a number no computer player's team has.
    // (Their allied computer players with them; a colour a friend took is no computer's.)
    const allies = (room.info.allies ?? []).filter((i) => !taken.has(i) && controllers[i] === "ai");
    room.info.allies = allies.length ? allies : undefined;
    const friendly = (i: number) => taken.has(i) || allies.includes(i);
    const friends = room.info.allied || allies.length ? [0, 1, 2, 3, 4, 5, 6, 7].find((t) => !map.players.some((mp, i) => mp.team === t && !friendly(i))) : undefined;
    const choices = map.players.map((_, i) => {
      const p = room.info.players.find((x) => x.seat === i);
      if (!p) return allies.includes(i) && friends !== undefined ? { team: friends } : undefined;
      return p.faction || p.bonus || friends !== undefined ? { ...(p.faction ? { faction: p.faction } : {}), ...(p.bonus ? { bonus: p.bonus } : {}), ...(friends !== undefined ? { team: friends } : {}) } : undefined;
    });
    await room.server.handle({ t: "advStart", mapFile: room.info.map, seed: h.seed(), controllers, turnMode: room.info.turnMode, choices, noHota: room.info.noHota, rules: room.info.rules }, -1);
    // (Days of play: an advanced start begins weeks in.)
    const s = room.server.state;
    if (s && room.info.simUntil) s.simultaneousUntil = s.day + room.info.simUntil - 1;
    startClock(room);
    await nudge(h, room);
    return tick(h, room);
  },
  mpLook: async (h, c, m) => {
    const room = c.room;
    if (!room?.server || seatOf(room, c.name) < 0) return;
    const look: Look = m.look.k === "town" ? { k: "town", object: m.look.object } : { k: m.look.k };
    if (JSON.stringify(look) === JSON.stringify(c.look)) return;
    c.look = look;
    return tellLook(room, c);
  },
  mpFollow: (_h, c, m) => void (c.follows = m.on),
  mpHidden: (_h, c, m) => void (c.hidden = m.hidden),
  mpLang: (h, c, m) => {
    c.lang = knownLang(m.lang);
    // (Kept with their seat: their pings while away are said in it.)
    const me = c.room?.info.players.find((p) => p.name === c.name);
    if (!me || me.lang === c.lang) return;
    if (c.lang) me.lang = c.lang;
    else delete me.lang;
    h.save(c.room!);
  },
  game: async (h, c, m) => {
    const room = c.room;
    if (!room?.server) throw new LobbyError("The game hasn't started.");
    const seat = seatOf(room, c.name);
    if (seat < 0) throw new LobbyError("You're not playing in this game.");
    if (!PLAYABLE.has(m.msg.t)) throw new LobbyError("A multiplayer game can't be replaced from inside it: leave the room first.");
    if (m.msg.t === "advAct" && m.msg.action?.type === "cheat") throw new LobbyError("Cheats are off in multiplayer games.");
    // Playing again: back from vacation (the seat is theirs at any time).
    if (m.msg.t === "advAct" && room.info.vacation?.[seat] !== undefined) {
      delete room.info.vacation[seat];
      h.tell(room, "%1 is back from vacation and plays %2 again.", c.name, { colour: seat });
      h.broadcastRoom(room);
    }
    await room.server.handle(m.msg, seat);
    await nudge(h, room);
    return tick(h, room);
  },
};

/** One message from a connection, to its handler. */
export async function handle(h: RoomsHost, c: Client, m: HostClientMessage): Promise<void> {
  await (HANDLERS[m.t] as Handler<typeof m.t>)(h, c, m as never);
}
