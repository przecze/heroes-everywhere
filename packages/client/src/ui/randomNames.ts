// A random map's name in the interface's language. The core makes it in English ("Random map (L+U, water, 4 players)",
// "2SM2h (random M, 4 players)"); the template's own name (2SM2h) stays as it is.
import { START_PRESETS, rmgTitle, type RandomMapOptions, type RmgTemplate } from "@heroes/core";
import { fallback, fmt, lang, said, tr, trn, type Text } from "../i18n/index.ts";

// i18n-keys (a random map's monsters, by its options' strength)
const MONSTERS = ["weak monsters", "normal monsters", "strong monsters"];

const players = (n: number) => trn(n, "%1 player", "%1 players");

export function localRandomName(name: string): string {
  const tpl = /^(.*) \(random (\S+), (\d+) players\)$/.exec(name);
  if (tpl) return tr("%1 (random %2, %3)", tr(tpl[1]), tpl[2], players(Number(tpl[3])));
  const plain = /^Random map \((.*), (\d+) players\)$/.exec(name);
  if (plain) {
    const [size, ...flags] = plain[1].split(", ");
    const words = flags.map((f) => (f === "water" ? tr("water") : f === "islands" ? tr("islands") : f));
    return tr("Random map (%1, %2)", [size, ...words].join(", "), players(Number(plain[2])));
  }
  // (Our own names, the guided first map's "First steps" and the advanced starts', in the tables too.)
  return tr(name);
}

/**
 * A random map's description in the interface's language, made again from its options (the core writes it in English:
 * randomMapTitle); a Matrix case's (the owner's) stays English, noted.
 */
export function localRandomDescription(o: RandomMapOptions, template: RmgTemplate | undefined, english: string): Text {
  if (lang() === "en") return said(english);
  if (o.case) return fallback(english, "random map case");
  const seed = tr("Seed %1.", o.seed);
  if (o.guided) return fmt`${tr("A small map for a first game against one computer player: weak monsters wait a few steps from your town, the goals are listed on the screen.")} ${seed}`;
  const start = o.start ? START_PRESETS[o.start] : undefined;
  if (start) return fmt`${tr(start.text)}${template ? fmt` ${tr("On the %1 template.", rmgTitle(template))}` : said("")} ${seed}`;
  const ct = o.compTeams ?? (o.allied ? 1 : 0);
  const roads = o.roads === undefined || o.roads === 7 ? undefined : o.roads === 0 ? tr("no roads") : tr("roads only: %1", [tr("dirt"), tr("gravel"), tr("cobblestone")].filter((_, k) => o.roads! & (1 << k)).join(", "));
  const extras = [
    tr(MONSTERS[o.monsters] ?? MONSTERS[1]),
    ...(template ? [] : [o.underground ? tr("with an underground level") : undefined, o.water ? tr("a lake in the middle") : undefined, o.islands ? tr("islands") : undefined]),
    o.teams ? (o.teams === 1 ? tr("the humans allied") : tr("the humans in %1 teams", o.teams)) : undefined,
    ct ? (ct === 1 ? tr("the computers allied") : tr("the computers in %1 teams", ct)) : undefined,
    roads,
  ].filter((x): x is Text => !!x);
  const head = template ? tr("A random map from the %1 template for %2", rmgTitle(template), players(o.players)) : tr("A random map for %1", players(o.players));
  return fmt`${head}, ${said(extras.join(", "))}. ${seed}`;
}
