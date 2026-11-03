import { loadDef, textureCanvas } from "../assets.ts";

/**
 * Icons for the page's own HTML buttons (lobby, chat, My notes, the ☰ panels...), as the original has them:
 * a picture, not a word (docs/ui-guidelines.md §1). A button says which with `data-ico="ok"`; its words move to
 * the tooltip and aria-label (they stay translated), and the original's button art (a DEF frame) is its face.
 * Without the game files a plain glyph stands in (`GLYPH`).
 */
const ART: Record<string, string> = {
  ok: "iokay.def", // confirm, send, join, close: the original closes its windows with the tick
  begin: "scnrbeg.def", // the scenario screen's Begin: start the game, open a new room
  cancel: "icancel.def", // close, cancel, not now: what leaves the window and changes nothing
  prev: "hsbtns3.def",
  // The slider's small arrows (a frame number after #: the DEF holds both and the knob).
  sleft: "igpcrdiv.def#0",
  sright: "igpcrdiv.def#2",
  next: "hsbtns5.def",
  swap: "hd_xchng.def", // refresh, change
  give: "tpmrkbu1.def", // the hand: invite, send to a player
  up: "ircma.def",
  down: "ircmi.def",
  // The ☰ panel's tiles (chrome/iconMenu.ts).
  sysopt: "icm003.def", // the combat options' computer, the System Options button's brown twin
  chat: "tpmrkb.def", // the handshake's frame, with two heroes talking in it (chatFace)
  notes: "hsbtns4.def", // the scroll
  review: "iam004.def", // the quest log's scroll
  admin: "icm001.def", // the flag
  wiki: "iam007.def", // the spellbook (the adventure map's Cast Spell): the book of everything in the game
};
/** Standing in without the art, and the whole face of the symbols the original has no button for (a plain gold glyph on its brown). */
const GLYPH: Record<string, string> = { ok: "✓", begin: "▶", cancel: "✕", prev: "‹", next: "›", sleft: "‹", sright: "›", swap: "⟳", give: "🤝", up: "▲", down: "▼", never: "✕",  pin: "📌", copy: "📋", mic: "🎤", play: "▶", pause: "❚❚", bell: "🔔", eye: "👁", save: "💾", undo: "↶", pencil: "✎", mail: "✉", sysopt: "⚙", layout: "⟲", sound: "♪", full: "⛶", chat: "💬", notes: "📜", help: "?", about: "ℹ", gear: "⚙", review: "✉", admin: "⚑", lang: "EN", catalog: "▦", wiki: "📖", home: "⌂", map: "🗺", battle: "⚔", campaign: "📜", branch: "⎇", ledger: "$", dev: "⚒", turn: "⟳", device: "📱" };

/** A button DEF's faces, as the original orders them: up, pressed, greyed, highlighted (hover); the last two only where the DEF has them. */
const faces = new Map<string, Promise<{ up: string; down: string; off?: string; hover?: string; w: number; h: number } | null>>();

/**
 * Chat: two of the original's gold hero heads (the adventure map's Next Hero and the Kingdom Overview's heroes button,
 * OVBUTN1) facing each other, speech bubbles between them, in the handshake button's frame (2026-10-31 20:59:
 * "two heroes facing each other, speech bubbles between them"; 2026-11-01 08:01: "not actual portraits but the general
 * hero face symbol from the HUD"); pressed, the frame's own down face and the picture a pixel lower.
 */
