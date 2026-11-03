// New Game's setup pieces, one set for the computer's original window (scenarioSelect.ts) and the phone's (mobileNewGame.ts):
// the map list's format icon (HotA's horn for a HotA map), the starting town's and hero's pictures (Random's own
// pictures, never a floating "?"), which towns and heroes a colour may start with (HotA's greyed, saying why, while its
// content is off), the town and hero pickers (HotA's grid windows: a tap picks, a long press or the right button shows
// the town's creatures or the hero's specialty), and the card's HotA content check (the horn) and rules scroll (blue).
import { FACTIONS, HOTA_FACTION_LIST, TOWNS, isHotaHero } from "@heroes/core";
import { Container, type FederatedPointerEvent, Graphics, Sprite, type Texture } from "pixi.js";
import { creaturePortrait, heroPortrait, loadDef, loadImage, specialtyIcon, townIcon } from "../../assets.ts";
import { loadData } from "../../gameData.ts";
import { tr, said, fmt, type Text, reason } from "../../i18n/index.ts";
import { townName } from "../../i18n/towns.ts";
import { extra } from "../../settings.ts";
import { WHITE, YELLOW } from "../../text.ts";
import { isTouchLongPress } from "../../touch.ts";
import { specialties } from "../heroScreen.ts";
import { DefButton, label, windowFrame } from "../kit.ts";
import { type Modals } from "../modals.ts";
import { messageBox, textPopup } from "../dialogs.ts";
import { gameRulesWindow, rulesChanged } from "../gameRules.ts";
import { type MapInfo, type ScenarioOptions, FORMAT_ICON, heroesOf } from "../newGameModel.ts";
import { oneHand, screenSize } from "../screen.ts";

const GREY = [150, 150, 150] as const;

// ---- pictures ------------------------------------------------------------------------------

/** The map's format in the scenario list: SCSELC's RoE, AB and SoD pictures, HotA's horn (frame 5: the mod's, see FORMAT_ICON). */
export async function formatIcon(m: Pick<MapInfo, "version" | "hota">): Promise<Texture | undefined> {
  const frames = (await loadDef("scselc.def").catch(() => null))?.get(0);
  return frames?.[m.hota > 0 ? 5 : (FORMAT_ICON[m.version] ?? 2)]?.texture ?? frames?.[2]?.texture;
}

/** HotA's horn (the map format's picture of it), for the HotA content check. */
const hornIcon = async () => (await loadDef("scselc.def").catch(() => null))?.get(0)?.[5]?.texture ?? null;

/** A random town's picture: ITPA's own (its last frame, the question mark over the towns), as VCMI's TOWN_RANDOM. */
export const randomTownIcon = async (): Promise<Texture | null> => (await loadDef("itpa.def").catch(() => null))?.get(0)?.[38]?.texture ?? null;

/** A colour's starting town as the Advanced Options show it (48 x 32). */
export const startTownIcon = (faction?: string): Promise<Texture | null> => (faction ? townIcon(FACTIONS.indexOf(faction), true, false, "small") : randomTownIcon());

/** A colour's starting hero (48 x 32): the hero's portrait, or HPSRAND's for a random one. */
export const startHeroIcon = (hero: number): Promise<Texture | null> => (hero >= 0 ? heroPortrait(hero, "small").catch(() => null) : loadImage("hpsrand.pcx").catch(() => null));

// ---- who may start with what -------------------------------------------------------------

const ALL_CLASSIC = (1 << 9) - 1;

/** Why a HotA town or hero can't be picked now: its content is off on this card. */
export const hotaOffWhy = () => tr("To pick a HotA town or hero, turn HotA content on (the horn on the scenario's card).");

/**
 * The towns a colour may start with (none: its town is fixed). A map of the original's that allows every town allows
 * HotA's three too, as HotA does; a random map's first colour picks from all of them (the map is made around it).
 * Each with why it can't be picked now (HotA's, while the game is without HotA's content).
 */
export function startTowns(m: MapInfo, color: number, o: Pick<ScenarioOptions, "noHota">): { faction: string; why?: Text }[] {
  const p = m.players[color];
  if (!p) return [];
  const randomFirst = randomMapTown(m, color);
  if (!p.randomFaction && !randomFirst) return [];
  let mask = randomFirst ? (1 << FACTIONS.length) - 1 : (p.factions ?? 0);
  if (!m.hota && (mask & ALL_CLASSIC) === ALL_CLASSIC) mask |= HOTA_FACTION_LIST.reduce((a, f) => a | (1 << FACTIONS.indexOf(f)), 0);
  const towns = FACTIONS.filter((_, i) => mask & (1 << i));
  if (towns.length < 2) return [];
  return towns.map((faction) => ({ faction, ...(o.noHota && HOTA_FACTION_LIST.includes(faction) ? { why: hotaOffWhy() } : {}) }));
}

