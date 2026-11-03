// The town hall on a phone: the original's building tiles (picture, the green / red / gold bar,
// the mark) half as big again in a list a finger drags, in the hall's own order (hall and fort
// first, each building always in its place); why one can't be built yet shows once it is opened.
// A tap opens the build window, a long tap shows the building and why it can or can't be built. Every phone layout (2026-10-26: the two-wide list upright, not the desktop grid scaled down; sideways as many to a row as fit).
import { Container, type Texture } from "pixi.js";
import type { Modals } from "../ui/modals.ts";
import { contentArea, openPage, pageColumn, scrollList } from "../ui/mobilePage.ts";
import { type BarState, shopGrid, shopTile, shopTileArt } from "../ui/blocks/shopTiles.ts";
import { type Text } from "../i18n/index.ts";

export interface HallEntry {
  id: number;
  name: string;
  /** TPTHBAR's states: 0 built, 1 can be built, 2 not yet, 3 not in this town. */
  bar: number;
  /** TPTHCHK's mark: 0 built, 1 can't yet, 2 too dear, -1 none. */
  mark: number;
  why: string | null;
  icon?: Texture;
}

/** Resolves once closed; `pick` opens a building's window and answers whether it was built. */
export async function mobileHall(modals: Modals, title: Text, entries: () => HallEntry[], pick: (id: number) => Promise<boolean>, info?: (e: HallEntry) => void, resources?: (room: number) => Promise<Container>): Promise<void> {
  const page = await openPage(modals, { draw: () => draw(), titleOnly: true });
  let area = contentArea();
  const art = await shopTileArt();
  let list: ReturnType<typeof scrollList> | null = null;
  const done = () => page.close();

  const draw = async () => {
    // The layout now (the phone may have turned).
    area = contentArea();
    const parts = await pageColumn(title, { buttons: [["Close", () => done()]] });
    // What you have, in a strip across the list's foot (the original's hall keeps the resource bar at its foot;
    // The owner, 2026-10-25: see your resources while buying). Redrawn with the page, so a building bought shows at once.
    if (resources) {
      const bar = await resources(area.w);
      area = { ...area, h: area.h - bar.height - 12 };
      bar.position.set(area.x + Math.round((area.w - bar.width) / 2), area.y + area.h + 12);
      parts.addChild(bar);
    }
    // The original's tiles (picture, the green / red / gold bar with the name, the mark) half as big again, as many
    // to a row as fit: the phones' one shopping-list look (ui/blocks/shopTiles.ts).
    const { cols, k, tileW, tileH, gapX, gapY } = shopGrid(area.w);
    const content = new Container();
    // Each building in its slot, whatever can be built now (the player: they keep their place).
    for (const [i, e] of entries().entries()) {
      const tile = shopTile({ label: `hall: ${e.name}`, name: e.name, bar: e.bar as BarState, picture: e.icon, mark: e.mark }, art, k);
      tile.position.set((i % cols) * (tileW + gapX), Math.floor(i / cols) * (tileH + gapY));
      // (The reason one can't be built only once its tile is opened: the red bar already says it can't; The owner, 2026-10-26 22:14.)
      tile.eventMode = "static";
      tile.on("rightdown", (ev) => info?.(e));
      if (e.bar !== 0) {
        // One-handed: a slot of the page's grid, which stays where it is (touchcheck's handGrid).
        (tile as Container & { handGrid?: boolean }).handGrid = true;
        tile.cursor = "pointer";
        tile.on("pointertap", async (ev) => {
          if (list?.moved() || ev.button === 2) return;
          if (await pick(e.id)) done();
          else void draw();
        });
      }
      content.addChild(tile);
    }
    const keep = list?.offset() ?? 0;
    list = scrollList(content, area, keep);
    parts.addChild(list.view);
    page.setContent(parts);
  };

  await draw();
  return page.show();
}
