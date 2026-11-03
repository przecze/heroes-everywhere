// ☰ → Settings and its Additions beyond HotA window, in the look of the original's System Options.
import { localizeFeedback } from "../feedback/index.ts";
import { type Lang, LANGS, lang, languageChanged, tr } from "../i18n/index.ts";
import { localizeDom } from "../i18n/dom.ts";
import { AREAS, type Extra, type ExtraDef, EXTRAS, type Settings, setSetting, settings } from "../settings.ts";
import { relayout } from "../ui/screen.ts";
import { loadData } from "../gameData.ts";
import { localizeCreatures } from "../i18n/creatures.ts";
import { loadReleaseNames, localizeNames } from "../i18n/names.ts";
import { loadDef, textureCanvas } from "../assets.ts";
import { type PageWindow, pageWindow } from "./look.ts";
import { inDemo } from "../demo.ts";
import { toggleLayouts } from "./layouts.ts";
import { me } from "../feedback/listening.ts";

let refit = () => {};
/** What re-lays the canvas out after the touch layout setting changes (set by main). */
export function setRefit(fn: () => void) {
  refit = fn;
}

let panel: PageWindow | null = null;
let extrasPanel: PageWindow | null = null;

/** The extras this device can use, in their areas' order (the window's boxes). */
function shownExtras(anyTouch: boolean): [Extra, ExtraDef][] {
  const all = Object.entries(EXTRAS) as [Extra, ExtraDef][];
  return all.filter(([, e]) => (anyTouch || !e.touchOnly) && !(e.ownerOnly && me.playtester)).sort((a, b) => AREAS.indexOf(a[1].area) - AREAS.indexOf(b[1].area));
}

// A demo's frame (howto.ts) takes the page's language when the page's is switched under a welcome card (the page keeps it).
if (inDemo) (window as unknown as { __demoLang?: typeof applyLanguage }).__demoLang = (v) => applyLanguage(v, false);
// And is laid out as another layout for a moment (the welcome's Any device card), nothing kept.
if (inDemo)
  (window as unknown as { __demoSettings?: (patch: Partial<Settings>) => void }).__demoSettings = (patch) => {
    for (const [k, v] of Object.entries(patch)) setSetting(k as keyof Settings, v as never, false);
    relayout();
  };

/** Switches the interface's language (`keep`: on this device for good): the page's own texts and our texts in the windows open now at once, the game's own as windows open. */
export function applyLanguage(v: "auto" | Lang, keep = true) {
  const from = lang();
  setSetting("language", v, keep);
  if (lang() !== from) for (const fn of [...languageChanged]) fn(from);
  localizeDom(document.body);
  localizeFeedback();
  // The creatures' names too, for the windows that open next (the battle's own copy follows at its next update).
  // (A language with its own release's files: its names, made from them, first.)
  void loadReleaseNames(lang()).then(loadData).then((d) => (localizeCreatures(d.creatures, lang()), localizeNames(d, lang()))).catch(() => undefined);
  if (panel) (toggleOptions(), toggleOptions());
  relayout();
}

/** The System Options window's checkbox (SYSOPCHK: frame 0 off, 1 on) as CSS images for our ✓ / ⊘ boxes. */
let checkArt: Promise<[string, string] | null> | null = null;
export function loadCheckArt(el: HTMLElement) {
  checkArt ??= loadDef("sysopchk.def")
    .then((def) => {
      const f = def.get(0);
      if (!f?.[1]) return null;
      return [0, 1].map((i) => `url(${textureCanvas(f[i].texture).toDataURL()})`) as [string, string];
    })
    .catch(() => null);
  void checkArt.then((art) => {
    if (!art) return;
    el.style.setProperty("--chk-off", art[0]);
    el.style.setProperty("--chk-on", art[1]);
    el.classList.add("chkArt");
  });
}

/** A ✓ / ⊘ box with its name, as the System Options window's six. */
const check = (attrs: string, on: boolean, text: string, hidden = false) =>
  `<button type="button" class="sysChk" ${attrs} aria-pressed="${on}" ${hidden ? "hidden" : ""}>${text}</button>`;


