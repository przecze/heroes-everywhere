// The multiplayer lobby panel: name, create or join a room, pick a colour and the turn mode, start;
// and the link to the host that the game's messages then travel over.
import { keyboardRoom, onKeyboard } from "../keyboard.ts";
import { PLAYER_NAMES, RULE_INFO, RULE_KEYS, type RuleKey, type RuleOverrides, parseRandomMapName, randomMapName, ruleOn } from "@heroes/core";
import { reportText } from "@heroes/server";
import type { ReplayStep, ServerMessage } from "@heroes/server";
import { CLOCK_PRESETS } from "../../../host/src/clock.ts";
import { playerSwatch as swatch, textureCanvas } from "../assets.ts";
import type { Slot } from "../../../host/src/protocol.ts";
import { type CloudMeta, ago, cloudList, keepCloud, worthKeeping } from "../cloudSaves.ts";
import * as community from "../community/api.ts";
import { type ChatLine, type Look, MpLink, type MyGame, type RoomInfo, type SeatClock } from "../mp.ts";
import { enablePush, pushEnabled, pushSupported } from "../notify.ts";
import { dialogBacking } from "../chrome/look.ts";
import { loadCheckArt } from "../chrome/settingsWindow.ts";
import { adopPanel, partTexture } from "../ui/blocks/windowParts.ts";
import { extra } from "../settings.ts";
import { randomMapInfo } from "../ui/newGameParts.ts";
import { en, tr, trn } from "../i18n/index.ts";

/** Events a "since you were last here" window tells at most. */
const RECAP_SHOWN = 6;

/** A map's name for the lobby: a random map's readable one, else the file's. */
export function mapLabel(file: string): string {
  const random = parseRandomMapName(file);
  return random ? randomMapInfo(random).name : file.replace(/\.h3m$/i, "");
}

export interface LobbyHost {
  /** The map a new room would be on. */
  mapFile: () => string;
  /** The scenario selection, for another map (null: kept as it was). */
  chooseMap?: () => Promise<string | null>;
  /** Game messages from the host. */
  receive: (msg: ServerMessage) => void;
  status: (text: string) => void;
  /** The room's game began: load its map (our colour is `seat`). */
  started: (map: string) => void;
  /** A remembered room is gone: carry on with the local game. */
  stale: () => void;
  /** We left the room (its Leave button): back to the main menu. */
  left: () => void;
  /** No game on screen behind the panel (opened from the main menu, a link): closing it goes back to the main menu, not to a black page. */
  nothingBehind?: () => boolean;
  storage: (key: string, value?: string) => string | null;
  /** The room's turn clocks, as just sent. */
  clock?: (seats: Record<number, SeatClock>) => void;
  /** A new chat line (said in the game too). */
  chatLine?: (line: ChatLine) => void;
  /** "My games": opens a single-player game kept on the server. */
  openSave?: (slot: string) => Promise<void>;
  /** Back in a game played by notification: what we missed, in words, to show once the map is up; what of it we could see on the map, to watch (with the colours' names). */
  recap?: (text: string, replay?: ReplayStep[], names?: string[]) => void;
  /** Where an ally is looking, and an ally's battle to watch (following their turn). */
  look?: (seat: number, look: Look) => void;
  watch?: (seat: number, msg: ServerMessage) => void;
}

/** A clock setting's name in the lobby. */
function clockName(c: RoomInfo["clock"]): string {
  const preset = CLOCK_PRESETS.find((p) => JSON.stringify(p.clock) === JSON.stringify(c ?? null));
  return preset ? tr(preset.name) : tr("base %1 s, turn %2 s, battle %3 s, creature %4 s", c!.base, c!.turn, c!.battle, c!.unit);
}

const escape = (t: string) => t.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const title = (t: string) => t[0].toUpperCase() + t.slice(1);

/** The Turns choice: one at a time, or simultaneous until contact (and at most to a day, as HD+'s "till day"). */
const TURN_CHOICES: { label: string; mode: RoomInfo["turnMode"]; until: number | null }[] = [
  { label: en("Simultaneous until contact (HotA)"), mode: "simultaneous", until: null },
  { label: en("Simultaneous for a week, or until contact"), mode: "simultaneous", until: 7 },
  { label: en("Simultaneous for 2 weeks, or until contact"), mode: "simultaneous", until: 14 },
  { label: en("Simultaneous for a month, or until contact"), mode: "simultaneous", until: 28 },
  { label: en("One at a time"), mode: "sequential", until: null },
];
/** The soft turn deadlines the host may pick (hours; 0: none). */
const DEADLINES = [0, 12, 24, 48, 72];
/** A date as the player reads it (their locale). */
const day = (ms: number) => new Date(ms).toLocaleDateString();
const turnChoice = (r: RoomInfo) => Math.max(0, TURN_CHOICES.findIndex((c) => c.mode === r.turnMode && (c.mode === "sequential" || c.until === (r.simUntil ?? null))));
const BONUSES = [
  ["", en("Random bonus")],
  ["gold", en("Gold")],
  ["resource", en("Resource")],
  ["artifact", en("Artifact")],
] as const;

