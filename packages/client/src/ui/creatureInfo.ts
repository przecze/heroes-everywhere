// The original right-click creature popup (CRSTKPU): portrait on the town backdrop, stats,
// morale and luck, abilities. Used in battle and for any army slot outside it.
import { abilityLine } from "../i18n/abilities.ts";
import { touchScale } from "./screen.ts";
import { placePopup } from "./blocks/popupPlace.ts";
import { isTouchLongPress, untilReleased } from "../touch.ts";
import type { CreatureStats } from "@heroes/core";
import { Container, type FederatedPointerEvent, Sprite } from "pixi.js";
import { creaturePic } from "./creaturePic.ts";
import { loadDef, loadImage } from "../assets.ts";
import { GameText, WHITE, YELLOW } from "../text.ts";
import { BAD, GOOD } from "./stackBreakdown.ts";
import { originalWords } from "./gameText.ts";
import { tr, maybeTr, said, type Text } from "../i18n/index.ts";
import { extra } from "../settings.ts";
import type { BreakLine } from "./stackBreakdown.ts";

export interface CreatureInfo {
  count: number;
  /** Values in this battle / with this hero, when they differ from the creature's own. */
  attack?: number;
  defense?: number;
  speed?: number;
  shots?: number;
  healthLeft?: number;
  morale?: number;
  luck?: number;
  status?: Text;
  /** Whose colours the card's frame takes (else the player at this screen, setPopupPlayer). */
  player?: number;
  /** Spells on the stack (battle): their icons with the rounds left, in place of the abilities. */
  effects?: { spell: number; rounds: number }[];
  /** Where the bonuses come from (stackBreakdown.ts), for the window's collapsed list of effects. */
  breakdown?: BreakLine[];
}

/** A number as "base +bonus = total" in pieces to colour (the addition, EXTRAS stackBonus); null when it has no bonus or the classic "base(total)" stays. */
export function bonusParts(base: number, now?: number): { text: string; color: "base" | "good" | "bad" }[] | null {
  if (!extra("stackBonus") || now === undefined || now === base) return null;
  const d = now - base;
  const c = d > 0 ? "good" : "bad";
  return [
    { text: `${base} `, color: "base" },
    { text: `${d > 0 ? "+" : "-"}${Math.abs(d)} `, color: c },
    { text: `= ${now}`, color: c },
  ];
}

/** The rows' names as the game's files have them (PRISKILL 0 / 1, GENRLTXT 198 / 199 / 388 / 200 / 193, VCMI's CStackWindow), once loaded. */
let rowWord: (ours: string) => string = (ours) => ours;
let rowWordsLoading: Promise<unknown> | undefined;
export const loadRowWords = () =>
  (rowWordsLoading ??= Promise.all([
    originalWords("priskill", { "Attack Skill": 0, "Defense Skill": 1 }),
    originalWords("genrltxt", { Shots: 198, Damage: 199, Health: 388, "Health Left": 200, Speed: 193 }),
  ]).then(([a, b]) => (rowWord = (ours) => (ours === "Attack Skill" || ours === "Defense Skill" ? a(ours) : b(ours)))));

/** The popup's numbers: name and value (with this battle's or hero's in brackets when they differ). */
export function creatureRows(c: CreatureStats, info: CreatureInfo): [string, string][] {
  return creatureRowParts(c, info).map(([k, v]) => [k, v]);
}

/** creatureRows with the coloured pieces of the values that have a bonus (else undefined). */
export function creatureRowParts(c: CreatureStats, info: CreatureInfo): [string, string, ReturnType<typeof bonusParts>][] {
  const withBonus = (base: number, now?: number) => (now === undefined || now === base ? String(base) : `${base}(${now})`);
  const rows: [string, string][] = [
    ["Attack Skill", withBonus(c.attack, info.attack)],
    ["Defense Skill", withBonus(c.defense, info.defense)],
    ["Shots", c.shots ? `${info.shots ?? c.shots}` : "-"],
    ["Damage", `${c.minDamage} - ${c.maxDamage}`],
    ["Health", String(c.hp)],
    ["Health Left", String(info.healthLeft ?? c.hp)],
    ["Speed", withBonus(c.speed, info.speed)],
  ];
  const segs: Record<string, ReturnType<typeof bonusParts>> = {
    "Attack Skill": bonusParts(c.attack, info.attack),
    "Defense Skill": bonusParts(c.defense, info.defense),
    Speed: bonusParts(c.speed, info.speed),
  };
  return rows.map(([k, v]) => [rowWord(k), segs[k] ? segs[k]!.map((p) => p.text).join("") : v, segs[k] ?? null]);
}

