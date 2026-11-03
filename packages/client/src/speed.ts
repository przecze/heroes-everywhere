// Fast mode for agents (and impatient players): no animation waits. On with "?agent=1" in the
// address, or localStorage "heroes.fast" = "1". Quick combat turns it on (and the sounds off) for
// the rest of one battle.
const fromUrl = new URLSearchParams(location.search).has("agent");
let stored = false;
try {
  stored = localStorage.getItem("heroes.fast") === "1";
} catch {
  // storage unavailable
}
const base = fromUrl || stored;

export let fast = base;
/** Quick combat under way: no waits and no sounds. */
export let quick = false;

export function setQuick(on: boolean) {
  quick = on;
  fast = on || base;
}
