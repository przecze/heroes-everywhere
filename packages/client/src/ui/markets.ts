// Adventure map trading spots with the original windows: University (UNIVERS1/2), Hill Fort
// (APHLFTBK) and the War Machine Factory (the recruit window). Layouts follow VCMI's GUIClasses.
import { MOD_TEXTS } from "@heroes/core";
import { heroPortraitHold } from "./heroPortraitHold.ts";
import { type AdventureAction, type ArmySlot, type CreatureStats, type GameData, type Hero, LEVEL_NAMES, SKILL_NAMES, UNIVERSITY_COST, canPay } from "@heroes/core";
import { Container, Sprite, type Texture } from "pixi.js";
import { heroPortrait, loadDef, loadImage } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, label, loadImagePlayer, smallFont } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { messageBox } from "./dialogs.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { heroArmyClicks } from "./heroScreen.ts";
import { stackInfo } from "./stackBreakdown.ts";
import { infoCard } from "./stackWindow.ts";
import { originalWords, resolveText } from "./gameText.ts";
import { mobileUniversity } from "./mobileUniversity.ts";
import { phoneSized, screenSize, uprightTop } from "./screen.ts";
import { leatherWindow } from "./blocks/phoneWindow.ts";
import { skillHelp } from "./skillHelp.ts";
import { lang, tr, said, type Text } from "../i18n/index.ts";
import { resourceAmount } from "./resourceNames.ts";


export interface UniversityOptions {
  hero: () => Hero;
  gold: () => number;
  skills: number[];
  learn: (skill: number) => void;
  /** Why the hero can't learn it here, gold aside (core cannotLearnSkill); null when they can. */
  why: (skill: number) => string | null;
  listen: (fn: () => void) => () => void;
  /** HotA's Seafaring Academy: three skills, which it also improves. */
  academy?: boolean;
  /** The Conflux's Magic University: its name, picture, the treasury and each school's price (gold and a resource). */
  town?: { title: Text; picture?: Texture; resources: () => number[]; cost: (skill: number) => number[] };
}

/** What learning `skill` costs (seven resources) and whether the player has it. */
export function universityPrice(o: UniversityOptions, skill: number): { cost: number[]; afford: boolean } {
  const cost = o.town?.cost(skill) ?? [0, 0, 0, 0, 0, 0, UNIVERSITY_COST];
  const have = o.town?.resources() ?? [0, 0, 0, 0, 0, 0, o.gold()];
  return { cost, afford: canPay(cost, have) };
}

/** The price in words: "2000 gold and 5 gems". */
export function priceWords(cost: number[]): Text {
  const parts = cost.map((n, i) => (n ? resourceAmount(i, n, true) : "")).filter(Boolean).reverse();
  // ("Złoto: 2000, Klejnoty: 5": no "and" between the name-first amounts.)
  return parts.length > 1 && lang() === "en" ? tr("%1 and %2", parts.slice(0, -1).join(", "), parts[parts.length - 1]) : said(parts.join(", "));
}