/** The abilities worth naming, readable: the game's own text when it has one ("Flies. Breath attack."), else from the ability list. */
export function creatureAbilities(c: CreatureStats): string[] {
  if (c.abilityText) return [abilityLine(c.abilityText.replace(/\s+/g, " "))];
  if (HOTA_TEXT[c.id] !== undefined) return HOTA_TEXT[c.id] ? [tr(HOTA_TEXT[c.id])] : [];
  return c.abilities
    .filter((a) => !["NONE", "KING", "MORE_DAMAGE_FROM_SPELL", "SKELETON_TRANSFORMER_TARGET", "SPELL_IMMUNITY", "DOUBLE_WIDE"].includes(a.type) && !(a.type === "CASTS" && HOTA_NAMES[abilityKey(c)]))
    .map((a) => maybeTr(HOTA_NAMES[`${a.type}:${a.subtype ?? ""}:${Math.sign(a.val ?? 0)}`] ?? HOTA_NAMES[`${a.type}:${a.subtype ?? ""}`]) ?? a.type.replace(/_/g, " ").toLowerCase().replace(/^./, (ch) => ch.toUpperCase()) + (a.subtype ? ` (${a.subtype})` : ""));
}

/**
 * HotA's creatures' ability texts. HotA keeps them in its own data, not in the text files (nor in
 * HotA.lod): the Cove's and the Cannon's are the HotA mod's "Special Ability" lines (its english.json),
 * the rest written in the same style from their abilities.
 */
// i18n-keys
const HOTA_TEXT: Record<number, string> = {
  150: "Ranged attack. Can attack siege walls.",
  151: "Ranged attack. No melee penalty. No enemy retaliation. Accurate shot.",
  153: "Teleporting. Immune to Ice Bolt and Frost Ring spells.",
  154: "Teleporting. Immune to Ice Bolt and Frost Ring spells.",
  155: "",
  156: "",
  157: "Ranged attack. No melee penalty.",
  158: "Ranged attack. No melee penalty. No enemy retaliation.",
  159: "Flying.",
  160: "Flying. Ferocity.",
  161: "Ranged attack. A spell after each shot (basic).",
  162: "Ranged attack. A spell after each shot (advanced).",
  163: "Ignores 30% of enemy's attack skill.",
  164: "Ignores 60% of enemy's attack skill.",
  165: "Poisonous.",
  166: "Poisonous. Revenge.",
  167: "Casts Mirth.",
  168: "Flies. Unlimited retaliations. Hypnotizes. Mind spell immunity.",
  169: "Casts Fortune. +1 Luck for the army.",
  170: "Non-living. Takes 85% less damage from spells.",
  171: "Shoots grenades. Ignores 20% of the enemy's Defense. +1 Luck.",
  172: "Attacks two hexes. Repairs mechanical allies and war machines.",
  173: "Attacks two hexes. Repairs mechanical allies and war machines.",
  174: "",
  175: "",
  176: "Mechanical. Detonates when killed once ignited.",
  177: "Mechanical. No enemy retaliation. Detonates when killed once ignited.",
  178: "Burrows.",
  179: "Burrows. Devours corpses for extra strikes.",
  180: "Shoots. Strikes first at range. Ranged retaliation.",
  181: "Shoots. Strikes first at range. Unlimited ranged retaliations.",
  182: "Flies. Meditation.",
  183: "Flies. Meditation (keeps its turn).",
  184: "Mechanical. Heat Stroke.",
  185: "Mechanical. Heat Stroke.",
  186: "Generates 1 gold a day.",
  187: "Generates 1 gold a day.",
  188: "",
  189: "Takes less damage from spells.",
  190: "Shoots. No melee penalty.",
  191: "Shoots. No melee penalty. Shoots when blocked.",
  192: "Shakes off spells after a round.",
  193: "Shakes off spells after a round. Rune levels.",
  194: "Shoots. Casts Air Shield.",
  195: "Shoots. Casts Air Shield. Freezing shot.",
  196: "",
  197: "+100% Defense when defending.",
  198: "Teleports allies. Slows enemy flyers.",
  199: "Teleports allies. Slows enemy flyers more.",
};