export class Lobby {
  /** The link to the host, once there is one. */
  link: MpLink | null = null;
  /** Our colour in a started game (-1: not in one). */
  seat = -1;
  room: RoomInfo | null = null;
  private name: string;
  /** The room's chat so far. */
  chatLines: ChatLine[] = [];
  /** The host's rooms, as last listed (null: not asked yet). */
  private list: RoomInfo[] | null = null;
  /** The map picked here for a new room (null: the host's). */
  private map: string | null = null;
  /** "My games": the multiplayer games I'm in, and my games on the server (null: not asked yet). */
  private mine: MyGame[] | null = null;
  private saves: CloudMeta[] | null = null;
  /** A profile's "Invite to play": the room is made, set to friends allied, then the player is told. */
  private pending: { to: string; name: string; into?: boolean } | null = null;
  /** Reconnections tried since the room was last heard of (onClose). */
  private retries = 0;
  /** "My games" with the quick tries too. */
  private showAll = false;
  /** The player's account name, when signed in: the name they play under (no name box). */
  private account: string | null = null;
  /** Going back into the room we were in (a reload, a link): if it's gone, the game goes on locally. A code typed wrong is only said. */
  private rejoining = false;
  private readonly panel = document.createElement("div");
  private readonly host: LobbyHost;

