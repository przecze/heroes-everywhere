// Layouts…: the page menu's window with a small picture of the current screen in each layout (upright,
// the game turned sideways, sideways, one-handed left and right, and the desktop's), drawn by laying
// the game out as that layout would (screen.ts previewLayout), so a player sees what a choice does to
// the map, the battle or the town they are in before taking it. A tap on a picture takes that layout.
// It never turns the phone: the layouts that need the phone held the other way say so, and its ⟳
// button turns the screen (the ☰ panel's Layout tile, then ⟳: two taps from anywhere).
import { turnScreen } from "../fullscreen.ts";
import { tr } from "../i18n/index.ts";
import { type Settings, setSetting, settings } from "../settings.ts";
import { heldUpright, type LayoutProbe, previewLayouts, relayout, screenSize, toggleTurn, touchLayoutWanted } from "../ui/screen.ts";
import { type PageWindow, pageWindow } from "./look.ts";

interface Choice {
  key: string;
  name: string;
  /** What the picture is laid out as. */
  probe: LayoutProbe;
  /** The settings that make the layout (an invisible switch for the others: a layout the way the phone is held decides). */
  patch: Partial<Settings>;
  /** Shown under the picture when the phone isn't held the way this layout needs. */
  needs: "upright" | "sideways" | null;
  /** The page turned a quarter (☰ → Rotate's turn, for this tab: ui/screen.ts). */
  turn?: boolean;
}

/** The phone's two sides, from the screen itself (a desktop window: a common phone's). */
function phoneSides(): [number, number] {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const [a, b] = coarse && screen.width && screen.height ? [screen.width, screen.height] : [390, 844];
  return [Math.min(a, b), Math.max(a, b)];
}

function choices(): Choice[] {
  const [short, long] = phoneSides();
  const touch = { touchLayout: "on" } as const;
  const sideways = { probe: { touch: true, upright: false, w: long, h: short }, needs: "sideways" } as const;
  const all: Choice[] = [
    { key: "upright", name: tr("Upright"), probe: { touch: true, upright: true, w: short, h: long }, patch: { ...touch, sideways: "portrait" }, needs: "upright" },
    { key: "turned", name: tr("Turned sideways"), probe: { touch: true, upright: false, w: long, h: short }, patch: { ...touch }, needs: "upright", turn: true },
    { key: "side", name: tr("Sideways"), ...sideways, patch: { ...touch, oneHand: "off" } },
    { key: "desktop", name: tr("Desktop"), probe: { touch: false, upright: false, w: 1280, h: 720 }, patch: { touchLayout: "off" }, needs: null },
  ];
  // The desktop's layout is for a window with a mouse; a phone has no use for it.
  return matchMedia("(pointer: coarse)").matches ? all.filter((c) => c.key !== "desktop") : all;
}

/** Which of the layouts is in use now. */
function current(): string | null {
  if (!screenSize.touch) return "desktop";
  const s = settings();
  if (screenSize.portrait) return "upright";
  if (screenSize.turn === 90) return "turned";
  if (heldUpright()) return null; // small and upright: none of these
  return s.oneHand === "left" ? "left" : s.oneHand === "right" ? "right" : "side";
}

let panel: PageWindow | null = null;

