// The original's list of places to pick from (TPGATE: the Castle Gate's towns, Town Portal's
// destinations), laid out as VCMI's CObjectListWindow: a title (and the building's or spell's
// picture under it), a line saying what to do, nine rows of 25 pixels with the picked one framed
// (TPGATES), OK and Cancel. A click picks a row, a double click (or Enter) goes; a finger drags the rows.
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { loadImage } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { rowSwipe } from "./blocks/rowSwipe.ts";
import { DefButton, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { said, type Text } from "../i18n/index.ts";

export interface ObjectListOptions {
  title: Text;
  description: Text;
  items: string[];
  /** Shown centred under the title (the Castle Gate's building icon). */
  picture?: Texture | null;
}

const ROWS = 9;
const ROW_H = 25;
const LIST = { x: 14, y: 151 };

/** Resolves with the picked row, or -1 when cancelled. */
export async function objectListWindow(modals: Modals, player: number, o: ObjectListOptions): Promise<number> {
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("tpgate.pcx", Math.max(0, player))));
  const frame = await loadImage("tpgates.pcx").catch(() => null);
  // (VCMI's CENTER labels: the title on 152, 27, the line under it on 145, 133; each row's name on its frame's middle.)
  const title = label(o.title, "bigfont", YELLOW).centreOn(152, o.picture ? 27 : 51);
  win.addChild(title);
  if (o.picture) win.addChild(Object.assign(new Sprite(o.picture), { x: Math.round(152 - o.picture.width / 2), y: Math.round(75 - o.picture.height / 2) }));
  const descr = label(o.description, "smalfont", WHITE).centreOn(145, 133);
  win.addChild(descr);
  const rows = new Container();
  win.addChild(rows);
  let selected = o.items.length ? 0 : -1;
  let top = 0;
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v: number) => (close(), resolve(v));
    let lastTap = { row: -1, at: 0 };
    const draw = () => {
      rows.removeChildren().forEach((c) => c.destroy({ children: true }));
      top = Math.max(0, Math.min(top, o.items.length - ROWS));
      for (let i = 0; i < ROWS && top + i < o.items.length; i++) {
        const index = top + i;
        const row = new Container();
        row.position.set(LIST.x, LIST.y + i * ROW_H);
        const w = frame?.width ?? 256;
        const h = frame?.height ?? 22;
        row.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 }));
        if (index === selected && frame) row.addChild(new Sprite(frame));
        const t = label(said(o.items[index]), "smalfont", WHITE).centreOn(Math.floor(w / 2), Math.floor(h / 2));
        t.fit(w - 8);
        row.addChild(t);
        row.eventMode = "static";
        row.cursor = "pointer";
        row.on("pointertap", () => {
          if (swipe.moved()) return;
          const now = performance.now();
          if (lastTap.row === index && now - lastTap.at < 400) return done(index);
          lastTap = { row: index, at: now };
          selected = index;
          draw();
        });
        rows.addChild(row);
      }
    };
    const move = (d: number) => {
      if (!o.items.length) return;
      selected = Math.max(0, Math.min(o.items.length - 1, selected + d));
      if (selected < top) top = selected;
      if (selected >= top + ROWS) top = selected - ROWS + 1;
      draw();
    };
    // A finger drags the rows (more than nine places: Town Portal late in a game).
    const swipe = rowSwipe(rows, ROW_H, () => top, (t) => ((top = t), draw()));
    draw();
    win.eventMode = "static";
    win.on("wheel", (e) => ((top += e.deltaY > 0 ? 1 : -1), draw()));
    const ok = new DefButton("iokay.def", 15, 402, player);
    ok.onClick = () => selected >= 0 && done(selected);
    const cancel = new DefButton("icancel.def", 228, 402, player);
    cancel.onClick = () => done(-1);
    win.addChild(ok, cancel);
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Enter") ok.onClick();
        else if (k === "Escape") cancel.onClick();
        else if (k === "ArrowUp") move(-1);
        else if (k === "ArrowDown") move(1);
        else if (k === "PageUp") move(-ROWS);
        else if (k === "PageDown") move(ROWS);
        return true;
      },
    });
  });
}
