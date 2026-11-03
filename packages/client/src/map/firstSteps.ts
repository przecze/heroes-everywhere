// A new player's first game (EXTRAS firstSteps): the Quick game, the first time on a device, is a small
// guided map (rmg ":g": a few Peasants wait a few steps from the town) with a checklist of first goals
// in the corner: move, win the fight, build, recruit, end the turn, send a note. Each goal ticks off
// when the game shows it done; the list folds to the next goal and goes once all are done.
import { type AdventureState, parseRandomMapName } from "@heroes/core";
import { extra } from "../settings.ts";
import { tr } from "../i18n/index.ts";
import { screenSize } from "../ui/screen.ts";
import { dialogBacking } from "../chrome/look.ts";

const KEY = "heroes.firstSteps";
/** Set once every goal was done (or the list closed for good): later Quick games are the usual ones. */
const DONE = "heroes.firstSteps.done";
/** The page's event when a note went off (feedback/box.ts). */
export const NOTE_SENT = "heroes:noteSent";

type Goal = "move" | "fight" | "build" | "recruit" | "endTurn" | "note";
const ALL_GOALS: Goal[] = ["move", "fight", "build", "recruit", "endTurn", "note"];
/** The goals: sending a note only where the page has Feedback (the open-source release has none). */
const goals = (): Goal[] => (document.getElementById("fbToggle") ? ALL_GOALS : ALL_GOALS.filter((g) => g !== "note"));

const text = (g: Goal): string => {
  const touch = screenSize.touch;
  switch (g) {
    case "move":
      return touch ? tr("Move your hero: tap a spot, tap it again to go") : tr("Move your hero: click a spot, click it again to go");
    case "fight":
      return tr("Defeat the Peasants near your town");
    case "build":
      return tr("Open your town and build something");
    case "recruit":
      return tr("Recruit creatures in your town");
    case "endTurn":
      return tr("End the turn (the hourglass)");
    case "note":
      return tr("Tell us what you think: the ✎ button");
  }
};

const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // not kept: the list starts afresh after a reload
    }
  },
};

/** Should this Quick game be the guided first one? */
export const firstGameDue = () => extra("firstSteps") && !storage.get(DONE);

/** A guided first game's map (rmg.ts ":g"). */
export const isGuided = (mapFile: string | undefined) => !!mapFile && !!parseRandomMapName(mapFile)?.guided;

interface Progress {
  map: string;
  done: Goal[];
  /** The Peasants the map put by the town (the map may have other Peasants too). */
  foe?: number;
}