export function toggleLayouts() {
  if (panel) return panel.close();
  const list = choices();
  const now = current();
  const coarse = matchMedia("(pointer: coarse)").matches;
  // Where the phone's camera is along its top: the page's ☰ and Feedback go up into the corners it leaves free.
  const cams: [Settings["camera"], string][] = [["left", tr("Left")], ["middle", tr("Middle")], ["right", tr("Right")]];
  panel = pageWindow(
    "layoutsPanel",
    tr("Layouts"),
    `<div class="row hint">${coarse ? tr("This screen in each layout: tap one to take it. ⟳ turns the screen.") : tr("This screen in each layout. Tap one to take it.")}</div>
    <div class="layoutGrid">${list
      .map(
        (c) => `<button class="layoutCard" data-key="${c.key}" aria-pressed="${c.key === now}">
          <span class="pic"><i>…</i></span><b>${c.name}</b>
          <small>${c.key === now ? tr("In use") : c.needs === "upright" && !heldUpright() ? tr("When the phone is held upright") : c.needs === "sideways" && heldUpright() ? tr("When the phone is held sideways") : ""}</small></button>`,
      )
      .join("")}</div>${
      coarse
        ? `<div class="row hint">${tr("Camera hole at the top")}</div><div class="camRow">${cams.map(([k, n]) => `<button data-cam="${k}" aria-pressed="${k === settings().camera}">${n}</button>`).join("")}</div>`
        : ""
    }`,
    { head: coarse ? `<button data-turn data-ico="turn">${tr("Turn the screen")}</button>` : "", onClose: () => (panel = null) },
  );
  const box = panel.box;
  box.querySelectorAll<HTMLElement>("[data-cam]").forEach((b) =>
    b.addEventListener("click", () => {
      setSetting("camera", b.dataset.cam as Settings["camera"]);
      box.querySelectorAll<HTMLElement>("[data-cam]").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
      relayout();
    }),
  );
  box.querySelector("[data-turn]")?.addEventListener("click", () => (toggleLayouts(), void turnScreen()));
  // Each picture lays the whole game out again, one after another; they come up as they are done.
  const cards = [...box.querySelectorAll<HTMLButtonElement>(".layoutCard")];
  cards.forEach((card, n) => card.classList.toggle("on", list[n].key === now));
  const pics = cards.map((c) => c.querySelector<HTMLElement>(".pic")!);
  const width = Math.min(220, Math.max(120, Math.round(pics[0].clientWidth || 160)));
  let busy = true;
  void previewLayouts(list, width * (window.devicePixelRatio > 1 ? 2 : 1), (i, canvas) => panel?.box === box && pics[i].replaceChildren(canvas)).then(() => {
    busy = false;
    if (panel?.box === box) pics.forEach((p) => p.querySelector("i")?.remove());
  });
  cards.forEach((card, n) =>
    card.addEventListener("click", () => {
      // (While the pictures are being made the game is laid out as each of them, so wait for the last.)
      if (busy) return;
      const c = list[n];
      // Kept on this device; the layouts the phone's hold doesn't use yet start when it's held that way.
      for (const [k, v] of Object.entries(c.patch)) if (k !== "touchLayout" || touchLayoutWanted() !== (v === "on")) setSetting(k as keyof Settings, v as never);
      toggleLayouts();
      // The turn only for the way the phone is held now (the others start when it's held their way, unturned).
      const fits = c.needs === null || (c.needs === "upright") === heldUpright();
      if (fits) toggleTurn(!!c.turn);
      else relayout();
    }),
  );
}

let thumbs: PageWindow | null = null;

/** ☰ → One-handed (a phone held sideways): both hands, or one thumb, left or right; a tap takes it at once. */
export function toggleThumbs() {
  if (thumbs) return thumbs.close();
  const now = settings().oneHand;
  const list: [Settings["oneHand"], string][] = [["off", tr("Both hands")], ["left", tr("Left thumb")], ["right", tr("Right thumb")]];
  thumbs = pageWindow("thumbsPanel", tr("One-handed"), `<div class="thumbRow">${list.map(([k, n]) => `<button data-hand="${k}" aria-pressed="${k === now}">${n}</button>`).join("")}</div>`, { onClose: () => (thumbs = null) }); // i18n-ok (markup)
  thumbs.box.querySelectorAll<HTMLElement>("[data-hand]").forEach((b) =>
    b.addEventListener("click", () => {
      setSetting("oneHand", b.dataset.hand as Settings["oneHand"]);
      toggleThumbs();
      relayout();
    }),
  );
}
