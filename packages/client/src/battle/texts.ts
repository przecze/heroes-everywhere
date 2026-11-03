// The battle console's words: the log's lines in the game files' words (GENRLTXT, the packs in other languages),
// the line while nothing is pointed at, a stack described, why a spell can't be cast.
import type { BattleView } from "./view.ts";
import { settings } from "../settings.ts";
import { attackOf, defenseOf, hpOf, speedOf, type SpellInfo, magicBlock, HOTA_ARTIFACTS, type BattleState, type Unit, activeUnit, stats, type WallPart, controlSide, actsByItself, type LogEntry, logText, lineOf, stackName } from "@heroes/core";
import { oneHand, phoneSized, screenSize } from "../ui/screen.ts";
import { packLines } from "../ui/gameText.ts";
import { GEN } from "../i18n/genrltxt.ts";
import { OURS } from "../i18n/battleOurs.ts";
import { has, lang, tr, type Text, said, fmt, fallback } from "../i18n/index.ts";

export class BattleTexts {
  private readonly v: BattleView;
  constructor(v: BattleView) {
    this.v = v;
  }

  /** What a right-click while aiming says (GENRLTXT 731, loaded with the battle). */
  cancelledText = tr("Spell cancelled");

  describe(u: Unit): Text {
    const s = this.v.state!;
    const c = stats(s, u);
    const who = fmt`${u.count} ${u.count === 1 ? said(c.name) : said(c.plural)}`;
    // The combat options' Creature Info "spells only": the spells on the stack. Otherwise its name, as the original's
    // bar (its numbers are the stack panel's and the right-click card's: an English "Att 7 Def 9 Dmg 2-5" line of ours
    // here was neither translated nor the original's, the owner 2026-10-27).
    if (settings().creatureInfo !== "spells") return who;
    const spells = (u.effects ?? []).map((e) => s.spells?.[e.spell]?.name).filter(Boolean);
    return fmt`${who}  ·  ${spells.length ? said(spells.join(", ")) : tr("No spells")}`;
  }

  /** A stack's numbers in this battle for the phone's cards, in the player's language (once English whatever it was). */
  numbers(u: Unit): string {
    const s = this.v.state!;
    const c = stats(s, u);
    return tr("Att %1  Def %2  Dmg %3-%4  HP %5  Spd %6", attackOf(s, u), defenseOf(s, u), c.minDamage, c.maxDamage, `${u.firstHp}/${hpOf(s, u)}`, speedOf(s, u));
  }

  /** How many lines back the bar's log is scrolled (ComSlide arrows, Up / Down); a new line returns to the end. */
  private logBack = 0;
  private logSeen = 0;

  private logSync(s: BattleState) {
    if (s.log.length !== this.logSeen) ((this.logSeen = s.log.length), (this.logBack = 0));
  }

  scrollLog(d: number) {
    const s = this.v.state;
    if (!s) return;
    this.logSync(s);
    this.logBack = Math.max(0, Math.min(s.log.length - 1, this.logBack + d));
    this.v.setHint(this.idleHint());
  }

  idleHint(): Text {
    const s = this.v.state;
    if (!s) return said("");
    this.logSync(s);
    // Scrolled back: two lines of the log, as the original's console.
    if (this.logBack > 0) {
      const end = s.log.length - this.logBack;
      return said(s.log.slice(Math.max(0, end - 2), end).map((e) => this.logLine(e)).join("\n"));
    }
    if (s.winner !== null) return this.logLine(s.log[s.log.length - 1]);
    // A spell picked from the book: say what to do next (a finger has no cursor to show it).
    if (this.v.casting) {
      const name = this.v.casting.spell.name;
      if (!screenSize.touch) return tr("%1: click a target (right-click or Esc to cancel).", name);
      return oneHand() && phoneSized() && !screenSize.portrait ? tr("%1: aim on the pad, tap it to cast (hold to cancel).", name) : tr("%1: tap a target (hold to cancel).", name);
    }
    const sel = this.v.myTactics() ? this.v.tacticSel : null;
    if (sel)
      return screenSize.touch
        ? tr("Tactics: place the %1 (tap a shaded hex, then again), or tap another stack.", stackName(s, sel))
        : tr("Tactics: click where the %1 should stand, or another stack.", stackName(s, sel));
    const u = activeUnit(s);
    if (!u) return said("");
    // (Touch layouts say how to take over under the message, the blows included.)
    // (A stack the combat options' Auto-Combat Options leave to the player: said so, then as any turn of theirs.)
    const handed = this.v.auto && !!this.v.myActive() && this.v.leftToPlayer(u);
    if (handed && !this.v.casting && u.machine !== "catapult" && u.machine !== "tent") return fmt`${tr("Round %1", s.round)} · ${tr("Auto combat leaves the %1 to you", stackName(s, u))}\n${this.logLine(s.log[s.log.length - 1])}`;
    if (this.v.auto && !handed) return fmt`${tr("Round %1", s.round)} · ${tr("Auto combat: %1", stackName(s, u))}\n${screenSize.touch ? this.logLine(s.log[s.log.length - 1]) : tr("Click the field or press A to take over.")}`;
    const whose = this.v.mine(controlSide(u)) && !actsByItself(s, u) ? tr("Your turn") : tr("%1 is thinking", s.sides[controlSide(u)].name);
    if (u.machine === "catapult" && this.v.mine(controlSide(u)) && !actsByItself(s, u)) return fmt`${tr("Round %1", s.round)} · ${whose}: ${tr("Catapult")}\n${screenSize.touch ? tr("Tap the wall, tower or gate to aim at.") : tr("Click the wall, tower or gate to aim at.")}`;
    if (u.machine === "tent" && this.v.mine(controlSide(u))) return fmt`${tr("Round %1", s.round)} · ${whose}: ${tr("First Aid Tent")}\n${screenSize.touch ? tr("Tap a wounded stack to heal it.") : tr("Click a wounded stack to heal it.")}`;
    return fmt`${tr("Round %1", s.round)} · ${whose}: ${said(stackName(s, u))}\n${this.logLine(s.log[s.log.length - 1])}`;
  }

