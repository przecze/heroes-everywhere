// Every 2D canvas the page makes keeps its pixels in the page's memory (willReadFrequently: Chrome then
// keeps it off the GPU). Canvases on the GPU come back blank when the phone's graphics restart, and the
// game draws every text and many icons into canvases (ui/graphicsLoss.ts has the story). Imported first
// (main.ts), before anything makes a canvas; no imports of its own for that reason.

const patch = (proto: { getContext: unknown } | undefined) => {
  if (!proto) return;
  const was = proto.getContext as (this: unknown, type: string, opts?: Record<string, unknown>) => unknown;
  proto.getContext = function (this: unknown, type: string, opts?: Record<string, unknown>) {
    // (A maker that asked for a GPU canvas, willReadFrequently: false, gets one.)
    if (type === "2d" && opts?.willReadFrequently === undefined) opts = { ...opts, willReadFrequently: true };
    return was.call(this, type, opts);
  };
};
try {
  if (typeof HTMLCanvasElement !== "undefined") patch(HTMLCanvasElement.prototype);
  if (typeof OffscreenCanvas !== "undefined") patch(OffscreenCanvas.prototype);
} catch {
  // (A browser that won't have it: canvases as they come.)
}

export {};
