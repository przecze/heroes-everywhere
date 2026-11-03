// The original hero screen (HEROSCR4), laid out like the game (positions from VCMI's CHeroWindow).
import { heroPortraitHold } from "./heroPortraitHold.ts";
import { BOXES, HEAD, SKILLS_PART, heroHead, heroSkills } from "./blocks/heroBlocks.ts";
import { has, lang, said, fallback, fmt, type Text, NONE } from "../i18n/index.ts";
import { specialtyTexts } from "../i18n/names.ts";
import {
  type AdventureAction,
  type ArtifactRef,
  type GameData,
  HERO_INFO,
  type Hero,
  SKILLS,
  stackSkills,
  type MoraleLuckPart, COMBOS, LOCKED, SLOT, assemblable } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { artifactText } from "./artifactText.ts";
import { parseTxt } from "@heroes/formats";
import { loadDef, heroPortrait, fetchRes } from "../assets.ts";
import { WHITE } from "../text.ts";
import { redraws } from "./redraw.ts";
import { DefButton, FingerArea, dragSource, label, loadImagePlayer, slotAt } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { YES_NO, textPopup, messageBox } from "./dialogs.ts";
import { ArtifactHand, type HandPlace } from "./artifactHand.ts";
import { setPopupPlayer } from "./creatureInfo.ts";
import { splitWindow } from "./split.ts";
import { ArmyClicks } from "./armyClicks.ts";
import { type StackWindowOptions, stackWindow } from "./stackWindow.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { gameTexts } from "./highScores.ts";
import { resolveText, heroClassName, englishLine } from "./gameText.ts";
import { phoneSized } from "./screen.ts";
import { mobileHeroScreen } from "./mobileHero.ts";
import { stackInfo } from "./stackBreakdown.ts";

/** The hero window's artifacts panel sits at (-65, -8) from the window (VCMI's CHeroWindow): SLOT_POS and the backpack are the panel's own coordinates. */
export const ARTS = { x: -65, y: -8 };
export const SLOT_POS = [
  [509, 30], [568, 242], [509, 80], [383, 69], [562, 184], [509, 131], [431, 69], [610, 184], [515, 295],
  [383, 143], [399, 193], [415, 244], [431, 295], [564, 30], [610, 30], [610, 76], [610, 122], [610, 310], [381, 295],
];

export interface HeroScreenOptions {
  data: GameData;
  /** Latest version of the hero (after actions). */
  hero: () => Hero;
  send: (a: AdventureAction) => void;
  /** Called when the state changes, to redraw. */
  listen: (fn: () => void) => () => void;
  /** The player's heroes, for the column of portraits that switches between them. */
  heroes?: () => Hero[];
  /** The quest log (its button). */
  questLog?: () => void;
  /** Morale and luck as the battle would count them, with what they're made of (the right-click texts). */
  moraleLuck: (h: Hero) => { morale: number; luck: number; moraleParts?: MoraleLuckPart[]; luckParts?: MoraleLuckPart[] };
  /** A click on the spellbook: the book (its adventure spells). */
  spellbook?: (h: Hero) => void;
  /** Whether the hero may be dismissed (not your last hero without a town, nor at sea): else the button is greyed, as VCMI's CHeroWindow. */
  canDismiss?: (h: Hero) => boolean;
  /** Why not, said by a tap on the greyed Dismiss (EXTRAS greyedWhy). */
  dismissWhy?: (h: Hero) => Text | null;
}

