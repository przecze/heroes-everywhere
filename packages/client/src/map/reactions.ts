// What the adventure screen does for each of the game's events: a sound, a message, a window to
// open. Kept apart from the screen so a test (or a headless check) can see that every event the
// player gets has an answer on screen; map/inbox.ts carries the reactions out, in order.
import { type AdventureEvent, type AdventureState, type Component, type TextRef, SPELL_ART, startsMonth, startsWeek } from "@heroes/core";
import { ObjectSounds } from "./sounds.ts";
import { resourceName } from "../ui/resourceNames.ts";
import { type Text, fmt, rulesText, said } from "../i18n/index.ts";

/** The rules' words for an event: the game's own line replaces them once loaded (`ref`); without one, ours or noted English. */
const rules = (text: string | undefined, ref: TextRef | undefined, where: string): Text => (ref ? said(text ?? "") : rulesText(text, where));

export type OfferEvent = Extract<AdventureEvent, { e: "offer" }>;

export type Reaction =
  /** A hero's walk; `z` is the level it began on (only the shown level animates). */
  | { r: "animate"; hero: number; path: number[]; z?: number }
  | { r: "sound"; name: string }
  /** A window (or with `toast`, the info box when visit toasts are on). */
  | { r: "message"; text: Text; ref?: TextRef; components?: Component[]; toast?: boolean }
  /** The status bar: `text`, then the original's own line once it's loaded. */
  | { r: "status"; text: Text; ref?: TextRef; components?: Component[] }
  /** A picked-up pile shown in the info box for a moment. */
  | { r: "pile"; resource: number; amount: number }
  /** The status line once the battle screen has closed. */
  | { r: "battleLine"; text: string }
  | { r: "town"; object: number }
  | { r: "dwelling"; hero: number; object: number }
  /** Select this hero once the update is shown (it came out somewhere else). */
  | { r: "follow"; hero: number }
  | { r: "shipyard"; object: number }
  | { r: "market"; hero: number; object: number }
  | { r: "offer"; event: OfferEvent }
  /** A timed or town event's script asks the player (no hero to ask). */
  | { r: "scriptAsk"; event: Extract<AdventureEvent, { e: "scriptAsk" }> }
  | { r: "joiners"; hero: number }
  | { r: "garrison"; hero: number; object: number }
  | { r: "puzzle" }
  | { r: "exchange"; heroes: [number, number] }
  /** View Air / View Earth: the world view with what the spell reveals. */
  | { r: "worldView" }
  /** The game has just ended (won or lost is the screen's to tell, by team). */
  | { r: "gameOver" }
  /** Another player is out of the game (GENRLTXT 5, "%s has been vanquished!"; A player, 2026-10-28: no word of it). */
  | { r: "vanquished"; player: number }
  /** Someone else's hero fought a monster on the map (no battle screen for us): a beat to see it, before it's gone. */
  | { r: "clash"; hero: number; object: number }
  /** A new day: its jingle (a new week's or month's), the HUD's day, the astrologers on a week's first. */
  | { r: "newDay"; sound: "newday" | "newweek" | "newmonth" };

/**
 * The screen's reactions to one update, in the events' order, then the game's end and a new day. `prev` is the state shown so far
 * (null on a game's first update), `me` the player at this screen, `messageSeat` the one the map's
 * timed messages are for (on the first update `me` isn't known yet). `sounds` carries the object
 * sounds from one update to the next (a question's sound isn't played again with its answer).
 */
