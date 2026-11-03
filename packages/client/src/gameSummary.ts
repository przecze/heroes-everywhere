// "Your games" at a glance: the summary itself is the core's (the multiplayer host makes it for a
// room's players too); here the happenings' lines are put into the player's language.
export { type GameEvent, type GameSummary, myColor, summarize } from "@heroes/core";
import { tr, type Text } from "./i18n/index.ts";

/** A log line of the rules (English, names inside) in the interface language; unknown ones stay as written. */
export function eventText(line: Text): Text {
  const rules: [RegExp, (m: RegExpMatchArray) => Text][] = [
    [/^(.+) is victorious and gains (\d+) experience\.$/, (m) => tr("%1 is victorious and gains %2 experience.", m[1], m[2])],
    [/^(.+) has been defeated\.$/, (m) => tr("%1 has been defeated.", m[1])],
    [/^(.+) lays siege to (.+)!$/, (m) => tr("%1 lays siege to %2!", m[1], m[2])],
    [/^(.+) surrenders, and gains safe passage for (\d+) gold\.$/, (m) => tr("%1 surrenders and gains safe passage for %2 gold.", m[1], m[2])],
    [/^The (.+) flee\.$/, (m) => tr("The %1 flee.", m[1])],
    [/^(.+) claims (.+)\.$/, (m) => tr("%1 claims %2.", m[1], m[2])],
    [/^(.+) brings the Grail to (.+)\.$/, (m) => tr("%1 brings the Grail to %2.", m[1], m[2])],
    [/^(.+) wins the game!$/, (m) => tr("%1 wins the game!", tr(m[1]))],
    [/^(.+) is out of the game: (.+)\.$/, (m) => tr("%1 is out of the game: %2.", tr(m[1]), m[2])],
  ];
  for (const [re, f] of rules) {
    const m = line.match(re);
    if (m) return f(m);
  }
  return line;
}