async function chatFace() {
  const [def, heads] = await Promise.all([loadDef("tpmrkb.def"), loadDef("ovbutn1.def")]);
  const frames = def.get(0);
  const headTex = heads.get(0)?.[0]?.texture;
  if (!frames?.[1] || !headTex) return null;
  const W = frames[0].fullWidth;
  const H = frames[0].fullHeight;
  // The head alone: the button's gold, its leather and rim left out.
  const src = textureCanvas(headTex);
  const sw = src.width;
  const sh = src.height;
  const px = src.getContext("2d")!.getImageData(0, 0, sw, sh);
  // (The head's place on the 48 x 32 button, its gold only: the leather round it is brown, the rim grey.)
  const [x0, y0, x1, y1] = [13, 3, 35, 29];
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const i = 4 * (y * sw + x);
      const [r, g, b] = [px.data[i], px.data[i + 1], px.data[i + 2]];
      const gold = r > 120 && g > 85 && r - b > 55;
      if (!gold || x < x0 || x > x1 || y < y0 || y > y1) px.data[i + 3] = 0;
    }
  const head = document.createElement("canvas");
  head.width = Math.max(1, x1 - x0 + 1);
  head.height = Math.max(1, y1 - y0 + 1);
  head.getContext("2d")!.putImageData(px, -x0, -y0);
  const draw = (i: number) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.drawImage(textureCanvas(frames[i].texture), 0, 0);
    const d = i === 1 ? 1 : 0;
    // The leather inside the rim, darkened under the heads.
    g.fillStyle = "rgba(20, 12, 4, 0.8)";
    g.fillRect(3, 3, W - 6, H - 6);
    // At their own size (scaled they blur), each at its side, the left one facing right as drawn, the right one turned round.
    const y = Math.round((H - head.height) / 2) + 1 + d;
    g.drawImage(head, 3 + d, y);
    g.save();
    g.translate(W - 3 + d, 0);
    g.scale(-1, 1);
    g.drawImage(head, 0, y);
    g.restore();
    // Two speech bubbles between them, one from each, the left one higher.
    const bubble = (cx: number, cy: number, tail: 1 | -1) => {
      g.beginPath();
      g.ellipse(cx, cy, 5, 3.5, 0, 0, Math.PI * 2);
      g.moveTo(cx + tail * 1, cy + 3);
      g.lineTo(cx + tail * 5, cy + 7);
      g.lineTo(cx + tail * 3, cy + 2);
      g.fillStyle = "#f4ead0";
      g.fill();
      g.strokeStyle = "#000";
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = "#6b4a1a";
      for (const dx of [-2.5, 0, 2.5]) g.fillRect(Math.round(cx + dx), Math.round(cy), 1, 1);
    };
    bubble(W / 2 - 1 + d, 8 + d, -1);
    bubble(W / 2 + 1 + d, 18 + d, 1);
    return `url(${c.toDataURL()})`;
  };
  return { up: draw(0), down: draw(1), w: W, h: H };
}

function face(name: string) {
  let p = faces.get(name);
  if (!p && name === "chat") {
    p = chatFace().catch(() => null);
    faces.set(name, p);
  }
  if (!p) {
    const [file, from = "0"] = ART[name].split("#");
    p = loadDef(file)
      .then((def) => {
        const frames = def.get(0)?.slice(Number(from), Number(from) + (from === "0" && !ART[name].includes("#") ? Infinity : 2));
        if (!frames?.[0]) return null;
        const url = (i: number) => `url(${textureCanvas(frames[Math.min(i, frames.length - 1)].texture).toDataURL()})`;
        return { up: url(0), down: url(1), off: frames[2] ? url(2) : undefined, hover: frames[3] ? url(3) : undefined, w: frames[0].fullWidth, h: frames[0].fullHeight };
      })
      .catch(() => null);
    faces.set(name, p);
  }
  return p;
}

/**
 * What deletes or gives up something for good (the downloaded files, a game left, an address): never the cancel sign,
 * which closes windows and changes nothing (2026-10-27: "a button that looks like it dismisses the dialogue removed
 * the files"). It keeps its words, after a bin, in a red-brown of its own, apart from the window's own buttons.
 */
const REMOVE_GLYPH = "🗑";

/** Turns every `button[data-ico]` under `root` (not yet done) into its icon. */
export function applyIcons(root: ParentNode = document) {
  for (const b of root.querySelectorAll<HTMLButtonElement>("button[data-ico]:not(.ico):not(.removeBtn)")) {
    const name = b.dataset.ico!;
    if (name === "remove") {
      b.classList.add("removeBtn");
      b.dataset.glyph = REMOVE_GLYPH;
      if (!b.textContent?.trim() && b.title) b.textContent = b.title;
      continue;
    }
    if (!GLYPH[name]) continue;
    b.classList.add("ico");
    const words = b.textContent?.trim();
    if (words) {
      b.title ||= words;
      b.textContent = "";
    }
    if (!b.getAttribute("aria-label") && b.title) b.setAttribute("aria-label", b.title);
    b.dataset.glyph ||= GLYPH[name];
    if (!ART[name]) {
      b.classList.add("glyph");
      continue;
    }
    void face(name).then((f) => {
      if (!f) return;
      b.style.setProperty("--ico-up", f.up);
      b.style.setProperty("--ico-down", f.down);
      if (f.off) b.style.setProperty("--ico-off", f.off);
      if (f.hover) b.style.setProperty("--ico-hover", f.hover);
      b.classList.toggle("greyArt", !!f.off);
      b.style.setProperty("--ico-w", String(f.w));
      b.style.setProperty("--ico-h", String(f.h));
      b.classList.add("art");
    });
  }
}

/** Watches the page: panels build their buttons whenever they open. */
export function watchIcons() {
  applyIcons();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => ((queued = false), applyIcons()));
  }).observe(document.body, { childList: true, subtree: true });
}
