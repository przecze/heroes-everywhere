// The Mage Guild on an upright phone (2026-10-27 22:43: "spells listed with text = bad always, and the full
// desktop graphic just scaled down rather than reimagined"): one of phoneWindow's sheets. The guild's room as a
// picture across the top (cut round its window onto the town, the part that is the guild's own), then a row per
// level of the guild: the level's number and its spells' scrolls (SPELLSCR) at a finger's size, the levels not built
// yet as empty scrolls half the size. A tap on a scroll does what the desktop's click does (HotA's research), a held finger shows
// the spell's text (the original's right click), as the spellbook's. Exit at the foot.
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { loadDef } from "../assets.ts";
import { YELLOW } from "../text.ts";
import { DefButton } from "../ui/kit.ts";
import { textPopup } from "../ui/dialogs.ts";
import { type Modals } from "../ui/modals.ts";
import { FRAME_PAD as P, SHEET_IN, SHEET_NAME, SPLIT, fitSheet, splitLine } from "../ui/blocks/phoneWindow.ts";
import { bigText, openPage } from "../ui/mobilePage.ts";
import { spellText } from "../ui/spellText.ts";
import { said, fallback, type Text } from "../i18n/index.ts";

/** What a scroll needs of its spell. */
type Spell = { id: number; name: string; text: string[] };

export interface GuildSheet {
  player: number;
  /** Its name over the window (Mage Guild Level 3). */
  title: string;
  /** The guild's room (TPMAGE...) with its window onto the town drawn in, and where that window is. */
  room: Texture;
  view: { texture: Texture; x: number; y: number } | null;
  /** How many levels the town's guild can have, and how many are built. */
  levels: number;
  built: number;
  /** Each level's spells (undefined: not built yet), the slots each level has. */
  spells: (l: number) => (Spell | undefined)[] | undefined;
  slots: (l: number) => number;
  /** The scroll a spell's id has (the Aurora Borealis: every scroll the same). */
  scroll: (id: number) => Texture | undefined;
  /** The slot under HotA's research, if any. */
  research: () => [level: number, slot: number] | undefined;
  /** The Aurora Borealis: every scroll says this. */
  aurora?: Text;
  tap: (level: number, slot: number) => Promise<void>;
  onClose: () => void;
}

/** A scroll's cell: the scrolls (about 50 x 90) at this width. */
const CELL = 50;
const NUM_W = 30;

export async function mobileGuild(modals: Modals, g: GuildSheet): Promise<() => void> {
  const empty = await loadDef("tpmages.def").then((d) => d.get(0)?.[1]?.texture).catch(() => undefined);
  const exit = new DefButton("tpmage1.def", 0, 0, g.player);
  await exit.ready;
  let busy = false;
  let shell: Awaited<ReturnType<typeof openPage>> | null = null;
  const draw = () => {
    const root = new Container();
    root.label = "window: mage guild";
    let y = P;
    // The room round its window onto the town: as wide as the sheet, cut to a band.
    const band = new Container();
    band.label = "picture: mage guild";
    band.addChild(new Sprite(g.room));
    if (g.view) band.addChild(Object.assign(new Sprite(g.view.texture), { x: g.view.x, y: g.view.y }));
    const cx = g.view ? g.view.x + g.view.texture.width / 2 : 400;
    const cutW = 440;
    const cutH = 230;
    const cut = new Rectangle(Math.max(0, Math.min(800 - cutW, Math.round(cx - cutW / 2))), g.view ? Math.max(0, g.view.y - 20) : 60, cutW, cutH);
    band.position.set(-cut.x, -cut.y);
    const pic = new Container();
    pic.addChild(band);
    pic.mask = pic.addChild(new Graphics().rect(0, 0, cutW, cutH).fill(0xffffff));
    pic.scale.set(SHEET_IN / cutW);
    pic.position.set(P, y);
    root.addChild(pic);
    y += Math.round(cutH * pic.scale.y) + SPLIT;
    // A row per level: its number, then its scrolls.
    for (let l = 0; l < g.levels; l++) {
      if (l) splitLine(root, P, y - SPLIT, SHEET_IN);
      const row = new Container();
      row.label = `panel: guild level ${l + 1}`;
      const on = l < g.built;
      const num = bigText(said(String(l + 1)), "bigfont", YELLOW, SHEET_NAME);
      num.alpha = on ? 1 : 0.45;
      row.addChild(num);
      const spells = g.spells(l);
      const n = g.slots(l);
      // A level not built yet: its empty scrolls at half the size, so the guild's built rows keep the room (the owner's note
      // 2026-10-29 07:25: "why 2nd and 3rd row so big" on a guild of level 1).
      const cell = on ? CELL : Math.round(CELL / 2);
      const step = Math.min(cell + 8, (SHEET_IN - NUM_W) / Math.max(1, n));
      let rowH = num.height;
      for (let i = 0; i < n; i++) {
        const spell = spells?.[i];
        const tex = g.aurora ? g.scroll(70) : spell ? g.scroll(spell.id) : empty;
        if (!tex) continue;
        const sp = new Sprite(tex);
        sp.scale.set(cell / tex.width);
        sp.position.set(Math.round(NUM_W + i * step + (step - sp.width) / 2), 0);
        if (!on) sp.alpha = 0.45;
        row.addChild(sp);
        rowH = Math.max(rowH, sp.height);
        const r = g.research();
        if (spell && r && r[0] === l + 1 && r[1] === i) row.addChild(new Graphics().rect(sp.x - 2, -2, sp.width + 4, sp.height + 4).stroke({ color: 0xffd700, width: 2 }));
        if (!spell && !g.aurora) continue;
        sp.label = `button: ${spell?.name ?? fallback("every spell")}`;
        sp.eventMode = "static";
        sp.cursor = "pointer";
        sp.on("pointertap", () => {
          if (busy || g.aurora) return;
          busy = true;
          void g.tap(l + 1, i).finally(() => ((busy = false), draw()));
        });
        // Held: the spell's text (the original's right click on a scroll).
        sp.on("rightdown", (e) => textPopup(g.aurora ?? (spell ? spellText(spell) : said("")), g.player, e.global.x, e.global.y, [{ texture: tex, caption: said(spell?.name ?? "") }]));
      }
      num.position.set(0, Math.round((rowH - num.height) / 2));
      row.position.set(P, y);
      root.addChild(row);
      y += rowH + SPLIT;
    }
    exit.scale.set(1.1);
    exit.position.set(P + SHEET_IN - exit.width, y);
    root.addChild(exit);
    fitSheet(root, y + exit.height + P);
    shell?.setContent(root);
  };
  shell = await openPage(modals, { bare: true, title: said(g.title), onClose: g.onClose, draw });
  exit.onClick = () => shell?.close();
  draw();
  void shell.show();
  return () => shell?.close();
}