  constructor(host: LobbyHost) {
    this.host = host;
    this.name = host.storage("heroes.name") ?? `Player${Math.floor(Math.random() * 900 + 100)}`;
    // A player plays under their account's name (the host takes it from the gate, whatever is typed): shown, not asked.
    void fetch("/__whoami", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((who: { name?: string } | null) => {
        if (!who?.name) return;
        this.account = this.name = who.name;
        if (this.open) this.render();
      })
      .catch(() => {});
    this.panel.className = "townPanel lobbyPanel";
    this.panel.hidden = true;
    void dialogBacking();
    lobbyArt(this.panel);
    document.body.appendChild(this.panel);
    // Typing in it (the chat line, a name, the code): the panel ends above the keyboard, the line in sight (keyboard.ts).
    onKeyboard(() => {
      const a = document.activeElement;
      const inside = this.open && a instanceof HTMLInputElement && this.panel.contains(a);
      this.panel.style.maxHeight = "";
      if (!inside) return;
      const room = keyboardRoom();
      const top = this.panel.getBoundingClientRect().top;
      if (top + this.panel.offsetHeight > room.top + room.height - 8) this.panel.style.maxHeight = `${Math.max(120, room.top + room.height - top - 8)}px`;
      a.scrollIntoView({ block: "nearest" });
    });
  }

  get open() {
    return !this.panel.hidden;
  }

  toggle() {
    this.panel.hidden = !this.panel.hidden;
    this.render();
    if (this.open && !this.room) this.refreshList();
  }

  /** The front panel with "my games" in front (the main menu's My Games). */
  showMine() {
    this.panel.hidden = false;
    this.render();
    if (!this.room) this.refreshList();
  }

  /** Asks the host for its rooms (the list shows them when they come). */
  refreshList() {
    const mp = this.connect();
    void mp.lobby({ t: "mpList" });
    if (!extra("asyncGames")) return;
    void mp.lobby({ t: "mpMine" });
    void cloudList().then((list) => {
      this.saves = list;
      if (this.open && !this.room) this.render();
    });
  }

  hide() {
    this.panel.hidden = true;
  }

  /**
   * Its Close (the tick in the corner): with no game behind it (the room not started yet, opened from the main menu or
   * a link) back to the main menu, staying in the room (the menu's Multiplayer brings it back); else to the game.
   * (Michał and a player, 2026-11-02: the host closed the room with its tick, taking it for Start, and was left on a black page.)
   */
  close() {
    this.hide();
    if (this.host.nothingBehind?.()) location.hash = "#menu";
  }

  /** A game link from another device: show that room and who to continue as. */
  peek(room: string) {
    void this.connect().lobby({ t: "mpPeek", room });
  }

  /**
   * "Invite to play" on a profile: a new room on a random map for the friends and the computer players,
   * played by notification as friends allied, and the invitation sent once the room is so (the
   * invited player's push opens the room; they take a free colour, the host starts). Inviting while a
   * room of ours waits to start (`last`, the room this browser was in) asks them into that one, as long
   * as a computer player is left to play against; else a new room.
   */
  inviteTo(to: string, name: string, last?: { room: string; name: string } | null) {
    this.pending = { to, name, into: !!last };
    this.panel.hidden = false;
    if (last) return this.rejoin(last.room, last.name);
    this.inviteRoom();
  }

  /** The room an invitation makes: four colours, so up to three friends still have a computer to play against. */
  private inviteRoom() {
    const map = randomMapName({ size: 72, players: 4, humans: 2, monsters: 1, seed: (Math.random() * 2 ** 31) | 0 });
    void this.connect().lobby({ t: "mpCreate", name: this.name, map });
  }

  /** A line under the room's heading. */
  private notice = "";
  private tell(text: string) {
    this.notice = text;
    this.render();
  }

  private invitePending(mp: MpLink, r: RoomInfo) {
    const inv = this.pending!;
    if (!r.async || !r.allied) return void mp.lobby({ t: "mpMode", turnMode: r.turnMode, async: true, allied: true });
    this.pending = null;
    void community
      .invite(inv.to, r.id)
      .then((ok) => this.tell(ok ? tr("%1 has been invited. Start the game when they have joined.", inv.name) : tr("The invitation could not be sent.")))
      .catch(() => this.tell(tr("The invitation could not be sent.")));
  }

  /** Back into the room we were in before a reload. */
  rejoin(room: string, name: string) {
    this.name = name;
    this.rejoining = true;
    void this.connect().lobby({ t: "mpJoin", room, name });
  }

  /**
   * Out of the room: the host frees our colour (before the start; a running game keeps it to
   * continue later), and this browser no longer rejoins it after a reload.
   */
  async leave() {
    const mp = this.link;
    this.link = null;
    this.room = null;
    this.seat = -1;
    this.chatLines = [];
    this.host.storage("heroes.mp", "");
    if (!mp) return;
    mp.onClose = mp.onError = mp.onRoom = mp.onPeek = mp.onClock = mp.onChat = mp.onRooms = mp.onMine = mp.onRecap = mp.onLook = mp.onWatch = null;
    await mp.lobby({ t: "mpLeave" });
    await mp.flushed();
    mp.close();
  }

  /** Says something in the room's chat. */
  chat(text: string) {
    if (text.trim() && this.room) void this.link?.lobby({ t: "mpChat", text });
  }

  /** The panel open at its chat line (Tab in the game, as the original's message line). */
  openChat() {
    this.panel.hidden = false;
    this.render();
    this.panel.querySelector<HTMLInputElement>("[data-say]")?.focus();
  }

  private setName(name: string) {
    this.name = name;
    this.host.storage("heroes.name", name);
  }

  private connect(): MpLink {
    if (this.link) return this.link;
    const mp = new MpLink();
    this.link = mp;
    mp.onMessage((msg) => this.host.receive(msg));
    mp.onError = (message, code) => {
      // (Acted on by its code; the words only shown. An older host sends no code: its words still count.)
      const gone = code === "noRoom" || message === "No such room.";
      message = tr(message); // i18n-ok (the host's words, translated where a line exists)
      this.host.status(message);
      const err = this.panel.querySelector("[data-err]");
      if (err) err.textContent = message;
      // An invitation into a room that is gone: a new one.
      if (gone && this.pending?.into) {
        this.pending.into = false;
        this.host.storage("heroes.mp", "");
        return void this.inviteRoom();
      }
      // A stale room from a previous session: forget it and play locally.
      if (gone && !this.room && this.rejoining) {
        this.rejoining = false;
        this.host.storage("heroes.mp", "");
        mp.close();
        this.link = null;
        this.host.stale();
      }
    };
    mp.onMine = (games) => {
      this.mine = games;
      if (this.open && !this.room) this.render();
    };
    mp.onRoom = (r, you) => {
      this.retries = 0;
      this.rejoining = false;
      // (Another game opened from "my games" starts its map too.)
      const wasStarted = this.room?.id === r.id && this.room.started;
      // (Arriving in a room still waiting, e.g. from a link or a reload, shows it: there's nothing else to see yet.)
      if (this.room?.id !== r.id && !r.started) this.panel.hidden = false;
      // (A room entered starts at its top, its players and the bell: not scrolled to where the code was typed.)
      const entered = this.room?.id !== r.id;
      this.room = r;
      this.name = you;
      this.host.storage("heroes.mp", JSON.stringify({ room: r.id, name: you }));
      this.seat = r.started ? (r.players.find((p) => p.name === you)?.seat ?? -1) : -1;
      this.render();
      if (entered) this.panel.scrollTop = 0;
      if (this.pending?.into) {
        // (Our room still waiting, with a colour for them and a computer left after them: invited into it.)
        this.pending.into = false;
        const free = r.colors.filter((c) => !r.players.some((p) => p.seat === c));
        if (r.started || r.host !== you || free.length < 2) return void this.inviteRoom();
      }
      if (this.pending && !r.started && r.host === you) this.invitePending(mp, r);
      if (r.started && !wasStarted) {
        this.host.started(r.map);
        // (Counted for the profile's "games played".)
        community.reportPlayed(r.id);
      }
    };
    mp.onRooms = (rooms) => {
      this.list = rooms;
      if (this.open && !this.room) this.render();
    };
    // A dropped connection in a room (a phone asleep, the network gone, the host restarted): back in by
    // itself, sooner first and then less often; the host sends the game as it stands.
    mp.onClose = () => {
      this.host.status(tr("Disconnected from the multiplayer host."));
      if (this.link !== mp || !this.room) return;
      const room = this.room.id;
      const name = this.name;
      setTimeout(() => {
        if (this.link !== mp) return;
        this.link = null;
        void this.connect().lobby({ t: "mpJoin", room, name });
      }, Math.min(30_000, 1000 * 2 ** this.retries++));
    };
    mp.onClock = (seats) => this.host.clock?.(seats);
    mp.onLook = (seat, look) => this.host.look?.(seat, look);
    mp.onWatch = (seat, msg) => this.host.watch?.(seat, msg);
    mp.onRecap = (reports, since, replay) => {
      const players = this.room?.players ?? [];
      const names = PLAYER_NAMES.map((n, seat) => players.find((p) => p.seat === seat)?.name ?? n);
      const head = since ? tr("Since you were last here (day %1):", since) : tr("Since you were last here:");
      // (The latest ones: a long absence would make a window taller than the screen.)
      const shown = reports.slice(-RECAP_SHOWN);
      const earlier = reports.length - shown.length;
      // (Nothing to tell in words, only moves to watch: no empty heading.)
      if (!shown.length) return this.host.recap?.("", replay, names);
      this.host.recap?.([head, ...(earlier ? [trn(earlier, "…and one earlier event.", "…and %1 earlier events.")] : []), ...shown.map((r) => reportText(r, this.seat, names, tr))].join("\n\n"), replay, names);
    };
    mp.onChat = (lines, history) => {
      const fresh = lines.filter((l) => !this.chatLines.some((o) => o.at === l.at && o.from === l.from && o.text === l.text));
      this.chatLines.push(...fresh);
      this.chatLines.splice(0, this.chatLines.length - 100);
      // (The history sent on joining isn't said again; what's new is.)
      if (lines.length === 1 && !history) for (const l of fresh) this.host.chatLine?.({ ...l, text: chatText(l) });
      if (this.open) this.renderChat();
    };
    // Opened from a game link on another device: pick who you are.
    mp.onPeek = (r, mine, you) => {
      // Our own seat (we're known on every device): straight in.
      if (mine) return void mp.lobby({ t: "mpJoin", room: r.id, name: mine });
      const panel = this.panel;
      panel.hidden = false;
      // (A seat that is someone's own, an account's, can't be taken: only theirs to continue.)
      panel.innerHTML = `<div class="head"><b>${tr(`Room %1`, r.id)}</b><button data-x data-ico="ok">${tr(`Close`)}</button></div>
        <div class="sub">${tr(`Map: %1 · %2%3`, mapLabel(r.map), r.started ? tr("in progress") : tr("waiting to start"), r.async ? tr(" · played by notification") : "")}</div>
        <h4>${you ? tr("Playing") : tr("Continue as")}</h4>
        ${r.players.map((p) => `<div class="row"><span>${escape(p.name)} (${tr(PLAYER_NAMES[p.seat])})${p.online ? tr(" · playing now") : ""}</span>${p.key || you ? "" : `<button data-as="${escape(p.name)}" data-ico="ok">${tr(`That's me`)}</button>`}</div>`).join("")}
        ${r.started && r.allies?.length && !r.players.some((p) => p.name === you) ? `<div class="row"><span>${tr(`Take over the allied computer's colour as`)} <b>${escape(you || this.name)}</b></span><button data-as="" data-new data-ico="ok">${tr(`Join`)}</button></div>` : ""}
        ${r.started ? "" : you ? `<div class="row"><span>${tr(`Join as`)} <b>${escape(you)}</b></span><button data-as="" data-new data-ico="ok">${tr(`Join`)}</button></div>` : `<h4>${tr(`Or join`)}</h4><div class="row">${this.account ? `<b>${escape(this.account)}</b>` : `<input data-name value="${escape(this.name)}">`}<button data-as="" data-new data-ico="ok">${tr(`Join`)}</button></div>`}`;
      panel.querySelector("[data-x]")?.addEventListener("click", () => this.close());
      panel.querySelectorAll<HTMLButtonElement>("[data-as]").forEach((b) =>
        b.addEventListener("click", () => {
          this.setName(b.dataset.new !== undefined ? panel.querySelector<HTMLInputElement>("[data-name]")?.value.trim() || you || this.name : b.dataset.as!);
          void this.connect().lobby({ t: "mpJoin", room: r.id, name: this.name });
        }),
      );
    };
    return mp;
  }

  /** "My games": the multiplayer games I'm in, then my games on the server worth coming back to. */
  private myGames(): string {
    if (!extra("asyncGames")) return "";
    const mp = (this.mine ?? []).map((g) => {
      const others = g.room.players.filter((p) => p.seat !== g.seat).map((p) => escape(p.name));
      const state = !g.room.started ? tr("not started") : g.over ? tr("over") : g.myTurn ? `<b>${tr("your turn")}</b>` : g.waitingFor.length ? tr("waiting for %1", g.waitingFor.map(escape).join(", ")) : tr("waiting");
      return `<div class="row"><span>${swatch(g.seat)}${escape(mapLabel(g.room.map))}${g.day ? tr(", day %1", g.day) : ""}<br><span class="sub">${tr("with %1", others.join(", ") || tr("nobody yet"))} · ${state}</span></span><span><button data-opengame="${g.room.id}" data-ico="ok">${tr("Open")}</button> <button data-quit="${g.room.id}" data-ico="remove" title="${tr("Leave this game for good")}">${tr("Leave")}</button></span></div>`;
    });
    const all = (this.saves ?? []).filter((m) => m.slot.startsWith("current-") || m.slot.startsWith("save-"));
    const shown = this.showAll ? all : all.filter(worthKeeping);
    const sp = shown.map(
      (m) =>
        `<div class="row"><span>${tr("%1, day %2", escape(m.name), m.day)}<br><span class="sub">${(m.humans ?? 1) > 1 ? tr("hot seat, %1 players · ", m.humans) : ""}${escape(m.device)} · ${ago(m.savedAt)}</span></span><span><button data-opensave="${escape(m.slot)}" data-ico="ok">${tr("Open")}</button> <button data-keep="${escape(m.slot)}" data-ico="pin" class="${m.kept ? "on" : ""}" title="${m.kept ? tr("Kept in My games") : tr("Keep it in My games")}"></button></span></div>`,
    );
    const hidden = all.length - shown.length;
    return `<h4>${tr("My games")}</h4>${mp.length ? this.pushRow() : ""}
      ${this.mine === null && this.saves === null ? `<div class="sub">${tr("Looking…")}</div>` : ""}
      ${mp.join("")}${sp.join("")}
      ${this.mine !== null && !mp.length && !sp.length ? `<div class="sub">${tr("None yet: games with friends, games you keep and games past their first week show here.")}</div>` : ""}
      ${hidden || this.showAll ? `<div class="row"><span class="sub">${this.showAll ? tr("Showing quick tries too") : trn(hidden, "%1 quick try hidden", "%1 quick tries hidden")}</span><button data-allgames data-ico="eye" title="${this.showAll ? tr("Hide them") : tr("Show")}"></button></div>` : ""}`;
  }

  /** Played by notification, a running game of mine: away until a date (the caretaker plays my turns), or back now. */
  private vacationRow(): string {
    const room = this.room;
    const me = room?.players.find((p) => p.name === this.name);
    if (!room?.started || !me || !extra("absentFriends")) return "";
    const until = room.vacation?.[me.seat];
    if (until) return `<div class="row"><span>${tr("On vacation until %1: the caretaker plays your turns", day(until))}</span><button data-back data-ico="undo">${tr("Back now")}</button></div>`;
    const week = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    return `<div class="row"><span>${tr("Going away? The caretaker plays your turns until")}</span><input type="date" data-until style="min-width:8.5em" value="${week}" min="${new Date().toISOString().slice(0, 10)}"><button data-vacation data-ico="ok">${tr("Go on vacation")}</button></div>`;
  }

  /** Turning this device's notifications on (they say when it's your turn). */
  private pushRow(): string {
    return pushSupported() ? `<div class="row"><span>${tr("Tell me on this device when it's my turn")}</span><button data-push data-ico="bell" title="${tr("Turn on")}"></button></div>` : "";
  }

  /** The game rules as the New Game screen's window has them: a check each, HotA's checked; the host's to change. */
  private rulesRows(room: RoomInfo, isHost: boolean): string {
    const row = (key: string, name: string, help: string, on: boolean) => `<label class="row" title="${escape(help)}"><span>${name}</span><input type="checkbox" data-rule="${key}" ${on ? "checked" : ""} ${isHost ? "" : "disabled"}></label>`;
    return `<h4>${tr("Game rules")}</h4>${row("noHota", tr("Without Horn of the Abyss content"), tr("No HotA towns, creatures, artifacts, heroes or skills: only the original's. HotA's rules and its changes to the original towns and creatures stay."), !!room.noHota)}${RULE_KEYS.map((k) => row(k, tr(RULE_INFO[k].name), tr(RULE_INFO[k].help), ruleOn(room.rules, k))).join("")}`; // i18n-ok (a data key)
  }

  /**
   * Start (the host) or who it waits for (the others), first under the room's line: on an upright phone the room's
   * settings run several screens down, and the host looked for Start at the top (2026-11-02).
   */
  private startRow(room: RoomInfo, isHost: boolean): string {
    const seats = room.slots?.filter((x) => x.human).length ?? room.colors.length;
    const joined = room.players.map((p) => escape(p.name)).join(", ");
    const who = `<span>${tr("Players: %1 (%2 of %3)", joined, room.players.length, seats)}</span>`;
    return isHost
      ? `<div class="row mpStart">${who}<button data-start data-ico="begin">${tr(`Start game`)}</button></div>`
      : `<div class="row mpStart">${who}<span class="sub">${tr(`Waiting for %1 to start…`, escape(room.host))}</span></div>`;
  }

  private render() {
    const { panel, room } = this;
    const isHost = room?.host === this.name;
    // (A line being typed survives the panel being drawn again for someone joining.)
    const sayBox = panel.querySelector<HTMLInputElement>("[data-say]");
    const typing = sayBox?.value ?? "";
    const typingFocused = !!sayBox && document.activeElement === sayBox;
    const seatName = (c: number) => tr(PLAYER_NAMES[c]);
    const mine = room?.players.find((p) => p.name === this.name);
    const slots: Slot[] = room ? (room.slots ?? room.colors.map((seat) => ({ seat, human: true, computer: true, factions: [] }))) : [];
    const slotRow = (sl: (typeof slots)[number]) => {
      const p = room!.players.find((x) => x.seat === sl.seat);
      const me = p && p.name === this.name;
      const who = p
        ? `${escape(p.name)}${p.name === room!.host ? tr(" (host)") : ""}${p.online ? "" : tr(" · offline")}${room!.away?.includes(sl.seat) ? tr(" · computer for now") : ""}${room!.vacation?.[sl.seat] ? tr(" · on vacation until %1", day(room!.vacation[sl.seat])) : ""}`
        : room!.allies?.includes(sl.seat)
          ? tr("Allied computer")
          : sl.computer
            ? tr("Computer")
            : tr("Closed");
      const take = !room!.started && !p && sl.human && mine ? `<button data-seat="${sl.seat}" data-ico="ok">${tr("Take")}</button>` : "";
      // (The host makes a computer colour the friends' ally: absent friends and empty seats covered.)
      const ally = !room!.started && !p && isHost && extra("absentFriends") && (sl.computer || sl.human) ? `<label class="sub"><input type="checkbox" data-ally="${sl.seat}" ${room!.allies?.includes(sl.seat) ? "checked" : ""}> ${tr("ally")}</label>` : "";
      const town =
        me && !room!.started && sl.factions.length > 1
          ? `<select data-faction><option value="">${tr("Random town")}</option>${sl.factions.map((f) => `<option value="${f}" ${p.faction === f ? "selected" : ""}>${title(f)}</option>`).join("")}</select>`
          : `<span>${p?.faction ? title(p.faction) : sl.factions.length ? tr("Random town") : tr("Map's town")}</span>`;
      const bonus =
        me && !room!.started
          ? `<select data-bonus>${BONUSES.map(([v, l]) => `<option value="${v}" ${(p.bonus ?? "") === v ? "selected" : ""}>${tr(l)}</option>`).join("")}</select>`
          : p?.bonus
            ? `<span>${tr("Bonus: %1", tr(title(p.bonus)))}</span>`
            : "";
      return `<div class="mpSlot${me ? " me" : ""}" style="--slot-bg: var(--slot-${sl.seat})"><div class="row"><span>${swatch(sl.seat)}${seatName(sl.seat)}${room!.allied && (p || room!.allies?.includes(sl.seat)) ? ` · ${tr("friends' team")}` : sl.team !== undefined ? tr(" · team %1", sl.team + 1) : ""}</span><span>${who}</span>${ally}${take}</div>${
        p ? `<div class="row opts">${town}${bonus}</div>` : ""
      }</div>`;
    };
    const roomRow = (r: RoomInfo) => {
      const seats = r.slots?.filter((x) => x.human).length ?? r.colors.length;
      const people = r.players.map((p) => escape(p.name)).join(", ");
      return `<div class="row"><span><b>${r.id}</b> ${escape(mapLabel(r.map))}<br><span class="sub">${people} · ${r.players.length}/${seats} · ${r.started ? tr("in progress") : tr("waiting")}</span></span>${
        r.started ? `<button data-peek="${r.id}" data-ico="ok">${tr("Continue")}</button>` : r.players.length < seats ? `<button data-joinroom="${r.id}" data-ico="ok">${tr("Join")}</button>` : `<span class="sub">${tr("full")}</span>`
      }</div>`;
    };
    panel.innerHTML = room
      ? `<div class="head"><b>${tr(`Room %1`, room.id)}</b><button data-x data-ico="ok">${tr(`Close`)}</button></div>
         <div class="sub">${tr(`Map: %1 · share the code`, mapLabel(room.map))} <b>${room.id}</b> · ${room.started ? tr("in progress") : tr("waiting to start")}</div>
         ${this.notice ? `<div class="sub"><b>${escape(this.notice)}</b></div>` : ""}
         ${room.started ? "" : this.startRow(room, isHost)}
         <div class="row"><span>${tr(`Invite / continue on another device`)}</span><button data-copy data-ico="copy">${tr(`Copy link`)}</button></div>
         ${room.async ? this.pushRow() : ""}
         <div class="row"><span>${room.started ? tr("Your colour stays yours to continue later") : tr("Back to the main menu")}</span><button data-leave data-ico="cancel">${tr(`Leave room`)}</button></div>
         <h4>${tr(`Players`)}</h4>
         ${slots.map(slotRow).join("")}
         ${room.started ? "" : `<h4>${tr(`Turns`)}</h4><div class="row"><select data-mode ${isHost ? "" : "disabled"}>
           ${TURN_CHOICES.map((c, i) => `<option value="${i}" ${turnChoice(room) === i ? "selected" : ""}>${tr(c.label)}</option>`).join("")}</select></div>
         ${extra("asyncGames") ? `<label class="row"><span>${tr(`Play by notification: friends move when they can, each told when it's their turn (no time limit)`)}</span><input type="checkbox" data-async ${room.async ? "checked" : ""} ${isHost ? "" : "disabled"}></label>` : ""}
         <label class="row"><span>${tr(`Friends allied: all of you one team against the computer players`)}</span><input type="checkbox" data-allied ${room.allied ? "checked" : ""} ${isHost ? "" : "disabled"}></label>
         ${room.async && extra("absentFriends") ? `<div class="row"><span>${tr(`Soft turn deadline: past it, a cautious caretaker plays the turn of a friend away`)}</span><select data-deadline ${isHost ? "" : "disabled"}>${DEADLINES.map((h) => `<option value="${h}" ${(room.deadline ?? 0) === h ? "selected" : ""}>${h ? tr("%1 hours", h) : tr("None")}</option>`).join("")}</select></div>` : ""}
         <div class="row" ${room.async ? "hidden" : ""}><span>${tr(`Time limit`)}</span><select data-clock ${isHost ? "" : "disabled"}>${CLOCK_PRESETS.map((p, i) => `<option value="${i}" ${JSON.stringify(p.clock) === JSON.stringify(room.clock ?? null) ? "selected" : ""}>${tr(p.name)}</option>`).join("")}</select></div>
         ${extra("gameRules") ? this.rulesRows(room, isHost) : ""}
`}
         ${room.started && room.clock && !room.async ? `<div class="sub">${tr(`Time limit: %1`, clockName(room.clock))}</div>` : ""}
         ${room.async ? `<div class="sub">${tr(`Played by notification: each of you is told when it's their turn.`)}${room.started && room.deadline ? ` ${tr(`A friend away over %1 hours, the others done, has the turn played by a cautious caretaker.`, room.deadline)}` : ""}</div>${this.vacationRow()}` : ""}
         <h4>${tr(`Chat`)}</h4><div data-chat></div>
         <div class="row"><input data-say maxlength="300" placeholder="${tr(`Say something`)}" style="flex:1"><button data-send data-ico="ok">${tr(`Send`)}</button></div>`
      : `<div class="head"><b>${tr(`Multiplayer`)}</b><button data-x data-ico="ok">${tr(`Close`)}</button></div>
         ${this.myGames()}
         <div class="row"><span>${tr(`Your name`)}</span>${this.account ? `<b>${escape(this.account)}</b>` : `<input data-name value="${escape(this.name)}">`}</div>
         <h4>${tr(`New room`)}</h4><div class="row"><span>${tr(`on %1`, mapLabel(this.map ?? this.host.mapFile()))}</span>${this.host.chooseMap ? `<button data-map data-ico="swap">${tr(`Change`)}</button>` : ""}</div>
         <div class="row"><span></span><button data-create data-ico="begin">${tr(`Create room`)}</button></div>
         <h4>${tr(`Join a room`)}</h4><div class="row"><input data-code placeholder="${tr(`code`)}" size="6"><button data-join data-ico="ok">${tr(`Join`)}</button></div>
         <div class="row"><span>${tr(`Rooms on this server`)}</span><button data-refresh data-ico="swap">${tr(`Refresh`)}</button></div>
         <div data-rooms>${this.list === null ? `<div class="sub">${tr(`Looking…`)}</div>` : this.list.length ? this.list.map(roomRow).join("") : `<div class="sub">${tr(`No rooms yet: create one and share its code.`)}</div>`}</div>
         <div class="sub" data-err></div>`;
    const on = (sel: string, ev: string, fn: (e: Event) => void) => panel.querySelector(sel)?.addEventListener(ev, fn);
    on("[data-x]", "click", () => this.close());
    on("[data-copy]", "click", (e) => {
      const url = `${location.origin}${location.pathname}#map?room=${room!.id}`;
      const btn = e.currentTarget as HTMLButtonElement;
      void navigator.clipboard?.writeText(url).then(() => ((btn.dataset.glyph = "✓"), (btn.title = tr("Copied!"))));
    });
    on("[data-leave]", "click", () => void this.leave().then(() => this.host.left()));
    on("[data-name]", "change", (e) => this.setName((e.target as HTMLInputElement).value.trim() || this.name));
    on("[data-create]", "click", () => void this.connect().lobby({ t: "mpCreate", name: this.name, map: this.map ?? this.host.mapFile() }));
    on("[data-map]", "click", async () => {
      // The panel makes way for the selection, then comes back with its choice.
      panel.hidden = true;
      const file = await this.host.chooseMap!();
      if (file) this.map = file;
      panel.hidden = false;
      this.render();
    });
    on("[data-join]", "click", () => {
      const code = panel.querySelector<HTMLInputElement>("[data-code]")!.value.trim();
      if (code) void this.connect().lobby({ t: "mpJoin", room: code, name: this.name });
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-seat]").forEach((b) => b.addEventListener("click", () => void this.link?.lobby({ t: "mpSeat", seat: Number(b.dataset.seat) })));
    panel.querySelectorAll<HTMLButtonElement>("[data-joinroom]").forEach((b) => b.addEventListener("click", () => void this.connect().lobby({ t: "mpJoin", room: b.dataset.joinroom!, name: this.name })));
    panel.querySelectorAll<HTMLButtonElement>("[data-peek]").forEach((b) => b.addEventListener("click", () => this.peek(b.dataset.peek!)));
    on("[data-refresh]", "click", () => this.refreshList());
    // (Played by notification is best allied: no battles between friends, which need both there at once.)
    on("[data-async]", "change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      void this.link?.lobby({ t: "mpMode", turnMode: room!.turnMode, async: on, ...(on ? { allied: true } : {}) });
    });
    on("[data-allied]", "change", (e) => void this.link?.lobby({ t: "mpMode", turnMode: room!.turnMode, allied: (e.target as HTMLInputElement).checked }));
    panel.querySelectorAll<HTMLInputElement>("[data-ally]").forEach((b) => b.addEventListener("change", () => void this.link?.lobby({ t: "mpAlly", seat: Number(b.dataset.ally), ally: b.checked })));
    on("[data-deadline]", "change", (e) => void this.link?.lobby({ t: "mpMode", turnMode: room!.turnMode, deadline: Number((e.target as HTMLSelectElement).value) || null }));
    on("[data-vacation]", "click", () => {
      const v = panel.querySelector<HTMLInputElement>("[data-until]")?.value;
      // (To the end of that day, where the player is.)
      const until = v ? new Date(`${v}T23:59:59`).getTime() : NaN;
      if (until > Date.now()) void this.link?.lobby({ t: "mpVacation", until });
    });
    on("[data-back]", "click", () => void this.link?.lobby({ t: "mpVacation", until: null }));
    const push = panel.querySelector<HTMLButtonElement>("[data-push]");
    if (push) {
      void pushEnabled().then((on) => on && ((push.dataset.glyph = "✓"), (push.title = tr("On")), (push.disabled = true)));
      push.onclick = () =>
        void enablePush().then(
          () => ((push.dataset.glyph = "✓"), (push.title = tr("On")), (push.disabled = true)),
          (err: Error) => this.host.status(tr(`Notifications: %1`, err.message)),
        );
    }
    on("[data-allgames]", "click", () => ((this.showAll = !this.showAll), this.render()));
    panel.querySelectorAll<HTMLButtonElement>("[data-opengame]").forEach((b) => b.addEventListener("click", () => this.rejoin(b.dataset.opengame!, this.name)));
    panel.querySelectorAll<HTMLButtonElement>("[data-quit]").forEach((b) =>
      b.addEventListener("click", () => {
        if (!confirm(tr("Leave this game for good? The computer plays your colour from then on."))) return;
        void this.link?.lobby({ t: "mpQuit", room: b.dataset.quit! }).then(() => this.link?.lobby({ t: "mpMine" }));
      }),
    );
    panel.querySelectorAll<HTMLButtonElement>("[data-opensave]").forEach((b) => b.addEventListener("click", () => void this.host.openSave?.(b.dataset.opensave!)));
    panel.querySelectorAll<HTMLButtonElement>("[data-keep]").forEach((b) =>
      b.addEventListener("click", () => {
        const m = this.saves?.find((x) => x.slot === b.dataset.keep);
        if (!m) return;
        void keepCloud(m.slot, !m.kept).then((ok) => ok && ((m.kept = !m.kept), this.render()));
      }),
    );
    on("[data-faction]", "change", (e) => void this.link?.lobby({ t: "mpPick", faction: (e.target as HTMLSelectElement).value || null }));
    on("[data-bonus]", "change", (e) => void this.link?.lobby({ t: "mpPick", bonus: ((e.target as HTMLSelectElement).value || null) as "gold" | null }));
    on("[data-mode]", "change", (e) => {
      const c = TURN_CHOICES[Number((e.target as HTMLSelectElement).value)];
      if (c) void this.link?.lobby({ t: "mpMode", turnMode: c.mode, simUntil: c.until });
    });
    on("[data-start]", "click", () => void this.link?.lobby({ t: "mpStart" }));
    // The game rules (the host's): each check sent as the room's whole choice.
    panel.querySelectorAll<HTMLInputElement>("[data-rule]").forEach((b) =>
      b.addEventListener("change", () => {
        if (b.dataset.rule === "noHota") return void this.link?.lobby({ t: "mpMode", turnMode: room!.turnMode, noHota: b.checked });
        const rules: RuleOverrides = { ...room!.rules };
        const k = b.dataset.rule as RuleKey;
        if (b.checked) delete rules[k];
        else rules[k] = false;
        void this.link?.lobby({ t: "mpMode", turnMode: room!.turnMode, rules });
      }),
    );
    on("[data-clock]", "change", (e) => void this.link?.lobby({ t: "mpClock", clock: CLOCK_PRESETS[Number((e.target as HTMLSelectElement).value)]?.clock ?? null }));
    const say = () => {
      const input = panel.querySelector<HTMLInputElement>("[data-say]")!;
      this.chat(input.value);
      input.value = "";
    };
    on("[data-send]", "click", say);
    on("[data-say]", "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") say();
      else if ((e as KeyboardEvent).key === "Escape") this.close();
    });
    this.renderChat();
    const again = panel.querySelector<HTMLInputElement>("[data-say]");
    if (again) {
      again.value = typing;
      if (typingFocused) again.focus();
    }
  }

  private renderChat() {
    const box = this.panel.querySelector("[data-chat]");
    if (!box) return;
    box.innerHTML = this.chatLines
      .slice(-12)
      .map((l) => `<div class="sub">${l.from ? `<b>${escape(l.from)}:</b> ${escape(l.text)}` : `<i>${escape(chatText(l))}</i>`}</div>`)
      .join("") || `<div class="sub">${tr(`Nothing said yet.`)}</div>`;
  }
}

/**
 * The lobby in the original's look (docs/agents/windows-as-parts.md): each colour's row on the Advanced Options'
 * own marble in that colour (ADOP?PNL's `ground`), the checks as the System Options' (SYSOPCHK). Set as CSS images
 * on the panel; without the game files the plain rows and the browser's checks stay.
 */
function lobbyArt(panel: HTMLElement) {
  loadCheckArt(panel);
  "rbygopts".split("").forEach((letter, seat) => {
    void partTexture(adopPanel(letter), "ground", seat)
      .then((t) => {
        if (!t) return;
        // (textureCanvas is the whole picture: the part is its frame, cut out here.)
        const c = document.createElement("canvas");
        c.width = t.frame.width;
        c.height = t.frame.height;
        c.getContext("2d")!.drawImage(textureCanvas(t), t.frame.x, t.frame.y, t.frame.width, t.frame.height, 0, 0, t.frame.width, t.frame.height);
        panel.style.setProperty(`--slot-${seat}`, `url(${c.toDataURL()})`);
      })
      .catch(() => {});
  });
}

/** A chat line as this page says it: the host's own lines (a key and its values) in our language, a player's as typed. */
function chatText(l: ChatLine): string {
  if (!l.key) return l.text;
  return tr(l.key, ...(l.args ?? []).map((a) => (typeof a === "object" ? tr(PLAYER_NAMES[a.colour] ?? String(a.colour)) : a))); // i18n-ok (the host's line, keyed by its English)
}