  /** GENRLTXT (VCMI's numbering), for the original's combat log lines. */
  gen: string[] = [];
  /** Artifact names (ARTRAITS.TXT), for the messages that name one. */
  artifactNames: string[] = [];
  /** A log entry in the game files' words (GENRLTXT), as the console showed it while it played; our English without them. */
  logLine(e: LogEntry | undefined): Text {
    if (e === undefined || !this.v.state) return said("");
    // A language with its battle log (languages.ts): the packs' GENRLTXT lines and our own; the game files' lines are English.
    const l = lang();
    // (A language with its own release's files has no copied lines: its GENRLTXT is the pack's, `packed`.)
    const gen = has(l, "battleLog") ? (GEN[l] ?? {}) : undefined;
    const ours = has(l, "battleLog") ? OURS[l] : undefined;
    return said(logText(this.v.state, e, gen && ours ? { gen: (id) => gen[id] ?? this.packed(id) ?? this.gen[id], ours: (key) => ours[key] } : { gen: (id) => this.gen[id] }));
  }

  /** GENRLTXT's line `id` in the interface's language from the packs (languages.ts gameTexts: every line, not only the log's), once loaded. */
  private packed(id: number): string | undefined {
    const l = lang();
    if (!has(l, "gameTexts")) return undefined;
    const p = this.packs.get(l);
    if (!p) this.packs.set(l, (void packLines("genrltxt").then((t) => this.packs.set(l, t ?? {})), {}));
    return this.packs.get(l)?.[id];
  }
  packs = new Map<string, Record<string, string>>();

  /**
   * The original's line `id` filled with `args`: the language's own (its pack's), else the game files' (English
   * here, mixed with the language's names), else (no game files) the line's number. The words always come from
   * files, never from our code.
   */
  line(id: number, ...args: (string | number)[]): Text {
    const own = this.chosen(id);
    const t = own ?? this.gen[id];
    if (!t) return fallback(lineOf("genrltxt", id, args), `genrltxt ${id}`);
    let k = 0;
    const filled = t.replace(/%[sd]/g, () => String(args[k++] ?? "")).replace(/^\n/, "");
    // (The game files' English where the language has no line of its own: shown, and noted.)
    return own ? said(filled) : fallback(filled, `genrltxt ${id}`);
  }

  /** The line `line` fills in: the language's own, else (in English) the game's; undefined when it falls back. */
  private chosen(id: number): string | undefined {
    const l = lang();
    const own = (has(l, "battleLog") ? GEN[l]?.[id] : undefined) ?? this.packed(id);
    const t = own ?? this.gen[id];
    return !t || (l !== "en" && !own) ? undefined : t;
  }

  /** How many of `line`'s values the line used shows (an older release's translation can drop the last: the Polish
   *  "Atakuj: %s (%s - obrażenia)" has no kills, HotA's English has); Infinity when it falls back to ours. */
  shows(id: number): number {
    const t = this.chosen(id);
    return t ? (t.match(/%[sd]/g) ?? []).length : Infinity;
  }

  /** The original's reason a spell can't be cast here (GENRLTXT 537 Cursed Ground, 536 Recanter's Cloak,
   *  700 the Orb of Inhibition, 541 anything else, as VCMI), or null when nothing blocks it. */
  blockedText(s: BattleState, sp: SpellInfo, heroName: string): Text | null {
    const why = magicBlock(s, sp);
    if (!why) return null;
    if (why.by === "cursedGround") return this.line(537).trim();
    // (An Anti-magic Garrison: the original's general line, as VCMI.)
    if (why.by === "garrison") return this.line(541, heroName).trim();
    const art = why.artifact === undefined ? "" : (this.artifactNames[why.artifact] ?? HOTA_ARTIFACTS[why.artifact]?.name ?? "");
    if (why.type === "BLOCK_MAGIC_ABOVE" && art) return this.line(536, art, heroName).trim();
    if (why.type === "BLOCK_ALL_MAGIC" && art) return this.line(700, art).trim();
    return this.line(541, heroName).trim();
  }

}

export const PART_NAMES: Record<WallPart, string> = {
  keep: "keep",
  bottomTower: "lower tower",
  bottomWall: "lower wall",
  belowGate: "wall below the gate",
  overGate: "wall above the gate",
  upperWall: "upper wall",
  upperTower: "upper tower",
  gate: "gate",
};
