// Every button clicks (2026-10-30 19:21: "add sound effects on buttons ... look through the commonly used
// buttons, click if you will"): the original plays its button sound as any button goes down. The game's own buttons
// (DefButton, textButton, the town's tiles) play it themselves; the many hand-made ones (the map HUD's, the town's
// strips, the phone windows' picture buttons) did not, each needing its own line. Here the stage plays it for any
// press on a piece labelled as a button ("button: ...", the same labels the catalog and the notes' render tree read)
// that is live (a pointer cursor: greyed buttons show the default one), once a press: audio.ts keeps a press to one
// click, so a button that plays its own (on the press or on the tap after it) is not heard twice.
import { type Application, type Container, Point } from "pixi.js";
import { playSound, releasePress, startPress } from "../audio.ts";

/** The button a press landed on: the nearest piece up from the target labelled "button: ...", if it is live. */
function pressedButton(target: Container | null): Container | null {
  for (let c: Container | null = target; c; c = c.parent) {
    if (typeof c.label === "string" && c.label.startsWith("button:")) {
      // (Greyed: a DefButton says so itself, a word button is dimmed, the rest show the default cursor.)
      const off = (c as Container & { disabled?: boolean }).disabled === true || c.alpha < 0.6 || c.cursor !== "pointer";
      return off ? null : c;
    }
  }
  return null;
}

export function clickEveryButton(app: Application): void {
  const events = app.renderer.events;
  const at = new Point();
  // (Caught on its way down to the canvas, before the game's own handlers there, Pixi's among them: the stage itself
  // is passive and hears no presses.)
  window.addEventListener(
    "pointerdown",
    (e) => {
      startPress();
      if (e.button !== 0 || e.target !== events.domElement) return;
      events.mapPositionToPoint(at, e.clientX, e.clientY);
      if (pressedButton(events.rootBoundary.hitTest(at.x, at.y))) void playSound("button");
    },
    true,
  );
  for (const ev of ["pointerup", "pointercancel"]) window.addEventListener(ev, () => releasePress(), true);
}