export async function heroScreen(modals: Modals, player: number, o: HeroScreenOptions): Promise<void> {
  // Phones get a screen of their own, laid out for big text and fingers.
  if (phoneSized()) return mobileHeroScreen(modals, player, o);
  setPopupPlayer(player);
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("heroscr4.pcx", player)));
  // The player's flag over the column of heroes (CREST58, VCMI's banner at 606,8).
  const crest = (await loadDef("crest58.def").catch(() => null))?.get(0)?.[Math.max(0, player)];
  if (crest) win.addChild(Object.assign(new Sprite(crest.texture), { x: 606, y: 8 }));
  const shown = new Container();
  win.addChild(shown);
  const status = label(said(""), "smalfont", WHITE, "center", 660);
  status.position.set(7, 562);
  win.addChild(status);
  const arts = await loadDef("artifact.def");
  // The hero shown: the one opened, or another picked from the column on the right.
  let current = o.hero().id;
  const hero = (): Hero => o.heroes?.().find((x) => x.id === current) ?? o.hero();
  /** An artifact picked up (the cursor, with a mouse): a click puts it down (ArtifactHand). */
  const hand: ArtifactHand = new ArtifactHand({
    heroes: () => [hero()],
    artifacts: o.data.artifacts,
    move: (from, to) => o.send({ type: "equip", hero: hero().id, from: place(from), to: place(to) }),
    spellbook: () => o.spellbook?.(hero()),
    catapult: async () => void messageBox(modals, (await gameTexts()).general[312] || fallback("The Catapult must be equipped."), player),
    changed: () => void draw(),
  });
  const place = (p: HandPlace): ArtifactRef => (p.slot !== undefined ? { slot: p.slot } : { backpack: p.backpack });
  /** The hero's own army: a picked stack moves, swaps, merges or splits; picked again, its window. */
  const army = heroArmyClicks(modals, player, o, hero);
  let bagScroll = 0;

  const draw = redraws(shown, async (layer) => {
    const h = hero();
    const add = (x: number, y: number, sp: Sprite | Container) => (sp.position.set(x, y), layer.addChild(sp));
    // The head: the same block every layout draws (the portrait's and the name's boxes, the name and the level
    // centred; a tap on the portrait its biography).
    const head = add(BOXES.portrait.x, BOXES.portrait.y, await heroHead(modals, player, h, HEAD.w));
    // The skills section: the same block every layout draws (HEROSCR4's boxes, the names, the values and their texts).
    add(SKILLS_PART.x, SKILLS_PART.y, await heroSkills(modals, player, h, o.moraleLuck(h), { hover: (t) => (status.value = said(t)) }));
    // The portrait: the hero's biography, the portrait over the name (a dialog on a tap, held on the right button).
    // (Its text is the head block's; here only the status bar's words: GENRLTXT 15 "%s the %s".)
    const bioHover = (await resolveText({ file: "genrltxt", id: 15, args: [h.name, await heroClassName(h.heroClass, h)] })) ?? said(h.name);
    head.eventMode = "static";
    head.on("pointerover", () => (status.value = bioHover)).on("pointerout", () => (status.value = said("")));
    // Army: the shared stack row (click a stack, then another place to move, swap or merge it, as in the original; or drag it there).
    const artSlots: { c: Container; ref: ArtifactRef & { bagAt?: number } }[] = [];
    const grid: StackGrid = new StackGrid(
      { size: "large", at: Array.from({ length: 7 }, (_, i) => [15 + 66 * i, 485] as const), count: "corner" },
      {
        creatures: o.data.creatures,
        clicks: army,
        changed: () => void draw(),
        info: (slot, count) => ({ count, ...stackSkills(h, o.data.creatures[h.army[slot]?.creature ?? -1]) }),
        drag: { layer: win, grids: () => [grid], move: (from, to) => o.send({ type: "transfer", heroes: [h.id, h.id], kind: "army", from: { who: 0, slot: from.slot }, to: { who: 0, slot: to.slot } }) },
      },
    );
    await grid.set(h.army);
    layer.addChild(grid);
    // Artifacts: the paper doll and five backpack places.
    const artPlace = (x: number, y: number, real: number, ref: ArtifactRef, bagAt?: number) => {
      const c = new Container();
      c.position.set(x, y);
      c.addChild(new Graphics().rect(0, 0, 44, 44).fill({ color: 0, alpha: 0.001 }));
      const hp: HandPlace = { who: 0, ...ref };
      // The artifact in hand is on the cursor: its place shows empty.
      const art = hand.hides(hp) ? -1 : real;
      // A slot taken by a combination artifact's part shows the lock (frame 145).
      const f = art >= 0 ? arts.get(0)?.[art] : art === LOCKED ? arts.get(0)?.[145] : undefined;
      // At its place in the 44x44 slot: ARTIFACT.DEF's frames are trimmed.
      if (f) c.addChild(Object.assign(new Sprite(f.texture), { x: f.x, y: f.y }));
      // The slots that take the artifact in hand (and, on a touch screen, the one picked) light up: ARTIFACT.DEF's frame 144.
      const lit = arts.get(0)?.[144];
      if (lit && ((ref.slot !== undefined && hand.takes(0, ref.slot)) || hand.framed(hp))) c.addChild(Object.assign(new Sprite(lit.texture), { x: lit.x, y: lit.y }));
      c.eventMode = "static";
      c.cursor = "pointer";
      c.on("pointerover", () => (status.value = art >= 0 ? (said(o.data.artifacts[art]?.name) ?? said("")) : said("")));
      const isWornCombo = () => art >= 0 && ref.slot !== undefined && !!COMBOS[art] && !!h.combos?.[ref.slot];
      // GENRLTXT 733 (take it apart?), under the artifact's own text; true if it was taken apart.
      const askDisassemble = (text: Text) =>
        gameTexts().then(async (g) => {
          const pic = arts.get(0)?.[art];
          const a = await messageBox(modals, fmt`${text}\n\n${g.general[733] || englishLine("genrltxt", 733)}`, player, {
            buttons: YES_NO,
            components: pic ? [{ texture: pic.texture, caption: NONE }] : undefined,
          });
          if (a === "yes") {
            // (Its parts are all worn again, but it was the player's own wish: no offer to put it back together.)
            asking.add(`${h.id}:${art}`);
            o.send({ type: "disassemble", hero: h.id, slot: ref.slot! });
          }
          return a === "yes";
        });
      c.on("pointerdown", (e) => {
        if (e.button !== 2 || art < 0) return;
        const text = artifactText(o.data, art, h);
        // A worn combination can be taken apart from here.
        if (isWornCombo()) void askDisassemble(text);
        else textPopup(text, player, e.global.x, e.global.y);
      });
      artSlots.push({ c, ref });
      // (Dragging is HD mod's way; the original's is the click to pick up and the click to put down.)
      const dragged = art >= 0 && !hand.held && ref.slot !== SLOT.SPELLBOOK && ref.slot !== SLOT.MACH4
        ? dragSource(c, win, (x, y) => {
            const to = slotAt(artSlots, x, y);
            hand.drop();
            if (to && (to.slot !== ref.slot || to.backpack !== ref.backpack)) o.send({ type: "equip", hero: h.id, from: ref, to: to.slot !== undefined ? to : { backpack: to.bagAt } });
            void draw();
          })
        : () => false;
      c.on("pointertap", (e) => {
        if (e.button !== 0 || dragged()) return;
        // Clicking a worn combination with an empty hand offers to take it apart; "No" picks it up as usual.
        if (!hand.held && isWornCombo()) {
          void askDisassemble(artifactText(o.data, art, h)).then((done) => {
            if (!done) hand.click(hp, bagAt);
          });
          return;
        }
        hand.click(hp, bagAt);
      });
      artSlots.push({ c, ref: { ...ref, bagAt } });
      layer.addChild(c);
    };
    SLOT_POS.forEach(([x, y], slot) => artPlace(x + ARTS.x, y + ARTS.y, h.equipped?.[slot] ?? -1, { slot }));
    // The backpack: five places; with more, the arrows turn it round (VCMI's scrollBackpack, wrapping).
    const bag = hand.bag(0);
    bagScroll = bag.length > 5 ? ((bagScroll % bag.length) + bag.length) % bag.length : 0;
    for (let k = 0; k < 5; k++) {
      const i = bag.length > 5 ? (bagScroll + k) % bag.length : k;
      artPlace(403 + 46 * k + ARTS.x, 365 + ARTS.y, bag[i]?.art ?? -1, { backpack: bag[i]?.index }, i);
    }
    bagArrows(bag.length > 5);
  });

  let bagArrows = (_on: boolean) => {};
  await draw();
  const offerCombos = comboOffers(modals, player, o, hero);
  void offerCombos();
  const unlistenState = o.listen(() => {
    hand.check();
    void draw();
    void offerCombos();
  });
  // Leaving the screen lets go of an artifact in hand (it stays where it was).
  let unlisten = () => (hand.drop(), unlistenState());
  return new Promise((resolve) => {
    let close = () => {};
    const left = new DefButton("hsbtns3.def", 379 + ARTS.x, 364 + ARTS.y, player);
    left.onClick = () => ((bagScroll -= 1), void draw());
    const right = new DefButton("hsbtns5.def", 632 + ARTS.x, 364 + ARTS.y, player);
    right.onClick = () => ((bagScroll += 1), void draw());
    // Blocked while the backpack holds five or fewer (nothing to turn).
    bagArrows = (on) => ((left.disabled = !on), (right.disabled = !on));
    void draw();
    const quit = new DefButton("hsbtns.def", 609, 516, player);
    quit.onClick = () => (unlisten(), close(), resolve());
    win.addChild(left, right, quit);
    // No captions beside the buttons: SoD wrote "Quest Log" and "Dismiss Hero" there (JKTEXT, VCMI's 370,430 and
    // 510,430); HotA shows the buttons alone (its gallery's scr4.png).
    if (o.questLog) {
      const quests = new DefButton("hsbtns4.def", 314, 429, player);
      quests.onClick = () => o.questLog?.();
      win.addChild(quests);
    }
    // Dismiss the hero (after asking).
    const dismiss = new DefButton("hsbtns2.def", 454, 429, player).explain(modals, player, () => o.dismissWhy?.(hero()));
    dismiss.onClick = async () => {
      const h = hero();
      if (!(await confirmDismiss(modals, player, h))) return;
      o.send({ type: "dismiss", hero: h.id });
      unlisten();
      close();
      resolve();
    };
    // Formation (tight / loose) and Tactics: toggles kept on the hero.
    const formation = (tight: boolean) => {
      const b = new DefButton(tight ? "hsbtns6.def" : "hsbtns7.def", 481, tight ? 483 : 519, player, (hero().tight ?? false) === tight ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      b.onClick = () => o.send({ type: "heroSettings", hero: hero().id, tight });
      return b;
    };
    const toggles = new Container();
    let splitNow = () => {};
    const drawToggles = () => {
      dismiss.disabled = o.canDismiss ? !o.canDismiss(hero()) : false;
      toggles.removeChildren().forEach((c) => c.destroy({ children: true }));
      toggles.addChild(formation(true), formation(false));
      if ((hero().skills ?? []).some(([id]) => id === SKILLS.indexOf("tactics"))) {
        const t = new DefButton("hsbtns8.def", 539, 483, player, hero().noTactics ? [0, 1, 2, 3] : [1, 1, 2, 3]);
        t.onClick = () => o.send({ type: "heroSettings", hero: hero().id, tactics: !!hero().noTactics });
        toggles.addChild(t);
      }
      // Split: the picked stack into two (the Split Stack window), the new half into the first free place.
      const split = new DefButton("hsbtns9.def", 539, 519, player);
      splitNow = () => split.onClick();
      split.onClick = async () => void (await army.splitSelected());
      toggles.addChild(split);
    };
    drawToggles();
    win.addChild(dismiss, toggles);
    const unlistenToggles = o.listen(drawToggles);
    const baseUnlisten = unlisten;
    unlisten = () => (unlistenToggles(), baseUnlisten());
    // The player's heroes down the right (PortraitsSmall): a click shows that hero.
    const column = new Container();
    win.addChild(column);
    const drawColumn = async () => {
      column.removeChildren().forEach((c) => c.destroy({ children: true }));
      for (const [i, other] of (o.heroes?.() ?? []).slice(0, 8).entries()) {
        const pic = new Sprite(await heroPortrait(other, "small"));
        pic.position.set(612, 87 + i * 54);
        // (Touch: a finger high, into the gap between the portraits.)
        pic.hitArea = new FingerArea(pic, pic.texture.width, pic.texture.height);
        pic.eventMode = "static";
        pic.cursor = "pointer";
        const show = () => {
          current = other.id;
          hand.drop();
          bagScroll = 0;
          void draw();
        };
        pic.on("pointertap", (e) => e.button !== 2 && show());
        heroPortraitHold(pic, show);
        column.addChild(pic);
      }
    };
    void drawColumn();
    // The original's keys (VCMI's keyBindingsConfig): S split, D dismiss, T / L tight / loose formation, B Tactics.
    const keys: Record<string, () => void> = {
      s: () => splitNow(),
      d: () => void dismiss.onClick(),
      t: () => o.send({ type: "heroSettings", hero: hero().id, tight: true }),
      l: () => o.send({ type: "heroSettings", hero: hero().id, tight: false }),
      b: () => (hero().skills ?? []).some(([id]) => id === SKILLS.indexOf("tactics")) && o.send({ type: "heroSettings", hero: hero().id, tactics: !!hero().noTactics }),
    };
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Escape" || k === "Enter") (unlisten(), close(), resolve());
        else if (army.quickKey(k)) void draw();
        else keys[k.toLowerCase()]?.();
        return true;
      },
    });
  });
}

