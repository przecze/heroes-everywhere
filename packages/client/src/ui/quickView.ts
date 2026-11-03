// Right-click quick views of heroes and towns on the adventure map (HEROQVBK / TOWNQVBK),
// laid out like VCMI's CHeroTooltip / CTownTooltip. Enemies show army sizes as words only.
import { hallLevel, fortLevel, type AdvObject, type CreatureStats, type Hero, TOWNS, effectivePrimary, townIncome } from "@heroes/core";
import { Container, Sprite } from "pixi.js";
import { heroPortrait, loadDef, loadImage, townIcon } from "../assets.ts";
import { WHITE } from "../text.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { label, loadImagePlayer } from "./kit.ts";
import type { ArmyClicks } from "./armyClicks.ts";
import { said, type Text } from "../i18n/index.ts";
import { townName } from "../i18n/towns.ts";

/** Where a tooltip is drawn: the popup's own frame (HEROQVBK / TOWNQVBK), or the info bar's (ADSTATHR / ADSTATCS, no margin). */
export interface TooltipLook {
  background?: string;
  margin?: boolean;
  /** Morale and luck as the hero screen has them (the popup leaves them out without this). */
  moraleLuck?: { morale: number; luck: number };
  /** Exact numbers of someone else's army (Visions, Rogues nearby). */
  exact?: boolean;
  /**
   * Someone else's town or garrison: the viewer's Taverns (and the Cove's Thieves' Guilds) decide what
   * shows (heroes.thelazy.net Thieves' Guild): none, no troops; one, the stacks without numbers; two, about how many.
   */
  taverns?: number;
  /** The info bar: the army can be rearranged there. */
  army?: { clicks: ArmyClicks; changed: () => void };
}

// The seven army slots under the portrait (two rows).
const SLOTS = [[36, 73], [72, 73], [108, 73], [18, 122], [54, 122], [90, 122], [126, 122]];

async function armyIcons(c: Container, army: ({ creature: number; count: number } | null)[], creatures: CreatureStats[], exact: boolean, ox: number, oy: number, look: TooltipLook = {}) {
  const taverns = exact ? 2 : (look.taverns ?? 2);
  if (taverns <= 0) return;
  const grid = new StackGrid(
    { size: "small", at: SLOTS.map(([x, y]) => [ox + x, oy + y] as const), count: "below", numbers: taverns < 2 ? "none" : exact ? "exact" : "words" },
    { creatures, clicks: look.army?.clicks, changed: look.army?.changed },
  );
  c.addChild(grid);
  await grid.set(army.slice(0, 7));
}

/** `disguised`: the army a Disguise shows this viewer instead of the real one (core disguisedArmy), or null. */
export async function heroQuickView(h: Hero, viewer: number, creatures: CreatureStats[], disguised: ({ creature: number; count: number } | null)[] | null = null, look: TooltipLook = {}): Promise<Container> {
  const c = new Container();
  c.addChild(new Sprite(look.background ? await loadImage(look.background) : await loadImagePlayer("heroqvbk.pcx", Math.max(0, viewer))));
  const ox = look.margin === false ? 0 : 9;
  const oy = look.margin === false ? 0 : 10;
  const own = h.owner === viewer;
  const portrait = new Sprite(await heroPortrait(h));
  portrait.position.set(ox + 3, oy + 2);
  c.addChild(portrait);
  const name = label(said(h.name), "smalfont", WHITE);
  name.position.set(ox + 66, oy + 3);
  c.addChild(name);
  if (own) {
    const prim = effectivePrimary(h);
    [77, 104, 132, 160].forEach((x, i) => {
      const l = label(said(String(prim[i])), "smalfont", WHITE, "center", 25);
      l.position.set(ox + x - 12, oy + 60 - 7);
      c.addChild(l);
    });
    const mana = label(said(String(h.mana ?? 0)), "tiny", WHITE, "center", 40);
    mana.position.set(ox + 158 - 20, oy + 100 - 5);
    c.addChild(mana);
    const [morale, luck] = await Promise.all([loadDef("imrl22.def"), loadDef("ilck22.def")]);
    // (As the rules have them: heroMoraleLuck, which every caller passes for its own heroes.)
    const m = Math.max(-3, Math.min(3, look.moraleLuck?.morale ?? 0));
    const l = Math.max(-3, Math.min(3, look.moraleLuck?.luck ?? 0));
    const mf = morale.get(0)?.[m + 3];
    const lf = luck.get(0)?.[l + 3];
    if (mf) c.addChild(Object.assign(new Sprite(mf.texture), { x: ox + 5, y: oy + 74 }));
    if (lf) c.addChild(Object.assign(new Sprite(lf.texture), { x: ox + 5, y: oy + 91 }));
  }
  // (Disguised from Advanced: the numbers show as 0.)
  if (disguised && !own) await armyIcons(c, disguised, creatures, !!look.exact || disguised.every((a) => !a || a.count === 0), ox, oy, look);
  else await armyIcons(c, h.army, creatures, own || !!look.exact, ox, oy, look);
  return c;
}