/** Four skills on offer; click one to confirm learning it at Basic for 2000 gold. */
export async function universityWindow(modals: Modals, player: number, o: UniversityOptions): Promise<void> {
  // Phones: a page of skill cards with what each does.
  if (phoneSized()) return mobileUniversity(modals, o);
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("univers1.pcx", player));
  win.addChild(bg);
  const cx = bg.width / 2;
  const pic = new Sprite(o.town?.picture ?? (await loadImage("univbldg.pcx")));
  pic.position.set(cx - pic.width / 2, 76 - pic.height / 2);
  win.addChild(pic);
  const title = label(o.town?.title ?? (o.academy ? tr("Seafaring Academy") : tr("University")), "medfont", YELLOW, "center", 300);
  title.centreOn(cx, 26);
  win.addChild(title);
  const speech = label(
    o.academy
      ? tr(`${MOD_TEXTS["mapObject.hota.mapobjects.seafaringAcademy.seafaringAcademy.speech"].replace(/\.$/, "")}, for %1 gold each:`, UNIVERSITY_COST)
      : o.town
        ? tr(`The %1 teaches the schools of magic to those who pay %2 gold and 5 of the school's resource:`, o.town.title, UNIVERSITY_COST)
        : ((await resolveText({ file: "genrltxt", id: 603 })) ?? tr(`The University offers the following skills to those who pay %1 gold:`, UNIVERSITY_COST)),
    "smalfont",
    WHITE,
    "center",
    413,
  );
  // VCMI's CTextBox (24, 129, 413 x 70), centred both ways.
  speech.centreOn(24 + 206, 129 + 35);
  win.addChild(speech);
  const icons = (await loadDef("secskill.def")).get(0) ?? [];
  // The strips over and under each skill (VCMI's CUniversityWindow::CItem): gold when it can be
  // learnt, green when the hero has it, red when not.
  const [gold, green, red] = await Promise.all(["univgold.pcx", "univgren.pcx", "univred.pcx"].map((n) => loadImage(n).catch(() => null)));
  const items = new Container();
  win.addChild(items);
  const draw = () => {
    items.removeChildren();
    const h = o.hero();
    const left = 54 + ((4 - o.skills.length) * 104) / 2;
    o.skills.forEach((skill, i) => {
      const level = h.skills?.find(([k]) => k === skill)?.[1] ?? 0;
      const blocked = !!o.why(skill);
      // What it teaches: Basic (VCMI shows Basic under every skill, even one the hero has); the Seafaring Academy improves.
      const next = o.academy ? Math.min(3, level + 1) : 1;
      const f = icons[skill * 3 + next - 1 + 3];
      if (!f) return;
      const x = left + i * 104;
      const bar = blocked && level > 0 ? green : blocked || !universityPrice(o, skill).afford ? red : gold;
      if (bar) for (const y of [234 - 22, 234 + 48]) items.addChild(Object.assign(new Sprite(bar), { x: x - 28, y }));
      const sp = new Sprite(f.texture);
      sp.position.set(x, 234);
      sp.eventMode = "static";
      sp.cursor = "pointer";
      sp.on("pointertap", (e) => {
        if (e.button === 0 && !blocked) void confirm(skill, next);
      });
      // The right button held: what the skill does at the level it would teach.
      skillHelp(sp, player, skill, next);
      const name = label(said(SKILL_NAMES[skill]) ?? said(""), "smalfont", WHITE, "center", 100);
      name.centreOn(x + 22, 234 - 13);
      const lvl = label(said(LEVEL_NAMES[next]), "smalfont", WHITE, "center", 100);
      lvl.centreOn(x + 22, 234 + 57);
      items.addChild(sp, name, lvl);
    });
  };
  const confirm = async (skill: number, level = 1) => {
    const c = new Container();
    const cbg = new Sprite(await loadImagePlayer("univers2.pcx", player));
    c.addChild(cbg);
    const ccx = cbg.width / 2;
    const name = label(said(SKILL_NAMES[skill]) ?? said(""), "smalfont", WHITE, "center", 300);
    name.centreOn(ccx, 37);
    const icon = new Sprite(icons[skill * 3 + level - 1 + 3]?.texture);
    icon.position.set(ccx - icon.width / 2, 71 - icon.height / 2);
    const lvl = label(said(LEVEL_NAMES[level]), "smalfont", WHITE, "center", 300);
    lvl.centreOn(ccx, 105);
    const { cost: price, afford } = universityPrice(o, skill);
    const text = label(tr(`Do you want to learn %1 %2 for %3?`, LEVEL_NAMES[level], SKILL_NAMES[skill], priceWords(price)), "smalfont", WHITE, "center", 410);
    text.position.set(ccx - 205, 150);
    // Each resource it takes, side by side under the question (two share the one price plate).
    const resIcons = (await loadDef("resource.def")).get(0) ?? [];
    const parts = price.map((n, i) => [n, i] as const).filter(([n]) => n > 0).reverse();
    const costs = new Container();
    parts.forEach(([n, i], k) => {
      const x = ccx + (k - (parts.length - 1) / 2) * 48;
      const coin = new Sprite(resIcons[i]?.texture);
      coin.position.set(x - coin.width / 2, 234 - coin.height / 2);
      const amount = label(said(String(n)), "smalfont", WHITE, "center", 48);
      amount.centreOn(Math.round(x), 267);
      costs.addChild(coin, amount);
    });
    c.addChild(name, icon, lvl, text, costs);
    let close = () => {};
    const buy = new DefButton("iby6432.def", ccx - 84, 299, player);
    buy.disabled = !afford;
    buy.explain(modals, player, () => tr("Not enough gold."));
    buy.onClick = () => {
      o.learn(skill);
      close();
    };
    const cancel = new DefButton("icancel.def", ccx + 20, 299, player);
    cancel.onClick = () => close();
    c.addChild(buy, cancel);
    close = modals.show(c, { onKey: (k) => (k === "Escape" ? close() : k === "Enter" && !buy.disabled ? buy.onClick!() : undefined, true) });
  };
  draw();
  const unlisten = o.listen(draw);
  return new Promise((resolve) => {
    let close = () => {};
    const ok = new DefButton("iokay.def", cx - 32, 313, player);
    const done = () => (unlisten(), close(), resolve());
    ok.onClick = done;
    win.addChild(ok);
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done() : undefined, true) });
  });
}

