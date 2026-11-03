// HotA's buttons on a game console's controller (the platform's controller layer is pad/index.ts): on each screen the
// face buttons and shoulders press the original's own hotkeys (VCMI's keyBindingsConfig, as map/input.ts, the battle's
// and the town's onKey read them), the second layer (L2 held) the rest; each names the on-screen button it stands
// for, so its glyph is drawn beside it. Cross clicks, Square is the right click (the info popups), Circle is Back:
// those three are the platform's.
import type { Application, Container } from "pixi.js";
import { DefButton } from "../ui/kit.ts";
import { tr } from "../i18n/index.ts";
import { type PadBinding, type PadGame, nudgeCursor } from "../pad/index.ts";
import { screenSize } from "../ui/screen.ts";

/** What the adventure map's page says of itself (map/input.ts sets it): where the player is, and its view to move. */
export interface MapPadHooks {
  context(): "map" | "world" | "town" | "battle" | "tactics" | "window" | "loading";
  /** The right stick over the map: the view moves (map pixels a second at full tilt, scaled by the tilt). */
  look?(x: number, y: number, dt: number): boolean;
}
let hooks: MapPadHooks | null = null;
export function setMapPadHooks(h: MapPadHooks | null) {
  hooks = h;
}

const walk = (label: string): PadBinding[] =>
  (["up", "down", "left", "right"] as const).map((button) => ({ button, label, key: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[button], shift: true, repeat: true }));

/**
 * The d-pad in a battle (Songs of Conquest's players: a stick is slow and unsure from hex to hex): the cursor a hex
 * at a time (44 x 42 game pixels; up and down zigzag half a hex so they keep to a column).
 */
let zig = 1;
const hexSteps = (label: string): PadBinding[] => {
  const k = () => {
    const c = document.querySelector("#stage canvas");
    return c ? c.getBoundingClientRect().width / screenSize.w : 1;
  };
  const step = (dx: number, dy: number) => () => {
    if (dy) zig = -zig;
    nudgeCursor((dx + (dy ? zig * 22 : 0)) * k(), dy * k());
  };
  return [
    { button: "up", label, act: step(0, -42), repeat: true },
    { button: "down", label, act: step(0, 42), repeat: true },
    { button: "left", label, act: step(-44, 0), repeat: true },
    { button: "right", label, act: step(44, 0), repeat: true },
  ];
};