export function reactionsFor(prev: AdventureState | null, next: AdventureState, events: AdventureEvent[], me: number, messageSeat: number, sounds = new ObjectSounds()): Reaction[] {
  const out: Reaction[] = [];
  const mine = (hero: number) => next.heroes[hero]?.owner === me;
  const heard = sounds.update(prev, next, me);
  for (const ev of events) {
    // The object's own sound as a hero of ours gets there (with its message, window or question),
    // and its pickup sound as it leaves the map.
    for (const name of heard(ev)) out.push({ r: "sound", name });
    switch (ev.e) {
      case "move":
        out.push({ r: "animate", hero: ev.hero, path: ev.path, z: prev?.heroes[ev.hero]?.z });
        break;
      case "visit":
      case "pickup": {
        if (!mine(ev.hero)) break;
        // Only our own heroes' visits and pickups are told (the others' showed up while we waited).
        if (ev.e === "visit") {
          if (ev.sound) out.push({ r: "sound", name: ev.sound });
          out.push({ r: "status", text: rules(ev.message, ev.text, "visit"), ref: ev.text, components: ev.components });
          out.push({ r: "message", text: rules(ev.message, ev.text, "visit"), ref: ev.text, components: ev.components, toast: true });
        } else {
          // As the original: the pile shows in the info box for a moment, no window
          // (one with its own text from the map is a window: the visit event that follows).
          out.push({ r: "status", text: fmt`+${ev.amount} ${resourceName(ev.resource)}` });
          if (!ev.own) out.push({ r: "pile", resource: ev.resource, amount: ev.amount });
        }
        break;
      }
      case "message":
        if (ev.player === messageSeat) out.push({ r: "message", text: said(ev.text), components: ev.components }); // (the map's own words, in its language: i18n/mapText.ts)
        break;
      case "scriptAsk":
        if (ev.player === messageSeat) out.push({ r: "scriptAsk", event: ev });
        break;
      case "battleResult": {
        // The event is told from the attacker's side.
        const attackerMine = mine(ev.hero);
        const defenderMine = ev.defender !== undefined ? mine(ev.defender) : next.objects[ev.object]?.owner === me && !ev.won;
        if (attackerMine || defenderMine) out.push({ r: "battleLine", text: ev.won === attackerMine ? "Victory!" : "Your hero has been defeated." });
        // (A note of 2026-11-02: "Enemies made a break and it was sudden. Ideally you see the enemy attack the stack, then
        // a short pause as the stack disappears, then the enemy continues".)
        else if (ev.defender === undefined && prev?.objects[ev.object]?.type === 54) out.push({ r: "clash", hero: ev.hero, object: ev.object });
        break;
      }
      case "town":
        if (mine(ev.hero)) out.push({ r: "town", object: ev.object });
        break;
      case "dwelling":
        if (mine(ev.hero)) out.push({ r: "dwelling", hero: ev.hero, object: ev.object });
        break;
      case "teleport":
        if (mine(ev.hero)) out.push({ r: "follow", hero: ev.hero });
        break;
      case "shipyard":
        if (mine(ev.hero)) out.push({ r: "shipyard", object: ev.object });
        break;
      case "market":
        if (mine(ev.hero)) out.push({ r: "market", hero: ev.hero, object: ev.object });
        break;
      case "offer":
        if (mine(ev.hero)) out.push({ r: "offer", event: ev });
        break;
      case "joiners":
        if (mine(ev.hero)) out.push({ r: "joiners", hero: ev.hero });
        break;
      case "garrison":
        if (mine(ev.hero)) out.push({ r: "garrison", hero: ev.hero, object: ev.object });
        break;
      case "obelisk":
        if (!mine(ev.hero)) break;
        out.push({ r: "message", text: said("Your hero studies the obelisk and copies the markings onto the puzzle map."), ref: { file: "advevent", id: 96 } }); // i18n-ok (ADVEVENT 96 replaces it)
        out.push({ r: "puzzle" });
        break;
      case "meet":
        if (mine(ev.hero)) out.push({ r: "exchange", heroes: [ev.hero, ev.other] });
        break;
      case "spell": {
        if (!mine(ev.hero)) break;
        // The spell's own sound, as in battle (Summon Boat, Fly, Town Portal...).
        const sound = SPELL_ART[ev.spell]?.sound;
        if (sound) out.push({ r: "sound", name: sound });
        if (ev.message) out.push({ r: "message", text: rules(ev.message, ev.text, "spell"), ref: ev.text });
        // View Air / View Earth: the world view with what the spell reveals.
        if (ev.spell === 5 || ev.spell === 3) out.push({ r: "worldView" });
        const h = next.heroes[ev.hero];
        if (h.x !== prev?.heroes[ev.hero]?.x || h.y !== prev?.heroes[ev.hero]?.y) out.push({ r: "follow", hero: ev.hero });
        break;
      }
      // Shown by the state itself (flags, buildings, the day and turn in the HUD; a battle opens its screen).
      case "flag":
      case "battle":
      case "built":
      case "day":
      case "turn":
        break;
      default:
        ev satisfies never;
    }
  }
  if (next.winner !== undefined && prev?.winner === undefined) out.push({ r: "gameOver" });
  // (The game going on without them: its end says it all otherwise.)
  else if (prev && next.winner === undefined) next.players.forEach((p, i) => i !== me && prev.players[i]?.alive && !p.alive && out.push({ r: "vanquished", player: i }));
  if (prev && next.day > prev.day) out.push({ r: "newDay", sound: startsMonth(next.day) ? "newmonth" : startsWeek(next.day) ? "newweek" : "newday" });
  return out;
}
