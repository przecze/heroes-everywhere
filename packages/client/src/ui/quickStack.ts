// The buttons for HotA's quick stack actions (the plans are in quickPlan.ts): pictures of squares, no words.
import { Container, Graphics, Sprite } from "pixi.js";
import { loadDef } from "../assets.ts";
import { blankButton } from "./kit.ts";
import { QUICK_KINDS, QUICK_NAMES, type QuickKind, type QuickOps } from "./quickPlan.ts";

/** The small pictures on the buttons (no words: stacks of squares). */
function glyph(kind: QuickKind | "upgrade", w: number, h: number): Graphics {
  const g = new Graphics();
  const sq = 9;
  const cell = (x: number, y: number, size = sq) => g.rect(x, y, size, size).fill({ color: 0xe5d77b }).stroke({ color: 0x7a5d30, width: 1 });
  const cy = h / 2 - sq / 2;
  if (kind === "half") {
    cell(w / 2 - sq - 3, cy);
    cell(w / 2 + 3, cy);
  } else if (kind === "spread") {
    for (let i = 0; i < 4; i++) cell(w / 2 - 2 * sq - 9 + i * (sq + 6), cy);
  } else if (kind === "ones") {
    // Three big "1"s (2026-11-03: a little one inside a square was barely visible and looked like the even split).
    const top = h / 2 - 9;
    for (let i = 0; i < 3; i++) {
      const x = w / 2 - 18 + i * 14;
      g.poly([x, top + 4, x + 4, top, x + 7, top, x + 7, top + 15, x + 9, top + 15, x + 9, top + 18, x, top + 18, x, top + 15, x + 3, top + 15, x + 3, top + 5, x + 1, top + 6])
        .fill({ color: 0xe5d77b })
        .stroke({ color: 0x7a5d30, width: 1 });
    }
  } else if (kind === "upgrade") {
    // Two arrows up.
    for (const dx of [-9, 5]) g.poly([w / 2 + dx, cy + 14, w / 2 + dx + 8, cy + 14, w / 2 + dx + 8, cy + 6, w / 2 + dx + 12, cy + 6, w / 2 + dx + 4, cy - 4, w / 2 + dx - 4, cy + 6, w / 2 + dx, cy + 6]).fill({ color: 0xe5d77b }).stroke({ color: 0x7a5d30, width: 1 });
  } else {
    // Two small stacks into one big one.
    cell(w / 2 - 20, cy - 8, 7);
    cell(w / 2 - 20, cy + 10, 7);
    g.poly([w / 2 - 8, cy - 1, w / 2 - 8, cy + 11, w / 2 - 1, cy + 5]).fill({ color: 0xe5d77b });
    cell(w / 2 + 3, cy - 2, 13);
  }
  return g;
}

/** The creature window's Upgrade button's face (IVIEWCR's first frame) inside a w x h button. */
async function upgradePicture(w: number, h: number): Promise<Container | null> {
  const f = (await loadDef("iviewcr.def").catch(() => null))?.get(0)?.[0];
  if (!f) return null;
  const s = new Sprite(f.texture);
  s.scale.set(Math.min((w - 6) / f.texture.width, (h - 6) / f.texture.height));
  s.position.set(Math.round((w - s.width) / 2), Math.round((h - s.height) / 2));
  const c = new Container();
  c.addChild(s);
  return c;
}

/** The four action buttons in a row (pictures, greyed where they make no sense); `done` after one ran. */
export async function quickStrip(ops: QuickOps, done: () => void, bw = 52, bh = 36, gap = 8): Promise<Container> {
  const row = new Container();
  const kinds: (QuickKind | "upgrade")[] = ops.upgradeAll ? [...QUICK_KINDS, "upgrade"] : QUICK_KINDS;
  for (const [i, kind] of kinds.entries()) {
    const b = new Container();
    b.label = `button: ${kind === "upgrade" ? "Upgrade all" : QUICK_NAMES[kind]}`;
    const live = kind === "upgrade" ? ops.upgradeAll!.can() : ops.can(kind);
    const [face, held] = await Promise.all([blankButton(bw, bh), blankButton(bw, bh, true)]);
    held.visible = false;
    // Upgrade all: the creature window's own Upgrade picture (IVIEWCR; The owner, 2026-10-27 22:05 didn't know the two
    // drawn arrows), squares for the others.
    const pic: Container = (kind === "upgrade" && (await upgradePicture(bw, bh))) || glyph(kind, bw, bh);
    b.addChild(face, held, pic);
    // (Greyed out: the picture dims, the button stays.)
    pic.alpha = live ? 1 : 0.3;
    b.position.set(i * (bw + gap), 0);
    b.eventMode = "static";
    b.cursor = live ? "pointer" : "default";
    (b as Container & { handGrid?: boolean }).handGrid = true;
    b.on("pointerdown", () => live && ((held.visible = true), (face.visible = false)));
    const release = () => ((held.visible = false), (face.visible = true));
    b.on("pointerup", release);
    b.on("pointerupoutside", release);
    b.on("pointertap", () => live && (kind === "upgrade" ? ops.upgradeAll!.run() : ops.run(kind), done()));
    row.addChild(b);
  }
  return row;
}
