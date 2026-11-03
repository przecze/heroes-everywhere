// The original spellbook (SPELBACK), laid out like the game (positions from VCMI's CSpellWindow).
import { extra, settings } from "../settings.ts";
import { hotkeyOfSpell, toggleSpellHotkey } from "./spellHotkeys.ts";
import { tr, said, fmt, type Text, fallback } from "../i18n/index.ts";
import type { School, SpellInfo } from "@heroes/core";
import { Container, Graphics, Sprite } from "pixi.js";
import { loadDef, loadImage } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";

/** VCMI's Colors::ORANGE. */
export const ORANGE: [number, number, number] = [232, 184, 32];
import { FingerArea, helpRow, label, loadButtonHelp, loadImagePlayer, textButton } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { textPopup } from "./dialogs.ts";
import { gameTexts } from "./highScores.ts";
import { textTable } from "./gameText.ts";
import { consumeLongPress } from "../touch.ts";
import { phoneSized, screenSize } from "./screen.ts";
import { mobileSpellbook } from "./mobileSpellbook.ts";
import { playOnce } from "./video.ts";

/** Tab frames in SPELTAB.DEF and the order of the click areas on the right edge. */
export const TAB_FRAME: (School | "all")[] = ["air", "fire", "water", "earth", "all"];
export const TAB_AREA: [School | "all", number][] = [["air", 0], ["earth", 57], ["fire", 116], ["water", 176], ["all", 236]];
export const SCHOOL_PICTURE: Record<School, number> = { air: 0, fire: 1, water: 2, earth: 3 };
/** The frames round a spell's picture (VCMI's CSpellWindow schoolBorders): the school's colour, and
 * frame 0-3 is the caster's mastery of it (none, basic, advanced, expert), shown by the corners. */
export const SCHOOL_BORDER: Record<School, string> = { air: "splevA.def", fire: "splevF.def", water: "splevW.def", earth: "splevE.def" };

/** Which school's frame a spell gets and in what mastery: the open school's tab, or (on the
 * "all" tab) the first of its schools in which the caster has the best mastery (VCMI's getSpellSchoolLevel). */
export function spellBorder(o: Pick<SpellbookOptions, "mastery" | "schoolLevel">, sp: SpellInfo, tab: School | "all"): [School, number] | null {
  const level = Math.max(0, Math.min(3, o.mastery(sp)));
  if (tab !== "all") return [tab, level];
  if (!sp.schools.length) return null;
  const level1 = o.schoolLevel;
  const best = level1 ? sp.schools.find((sc) => level1(sp, sc) >= level) : undefined;
  return [best ?? sp.schools[0], level];
}

/** Loads the four school frames (missing art leaves the pictures unframed). */
export async function loadSchoolBorders() {
  const out = {} as Record<School, Awaited<ReturnType<typeof loadDef>> | null>;
  await Promise.all((Object.keys(SCHOOL_BORDER) as School[]).map(async (sc) => (out[sc] = await loadDef(SCHOOL_BORDER[sc]).catch(() => null))));
  return out;
}

export interface SpellbookOptions {
  spells: SpellInfo[];
  mana: number;
  /** Which spells are combat spells (others are adventure spells). */
  isCombat: (sp: SpellInfo) => boolean;
  /** Start on the combat or the adventure spells. */
  combat: boolean;
  cost: (sp: SpellInfo) => number;
  /** Mastery text ("Basic"...) for the level line. */
  mastery: (sp: SpellInfo) => number;
  /** The caster's mastery of one school (picks which school's frame a many-school spell gets). */
  schoolLevel?: (sp: SpellInfo, school: School) => number;
  /** Why it can't be cast now (shown when clicked), or null. */
  blocked: (sp: SpellInfo) => Text | null;
  /** A spell of the other kind (a battle spell on the map, a map spell in a battle): a click shows its description, not a refusal (VCMI's SpellArea::clickPressed). */
  wrongKind?: (sp: SpellInfo) => boolean;
  /** Right-click: the spell's description. */
  describe: (sp: SpellInfo) => Text;
  onMessage: (text: Text) => void;
  /** A spell hotkey pressed (spellHotkeys.ts): this spell picked without opening the book, or refused with the book's reason. */
  pick?: number;
}

/** SKILLLEV.TXT's short forms (lines 4-6), for the level line "1st lev/Exp". */
export const MASTERY_SHORT = ["", "Bas", "Adv", "Exp"];
/** HELP.TXT rows of the book's areas (VCMI's CSpellWindow InteractiveArea ids). */
const AREA_HELP = { left: 450, right: 451, adventure: 452, combat: 453, air: 454, fire: 455, water: 456, earth: 457, all: 458, mana: 459, exit: 460 } as const;