/** HEROSPEC.TXT: two header lines, then per hero: short name, long name, description (tab separated). */
let specTable: Promise<Text[][]> | null = null;
let specLang = "";
export function specialties(): Promise<Text[][]> {
  if (specLang !== lang()) (specTable = null), (specLang = lang());
  specTable ??= Promise.all([
    fetchRes("herospec.txt")
      .then((b) => parseTxt(b).slice(2))
      .catch(() => [] as string[][]),
    hotaTexts(),
  ]).then(([rows, hota]) => {
    // HotA's own heroes are past the original's table: their name, tooltip and description from
    // the HotA mod's English texts (hero.hota.<town>.<key>.specialty.*).
    for (const [id, info] of Object.entries(HERO_INFO)) {
      if (rows[Number(id)]?.[0]) continue;
      const base = Object.keys(hota).find((k) => k.endsWith(`.${info.key}.specialty.name`))?.replace(/\.name$/, "");
      if (base) rows[Number(id)] = [hota[`${base}.name`] ?? "", hota[`${base}.tooltip`] ?? "", hota[`${base}.description`] ?? ""];
    }
    // A language with the packs' names (languages.ts): their name, tooltip and description of each hero's specialty.
    const l = lang();
    if (has(l, "names")) {
      for (const id of Object.keys(HERO_INFO)) {
        const t = specialtyTexts(Number(id), l);
        if (t) rows[Number(id)] = [t[0] || rows[Number(id)]?.[0] || "", t[1] || rows[Number(id)]?.[1] || "", t[2] || rows[Number(id)]?.[2] || ""];
      }
    }
    // (In a language with the packs' names their words; English where neither has them.)
    return rows as Text[][];
  });
  return specTable;
}

