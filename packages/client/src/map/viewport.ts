// Where the adventure map is drawn on the canvas: the original frame's window (594 x 546 at 7, 7),
// wider on a wide canvas, or the whole canvas under the mobile HUD. The HUD in use sets it.
export const viewport = { x: 7, y: 7, w: 594, h: 546 };

/**
 * How much of the viewport's edges the HUD floating over the map covers (game pixels), so the map
 * can be dragged that much further past its edges and a town at the edge comes out from under it.
 * Zero where the HUD frames the map instead of lying over it (the desktop's).
 */
export const covered = { top: 0, right: 0, bottom: 0, left: 0 };