/** HotA's own names for its creatures' abilities (as their popups have them). */
// i18n-keys
const HOTA_NAMES: Record<string, string> = {
  "PRIMARY_SKILL:defenceWhileDefending": "Defense bonus",
  "STACKS_SPEED::-1": "Slows enemy flyers",
  "SPELLCASTER:teleport": "Teleport",
  "SPELLCASTER:detonates01": "Detonation",
  "SPELLCASTER:detonates02": "Detonation",
  "SPELLCASTER:summonLarva": "Devours corpses",
  "GENERATE_RESOURCE:gold": "Generates gold",
};
/** A HotA spellcaster with a name of its own: its casts count isn't named apart. */
const abilityKey = (c: CreatureStats) => {
  const a = c.abilities.find((x) => x.type === "SPELLCASTER");
  return a ? `SPELLCASTER:${a.subtype ?? ""}` : "";
};

/** Builds the popup (298 x 311). */
export async function creaturePopup(c: CreatureStats, info: CreatureInfo): Promise<Container> {
  const box = new Container();
  // The card's frame in the player's colours (VCMI's CStackWindow is PLAYER_COLORED); kit.ts is
  // loaded lazily, as it uses this module's popups itself.
  const player = info.player ?? popupPlayer;
  await loadRowWords().catch(() => {});
  const [bg, morale, luck, icons] = await Promise.all([
    import("./kit.ts").then((kit) => kit.loadImagePlayer("crstkpu.pcx", player)).catch(() => loadImage("crstkpu.pcx")),
    loadDef("imrl42.def"),
    loadDef("ilck42.def"),
    info.effects?.length ? loadDef("spellint.def").catch(() => null) : null,
  ]);
  box.addChild(new Sprite(bg));
  const text = (value: Text, x: number, y: number, align: "left" | "center" = "left", width?: number, color: readonly [number, number, number] = WHITE) => {
    const t = new GameText("smalfont", color, align, width);
    t.value = value;
    t.position.set(x, y);
    box.addChild(t);
    return t;
  };
  // (The original's places, as VCMI's CCreatureWindow had them: the name centred on 149, 30 in the
  // title strip of CRSTKPU; the rows' names from 155, 48 + 19 per row, their values ending at 276,
  // both in the rows' 16 px strips; the status centred in the bottom strip, 285-302.)
  const centred = (value: Text, x: number, y: number, color: readonly [number, number, number] = WHITE) => {
    const t = new GameText("smalfont", color);
    t.value = value;
    box.addChild(t.centreOn(x, y));
  };
  // The name in the title, the count in the picture's corner (VCMI's CCreaturePic, HotA's screenshots: "Magogs", 43).
  centred(info.count === 1 ? said(c.name) : said(c.plural), 149, 30, YELLOW);
  // Portrait: the creature on its town's backdrop, animated as the original (VCMI's CCreaturePic).
  const portrait = await creaturePic(c, true);
  portrait.position.set(20, 47);
  box.addChild(portrait);
  if (info.count > 0) {
    const n = new GameText("medfont", WHITE);
    n.value = said(String(info.count));
    n.position.set(20 + portrait.width - n.width - 3, 47 + portrait.height - n.height - 1);
    box.addChild(n);
  }
  creatureRowParts(c, info).forEach(([k, v, parts], i) => {
    const label = text(said(k), 155, 48 + i * 19);
    const val = text(said(v), 0, 48 + i * 19);
    val.x = 276 - val.width;
    if (parts) {
      // "7 +1 = 8": the creature's own white, the change and the total in green or red.
      val.destroy();
      const colours = { base: WHITE, good: GOOD, bad: BAD };
      const texts = parts.map((p) => text(said(p.text.trimEnd()), 0, 48 + i * 19, "left", undefined, colours[p.color]));
      let x = 276 - texts.reduce((a, t) => a + t.width + 4, -4);
      for (const t of texts) {
        t.x = x;
        x += t.width + 4;
      }
      if (label.x + label.width + 4 > texts[0].x) label.value = said(k.replace(/ Skill$/, ""));
      return;
    }
    // A long value with its bonus ("18(36)"): "Defense Skill" gives way to "Defense".
    if (label.x + label.width + 4 > val.x) label.value = said(k.replace(/ Skill$/, ""));
  });
  // Morale and luck boxes (icons hold -3..+3 as frames 0..6).
  const mf = morale.get(0)?.[Math.max(-3, Math.min(3, info.morale ?? 0)) + 3];
  if (mf) box.addChild(Object.assign(new Sprite(mf.texture), { x: 23, y: 189 }));
  const lf = luck.get(0)?.[Math.max(-3, Math.min(3, info.luck ?? 0)) + 3];
  if (lf) box.addChild(Object.assign(new Sprite(lf.texture), { x: 76, y: 189 }));
  // The spells on the stack in the lower right (icon, rounds left in the corner), as VCMI's stack
  // window does; without any, the creature's abilities fill the space.
  const effects = (info.effects ?? []).filter((e) => icons?.get(0)?.[e.spell + 1]).slice(0, 6);
  effects.forEach((e, i) => {
    const x = 126 + 52 * (i % 3);
    const y = 186 + 46 * Math.floor(i / 3);
    box.addChild(Object.assign(new Sprite(icons!.get(0)![e.spell + 1].texture), { x, y }));
    const n = new GameText("tiny", WHITE);
    // No count for what lasts until something happens (Berserk, Disrupting Ray).
    n.value = e.rounds >= 255 ? said("") : said(String(e.rounds));
    n.position.set(x + 46 - n.width, y + 36 - n.height);
    box.addChild(n);
  });
  const abilities = creatureAbilities(c);
  if (!effects.length && abilities.length) {
    const words = text(said(abilities.join(", ")), 128, 188, "left", 150);
    // A long text (Magic Elementals') in the smaller font, so it stays inside the frame.
    if (words.height > 82) {
      words.destroy();
      const small = new GameText("tiny", WHITE, "left", 150);
      small.value = said(abilities.join(", "));
      small.position.set(128, 188);
      box.addChild(small);
    }
  }
  if (info.status) centred(info.status, 149, 294);
  return box;
}