/** The HotA mod's English texts (its translation file), or nothing without the mod. */
let hotaTable: Promise<Record<string, string>> | null = null;
export function hotaTexts(): Promise<Record<string, string>> {
  hotaTable ??= fetchRes("english.json")
    .then((b) => JSON.parse(new TextDecoder().decode(b).replace(/^\s*\/\/.*$/gm, "")) as Record<string, string>)
    .catch(() => ({}));
  return hotaTable;
}

/**
 * A hero's own army: a picked stack moves, swaps, merges or splits; picked again, its window (Dismiss; Upgrade where
 * the place offers one: the Hill Fort). The hero screen, the map's hero widget and the Hill Fort share it.
 */
export function heroArmyClicks(
  modals: Modals,
  player: number,
  o: Pick<HeroScreenOptions, "data" | "send"> & { moraleLuck?: HeroScreenOptions["moraleLuck"] },
  hero: () => Hero,
  upgrade?: (slot: number) => StackWindowOptions["upgrade"],
): ArmyClicks {
  const clicks: ArmyClicks = new ArmyClicks({
    armies: () => [hero().army],
    move: (from, to, count) => o.send({ type: "transfer", heroes: [hero().id, hero().id], kind: "army", from: { who: 0, slot: from.slot }, to: { who: 0, slot: to.slot }, count }),
    split: (creature, left, right, minLeft, quick) => splitWindow(modals, player, o.data.creatures[creature], left, right, minLeft, quick),
    details: (ref) => {
      const h = hero();
      const a = h.army[ref.slot];
      const c = a && o.data.creatures[a.creature];
      if (!a || !c) return;
      void stackWindow(modals, player, c, {
        info: { count: a.count, ...stackInfo(h, c, o.data, o.moraleLuck?.(h)) },
        upgrade: upgrade?.(ref.slot),
        // A hero keeps at least one stack.
        dismiss: h.army.filter((x) => x).length > 1 ? () => o.send({ type: "dismissStack", hero: h.id, slot: ref.slot }) : undefined,
      });
    },
  });
  return clicks;
}

