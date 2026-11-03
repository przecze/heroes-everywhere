// The app's pages in one document (a single-page app): what a page sets up while it is on is recorded
// and undone when another takes over, so changing page needs no reload (which left full screen,
// started the music again and showed the loading splash). Recorded by themselves: the window's, the
// document's, the visual viewport's and the canvas's listeners, intervals, the ticker's callbacks, and
// (through onPageEnd, from their own modules) the layout, settings and pinch hooks, the game server's
// worker and the multiplayer socket, the page's own HTML panels. main.ts takes the page's part of the
// canvas and of #stage away. What the page chrome, Feedback and the chat set up later (a panel opened over
// a game, a voice note's timer) stays: they register through outsidePage.
import type { Application } from "pixi.js";

/** One page's stay: what undoes what it set up (each forgotten again once the page undoes it itself). */
export class PageScope {
  alive = true;
  private undo = new Set<() => void>();
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  /** Returns what forgets `fn` (the thing was undone by the page itself). */
  add(fn: () => void): () => void {
    if (!this.alive) return void run(fn), () => {};
    this.undo.add(fn);
    return () => this.undo.delete(fn);
  }
  end() {
    this.alive = false;
    const all = [...this.undo].reverse();
    this.undo.clear();
    all.forEach(run);
  }
}

function run(fn: () => void) {
  try {
    fn();
  } catch (err) {
    console.warn("page cleanup failed", err);
  }
}

let current: PageScope | null = null;
let shell = 0;

/** The page now on (null before the first and while the shell registers its own). */
export const currentPage = (): PageScope | null => (shell ? null : current);

/** `fn` runs when the page now on is left (nothing happens outside a page). */
export function onPageEnd(fn: () => void): () => void {
  return currentPage()?.add(fn) ?? (() => {});
}

/** Runs `fn` as the page's shell (chrome, Feedback, chat): what it sets up outlives the page now on. */
export function outsidePage<T>(fn: () => T): T {
  shell++;
  try {
    return fn();
  } finally {
    shell--;
  }
}

/** The page now on ends (everything it recorded undone) and `name` begins. */
export function beginPage(name: string): PageScope {
  current?.end();
  current = new PageScope(name);
  return current;
}

/** From now on the window's, document's and canvas's listeners, intervals and the ticker's callbacks belong to the page they were made on. */
export function capturePageResources(app: Application) {
  const targets: EventTarget[] = [window, document, app.canvas];
  if (window.visualViewport) targets.push(window.visualViewport);
  type Fn = EventListenerOrEventListenerObject;
  for (const t of targets) {
    const add = t.addEventListener.bind(t);
    const remove = t.removeEventListener.bind(t);
    /** The page's listeners on `t`: what the browser was given (a `once` one wrapped) and what forgets the record. */
    const mine = new Map<string, Map<Fn, { given: Fn; drop: () => void }>>();
    const keyOf = (type: string, opts?: boolean | EventListenerOptions) => `${type}|${typeof opts === "boolean" ? opts : !!opts?.capture}`;
    t.addEventListener = ((type: string, fn: Fn | null, opts?: boolean | AddEventListenerOptions) => {
      const page = currentPage();
      if (!fn || !page) return add(type, fn, opts);
      const key = keyOf(type, opts);
      const list = mine.get(key) ?? new Map();
      mine.set(key, list);
      if (list.has(fn)) return;
      const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
      const forget = () => {
        list.get(fn)?.drop();
        list.delete(fn);
      };
      const once = typeof opts === "object" && opts.once;
      const given: Fn = once ? (e: Event) => (forget(), typeof fn === "function" ? fn.call(t, e) : fn.handleEvent(e)) : fn;
      list.set(fn, { given, drop: page.add(() => (remove(type, given, capture), list.delete(fn))) });
      add(type, given, opts);
    }) as typeof t.addEventListener;
    t.removeEventListener = ((type: string, fn: Fn | null, opts?: boolean | EventListenerOptions) => {
      const list = fn ? mine.get(keyOf(type, opts)) : undefined;
      const rec = fn && list?.get(fn);
      if (!rec) return remove(type, fn, opts);
      rec.drop();
      list!.delete(fn!);
      remove(type, rec.given, opts);
    }) as typeof t.removeEventListener;
  }
  const every = window.setInterval.bind(window);
  const stop = window.clearInterval.bind(window);
  const intervals = new Map<number, () => void>();
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = every(fn, ms, ...args);
    const page = currentPage();
    if (page) intervals.set(id, page.add(() => (stop(id), intervals.delete(id))));
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) intervals.get(id)?.();
    if (id !== undefined) intervals.delete(id);
    stop(id);
  }) as typeof window.clearInterval;
  const ticker = app.ticker;
  const tick = ticker.add.bind(ticker);
  const tickOnce = ticker.addOnce.bind(ticker);
  const untick = ticker.remove.bind(ticker);
  const ticks = new Map<unknown, () => void>();
  ticker.add = ((fn, context, priority) => {
    const page = currentPage();
    if (page && !ticks.has(fn)) ticks.set(fn, page.add(() => (untick(fn, context), ticks.delete(fn))));
    return tick(fn, context, priority);
  }) as typeof ticker.add;
  ticker.addOnce = ((fn, context, priority) => {
    const page = currentPage();
    if (page) {
      const drop = page.add(() => untick(fn, context));
      tickOnce(drop);
    }
    return tickOnce(fn, context, priority);
  }) as typeof ticker.addOnce;
  ticker.remove = ((fn, context) => {
    ticks.get(fn)?.();
    ticks.delete(fn);
    return untick(fn, context);
  }) as typeof ticker.remove;
}