export async function townQuickView(o: AdvObject, viewer: number, creatures: CreatureStats[], garrison: ({ creature: number; count: number } | null)[], look: TooltipLook = {}): Promise<Container> {
  const c = new Container();
  c.addChild(new Sprite(look.background ? await loadImage(look.background) : await loadImagePlayer("townqvbk.pcx", Math.max(0, viewer))));
  const ox = look.margin === false ? 0 : 9;
  const oy = look.margin === false ? 0 : 10;
  const t = o.town!;
  const own = o.owner === viewer;
  const fort = fortLevel(t.built);
  const [icon, itmcls, itmtls] = await Promise.all([townIcon(o.subid, fort > 0, false, "large"), loadDef("itmcls.def"), loadDef("itmtls.def")]);
  if (icon) c.addChild(Object.assign(new Sprite(icon), { x: ox + 3, y: oy + 2 }));
  const faction = TOWNS[o.subid]?.faction ?? "town";
  const name = label(said(o.name) ?? townName(faction), "smalfont", WHITE);
  name.position.set(ox + 66, oy + 3);
  c.addChild(name);
  // Fort level icons: fort, citadel, castle, none.
  const fortIcon = itmcls.get(0)?.[fort ? fort - 1 : 3];
  if (fortIcon) c.addChild(Object.assign(new Sprite(fortIcon.texture), { x: ox + 105, y: oy + 31 }));
  if (own) {
    const hall = hallLevel(t.built);
    const hallIcon = itmtls.get(0)?.[Math.max(0, hall)];
    if (hallIcon) c.addChild(Object.assign(new Sprite(hallIcon.texture), { x: ox + 67, y: oy + 31 }));
    const income = label(said(String(townIncome(o)[6])), "tiny", WHITE, "center", 40);
    income.position.set(ox + 157 - 20, oy + 58 - 5);
    c.addChild(income);
  }
  await armyIcons(c, garrison, creatures, own || !!look.exact, ox, oy, look);
  return c;
}

/** A garrison on the map (VCMI's CInfoBoxPopup for CGGarrison: TOWNQVBK, the name and its army). */
export async function garrisonQuickView(name: Text, army: ({ creature: number; count: number } | null)[], viewer: number, own: boolean, creatures: CreatureStats[], look: TooltipLook = {}): Promise<Container> {
  const c = new Container();
  c.addChild(new Sprite(await loadImagePlayer("townqvbk.pcx", Math.max(0, viewer))));
  const title = label(name, "smalfont", WHITE);
  title.position.set(9 + 66, 10 + 3);
  c.addChild(title);
  await armyIcons(c, army, creatures, own || !!look.exact, 9, 10, look);
  return c;
}