/**
 * Settings, in the look of the original's System Options (a framed window, names in words, ✓ / ⊘
 * boxes, plaques at the foot): what the original has no window for and this device can use. The
 * game's own settings stay in its own windows (System Options, the combat options); the layout is the
 * Layouts window's; the additions beyond HotA have a window of their own.
 */
export function toggleOptions() {
  if (panel) return panel.close();
  // Only what this device can use: a touch screen has no window to size, a mouse-only one no feedback to type upright.
  const touch = matchMedia("(pointer: coarse)").matches;
  const voice = document.getElementById("fbVoiceOn") as HTMLInputElement | null;
  const upright = document.getElementById("fbPortrait") as HTMLInputElement | null;
  // (A button the page doesn't have, as in the open-source release, has no plaque.)
  const plaque = (id: string, text: string) => {
    const el = document.getElementById(id);
    return el ? `<button type="button" class="plaque" data-press="${id}" ${el.hidden ? "hidden" : ""}>${text}</button>` : "";
  };
  const alerts = document.getElementById("fbNotify");
  const s = settings();
  panel = pageWindow(
    "optionsPanel sysLook",
    tr("Settings"),
    `<div class="sysCols">
      <section class="sysBox" ${touch ? "hidden" : ""}><b>${tr("Interface size (desktop)")}</b>
        <select data-ui>${([["fit", tr("Fit the window")], ["large", tr("Large (more map in a big window)")], ["medium", tr("Medium")], ["small", tr("Small (the most map)")]] as const)
          .map(([v, t]) => `<option value="${v}" ${s.uiSize === v ? "selected" : ""}>${t}</option>`)
          .join("")}</select>
        ${check("data-set=wideScreen", s.wideScreen, tr("Wide window: the map takes the extra width (else 800 x 600 in the middle)"))}
      </section>
      <section class="sysBox"><b>${tr("Language")}</b>
        <select data-lang>${([["auto", tr("Automatic")], ...LANGS] as [string, string][])
          .map(([v, t]) => `<option value="${v}" ${s.language === v ? "selected" : ""}>${t}</option>`)
          .join("")}</select>
        <small>${tr("Our own texts and the creatures' names are translated. The game's own texts (spells, buildings, the original's messages) are in Polish and German too, from VCMI's translations; in the other languages they are English for now.")}</small>
      </section>
      <section class="sysBox"><b>${tr("Feedback and this device")}</b>
        ${voice ? check("data-input=fbVoiceOn", voice.checked, tr("Feedback by voice (experimental)")) : ""}
        ${upright ? check("data-input=fbPortrait", upright.checked, tr("Type feedback upright"), !touch) : ""}
        ${check("data-set=keepMusic", s.keepMusic, tr("Music in the background"))}
        ${check("data-set=classic", s.classic, tr("Classic HotA interface (none of the extras below)"))}
      </section>
    </div>
    <div class="plaques">
      <button type="button" class="plaque" data-extras>${tr("Additions beyond HotA")}</button>
      <button type="button" class="plaque" data-layouts>${tr("Layouts")}</button>
      ${plaque("menuNotify", tr("Notifications"))}
      ${plaque("offline", tr("Play offline…"))}
      ${plaque("fbDevice", tr("Add a device"))}
      ${plaque("menuInstall", tr("Install the game"))}
      ${alerts && !alerts.hidden ? plaque("fbNotify", alerts.textContent ?? "") : ""}
    </div>`,
    { onClose: () => (panel = null) },
  );
  const box = panel.box;
  loadCheckArt(box);
  box.querySelector<HTMLSelectElement>("[data-ui]")!.addEventListener("change", (e) => {
    setSetting("uiSize", (e.target as HTMLSelectElement).value as "fit");
    refit();
  });
  box.querySelector<HTMLSelectElement>("[data-lang]")!.addEventListener("change", (e) => applyLanguage((e.target as HTMLSelectElement).value as "auto" | Lang));
  for (const b of box.querySelectorAll<HTMLButtonElement>(".sysChk")) {
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      b.setAttribute("aria-pressed", String(on));
      const key = b.dataset.set as keyof Settings | undefined;
      if (key) {
        setSetting(key, on as never);
        if (key === "wideScreen") refit();
        return;
      }
      // The page menu's own checkboxes (feedback/box.ts and button.ts listen to them).
      const input = document.getElementById(b.dataset.input!) as HTMLInputElement | null;
      if (input) {
        input.checked = on;
        input.dispatchEvent(new Event("change"));
      }
    });
  }
  box.querySelector("[data-extras]")!.addEventListener("click", () => toggleExtras());
  box.querySelector("[data-layouts]")!.addEventListener("click", () => (toggleOptions(), toggleLayouts()));
  for (const b of box.querySelectorAll<HTMLButtonElement>("[data-press]"))
    b.addEventListener("click", () => {
      const target = document.getElementById(b.dataset.press!);
      // The alerts switch stays in view and shows its new state (it changes a moment after the press).
      if (b.dataset.press === "fbNotify") {
        target?.click();
        const again = setInterval(() => (b.textContent = target?.textContent ?? ""), 300);
        setTimeout(() => clearInterval(again), 4000);
        return;
      }
      toggleOptions();
      target?.click();
    });
}

