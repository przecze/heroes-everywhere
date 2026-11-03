// A list of rows a finger drags: on a touch screen, dragging over the list moves it a row per row's
// height (the original's lists scroll only by their slider or the wheel). `moved()`: whether the
// touch now ending dragged, so its tap doesn't also pick a row.
import type { Container, FederatedPointerEvent } from "pixi.js";

export interface RowSwipe {
  moved(): boolean;
}

/** `rowH`: a row's height in the list's own pixels; `top` / `scroll`: the first row shown, and moving it (clamped by the caller). */
export function rowSwipe(list: Container, rowH: number, top: () => number, scroll: (top: number) => void): RowSwipe {
  let swipe: { y: number; top: number; moved: boolean } | null = null;
  let last = false;
  list.eventMode = "static";
  list.on("pointerdown", (e: FederatedPointerEvent) => {
    last = false;
    if (e.pointerType === "touch") swipe = { y: e.global.y, top: top(), moved: false };
  });
  list.on("globalpointermove", (e: FederatedPointerEvent) => {
    if (!swipe || e.pointerType !== "touch") return;
    const k = list.worldTransform.d || 1;
    const rows = Math.round((e.global.y - swipe.y) / (rowH * k));
    if (rows) swipe.moved = true;
    if (swipe.top - rows !== top()) scroll(swipe.top - rows);
  });
  const end = () => {
    last = !!swipe?.moved;
    swipe = null;
  };
  list.on("pointerup", end);
  list.on("pointerupoutside", end);
  return { moved: () => !!swipe?.moved || last };
}