/**
 * Combination questions on screen, or answered yes and not yet carried out, by hero and combination
 * (two screens, or one reopened before the state catches up, mustn't ask again).
 */
const asking = new Set<string>();

/** All the parts of a combination worn: offers to put it together (once per hero and combination while the screen is open). */
export function comboOffers(modals: Modals, player: number, o: HeroScreenOptions, hero: () => Hero): () => Promise<void> {
  const asked = new Set<string>();
  return async () => {
    const h = hero();
    const can = assemblable(h);
    for (const key of asking) if (key.startsWith(`${h.id}:`) && !can.includes(Number(key.slice(key.indexOf(":") + 1)))) asking.delete(key);
    for (const combo of can) {
      const key = `${h.id}:${combo}`;
      if (asked.has(key) || asking.has(key)) continue;
      asked.add(key);
      asking.add(key);
      try {
        // GENRLTXT 732 (the parts are all here: assemble?) under the combination's own text, with its picture (VCMI's showArtifactAssemblyDialog).
        const name = o.data.artifacts[combo]?.name ?? "artifact";
        const line = said(((await gameTexts()).general[732] || englishLine("genrltxt", 732)).replace("%s", name));
        const pic = (await loadDef("artifact.def").catch(() => null))?.get(0)?.[combo];
        const a = await messageBox(modals, fmt`${artifactText(o.data, combo, h)}\n\n${line}`, player, {
          buttons: YES_NO,
          components: pic ? [{ texture: pic.texture, caption: NONE }] : undefined,
        });
        // (Still all worn: the state may have moved on while the question was up.)
        const now = hero();
        if (a === "yes" && now.id === h.id && assemblable(now).includes(combo)) o.send({ type: "assemble", hero: h.id, artifact: combo });
        else asking.delete(key);
      } catch (e) {
        asking.delete(key);
        throw e;
      }
    }
  };
}

/** Asks before a hero is dismissed (GENRLTXT 22, the original's question). */
export async function confirmDismiss(modals: Modals, player: number, h: Hero): Promise<boolean> {
  const question = (await gameTexts()).general[22] || fallback(`Are you sure you want to dismiss ${h.name}?`);
  const answer = await messageBox(modals, question, player, { buttons: YES_NO });
  return answer === "yes";
}