export function padBindings(ctx: string): PadBinding[] {
  switch (ctx) {
    case "map":
      return [
        { button: "triangle", label: tr("End turn"), key: "e", near: "iam001.def", hold: 600 },
        { button: "l1", label: tr("Next hero"), key: "h", near: "iam000.def" },
        { button: "r1", label: tr("Next town"), key: "t" },
        ...walk(tr("Walk a tile")),
        { button: "l3", label: tr("Hero screen"), key: "Enter" },
        { button: "r3", label: tr("World view"), key: "v" },
        { button: "cross", more: true, label: tr("Cast a spell"), key: "c", near: "iam007.def" },
        { button: "square", more: true, label: tr("Kingdom overview"), key: "k", near: "iam002.def" },
        { button: "triangle", more: true, label: tr("Quest log"), key: "q", near: "iam004.def" },
        { button: "circle", more: true, label: tr("System options"), key: "o", near: "iam009.def" },
        { button: "l1", more: true, label: tr("Move hero"), key: "m", near: "iam006.def" },
        { button: "r1", more: true, label: tr("Surface / underground"), key: "u", near: "iam010.def" },
        { button: "up", more: true, label: tr("Adventure options"), key: "a", near: "iam008.def" },
        { button: "down", more: true, label: tr("Dig"), key: "d" },
        { button: "left", more: true, label: tr("Puzzle map"), key: "p" },
        { button: "right", more: true, label: tr("Scenario information"), key: "i" },
      ];
    case "world":
      return [{ button: "triangle", label: tr("Close"), key: "Enter" }];
    case "tactics":
      return [
        { button: "triangle", label: tr("Start the battle"), key: "Enter", near: "button: Start battle" },
        { button: "r1", label: tr("Next stack"), key: " ", near: "button: Next stack" },
        ...hexSteps(tr("Step a hex")),
      ];
    case "battle":
      return [
        { button: "triangle", label: tr("Wait"), key: "w", near: "button: Wait" },
        { button: "r1", label: tr("Defend"), key: "d", near: "button: Defend" },
        { button: "l1", label: tr("Cast a spell"), key: "c", near: "button: Cast a spell" },
        ...hexSteps(tr("Step a hex")),
        { button: "up", more: true, label: tr("Battle log"), key: "ArrowUp", quiet: true },
        { button: "down", more: true, label: tr("Battle log"), key: "ArrowDown", quiet: true },
        { button: "cross", more: true, label: tr("Auto combat"), key: "a", near: "button: Auto combat" },
        { button: "triangle", more: true, label: tr("Quick combat"), key: "q" },
        { button: "square", more: true, label: tr("Retreat"), key: "r", near: "button: Retreat" },
        { button: "r1", more: true, label: tr("Surrender"), key: "s", near: "button: Surrender" },
      ];
    case "town":
      return [
        { button: "triangle", label: tr("Town hall"), key: "b" },
        { button: "l1", label: tr("Fort"), key: "f" },
        { button: "r1", label: tr("Recruit all"), key: "r" },
        { button: "cross", more: true, label: tr("Mage guild"), key: "g" },
        { button: "triangle", more: true, label: tr("Tavern"), key: "t" },
        { button: "square", more: true, label: tr("Marketplace"), key: "m" },
        { button: "l1", more: true, label: tr("Blacksmith"), key: "l" },
        { button: "r1", more: true, label: tr("Hero screen"), key: "h" },
        { button: "up", more: true, label: tr("Swap the heroes"), key: " " },
      ];
    case "window":
      return [{ button: "triangle", label: tr("OK"), key: "Enter", near: "iokay.def" }];
    default:
      return [];
  }
}

/** What the right stick does on each screen, for the prompts. */
export const padLookLabel = (ctx: string) => (ctx === "map" || ctx === "world" ? tr("Look around") : ctx === "battle" || ctx === "tactics" || ctx === "loading" ? null : tr("Scroll"));

/** HotA's half of controller play: the bindings, the map's view on the right stick, the on-screen buttons found. */
export function hotaPad(app: Application): PadGame {
  // An on-screen button by its art (a DefButton's .def) or its label ("button: Wait"): the last one found is kept while it's shown.
  const found = new Map<string, { at: number; c: Container | null }>();
  const shown = (c: Container) => {
    if (c.destroyed || !c.visible) return false;
    for (let p: Container | null = c; p; p = p.parent) if (!p.visible || p.alpha === 0) return false;
    return c.parent !== null;
  };
  const find = (near: string): Container | null => {
    const visit = (c: Container): Container | null => {
      if (!c.visible || c.alpha === 0) return null;
      if ((c instanceof DefButton && c.def === near) || c.label === near) return c;
      for (const k of c.children) {
        const r = visit(k as Container);
        if (r) return r;
      }
      return null;
    };
    return visit(app.stage);
  };
  return {
    context: () => (document.body.classList.contains("menuPage") ? "menu" : (hooks?.context() ?? "menu")),
    bindings: padBindings,
    lookLabel: padLookLabel,
    look: (ctx, x, y, dt) => (ctx === "map" || ctx === "world") && !!hooks?.look?.(x, y, dt),
    locate(near) {
      const now = performance.now();
      let f = found.get(near);
      if (!f || (f.c && !shown(f.c)) || (!f.c && now - f.at > 1000)) found.set(near, (f = { at: now, c: find(near) }));
      const c = f.c;
      if (!c || !shown(c)) return null;
      const b = c instanceof DefButton ? (c.tapBounds() ?? c.getBounds()) : c.getBounds();
      const r = app.canvas.getBoundingClientRect();
      const k = r.width / screenSize.w;
      return new DOMRect(r.left + b.x * k, r.top + b.y * k, b.width * k, b.height * k);
    },
  };
}
