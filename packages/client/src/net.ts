// Loading over a bad connection (a phone on the move, a server being redeployed): a request that
// fails for the network's sake, or with a server error, is tried again a few times, after a wait
// that grows, and while the device says it's offline it waits to be back online first. A missing
// file (404) fails at once. While anything is being retried, the page shows a small notice.

const WAITS = [500, 1000, 2000, 4000, 8000];

let retrying = 0;
let notice: HTMLElement | null = null;
// The notice's words, in the interface's language: the page sets them (connection.ts), so that the
// game's worker, which only counts, doesn't carry the translation tables.
let noticeText = () => "";
export function setRetryText(text: () => string) {
  noticeText = text;
}

/** The notice's count of requests being retried (the worker's come in through `retryNotice`). */
export function retryNotice(delta: number) {
  retrying = Math.max(0, retrying + delta);
  if (typeof document === "undefined") {
    // In the game's worker: the page shows it.
    (globalThis as unknown as { postMessage(m: unknown): void }).postMessage({ net: delta });
    return;
  }
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "netNotice";
    notice.textContent = noticeText();
    notice.setAttribute("role", "status");
    notice.style.cssText =
      "position:fixed;left:50%;top:calc(8px + var(--safe-top, 0px));transform:translateX(-50%);z-index:60;padding:6px 14px;background:#2a2014;color:#e8c860;border:1px solid #8a6a2a;border-radius:4px;font:16px Georgia,serif;pointer-events:none";
    document.body.appendChild(notice);
  }
  notice.style.display = retrying ? "block" : "none";
}

const online = () =>
  typeof navigator === "undefined" || navigator.onLine !== false
    ? Promise.resolve()
    : new Promise<void>((done) => {
        const back = () => {
          globalThis.removeEventListener("online", back);
          done();
        };
        globalThis.addEventListener("online", back);
        // (Some browsers never say they're back: look again now and then.)
        setTimeout(back, 10000);
      });

/** fetch(), tried again on a network failure or a server error (5xx, 408, 429). */
export async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  let shown = false;
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      let error: unknown = null;
      try {
        res = await fetch(url, init);
      } catch (e) {
        error = e;
      }
      const transient = !res || res.status >= 500 || res.status === 408 || res.status === 429;
      if (!transient || attempt >= WAITS.length) {
        if (res) return res;
        throw error;
      }
      if (!shown) {
        shown = true;
        retryNotice(1);
      }
      await new Promise((r) => setTimeout(r, WAITS[attempt]));
      await online();
    }
  } finally {
    if (shown) retryNotice(-1);
  }
}

/**
 * Keeps a load in its cache, unless the network failed it: then the next ask loads it again (the
 * connection may be back). A file that isn't there stays known as missing.
 */
export function remember<K, V>(cache: Map<K, Promise<V>>, key: K, p: Promise<V>): void {
  cache.set(key, p);
  p.catch((e) => {
    // (fetch's own failure is a TypeError; a missing file is an Error of ours.)
    if (e instanceof TypeError && cache.get(key) === p) cache.delete(key);
  });
}