/** The player at this screen: the colour of the popups' frames (VCMI falls back to blue). */
let popupPlayer = 1;
/** The player at this screen (for frames in their colours). */
export const screenPlayer = () => popupPlayer;
export function setPopupPlayer(player: number) {
  if (player >= 0 && player < 8) popupPlayer = player;
}

let layer: Container | null = null;
/** Where popups go (set once by the app): above everything. (Placed whole on the screen by ui/blocks/popupPlace.ts.) */
export function setPopupLayer(l: Container) {
  layer = l;
}

/** Shows a popup near a point while the pointer is held (or until the returned function is called). */
export function showPopup(build: () => Promise<Container>, x: number, y: number): () => void {
  let gone = false;
  let shown: Container | null = null;
  void build().then((box) => {
    if (gone || !layer) return void box.destroy({ children: true });
    box.label ||= "popup: held";
    box.scale.set(touchScale(box.width, box.height));
    layer.addChild(box);
    placePopup(box, { at: { x, y } });
    shown = box;
  });
  return untilReleased(
    () => {
      gone = true;
      shown?.destroy({ children: true });
    },
    { popup: true },
  );
}

/**
 * Right button held on `target`: the creature popup (nothing when `what` returns null). A finger held
 * on an army slot opens its window instead (`open`: the stack's info with the quick actions under it).
 */
export function creatureOnRightClick(target: Container, what: () => { c: CreatureStats; info: CreatureInfo } | null, open?: () => void) {
  target.eventMode = "static";
  target.on("rightdown", (e: FederatedPointerEvent) => {
    const w = what();
    if (!w) return;
    if (open && isTouchLongPress()) return open();
    showPopup(() => creaturePopup(w.c, w.info), e.global.x, e.global.y);
  });
}
