// The spellbook on a phone (2026-10-25: the book's feel, its parchment, bookmarks and spell tiles): the original
// book itself (SPELBACK, unstretched), sideways both pages of it, upright the right-hand page with the school flags and
// the bookmarks (combat's moved beside the others). Six spells a page where the original has them, in their school
// frames, the cost on the picture and the name under it in the medium font (the level and "Spell Points" lines of
// the original's tiny type would not read on a phone). A tap casts, or says why it can't be cast now; a long press
// tells what it does (the original's right-click); a swipe or the corners turn the page.
import { fitOnPage } from "./blocks/phoneWindow.ts";
import type { School, SpellInfo } from "@heroes/core";
import { Container, Graphics, Rectangle, Sprite } from "pixi.js";
import { loadDef, loadImage } from "../assets.ts";
import { YELLOW } from "../text.ts";
import { DefButton, label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { type SpellbookOptions, SCHOOL_RANK, TAB_AREA, TAB_FRAME, bookOrder, lastOpen, loadSchoolBorders, spellBorder } from "./spellbook.ts";
import { openPage } from "./mobilePage.ts";
import { screenSize } from "./screen.ts";
import { SPELBACK, partTexture } from "./blocks/windowParts.ts";
import { consumeLongPress } from "../touch.ts";
import { tr, said, fmt, NONE } from "../i18n/index.ts";
import { settings } from "../settings.ts";
import { playOnce } from "./video.ts";

/** Ink on the parchment. */
const INK = [62, 36, 12] as const;
/** What can't be cast now: the original's orange, darkened to read on the page. */
const INK_OFF = [150, 70, 14] as const;
/** The book in SPELBACK: both pages, the flags and the bookmarks (sideways); the right-hand half (upright). */
const SPREAD = SPELBACK.parts.spread;
const HALF = SPELBACK.parts.half;
/** The bookmarks' art (x, y, w, h): combat, adventure, the spell points, close. */
const MARKS = { combat: [219, 404, 38, 52], adventure: [353, 404, 38, 52], mana: [416, 404, 40, 52], exit: [477, 404, 38, 52] } as const;
/** Upright, combat's bookmark hangs under the right-hand page too, left of adventure. */
const COMBAT_UPRIGHT = 306;

export async function mobileSpellbook(modals: Modals, player: number, o: SpellbookOptions): Promise<SpellInfo | null> {
  let chosen: SpellInfo | null = null;
  const page = await openPage(modals, { draw: () => draw(), bare: true });
  // The book's parts in the player's colours, as the desktop's (windowParts' SPELBACK).
  const [icons, borders, spread, half, combatMark, tabs, cornerL, cornerR] = await Promise.all([
    loadDef("spells.def").catch(() => null),
    loadSchoolBorders(),
    partTexture(SPELBACK, "spread", player),
    partTexture(SPELBACK, "half", player),
    partTexture(SPELBACK, "combatMark", player),
    loadDef("speltab.def").catch(() => null),
    loadImage("speltrnl.pcx").catch(() => loadImage("speltrnl.bmp")).catch(() => null),
    loadImage("speltrnr.pcx").catch(() => loadImage("speltrnr.bmp")).catch(() => null),
  ]);
  let combat = o.combat;
  // The school and page the book was closed on come back (VCMI's spellbookLastTab / Page).
  const memory = lastOpen[o.combat ? "battle" : "map"];
  let school: School | "all" = memory.school;
  let pageNo = memory.page;
  /** The book as drawn now (draw() makes it afresh). */
  let current: Container | null = null;
  // Turning a page plays the original's page turn over the book, as the desktop book does (spellbook.ts flip; The owner,
  // 2026-10-27: "missing page flip anim" on the phone). Upright, only the one page shows (the book is cut to it).
  const flip = (d: -1 | 1) => {
    if (current && settings().spellbookAnimation) playOnce(d < 0 ? "pgtrnlft" : "pgtrnrgh", current, 13, 14);
  };

  const draw = () => {
    const upright = screenSize.portrait;
    const R = upright ? HALF : SPREAD;
    // Everything below in the book's own pixels (SPELBACK's), the whole scaled to the screen.
    const book = new Container();
    book.label = "panel: spellbook";
    current = book;
    const bgTex = upright ? half : spread;
    const bg = bgTex ? new Sprite(bgTex) : new Graphics().rect(0, 0, R.w, R.h).fill({ color: 0xe8d8a8 });
    bg.position.set(R.x, R.y);
    book.addChild(bg);
    if (upright) {
      // Combat's bookmark, from under the left-hand page.
      const m = MARKS.combat;
      if (combatMark) book.addChild(Object.assign(new Sprite(combatMark), { x: COMBAT_UPRIGHT, y: m[1] }));
    }
    const pagesShown = upright ? 1 : 2;
    const per = 6 * pagesShown;
    const spells = o.spells.filter((sp) => o.isCombat(sp) === combat && (school === "all" || sp.schools.includes(school))).sort(bookOrder);
    const pages = Math.max(1, Math.ceil(spells.length / per));
    pageNo = Math.max(0, Math.min(pageNo, pages - 1));
    memory.school = school;
    memory.page = pageNo;
    let swiped = false;
    if (!spells.length) {
      const t = label(tr(`No %1 spells%2.`, combat ? tr("combat") : tr("adventure"), school === "all" ? "" : tr(" of this school")), "medfont", INK, "center", 180);
      t.centreOn(upright ? 414 : 200, 240);
      book.addChild(t);
    }
    for (const [i, sp] of spells.slice(pageNo * per, (pageNo + 1) * per).entries()) {
      const why = o.blocked(sp);
      const slot = upright ? i + 6 : i;
      const c = new Container();
      c.position.set((slot < 6 ? 117 : 336) + (slot % 2) * 85, 84 + Math.floor((slot % 6) / 2) * 97);
      const pic = new Container();
      const icon = icons?.get(0)?.[sp.id];
      if (icon) pic.addChild(Object.assign(new Sprite(icon.texture), { x: icon.x, y: icon.y }));
      // The school's frame over the picture, its corners telling the mastery (as the book).
      const border = icon ? spellBorder(o, sp, school) : null;
      const frame = border && borders[border[0]]?.get(0)?.[border[1]];
      if (frame) pic.addChild(Object.assign(new Sprite(frame.texture), { x: frame.x, y: frame.y }));
      pic.alpha = why ? 0.55 : 1;
      c.addChild(pic);
      // The cost in the picture's corner, the name under it.
      const cost = label(said(String(o.cost(sp))), "medfont", why ? INK_OFF : YELLOW, "center", 30);
      cost.position.set(78 - 6 - cost.width, 65 - 4 - cost.height);
      c.addChild(cost);
      const name = label(said(sp.name), "medfont", why ? INK_OFF : INK, "center", 86);
      name.position.set(Math.round(39 - name.width / 2), 66);
      c.addChild(name);
      c.eventMode = "static";
      c.cursor = "pointer";
      c.hitArea = new Rectangle(-3, -3, 84, 97);
      // A long press: what it does (the right button's popup, on a touch screen).
      c.on("pointerdown", (e) => {
        if (e.button !== 2 || !DefButton.showHelp) return;
        const text = o.describe(sp).replace(`${sp.name}\n\n`, "");
        DefButton.showHelp(fmt`${said(sp.name)}\n\n${said(text)}${why ? fmt`\n\n${why}` : NONE}`, e.global.x, e.global.y);
      });
      c.on("pointertap", (e) => {
        if (e.button !== 0 || swiped || consumeLongPress()) return;
        if (o.wrongKind?.(sp)) return o.onMessage(o.describe(sp));
        if (why) return o.onMessage(why);
        chosen = sp;
        page.close();
      });
      book.addChild(c);
    }
    // A finger swiped across the page turns it.
    const turn = (d: -1 | 1) => {
      if (d < 0 ? pageNo <= 0 : pageNo >= pages - 1) return;
      pageNo += d;
      draw();
      flip(d);
    };
    let from: number | null = null;
    bg.eventMode = "static";
    book.eventMode = "static";
    book.on("pointerdown", (e) => ((from = e.global.x), (swiped = false)));
    book.on("pointerup", (e) => {
      if (from === null) return;
      const dx = (e.global.x - from) * screenSize.css;
      from = null;
      if (Math.abs(dx) > 40) {
        swiped = true;
        turn(dx > 0 ? -1 : 1);
      }
    });
    book.on("pointerupoutside", () => (from = null));
    book.on("wheel", (e) => e.deltaY && turn(e.deltaY > 0 ? 1 : -1));
    // The page corners (the book's, at 97, 77 and 487, 72; upright both on the one page).
    for (const [tex, d, x, y] of [[cornerL, -1, upright ? 316 : 97, 77], [cornerR, 1, 487, 72]] as const) {
      if (!tex || (d < 0 ? pageNo <= 0 : pageNo >= pages - 1)) continue;
      const c = Object.assign(new Sprite(tex), { x, y });
      c.eventMode = "static";
      c.cursor = "pointer";
      c.label = d < 0 ? "button: previous page" : "button: next page";
      c.hitArea = new Rectangle(-12, -12, tex.width + 24, tex.height + 24);
      c.on("pointertap", () => turn(d));
      book.addChild(c);
    }
    // The school flags down the right edge (the book's; SPELTAB's frame for the open school).
    const frameOf = tabs?.get(0)?.[TAB_FRAME.indexOf(school)];
    if (frameOf) book.addChild(Object.assign(new Sprite(frameOf.texture), { x: 524 + frameOf.x, y: 88 + frameOf.y }));
    const area = (x: number, y: number, w: number, h: number, name: string, fn: () => void) => {
      const g = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
      g.position.set(x, y);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.label = `button: ${name}`;
      g.on("pointertap", fn);
      book.addChild(g);
    };
    for (const [sc, dy] of TAB_AREA)
      area(546, 92 + dy, 52, 50, `${sc} spells`, () => {
        if (sc === school) return;
        const d = SCHOOL_RANK[school] < SCHOOL_RANK[sc] ? -1 : 1;
        school = sc;
        pageNo = 0;
        draw();
        flip(d);
      });
    // The bookmarks: combat, adventure, the spell points (the number on it), close.
    const kind = (c: boolean) => () => {
      if (c === combat) return;
      combat = c;
      pageNo = 0;
      draw();
      flip(c ? -1 : 1);
    };
    area(upright ? COMBAT_UPRIGHT : MARKS.combat[0], 400, 40, 60, "combat spells", kind(true));
    area(MARKS.adventure[0], 400, 40, 60, "adventure spells", kind(false));
    area(MARKS.exit[0], 400, 40, 60, "Close", () => page.close());
    const mana = label(said(String(o.mana)), "medfont", YELLOW, "center", 60);
    mana.centreOn(MARKS.mana[0] + 20, 426);
    book.addChild(mana);
    // (No gold edge on the open kind's bookmark: the original has none, and the owner asked what the yellow square was, 2026-10-27.)

    // Scaled to the room (under the page's own buttons, clear of a sideways phone's navigation bar).
    const shell = new Container();
    book.position.set(-R.x, -R.y);
    shell.addChild(book);
    // Upright the book is its right-hand half: the page turn (drawn over both pages) is cut to it.
    if (upright) {
      const cut = new Graphics().rect(0, 0, R.w, R.h).fill(0xffffff);
      shell.addChild(cut);
      book.mask = cut;
    }
    fitOnPage(shell, R.w, R.h, upright);
    page.setContent(shell);
  };

  draw();
  await page.show();
  memory.school = school;
  memory.page = pageNo;
  return chosen;
}
