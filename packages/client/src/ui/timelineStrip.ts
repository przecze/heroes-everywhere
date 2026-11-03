// A game's timeline drawn left to right (timeline/model.ts): each point a little picture of what
// happened there (your flag for a new day, crossed swords for a battle, your town for a town taken,
// the star for the game won), its day under it, gold lines from each point to the next, and a branch
// left behind on a lane of its own below where it split off. One finger drags it both ways; a tap
// picks a point. The point you are at has a white frame, the picked one the original's yellow.
import { Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import { loadDef, townIcon } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { type Placed, type TimelinePoint, layout, nowPoint } from "../timeline/model.ts";
import { dateParts } from "@heroes/core";
import { tr, said, fmt, type Text } from "../i18n/index.ts";
import { PLAYER_RGB, eventLine, loadArt } from "./gameRows.ts";
import { GOLD } from "./blocks/menuBlocks.ts";
import { bigText } from "./mobilePage.ts";

/** The moment being played, ahead of the last point taken (it is not a point yet). */
export const NOW = "now";

interface Art {
  flags: Texture[];
  swords?: Texture;
  hourglass?: Texture;
  star?: Texture;
  town: Texture | null;
}

async function art(faction: number): Promise<Art> {
  const [flags, swords, hourglass, skills] = await Promise.all(["itgflags.def", "icm004.def", "icm006.def", "pskil32.def"].map((d) => loadDef(d).catch(() => null)));
  const town = faction >= 0 ? await townIcon(faction, true, false, "small").catch(() => null) : null;
  return { flags: (flags?.get(0) ?? []).map((f) => f.texture), swords: swords?.get(0)?.[0]?.texture, hourglass: hourglass?.get(0)?.[0]?.texture, star: skills?.get(0)?.[4]?.texture, town };
}

const iconOf = (p: TimelinePoint, a: Art, color: number): Texture | undefined =>
  p.kind === "battle" || p.kind === "lost" ? a.swords : p.kind === "won" ? a.star : p.kind === "town" || p.kind === "start" ? (a.town ?? a.flags[color]) : p.kind === "here" ? a.hourglass : a.flags[color];

export interface StripOptions {
  points: TimelinePoint[];
  /** Where this device is in the game. */
  head?: string;
  selected: string;
  /** The game goes on past the head (the moment being played): drawn as the hourglass after it. */
  now?: boolean;
  color: number;
  faction: number;
  w: number;
  h: number;
  /** How much bigger than the desktop's (phones: a finger's size). */
  k: number;
  onPick: (id: string) => void;
}

export async function timelineStrip(o: StripOptions): Promise<Container> {
  const a = await art(o.faction);
  const { k, w, h } = o;
  const colW = Math.round(62 * k);
  const laneH = Math.round(62 * k);
  const box = Math.round(36 * k);
  const placed: Placed[] = layout(o.points);
  if (o.now) {
    const head = placed.find((p) => p.point.id === o.head) ?? placed[placed.length - 1];
    const taken = head && placed.some((p) => p.parent === head);
    const lanes = Math.max(0, ...placed.map((p) => p.lane));
    const here = nowPoint(NOW, head?.point.day ?? 1);
    placed.push({ point: here, col: head ? head.col + 1 : 0, lane: taken ? lanes + 1 : (head?.lane ?? 0), ...(head ? { parent: head } : {}) });
  }
  const cols = Math.max(1, ...placed.map((p) => p.col + 1));
  const lanes = Math.max(1, ...placed.map((p) => p.lane + 1));
  const pad = Math.round(12 * k);
  const at = (p: Placed) => ({ x: pad + p.col * colW + colW / 2, y: pad + p.lane * laneH + box / 2 });

  const view = new Container();
  view.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.45 }).stroke({ color: 0x7a5d30, width: 1, alignment: 1 }));
  const content = new Container();
  const mask = new Graphics().rect(0, 0, w, h).fill(0xffffff);
  view.addChild(content, mask);
  view.mask = mask;
  // (Taps only inside the strip: the mask hides what's scrolled out, it doesn't stop it catching taps.)
  view.hitArea = new Rectangle(0, 0, w, h);
  const fullW = pad * 2 + cols * colW;
  const fullH = pad * 2 + lanes * laneH;
  content.addChild(new Graphics().rect(0, 0, Math.max(w, fullW), Math.max(h, fullH)).fill({ color: 0, alpha: 0.001 }));

  // The lines first, under the pictures: along the lane, and down a step where a branch leaves.
  const lines = new Graphics();
  for (const p of placed) {
    if (!p.parent) continue;
    const from = at(p.parent);
    const to = at(p);
    if (from.y === to.y) lines.moveTo(from.x, from.y).lineTo(to.x, to.y);
    else lines.moveTo(from.x, from.y).lineTo(from.x + colW / 2, from.y).lineTo(from.x + colW / 2, to.y).lineTo(to.x, to.y);
  }
  lines.stroke({ color: GOLD, width: Math.max(2, Math.round(3 * k)), alpha: 0.85 });
  content.addChild(lines);

  let dragged = false;
  for (const p of placed) {
    const { x, y } = at(p);
    const node = new Container();
    node.position.set(Math.round(x - box / 2), Math.round(y - box / 2));
    node.addChild(new Graphics().rect(0, 0, box, box).fill({ color: 0x000000, alpha: 0.7 }));
    const tex = iconOf(p.point, a, o.color);
    if (tex) {
      const s = Math.min((box - 6) / tex.width, (box - 6) / tex.height);
      node.addChild(Object.assign(new Sprite(tex), { scale: { x: s, y: s }, x: Math.round((box - tex.width * s) / 2), y: Math.round((box - tex.height * s) / 2) }));
    }
    const sel = p.point.id === o.selected;
    const head = p.point.id === o.head;
    const ring = sel ? 0xffe000 : head ? 0xffffff : p.point.kind === "lost" ? 0xe03030 : PLAYER_RGB[o.color];
    node.addChild(new Graphics().rect(0, 0, box, box).stroke({ color: ring, width: sel || head ? Math.max(2, Math.round(3 * k)) : 2, alignment: 1 }));
    const day = bigText(said(String(p.point.day)), "medfont", sel ? YELLOW : WHITE, 1.25 * Math.max(1, k * 0.8), { w: colW - 4, center: true });
    day.position.set(Math.round(box / 2 - (colW - 4) / 2), box + 2);
    if (!sel) day.alpha = 0.8;
    node.addChild(day);
    // A finger-sized target around the picture and its day.
    node.hitArea = { contains: (hx: number, hy: number) => hx >= box / 2 - colW / 2 && hx <= box / 2 + colW / 2 && hy >= -6 * k && hy <= laneH - 6 * k };
    node.eventMode = "static";
    node.cursor = "pointer";
    node.label = `point: day ${p.point.day} ${p.point.kind}`;
    node.on("pointertap", () => !dragged && o.onPick(p.point.id));
    content.addChild(node);
  }

  // Dragged with one finger (or the mouse) both ways, the wheel scrolls along; first, the picked point in view.
  let cx = 0;
  let cy = 0;
  const clamp = () => {
    cx = Math.max(Math.min(0, w - fullW), Math.min(0, cx));
    cy = Math.max(Math.min(0, h - fullH), Math.min(0, cy));
    content.position.set(Math.round(cx), Math.round(cy));
  };
  const pick = placed.find((p) => p.point.id === o.selected);
  if (pick) {
    const { x, y } = at(pick);
    cx = w - x - colW * 1.5;
    cy = h / 2 - y;
  } else cx = -fullW;
  clamp();
  view.eventMode = "static";
  let from: { x: number; y: number } | null = null;
  let travel = 0;
  view.on("pointerdown", (e) => ((from = { x: e.global.x, y: e.global.y }), (travel = 0), (dragged = false)));
  view.on("globalpointermove", (e) => {
    if (!from) return;
    const s = view.worldTransform.a || 1;
    const dx = (e.global.x - from.x) / s;
    const dy = (e.global.y - from.y) / s;
    from = { x: e.global.x, y: e.global.y };
    travel += Math.abs(dx) + Math.abs(dy);
    if (travel > 8) dragged = true;
    cx += dx;
    cy += dy;
    clamp();
  });
  const up = () => {
    from = null;
    setTimeout(() => (dragged = false), 0);
  };
  view.on("pointerup", up);
  view.on("pointerupoutside", up);
  view.on("wheel", (e) => ((cx -= e.deltaY + e.deltaX), clamp()));
  view.label = "timeline";
  return view;
}

