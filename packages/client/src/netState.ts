// Is there a connection? Decided by online.ts, which asks the server rather than trusting the browser
// alone (a train's wifi says "connected" and carries nothing). Kept apart, with nothing imported, so the
// outbox and the senders can read it without pulling in the page's toasts.

let off = typeof navigator !== "undefined" && navigator.onLine === false;
const watchers = new Set<(offline: boolean) => void>();

/** No connection to the server now (as last checked). */
export const isOffline = () => off;

/** The last few changes (when the connection went or came back), for a feedback note's meta. */
export const netChanges: { at: string; offline: boolean }[] = [];

export function setOffline(v: boolean) {
  if (v === off) return;
  off = v;
  netChanges.push({ at: new Date().toISOString(), offline: v });
  if (netChanges.length > 8) netChanges.shift();
  watchers.forEach((f) => f(v));
}

export const onNetChange = (f: (offline: boolean) => void) => (watchers.add(f), () => watchers.delete(f));

/** A request just failed for want of a connection: online.ts checks at once. */
export const netTrouble = () => typeof window !== "undefined" && window.dispatchEvent(new Event("heroes:netTrouble"));