export interface HillFortOptions {
  hero: () => Hero;
  resources: () => number[];
  creatures: CreatureStats[];
  /** The game's data and the way to act: the army is rearranged here as everywhere (VCMI's CGarrisonInt at 108, 60). */
  data: GameData;
  send: (a: AdventureAction) => void;
  /** What the stack in this slot becomes and for how much (core hillFortUpgrade); null if nothing. */
  offer: (slot: number) => { to: number; cost: number[] } | null;
  upgrade: (slot: number) => void;
  listen: (fn: () => void) => () => void;
  /** The hero's screen, the portrait held (EXTRAS portraitHold). */
  openHero?: (id: number) => void;
}

/**
 * The hero's army with an upgrade button and its price under each stack, and Upgrade All. The army is the shared
 * stack row (ui/blocks/stackGrid.ts) with the shared clicks: stacks move, split and open their card (with Upgrade at
 * this fort's price) as in every army. A red button (too dear) says why.
 */
export async function hillFortWindow(modals: Modals, player: number, o: HillFortOptions): Promise<void> {
  const win = new Container();
  // Upright phones: the same pieces on the windows' leather in a narrow window, the seven places four over three and
  // the totals likewise, so it is drawn big enough to read (the wide original shrank to a strip).
  const up = phoneSized() && screenSize.portrait;
  const UW = 20 + 4 * 76 + 20;
  const UH = 560;
  /** Where place i's column starts (its left, and the top of its picture), desktop or upright. */
  const col = (i: number): [number, number] => (up ? [20 + (i % 4) * 76 + (i >= 4 ? 38 : 0), 120 + Math.floor(i / 4) * 150] : [104 + 76 * i, 60]);
  /** Where total r's icon goes. */
  const tot = (r: number): [number, number] => (up ? [20 + (r % 4) * 76 + (r >= 4 ? 38 : 0), 430 + Math.floor(r / 4) * 30] : [104 + 76 * r, 237]);
  win.addChild(up ? await leatherWindow(UW, UH, player) : new Sprite(await loadImagePlayer("aphlftbk.pcx", player)));
  const title = label(tr("Hill Fort"), "bigfont", YELLOW, "center", 300);
  title.centreOn(up ? UW / 2 + 30 : 325, up ? 56 : 32);
  win.addChild(title);
  const portrait = new Sprite(await heroPortrait(o.hero()));
  portrait.position.set(up ? 24 : 30, up ? 24 : 60);
  win.addChild(portrait);
  heroPortraitHold(portrait, o.openHero && (() => o.openHero!(o.hero().id)));
  const smalres = (await loadDef("smalres.def")).get(0) ?? [];
  const layer = new Container();
  win.addChild(layer);
  const afford = (cost: number[]) => cost.every((v, r) => v <= o.resources()[r]);
  const tooDear = async () => messageBox(modals, tr("Not enough resources."), player);
  const clicks = heroArmyClicks(modals, player, { data: o.data, send: o.send }, o.hero, (slot) => {
    const up = o.offer(slot);
    return up ? { text: priceWords(up.cost), cost: up.cost, afford: afford(up.cost), apply: () => o.upgrade(slot) } : undefined;
  });
  const grid = new StackGrid(
    { size: "large", at: Array.from({ length: 7 }, (_, i) => [col(i)[0] + 4, col(i)[1]] as const), count: "corner", frames: up },
    { creatures: o.creatures, clicks, changed: () => void draw(), info: (slot, count) => ({ count, ...stackInfo(o.hero(), o.creatures[o.hero().army[slot]?.creature ?? -1], o.data) }) },
  );
  win.addChild(grid);
  const draw = async () => {
    const h = o.hero();
    await grid.set(h.army);
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const total = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) {
      const a: ArmySlot | null = h.army[i];
      const upg = a ? o.offer(i) : null;
      const cost = upg?.cost ?? null;
      cost?.forEach((v, r) => (total[r] += v));
      // Up to two resources per stack under its portrait.
      const [cx, cy] = col(i);
      (cost ?? []).map((v, r) => [r, v]).filter(([, v]) => v > 0).slice(0, 2).forEach(([r, v], j) => {
        const icon = smalres[r];
        if (icon) layer.addChild(Object.assign(new Sprite(icon.texture), { x: cx, y: cy + 68 + 20 * j }));
        // BOTTOMRIGHT at 168 + 76 i, 144 + 20 j (VCMI's slotLabels).
        const l = label(said(String(v)), smallFont(), WHITE);
        l.position.set(cx + 64 - l.width, cy + 84 + 20 * j - l.height);
        layer.addChild(l);
      });
      // A stack with nothing to become says so in the price strip (HotA's screenshots: "N/A" over the yellow button).
      if (a && !upg) {
        const l = label(tr("N/A"), smallFont(), WHITE);
        l.position.set(cx + 64 - l.width, cy + 84 - l.height);
        layer.addChild(l);
      }
      const affordable = cost ? afford(cost) : false;
      const def = !a ? "aphlf1r.def" : !upg ? "aphlf1y.def" : affordable ? "aphlf1g.def" : "aphlf1r.def";
      const b = new DefButton(def, cx + 3, cy + 111, player);
      // Only an empty slot's button is greyed out; HotA draws the yellow (nothing to do) and red (too dear) ones lit.
      b.disabled = !a;
      b.onClick = () => void (upg && (affordable ? o.upgrade(i) : tooDear()));
      layer.addChild(b);
    }
    total.forEach((v, r) => {
      const icon = smalres[r];
      const [tx, ty] = tot(r);
      if (icon) layer.addChild(Object.assign(new Sprite(icon.texture), { x: tx, y: ty }));
      const l = label(said(String(v)), smallFont(), WHITE);
      l.position.set(tx + 62 - l.width, ty + 16 - l.height);
      layer.addChild(l);
    });
    const can = total.some((v) => v > 0) && afford(total);
    const all = new DefButton(can ? "aphlf4g.def" : "aphlf4r.def", up ? 24 : 30, up ? 500 : 231, player);
    all.disabled = !total.some((v) => v > 0);
    all.onClick = () => void (can ? h.army.forEach((a, i) => a && o.offer(i) && o.upgrade(i)) : tooDear());
    layer.addChild(all);
  };
  await draw();
  const unlisten = o.listen(() => void draw());
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (unlisten(), close(), resolve());
    const ok = new DefButton("iokay.def", up ? UW - 24 - 64 : 294, up ? 500 : 275, player);
    ok.onClick = done;
    win.addChild(ok);
    // The army's keys as everywhere (1 to 4: HotA's quick actions on the picked stack).
    const onKey = (k: string) => (k === "Escape" || k === "Enter" ? done() : clicks.quickKey(k) && void draw(), true);
    if (!up) return void (close = modals.show(win, { onKey }));
    // Upright: as wide as the screen allows, under the page's buttons, in the middle.
    const holder = new Container();
    holder.addChild(win);
    const k = Math.min((screenSize.w - 16) / UW, (screenSize.h - uprightTop() - 16) / UH);
    win.scale.set(k);
    close = modals.show(holder, { x: () => Math.round((screenSize.w - UW * k) / 2 - screenSize.ox), y: () => Math.round(Math.max(uprightTop(), (screenSize.h - UH * k) / 2) - screenSize.oy), onKey });
  });
}