/** A random map whose first colour's town the player picks (its name then carries it: ":f-"); not an advanced start's or a case's. */
export const randomMapTown = (m: MapInfo, color: number) => color === 0 && /^random:/.test(m.file) && !/:(s|c|f)-/.test(m.file);

/** The heroes a colour may start with in its town (none: random only), each with why it can't be picked now. */
export function startHeroes(faction: string | undefined, o: Pick<ScenarioOptions, "noHota">): { hero: number; why?: Text }[] {
  if (!faction) return [];
  return heroesOf(faction).map((hero) => ({ hero, ...(o.noHota && isHotaHero(hero) ? { why: hotaOffWhy() } : {}) }));
}

/** Turns HotA's content on or off for this game: off, any HotA town or hero picked goes back to Random. */
export function setHotaContent(o: ScenarioOptions, on: boolean) {
  o.noHota = on ? undefined : true;
  if (on) return;
  for (const pick of o.picks) {
    if (pick.faction && HOTA_FACTION_LIST.includes(pick.faction)) (pick.faction = undefined), (pick.hero = -1);
    if (pick.hero >= 0 && isHotaHero(pick.hero)) pick.hero = -1;
  }
}

// ---- holding and tapping ---------------------------------------------------------------------

/**
 * A tap on `target` does `tap`; the right button (a long press on a touch screen) does `hold` at the pointer, or `tap`
 * when there's no `hold` (the owner: a long press on a box opens its picker). A long press's own tap after it is let go.
 */
export function tapOrHold(target: Container, tap: () => void, hold?: (x: number, y: number) => void) {
  target.eventMode = "static";
  target.cursor = "pointer";
  let held = 0;
  target.on("rightdown", (e: FederatedPointerEvent) => {
    held = performance.now();
    if (hold) hold(e.global.x, e.global.y);
    else if (screenSize.touch || isTouchLongPress()) tap();
  });
  target.on("pointertap", (e: FederatedPointerEvent) => {
    if (e.button !== 0 || performance.now() - held < 1500) return;
    tap();
  });
}

// ---- the pickers -------------------------------------------------------------------------------

interface GridItem {
  texture: Texture | null;
  caption: Text;
  /** Can't be picked now: said by a tap on it (EXTRAS greyedWhy), the item greyed. */
  why?: Text;
  /** What a long press (the right button) shows: the town's creatures, the hero's specialty. */
  info?: (x: number, y: number) => void;
  label: string;
}

/**
 * HotA's picker window (its Advanced Options' town and hero grids): the title, the items in rows with their names, the
 * one chosen framed in gold, Cancel under them. A tap picks and closes; resolves with the index, or -1.
 */
export async function pickerGrid(modals: Modals, title: Text, items: GridItem[], chosen: number, player: number): Promise<number> {
  // One-handed, three across, so the whole grid fits under the thumb (2026-10-27 11:26: "move it to the thumb side
  // and make 3x5, all reachable by thumb").
  const cols = Math.min(items.length, oneHand() ? 3 : items.length > 12 ? 6 : 5);
  const cellW = 78;
  const iconH = 32;
  const captions = items.map((it) => label(it.caption, "smalfont", it.why ? GREY : WHITE, "center", cellW - 4));
  const capH = Math.max(16, ...captions.map((c) => c.height));
  const cellH = iconH + 4 + capH + 10;
  const rows = Math.ceil(items.length / cols);
  const width = Math.max(300, cols * cellW + 40);
  const head = label(title, "bigfont", YELLOW, "center", width - 40);
  const top = 20 + head.height + 12;
  const height = top + rows * cellH + 12 + 30 + 18;
  const win = await windowFrame(width, height, player);
  head.position.set(20, 18);
  win.addChild(head);
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: number) => (close(), resolve(v));
    const x0 = Math.round((width - cols * cellW) / 2);
    items.forEach((it, i) => {
      const cell = new Container({ label: `pick: ${it.label}` });
      cell.position.set(x0 + (i % cols) * cellW, top + Math.floor(i / cols) * cellH);
      cell.addChild(new Graphics().rect(0, 0, cellW, cellH - 4).fill({ color: 0, alpha: 0.001 }));
      if (it.texture) {
        const s = new Sprite(it.texture);
        s.scale.set(Math.min(1, 58 / s.texture.width, iconH / s.texture.height));
        s.position.set(Math.round((cellW - s.width) / 2), 0);
        if (it.why) s.alpha = 0.4;
        cell.addChild(s);
        if (i === chosen) cell.addChild(new Graphics().rect(s.x - 1.5, s.y - 1.5, s.width + 3, s.height + 3).stroke({ color: 0xffd700, width: 2 }));
      }
      captions[i].position.set(2, iconH + 4);
      if (i === chosen && !it.why) captions[i].tint = 0xffff66;
      cell.addChild(captions[i]);
      tapOrHold(
        cell,
        () => (it.why ? extra("greyedWhy") && void messageBox(modals, it.why, player) : done(i)),
        it.info,
      );
      win.addChild(cell);
    });
    const cancel = new DefButton("icancel.def", Math.round((width - 64) / 2), height - 18 - 30);
    cancel.onClick = () => done(-1);
    win.addChild(cancel);
    close = modals.show(win, { underThumb: true, onKey: (key) => (key === "Escape" ? (done(-1), true) : key === "Enter" ? (done(chosen), true) : false) });
  });
}