/** The additions beyond HotA, each with its own switch, and the classic interface that turns them all off. */
export function toggleExtras() {
  if (extrasPanel) return extrasPanel.close();
  const anyTouch = matchMedia("(any-pointer: coarse)").matches;
  const s = settings();
  const groups: [string, [Extra, ExtraDef][]][] = [];
  for (const e of shownExtras(anyTouch)) {
    const g = groups.find((x) => x[0] === e[1].area) ?? (groups.push([e[1].area, []]), groups[groups.length - 1]);
    g[1].push(e);
  }
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  extrasPanel = pageWindow(
    "optionsPanel sysLook extrasPanel",
    tr("Additions beyond HotA"),
    `${check("data-classic", s.classic, tr("Classic HotA interface (none of the extras below)"))}
    <div class="extrasList">${groups
      .map(([area, list]) => `<div class="sysBox"><b>${tr(area)}</b>${list.map(([key, e]) => check(`data-extra="${key}" title="${esc(tr(e.help))}" ${s.classic ? "disabled" : ""}`, s[key], tr(e.name))).join("")}</div>`)
      .join("")}</div>
    <div class="sysStatus"></div>`,
    { onClose: () => (extrasPanel = null), nested: !!panel },
  );
  const box = extrasPanel.box;
  loadCheckArt(box);
  // The status line: the pointed-at (or held) row's long text, as the original's status bar explains its buttons.
  const status = box.querySelector<HTMLElement>(".sysStatus")!;
  const say = (text?: string) => (status.textContent = text ?? tr("Point at a switch for what it does."));
  say();
  box.querySelectorAll<HTMLButtonElement>("[data-extra]").forEach((x) => {
    x.addEventListener("pointerenter", () => say(x.title));
    x.addEventListener("focus", () => say(x.title));
    x.addEventListener("pointerleave", () => say());
  });
  const classic = box.querySelector<HTMLButtonElement>("[data-classic]")!;
  classic.addEventListener("click", () => {
    const on = classic.getAttribute("aria-pressed") !== "true";
    classic.setAttribute("aria-pressed", String(on));
    setSetting("classic", on);
    box.querySelectorAll<HTMLButtonElement>("[data-extra]").forEach((x) => (x.disabled = on));
    panel?.box.querySelector('[data-set="classic"]')?.setAttribute("aria-pressed", String(on));
  });
  box.querySelectorAll<HTMLButtonElement>("[data-extra]").forEach((x) =>
    x.addEventListener("click", () => {
      const on = x.getAttribute("aria-pressed") !== "true";
      x.setAttribute("aria-pressed", String(on));
      setSetting(x.dataset.extra as Extra, on);
    }),
  );
}