export interface TransformerOptions {
  hero: () => Hero;
  creatures: CreatureStats[];
  transform: (slots: number[]) => void;
}

/** The Skeleton Transformer (SKTRNBK): click stacks over to the right, then transform them. */
export async function transformerWindow(modals: Modals, player: number, o: TransformerOptions): Promise<void> {
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("sktrnbk.pcx", player));
  win.addChild(bg);
  const text = (t: Text, x: number, y: number, font: "smalfont" | "medfont", color: readonly [number, number, number], width: number) => {
    const l = label(t, font, color, "center", width);
    l.centreOn(x, y);
    win.addChild(l);
  };
  // GENRLTXT 485-488 (VCMI's CTransformerWindow).
  const words = await originalWords("genrltxt", { "Holding Area": 485, "Skeleton Transformer": 486, "Move creatures to the right to turn them into skeletons.": 487, "Creatures here will become skeletons.": 488 });
  text(words("Holding Area"), 153, 29, "smalfont", YELLOW, 250);
  text(words("Skeleton Transformer"), 153 + 295, 29, "smalfont", YELLOW, 250);
  text(words("Move creatures to the right to turn them into skeletons."), 26 + 127, 76, "medfont", YELLOW, 255);
  text(words("Creatures here will become skeletons."), 320 + 127, 76, "medfont", YELLOW, 255);
  // The two sides are the shared stack row (each stack in its own place, as VCMI's CTransformerWindow): a tap sends a
  // stack to the other side, a long press opens its card.
  const right = new Set<number>();
  const at = (side: number) => Array.from({ length: 7 }, (_, id) => [45 + (id % 3) * 83 + Math.floor(id / 6) * 83 + side * 289, 109 + Math.floor(id / 3) * 98] as const);
  const card = infoCard(modals, player, o.creatures, () => o.hero().army);
  const flip = (slot: number) => (right.has(slot) ? right.delete(slot) : right.add(slot), void draw());
  const sides = [0, 1].map((side) => new StackGrid({ size: "large", at: at(side), count: "below" }, { creatures: o.creatures, onTap: flip, card }));
  win.addChild(...sides);
  const draw = async () => {
    const army = o.hero().army;
    await Promise.all(sides.map((g, side) => g.set(army.map((a, id) => (right.has(id) === (side === 1) ? a : null)))));
  };
  await draw();
  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    const all = new DefButton("altarmy.def", 146, 416, player);
    all.onClick = () => {
      o.hero().army.forEach((a, i) => a && right.add(i));
      void draw();
    };
    const convert = new DefButton("altsacr.def", 269, 416, player);
    convert.onClick = () => {
      if (right.size) o.transform([...right]);
      done();
    };
    const cancel = new DefButton("icancel.def", 392, 416, player);
    cancel.onClick = done;
    win.addChild(all, convert, cancel);
    close = modals.show(win, { onKey: (k) => (k === "Escape" ? done() : k === "Enter" ? convert.onClick!() : undefined, true) });
  });
}