/** What a point is, in a few words. */
export function kindText(kind: TimelinePoint["kind"]): Text {
  return {
    start: tr("The game begins"),
    day: tr("A new day"),
    battle: tr("A battle"),
    town: tr("A town taken"),
    won: tr("The game won"),
    lost: tr("The game lost"),
    here: tr("Where you left off"),
  }[kind];
}

/** "5 min ago" and the like, in the interface's language. */
export const ago = (at: number) => {
  const ms = Date.now() - at;
  return ms < 90_000 ? tr("just now") : ms < 3_600_000 ? tr("%1 min ago", Math.round(ms / 60_000)) : ms < 172_800_000 ? tr("%1 h ago", Math.round(ms / 3_600_000)) : tr("%1 days ago", Math.round(ms / 86_400_000));
};

/**
 * The picked point told: its date, what it is and when it was taken (and on which device), the
 * happenings since the point before with their little icons, and what playing on from it does.
 */
export async function pointCard(p: TimelinePoint | null, o: { color: number; w: number; branches: boolean; now?: boolean }): Promise<Container> {
  const a = await loadArt();
  const c = new Container();
  const { w } = o;
  if (!p) return c;
  const date = bigText(tr("Month %1, Week %2, Day %3", ...dateParts(p.day)), "medfont", YELLOW, 1.25, { w });
  c.addChild(date);
  let y = 26;
  const what = p.id === NOW ? tr("Where you left off") : fmt`${kindText(p.kind)} · ${ago(p.at)}${p.device ? fmt`, ${said(p.device)}` : said("")}`;
  c.addChild(Object.assign(bigText(what, "medfont", WHITE, 1.25, { w }), { y }));
  y += 30;
  const sum = { color: o.color, faction: -1, heroes: 0, towns: 0, events: [] };
  for (const line of p.events ?? []) {
    const l = eventLine({ kind: /claims|Grail/.test(line) ? "town" : "battle", text: line }, sum, a, w, 1.25);
    l.y = y;
    c.addChild(l);
    y += l.height + 4;
  }
  const hint = p.id === NOW ? tr("Load carries on where you left off.") : o.branches ? tr("Playing on from here starts a new branch; the later points stay.") : tr("Load goes back to this point.");
  const t = bigText(hint, "medfont", WHITE, 1.25, { wrap: w });
  t.alpha = 0.75;
  t.y = y + 6;
  c.addChild(t);
  return c;
}