/** VCMI's SpellSchool order (ANY -1): which way a page turns when the school changes, and the order spells with equal levels sort in. */
export const SCHOOL_RANK: Record<School | "all", number> = { all: -1, air: 0, fire: 1, water: 2, earth: 3 };
/** The Up / Down arrows' round (VCMI's CSpellWindow::keyPressed legacyOrder). */
const TAB_ROUND: (School | "all")[] = ["air", "earth", "fire", "water", "all"];
/** The tab and page the book was closed on, one each for the map and the battle (VCMI's spellbookLastTab / Page). */
export const lastOpen: Record<"map" | "battle", { school: School | "all"; page: number }> = { map: { school: "all", page: 0 }, battle: { school: "all", page: 0 } };

/** VCMI's SpellbookSpellSorter: level, then the schools in their order (a spell of an earlier school first), then the name. */
export function bookOrder(a: SpellInfo, b: SpellInfo): number {
  if (a.level !== b.level) return a.level - b.level;
  for (const sc of ["air", "fire", "water", "earth"] as School[]) {
    const x = a.schools.includes(sc);
    if (x !== b.schools.includes(sc)) return x ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/** Opens the book; resolves with the chosen spell, or null when closed. */
export async function spellbookWindow(modals: Modals, player: number, o: SpellbookOptions): Promise<SpellInfo | null> {
  if (o.pick !== undefined) {
    const sp = o.spells.find((x) => x.id === o.pick);
    const why = !sp ? tr("The hero doesn't know that spell.") : o.blocked(sp);
    if (why) return void o.onMessage(why), null;
    return sp ?? null;
  }
  // Phones: a page of spell cards in big text (the book's names and texts are unreadable there).
  if (phoneSized()) return mobileSpellbook(modals, player, o);
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("spelback.pcx", player)));
  const [tabs, schools, icons, cornerL, cornerR, borders] = await Promise.all([
    loadDef("speltab.def"),
    loadDef("schools.def").catch(() => null),
    loadDef("spells.def"),
    loadImage("speltrnl.pcx").catch(() => loadImage("speltrnl.bmp")),
    loadImage("speltrnr.pcx").catch(() => loadImage("speltrnr.bmp")),
    loadSchoolBorders(),
  ]);
  const tab = new Sprite();
  tab.position.set(524, 88);
  const left = new Sprite(cornerL);
  left.position.set(97, 77);
  const right = new Sprite(cornerR);
  right.position.set(487, 72);
  const page = new Container();
  const mana = label(said(String(o.mana)), "smalfont", YELLOW, "center", 40);
  mana.centreOn(435, 426);
  win.addChild(tab, page, left, right, mana);
  // The status bar along the bottom (VCMI's Spelroll at 7, 569): what the pointer is over.
  const status = label(said(""), "smalfont", WHITE, "center", 586);
  status.position.set(7, 569 + 3);
  win.addChild(status);
  const [general] = await Promise.all([gameTexts().then((t) => t.general).catch(() => [] as string[]), loadButtonHelp().catch(() => {})]);
  // GENRLTXT 172-176: "1st lev"..."5th lev"; 387: "Spell Points".
  const levelName = (n: number) => (general[171 + n] || `Level ${n}`).trim();
  const pointsName = (general[387] || fallback("Spell Points")).trim();
  const helpHover = (id: number) => helpRow(id)?.hover ?? "";
  const lev = await textTable("skilllev");
  const masteryShort = (m: number) => lev(2 + m, said(MASTERY_SHORT[m]));

  const memory = lastOpen[o.combat ? "battle" : "map"];
  let school: School | "all" = memory.school;
  /** The spell under the pointer: a digit pressed now ties it to that key (HD's spell hotkeys). */
  let hovered: SpellInfo | null = null;
  let combat = o.combat;
  let pageNo = 0;

  const list = () => o.spells.filter((sp) => o.isCombat(sp) === combat && (school === "all" || sp.schools.includes(school))).sort(bookOrder);

  return new Promise((resolve) => {
    let close = () => {};
    const finish = (sp: SpellInfo | null) => {
      // (Like VCMI's exit, and a cast on the map: the tab and page come back next time.)
      memory.school = school;
      memory.page = pageNo;
      close();
      resolve(sp);
    };
    const pages = () => {
      const n = list().length + (school === "all" ? 0 : 2);
      return Math.max(1, Math.ceil(n / 12));
    };
    pageNo = Math.max(0, Math.min(memory.page, pages() - 1));
    // Touch layout: the castable spells again as big named buttons in the room left of the book.
    const quick = new Container();
    let quickGen = 0;
    const drawQuick = async () => {
      const gen = ++quickGen;
      quick.removeChildren().forEach((c) => c.destroy({ children: true }));
      const room = screenSize.ox;
      if (!screenSize.touch || room < 120) return;
      const k = 1.3;
      const w = Math.min(170, Math.floor((room - 20) / k));
      const h = 32;
      const step = h * k + 8;
      const ready = o.spells.filter((sp) => o.isCombat(sp) === combat && !o.blocked(sp)).sort(bookOrder);
      const fit = ready.slice(0, Math.floor((600 - 20) / step));
      const buttons = await Promise.all(fit.map((sp) => textButton(fmt`${said(sp.name)} (${o.cost(sp)})`, w, h, () => finish(sp), "medfont")));
      if (gen !== quickGen || quick.destroyed) return void buttons.forEach((b) => b.destroy({ children: true }));
      for (const [i, b] of buttons.entries()) {
        b.scale.set(k);
        b.position.set(0, i * step);
        quick.addChild(b);
      }
      // Centred in the room left of the 800-wide middle, in the book's coordinates (it may be enlarged).
      const ws = win.scale.x || 1;
      quick.scale.set(1 / ws);
      quick.position.set((-room / 2 - (w * k) / 2 - win.x) / ws, ((600 - fit.length * step) / 2 - win.y) / ws);
    };
    const draw = () => {
      void drawQuick();
      page.removeChildren().forEach((c) => c.destroy({ children: true }));
      const f = tabs.get(0)?.[TAB_FRAME.indexOf(school)];
      // SPELTAB's and SCHOOLS' frames are trimmed: each at its offset in the DEF's canvas.
      if (f) (tab.texture = f.texture), tab.position.set(524 + f.x, 88 + f.y);
      left.visible = pageNo > 0;
      right.visible = pageNo < pages() - 1;
      const spells = list();
      // A school's first page opens with its picture in the first two slots.
      const offset = school !== "all" && pageNo === 0 ? 2 : 0;
      if (offset && schools) {
        const pic = schools.get(0)?.[SCHOOL_PICTURE[school as School]];
        if (pic) page.addChild(Object.assign(new Sprite(pic.texture), { x: 117 + pic.x, y: 74 + pic.y }));
      }
      const start = pageNo * 12 - (school !== "all" && pageNo > 0 ? 2 : 0);
      for (let slot = offset; slot < 12; slot++) {
        const sp = spells[start + slot - offset];
        if (!sp) break;
        const col = slot % 2;
        const row = Math.floor((slot % 6) / 2);
        const x = (slot < 6 ? 117 : 336) + col * 85;
        const y = 90 + row * 97;
        const c = new Container();
        c.position.set(x, y);
        const icon = icons.get(0)?.[sp.id];
        // The picture at its place in the 78x65 frame (the DEF's trimmed offset), as the school's frame is.
        if (icon) c.addChild(Object.assign(new Sprite(icon.texture), { x: icon.x, y: icon.y }));
        // The school's frame over the picture, its corners telling the mastery (as the original).
        const border = spellBorder(o, sp, school);
        const frame = border && borders[border[0]]?.get(0)?.[border[1]];
        if (frame) c.addChild(Object.assign(new Sprite(frame.texture), { x: frame.x, y: frame.y }));
        const m = o.mastery(sp);
        const blocked = o.blocked(sp);
        // As the original (VCMI's SpellArea): the name yellow and the rest white, or, when it can't be
        // cast, the name white and the rest orange (grey was unreadable on the parchment).
        // The lines as VCMI's SpellArea: "1st lev/Exp" (the mastery only when the caster has some), "Spell Points: 5".
        for (const [text, ly, first] of [[sp.name, 70, true], [`${levelName(sp.level)}${m ? `/${masteryShort(m)}` : ""}`, 82, false], [`${pointsName}: ${o.cost(sp)}`, 94, false]] as [string, number, boolean][]) {
          const t = label(said(text), "tiny", blocked ? (first ? WHITE : ORANGE) : first ? YELLOW : WHITE, "center", 90);
          t.centreOn(39, ly);
          c.addChild(t);
        }
        c.eventMode = "static";
        c.cursor = "pointer";
        c.hitArea = { contains: (px: number, py: number) => px >= 0 && py >= 0 && px < 65 && py < 104 };
        c.on("pointertap", (e) => {
          // (A finger held for the description lifts as a tap: not a cast.)
          if (e.button !== 0 || consumeLongPress()) return;
          if (o.wrongKind?.(sp)) return o.onMessage(o.describe(sp));
          if (blocked) return o.onMessage(blocked);
          finish(sp);
        });
        // The description while the right button (a held finger) stays down, as the original's popup.
        c.on("rightdown", (e) => void textPopup(o.describe(sp), player, e.global.x, e.global.y));
        const key = extra("spellHotkeys") ? hotkeyOfSpell(sp.id) : undefined;
        c.on("pointerover", () => ((hovered = sp), (status.value = fmt`${said(sp.name)} (${said(levelName(sp.level))})${extra("spellHotkeys") ? fmt`  ${key ? tr("Hotkey %1", key) : tr("Press 0-9 for a hotkey")}` : said("")}`)));
        c.on("pointerout", () => ((hovered = null), (status.value = said(""))));
        // Its hotkey in the picture's top left corner.
        if (key) {
          const k = label(said(key), "smalfont", YELLOW);
          k.position.set(3, 1);
          c.addChild(k);
        }
        page.addChild(c);
      }
    };
    const area = (x: number, y: number, w: number, h: number, fn: () => void, help?: number) => {
      const g = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
      g.position.set(x, y);
      // Touch screens: a finger's tap, a little past the art.
      g.hitArea = new FingerArea(g, w, h);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointertap", fn);
      if (help !== undefined) {
        g.on("pointerover", () => (status.value = said(helpHover(help))));
        g.on("pointerout", () => (status.value = said("")));
      }
      win.addChild(g);
    };
    // Turning a page plays the original's page turn over the book (VCMI: PGTRNLFT / PGTRNRGH at 13,14).
    const flip = (d: -1 | 1) => {
      if (settings().spellbookAnimation) playOnce(d < 0 ? "pgtrnlft" : "pgtrnrgh", win, 13, 14);
    };
    const turn = (d: -1 | 1) => {
      if (d < 0 ? pageNo <= 0 : pageNo >= pages() - 1) return;
      pageNo += d;
      draw();
      flip(d);
    };
    // A school's tab (VCMI selectSchool: the page turns left for a later school, right for an earlier one).
    const selectSchool = (s: School | "all") => {
      if (s === school) return;
      const d = SCHOOL_RANK[school] < SCHOOL_RANK[s] ? -1 : 1;
      school = s;
      pageNo = 0;
      draw();
      flip(d);
    };
    // The combat / adventure tabs (fbattleSpellsb turns left, fadvSpellsb right; nothing when already there).
    const selectKind = (c: boolean) => {
      if (c === combat) return;
      combat = c;
      pageNo = 0;
      draw();
      flip(c ? -1 : 1);
    };
    for (const [s, dy] of TAB_AREA) area(549, 94 + dy, 45, 35, () => selectSchool(s), AREA_HELP[s]);
    area(97, 77, 30, 30, () => turn(-1), AREA_HELP.left);
    area(487, 72, 30, 30, () => turn(1), AREA_HELP.right);
    area(221, 405, 36, 56, () => selectKind(true), AREA_HELP.combat);
    area(355, 405, 36, 56, () => selectKind(false), AREA_HELP.adventure);
    area(418, 405, 36, 56, () => {}, AREA_HELP.mana);
    area(479, 405, 36, 56, () => finish(null), AREA_HELP.exit);
    close = modals.show(win, {
      onKey: (key) => {
        if (key === "Escape" || key === "Enter") finish(null);
        else if (key === "ArrowLeft") turn(-1);
        else if (key === "ArrowRight") turn(1);
        // VCMI's spellbookTabAdventure / spellbookTabCombat.
        else if (key === "a" || key === "c") selectKind(key === "c");
        // Up / Down go round the school tabs (VCMI MOVE_UP / MOVE_DOWN).
        else if (key === "ArrowUp" || key === "ArrowDown") selectSchool(TAB_ROUND[(TAB_ROUND.indexOf(school) + (key === "ArrowDown" ? 1 : TAB_ROUND.length - 1)) % TAB_ROUND.length]);
        else if (/^[0-9]$/.test(key) && hovered && extra("spellHotkeys")) {
          const sp = hovered;
          toggleSpellHotkey(key, sp.id);
          draw();
          const now = hotkeyOfSpell(sp.id);
          status.value = now ? tr("%1: hotkey %2", sp.name, now) : tr("%1: no hotkey", sp.name);
        }
        return true;
      },
    });
    // Touch: swipe across the book to turn its pages.
    let swipeX: number | null = null;
    win.eventMode = "static";
    // The wheel turns them too.
    win.on("wheel", (e) => e.deltaY && turn(e.deltaY > 0 ? 1 : -1));
    const bg = win.getChildAt(0);
    // The book, and left of it the touch layout's quick list (a hit area also bounds the children's taps).
    win.hitArea = { contains: (x: number, y: number) => x < bg.width && y >= -win.y && y < bg.height + 600 && (x >= 0 ? y >= 0 && y < bg.height : true) };
    win.on("pointerdown", (e) => (swipeX = e.pointerType === "touch" ? e.global.x : null));
    win.on("pointerup", (e) => {
      if (swipeX === null) return;
      const dx = e.global.x - swipeX;
      swipeX = null;
      if (dx > 80) turn(-1);
      else if (dx < -80) turn(1);
    });
    // Drawn once the book has its place (the quick list sits beside it, outside its bounds).
    win.addChild(quick);
    draw();
  });
}