/** The checklist: `update` after each update of the game; shown only while `onMap` (no town, battle or window over the map). */
export function firstStepsGuide(onMap: () => boolean) {
  let panel: HTMLElement | null = null;
  let watch = 0;
  let progress: Progress | null = null;
  /** The whole list shown (else the next goal alone): open on a desktop, folded on a phone (it would cover the map). */
  let open = !screenSize.touch;
  /** Open or folded as the player left it (a goal done opens it a moment). */
  let chosen = open;
  let foldTimer = 0;
  /** What the goals are measured against: the hero's first tile, the towns' buildings and creatures for sale. */
  let start: Map<number, number> | undefined;
  let built: Map<number, number> | undefined;
  let forSale: Map<number, { day: number; n: number }> | undefined;

  const save = () => progress && storage.set(KEY, JSON.stringify(progress));
  const tick = (g: Goal) => {
    if (!progress || progress.done.includes(g)) return;
    progress.done.push(g);
    save();
    // (On a phone: open a moment on each goal done, then fold to the next one.)
    open = true;
    render();
    clearTimeout(foldTimer);
    if (screenSize.touch) foldTimer = window.setTimeout(() => ((open = chosen), render()), 3000);
  };
  const onNote = () => tick("note");

  function close(forGood: boolean) {
    if (forGood) storage.set(DONE, "1");
    panel?.remove();
    panel = null;
    clearInterval(watch);
    window.removeEventListener(NOTE_SENT, onNote);
  }

  function render() {
    if (!progress) return;
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "firstSteps";
      void dialogBacking();
      document.body.append(panel);
      window.addEventListener(NOTE_SENT, onNote);
      // (The town screen, a battle and the game's windows are drawn on the canvas, under this page element: it steps aside.)
      watch = window.setInterval(() => panel && (panel.hidden = !onMap()), 250);
      panel.hidden = !onMap();
    }
    const done = progress.done;
    const GOALS = goals();
    const all = GOALS.every((g) => done.includes(g));
    const next = GOALS.find((g) => !done.includes(g));
    panel.classList.toggle("folded", !open && !all);
    if (all) {
      panel.innerHTML = `<h4><span>${tr("First steps")} ✓</span><button class="x" data-skip aria-label="${tr("Close")}" title="${tr("Close")}">×</button></h4><p>${tr("Well done, those are the basics. Play on, or try a bigger map from New Game.")}</p>`;
    } else {
      // Folded: the next goal alone (a tap opens the list); open: every goal, the done ones ticked.
      const rows = GOALS.map((g) => `<li class="${done.includes(g) ? "done" : g === next ? "next" : ""}"><i></i>${text(g)}</li>`).join("");
      panel.innerHTML =
        `<h4><span data-fold>${tr("First steps")} <b>${done.length}/${GOALS.length}</b> <em>${open ? "▴" : "▾"}</em></span><button class="x" data-skip aria-label="${tr("Hide the list for good")}" title="${tr("Hide the list for good")}">×</button></h4>` +
        (open ? `<ol>${rows}</ol>` : `<p class="nextGoal" data-fold><i></i>${next ? text(next) : ""}</p>`);
    }
    for (const f of panel.querySelectorAll<HTMLElement>("[data-fold]")) f.onclick = () => ((chosen = open = !open), clearTimeout(foldTimer), render());
    panel.querySelector<HTMLElement>("[data-skip]")!.onclick = () => close(true);
  }

  return {
    /** After each update of the game, for player `me`. */
    update(s: AdventureState | null, me: number) {
      if (!s || me < 0 || !extra("firstSteps") || !isGuided(s.mapFile) || s.players[me]?.controller !== "human") {
        if (panel) close(false);
        return;
      }
      if (storage.get(DONE)) return;
      if (progress?.map !== s.mapFile) {
        let kept: Progress | null = null;
        try {
          kept = JSON.parse(storage.get(KEY) ?? "null") as Progress | null;
        } catch {
          kept = null;
        }
        progress = kept?.map === s.mapFile ? kept : { map: s.mapFile!, done: [] };
        chosen = open = !screenSize.touch;
        start = built = forSale = undefined;
        save();
      }
      const heroes = s.heroes.filter((h) => !h.removed && h.owner === me);
      const towns = s.objects.filter((o) => o.town && !o.removed && o.owner === me);
      start ??= new Map(heroes.map((h) => [h.id, h.x * 1000 + h.y]));
      built ??= new Map(towns.map((o) => [o.id, o.town!.built.length]));
      if (heroes.some((h) => start!.has(h.id) && start!.get(h.id) !== h.x * 1000 + h.y)) tick("move");
      // The Peasants the map put by the town (the stack nearest to it): gone means the fight was won.
      if (progress.foe === undefined && towns[0]) {
        const t = towns[0];
        const near = s.objects.filter((o) => o.type === 54 && o.subid === 139 && !o.removed).sort((a, b) => Math.abs(a.x - t.x) + Math.abs(a.y - t.y) - (Math.abs(b.x - t.x) + Math.abs(b.y - t.y)))[0];
        progress.foe = near?.id ?? -1;
        save();
      }
      const foe = s.objects.find((o) => o.id === progress!.foe);
      if (!foe || foe.removed) tick("fight");
      if (towns.some((o) => o.town!.builtToday || o.town!.built.length > (built!.get(o.id) ?? Infinity))) tick("build");
      // Fewer creatures for sale than earlier the same day: some were bought.
      forSale ??= new Map();
      for (const o of towns) {
        const n = o.town!.available.reduce((a, b) => a + b, 0);
        const was = forSale.get(o.id);
        if (was && was.day === s.day && n < was.n) tick("recruit");
        forSale.set(o.id, { day: s.day, n });
      }
      if (s.day >= 2) tick("endTurn");
      if (!panel) render();
    },
  };
}
