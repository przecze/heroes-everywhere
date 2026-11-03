// A game played by notification, back after a while: what the others did meanwhile, as far as we
// could see it (the host keeps it, fog applied: server turnReplay.ts), played again on the map
// fast, as the original's Replay Opponent's Turn. The heroes walk from where they were; flags
// change; battles are told where they were fought. A bar at the bottom (a finger's reach) pauses
// it and skips the rest.
import { type AdventureState, type Hero, PLAYER_NAMES } from "@heroes/core";
import type { HeroLook, ReplayStep } from "@heroes/server";
import { Container } from "pixi.js";
import { tr, said, type Text } from "../i18n/index.ts";
import { SCREEN_H, SCREEN_W, label, textButton, windowFrame } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { navBarRight, oneHand, screenSize } from "../ui/screen.ts";

/** Puts a hero (as the replay knows it) on a tile, in sight, even one we now know nothing of. */
export function placeHero(s: AdventureState, look: HeroLook, tile: number) {
  const n = s.size;
  const h: Hero = (s.heroes[look.id] ??= { id: look.id, type: look.type, name: look.name, owner: look.owner, heroClass: look.heroClass, x: 0, y: 0, z: 0, movement: 0, maxMovement: 0, army: Array(7).fill(null), primary: [0, 0, 0, 0], experience: 0, level: 1, dir: look.dir });
  Object.assign(h, { type: look.type, owner: look.owner, heroClass: look.heroClass, x: tile % n, y: Math.floor(tile / n) % n, z: Math.floor(tile / (n * n)), dir: look.dir });
  delete h.removed;
  delete h.garrison;
  if (look.boat !== undefined) h.boat = look.boat;
  else delete h.boat;
}

/** The map as it stood before the replay's first step: its heroes where they set out from, its flags as they were. */
export function rewind(now: AdventureState, steps: ReplayStep[]): AdventureState {
  const s = structuredClone(now);
  for (let i = steps.length - 1; i >= 0; i--) {
    const st = steps[i];
    if (st.k === "move") placeHero(s, st.hero, st.path[0]);
    else if (st.k === "flag" && s.objects[st.object]) s.objects[st.object].owner = st.from;
  }
  return s;
}

/**
 * One step carried out on `s` (the replay's map; the walk itself is the page's to show), and the
 * line the bar says for it. `now`: the game as it stands, for who fell in a battle.
 */
export function applyStep(s: AdventureState, st: ReplayStep, now: AdventureState, names: string[]): Text {
  const who = (p: number) => names[p] ?? tr(PLAYER_NAMES[p]) ?? "";
  if (st.k === "move") {
    placeHero(s, st.hero, st.path[st.path.length - 1]);
    return tr("Day %1: %2 (%3)", st.day, st.hero.name, who(st.hero.owner));
  }
  if (st.k === "flag") {
    const o = s.objects[st.object];
    if (o) o.owner = st.owner;
    const what = o?.town ? (o.name ?? tr("a town")) : null;
    return what ? tr("Day %1: %2 took %3.", st.day, who(st.owner), what) : tr("Day %1: %2 raised a flag.", st.day, who(st.owner));
  }
  // Who fell (as the game now has them) is gone from the map.
  const fell = (id: number | undefined) => id !== undefined && now.heroes[id]?.removed && s.heroes[id] && (s.heroes[id].removed = true);
  fell(st.won ? st.defender : st.hero);
  const name = s.heroes[st.hero]?.name ?? "";
  return st.won ? tr("Day %1: %2 (%3) won a battle.", st.day, name, who(st.owner)) : tr("Day %1: %2 (%3) lost a battle.", st.day, name, who(st.owner));
}

const BAR_W = 460;
const BAR_H = 96;

/** The replay's bar: what is happening, Pause / Go on, and Skip. */
export class ReplayBar {
  paused = false;
  skipped = false;
  private caption = label(said(""));
  private captionBox = { x: 0, y: 0, w: 0 };
  private close = () => {};
  private wake: (() => void) | null = null;

  async open(modals: Modals, player: number) {
    // Touch: a finger's size and readable (medfont 1.3 CSS px a pixel or more), so on a narrow upright screen the bar is narrower, not smaller.
    const room = screenSize.w - navBarRight() - 16;
    const want = Math.max(1.4, 1.3 / screenSize.css);
    const barW = screenSize.touch ? Math.max(240, Math.min(BAR_W, Math.floor(room / want))) : BAR_W;
    const inner = new Container();
    inner.addChild(await windowFrame(barW, BAR_H, player));
    // One line, squeezed when long (two would run into the buttons).
    this.caption = label(said(""), "medfont");
    this.captionBox = { x: barW / 2, y: 26, w: barW - 32 };
    inner.addChild(this.caption);
    const bw = Math.min(150, Math.floor((barW - 60) / 2));
    const bh = 36;
    let pause: Container | null = null;
    const drawPause = async () => {
      const b = await textButton(this.paused ? tr("Go on") : tr("Pause"), bw, bh, () => this.toggle().then(drawPause), "bigfont");
      b.position.set(barW / 2 - bw - 12, BAR_H - bh - 14);
      pause?.destroy({ children: true });
      pause = b;
      inner.addChild(b);
    };
    await drawPause();
    const skip = await textButton(tr("Skip"), bw, bh, () => this.skip(), "bigfont");
    skip.position.set(barW / 2 + 12, BAR_H - bh - 14);
    inner.addChild(skip);
    const win = new Container();
    win.addChild(inner);
    // Touch: big enough for a finger, low on the screen, on the thumb's side one-handed (clear of
    // Android's bar). Elsewhere: low over the map, clear of the resource bar and the right-hand panel.
    const k = () => (screenSize.touch ? Math.min(Math.max(1.6, want), (screenSize.w - navBarRight() - 16) / barW) : 1);
    const x = () => {
      inner.scale.set(k());
      if (!screenSize.touch) return Math.round((SCREEN_W - 200 - BAR_W) / 2);
      const free = screenSize.w - navBarRight() - barW * k();
      const hand = oneHand();
      return Math.round((hand === "left" ? 8 : hand === "right" ? free - 8 : free / 2) - screenSize.ox);
    };
    const y = () => (screenSize.touch ? Math.round(screenSize.h - BAR_H * k() - 10 - screenSize.oy) : SCREEN_H - 26 - BAR_H - 10);
    this.close = modals.show(win, {
      x,
      y,
      onKey: (key) => {
        if (key === " " || key === "p") void this.toggle().then(drawPause);
        else if (key === "Escape" || key === "Enter") this.skip();
        return true;
      },
    });
  }

  say(text: Text) {
    const b = this.captionBox;
    this.caption.value = text;
    this.caption.fit(b.w).centreOn(b.x, b.y);
  }

  private async toggle() {
    this.paused = !this.paused;
    if (!this.paused) this.wake?.();
  }

  skip() {
    this.skipped = true;
    this.paused = false;
    this.wake?.();
  }

  /** Waits while paused. */
  hold(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((r) => (this.wake = () => ((this.wake = null), r())));
  }

  /** A pause of `ms` (cut short by Skip), then waits while paused. */
  async wait(ms: number) {
    const end = performance.now() + ms;
    while (!this.skipped && performance.now() < end) await new Promise((r) => setTimeout(r, Math.min(50, end - performance.now())));
    await this.hold();
  }

  done() {
    this.close();
  }
}