/** A town's creatures (its seven dwellings' first creatures), held up as HotA's picker does on the right button. */
export async function showTownInfo(faction: string, player: number, x: number, y: number) {
  const fi = FACTIONS.indexOf(faction);
  const creatures = (await loadData().catch(() => null))?.creatures;
  const ids = (TOWNS[fi]?.creatures ?? []).slice(0, 7).map(([base]) => base);
  const pics = await Promise.all(ids.map((id) => creaturePortrait({ id }, "small").catch(() => null)));
  const comps = ids.flatMap((id, k) => (pics[k] ? [{ texture: pics[k]!, caption: said(creatures?.[id]?.name ?? "") }] : []));
  textPopup(fmt`{${townName(faction)}}`, player, x, y, comps);
}

/** A hero's specialty (its picture, name and what it does), held up as HotA's picker does on the right button. */
export async function showHeroInfo(hero: number, heroNames: string[], player: number, x: number, y: number) {
  const [rows, spec, portrait] = await Promise.all([specialties().catch(() => [] as string[][]), specialtyIcon(hero).catch(() => undefined), heroPortrait(hero, "large").catch(() => null)]);
  const [, long = "", desc = ""] = rows[hero] ?? [];
  const comps = [...(portrait ? [{ texture: portrait, caption: said(heroNames[hero] ?? "") }] : []), ...(spec ? [{ texture: spec, caption: said(long) }] : [])];
  textPopup(said(`{${heroNames[hero] ?? ""}}\n\n${desc}`.trim()), player, x, y, comps);
}

/** The town picker: Random first, then the colour's towns; resolves with the faction (undefined: Random), or null when cancelled. */
export async function pickTown(modals: Modals, towns: { faction: string; why?: Text }[], now: string | undefined, player: number): Promise<{ faction?: string } | null> {
  const icons = await Promise.all([randomTownIcon(), ...towns.map((t) => startTownIcon(t.faction))]);
  const items: GridItem[] = [
    { texture: icons[0], caption: tr("Random"), label: "Random" },
    ...towns.map((t, i) => ({ texture: icons[i + 1], caption: townName(t.faction), why: t.why, label: t.faction, info: (x: number, y: number) => void showTownInfo(t.faction, player, x, y) })),
  ];
  const at = await pickerGrid(modals, tr("Starting Town"), items, now ? towns.findIndex((t) => t.faction === now) + 1 : 0, player);
  return at < 0 ? null : { faction: at === 0 ? undefined : towns[at - 1].faction };
}

/** The hero picker: Random first, then the town's heroes; resolves with the hero (-1: Random), or null when cancelled. */
export async function pickHero(modals: Modals, heroes: { hero: number; why?: Text }[], now: number, heroNames: string[], player: number): Promise<number | null> {
  const icons = await Promise.all([startHeroIcon(-1), ...heroes.map((h) => startHeroIcon(h.hero))]);
  const items: GridItem[] = [
    { texture: icons[0], caption: tr("Random"), label: "Random" },
    ...heroes.map((h, i) => ({ texture: icons[i + 1], caption: said(heroNames[h.hero] ?? ""), why: reason(h.why) ?? undefined, label: heroNames[h.hero] ?? String(h.hero), info: (x: number, y: number) => void showHeroInfo(h.hero, heroNames, player, x, y) })),
  ];
  const at = await pickerGrid(modals, tr("Starting Hero"), items, now >= 0 ? heroes.findIndex((h) => h.hero === now) + 1 : 0, player);
  return at < 0 ? null : at === 0 ? -1 : heroes[at - 1].hero;
}

