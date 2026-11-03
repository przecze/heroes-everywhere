// The map a player who hasn't picked one yet is offered (New Game's preselected row, a plain "#map"
// with no game). Not the first of the list by name, which put every newcomer on Arrogance (the owner 21:53
// 2026-10-26: "don't funnel everyone to Arrogance just because A"): one of a few small maps that
// suit a first game (one human against computers, Normal or easier, the usual victory and loss),
// picked at random so players spread over them, the same one on that page; once a map is played,
// the last pick is offered instead (menu.ts, map/page.ts "heroes.map"). A device that never played gets
// the guided first game in New Game before any of these (newGame.ts). Arrogance is left out (the owner,
// 2026-10-27): every early player's game was on it, and its underground is a lot for a first game.

/** Small maps, mostly one level, Normal or easier, standard victory and loss, at least one computer. */
export const STARTER_MAPS = [
  "Good to Go.h3m",
  "Freedom.h3m",
  "Irrational Hostility.h3m",
  "Sands of Blood.h3m",
  "[HotA] Face To Face.h3m",
  "[HotA] Province.h3m",
  "[HotA] Just Win, Or Else.h3m",
];

let picked: string | undefined;

/** A starter among `files` (the maps' list), the same one each time on this page; the list's first when none is there. */
export function starterMap(files: readonly string[]): string | undefined {
  if (picked && files.includes(picked)) return picked;
  const fit = STARTER_MAPS.filter((f) => files.includes(f));
  picked = fit.length ? fit[Math.floor(Math.random() * fit.length)] : undefined;
  return picked ?? files.find((f) => !/^random:/.test(f)) ?? files[0];
}