/** Why the HotA content check can't be changed: the map is made with HotA's content, or the server lacks HotA's files. */
export type HotaLock = "map" | "missing" | false;

// ---- the card's HotA content check and rules scroll ----------------------------------------

// i18n-keys
export const HOTA_CONTENT_HELP =
  "{HotA content}\n\nWhat Horn of the Abyss added to the game: its towns (Cove, Factory, Bulwark) with their heroes and creatures, its neutral monsters, its artifacts and its skills (Interference, Runes). Off: only the original's, as in the Shadow of Death.\n\nHotA's rule changes are separate: the Rules scroll beside it.";

/**
 * The HotA content check (an addition, EXTRAS gameRules): the original's check box, HotA's horn and the words. A tap
 * turns it on or off (`set`); locked (`locked`: why) on a map made with HotA's content or on a server without HotA's files, a tap says why. The right button or a long
 * press on the words: what it means. `k`: its scale (a phone's card).
 */
export async function hotaContentCheck(modals: Modals, on: boolean, locked: HotaLock, set: (on: boolean) => void, k = 1, font: "smalfont" | "medfont" = "smalfont"): Promise<Container> {
  const c = new Container({ label: "button: HotA content" });
  const check = new DefButton("sysopchk.def", 0, 0, -1, on ? [1, 1, 1, 3] : [0, 1, 1, 3]);
  check.label = "button: HotA content";
  check.scale.set(k);
  check.help = tr(HOTA_CONTENT_HELP);
  const why = () =>
    locked === "missing"
      ? tr("This server doesn't have the Horn of the Abyss mod: HotA's content stays off. The setup page says where to get it.")
      : tr("This map is made with HotA's content: it can't be played without it.");
  if (locked) check.explain(modals, 1, why).disabled = true;
  else check.onClick = () => set(!on);
  await check.ready;
  if (locked) check.alpha = 0.6;
  const horn = await hornIcon();
  let x = Math.round(check.width) + 6 * k;
  if (horn) {
    const s = Object.assign(new Sprite(horn), { x, y: Math.round((check.height - 24 * k) / 2) });
    s.scale.set(k);
    c.addChild(s);
    x += Math.round(32 * k) + 4 * k;
  }
  const words = label(tr("HotA content"), font, on ? YELLOW : WHITE);
  words.scale.set(font === "medfont" ? k * 0.85 : 1);
  words.position.set(x, Math.round((check.height - words.height) / 2));
  c.addChild(check, words);
  // The whole row answers: a tap as the box, the right button (a long press) its meaning.
  const hit = new Graphics().rect(0, 0, x + words.width, check.height).fill({ color: 0, alpha: 0.001 });
  c.addChildAt(hit, 0);
  tapOrHold(hit, () => (locked ? extra("greyedWhy") && void messageBox(modals, why(), 1) : set(!on)), (px, py) => textPopup(tr(HOTA_CONTENT_HELP), 1, px, py));
  return c;
}

/** The rules scroll (an addition, EXTRAS gameRules): the blue scroll button of the map's quest log, "Rules" beside it, gold when one is changed. */
export async function rulesScroll(modals: Modals, o: ScenarioOptions, changed: () => void, k = 1, font: "smalfont" | "medfont" = "smalfont"): Promise<Container> {
  const c = new Container({ label: "button: Game rules" });
  const b = new DefButton("iam004.def", 0, 0);
  b.label = "button: Game rules";
  b.scale.set(k);
  b.help = tr("Game rules: take back one of HotA's rule changes (the Shadow of Death's instead).");
  b.hint = tr("Game rules");
  const open = () => void gameRulesWindow(modals, o, 1).then(changed);
  b.onClick = open;
  await b.ready;
  const off = rulesChanged({ rules: o.rules });
  if (off) b.addChild(new Graphics().rect(0, 0, 32, 32).stroke({ color: 0xffd700, width: 2 }));
  const words = label(tr("Rules"), font, off ? YELLOW : WHITE);
  words.scale.set(font === "medfont" ? k * 0.85 : 1);
  words.position.set(Math.round(b.width) + 6 * k, Math.round((b.height - words.height) / 2));
  const hit = new Graphics().rect(0, 0, words.x + words.width, b.height).fill({ color: 0, alpha: 0.001 });
  tapOrHold(hit, open);
  c.addChild(hit, b, words);
  return c;
}
