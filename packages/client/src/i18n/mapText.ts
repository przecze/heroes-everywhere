// A map's own texts (its description, timed events, signs, guards, monsters, towns, seers, rumours, heroes' lives)
// in Polish or German, from the VCMI packs and the HotA mod (public/l10n/<lang>/maps-<n>.json, made by
// tools/i18n/maps-text.ts; the packs' keys by place: sign.<x>.<y>.<level>.message ...). Sets them in the parsed map,
// for the page and for the game server's worker alike; a map with no file is left as it is.
import type { H3Map } from "@heroes/formats";
import { has } from "./languages.ts";

const slug = (file: string) => file.replace(/\.h3m$/i, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The maps' texts are in this many files, a map by the sum of its slug's letters (tools/i18n/maps-text.ts). */
const BUCKETS = 10;
const buckets = new Map<string, Promise<Record<string, Record<string, string>>>>();

export async function localizeMap(map: H3Map, file: string, language: string): Promise<H3Map> {
  if (!has(language, "mapTexts")) return map;
  const name = slug(file);
  const url = `/l10n/${language}/maps-${[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % BUCKETS}.json`;
  let all = buckets.get(url);
  if (!all) buckets.set(url, (all = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))));
  const t: Record<string, string> = (await all)[name] ?? {};
  if (!Object.keys(t).length) return map;
  const say = <T extends object>(o: T, field: keyof T, key: string) => {
    if (t[key]) (o[field] as unknown as string) = t[key];
  };
  const here = (o: { x: number; y: number; z: number }) => `${o.x}.${o.y}.${o.z}`;
  say(map, "name", "header.name");
  say(map, "description", "header.description");
  map.events?.forEach((e, i) => say(e, "message", `event.${i}.description`));
  map.rumors.forEach((r, i) => say(r, "text", `header.rumor.${i}.text`));
  for (const [id, c] of Object.entries(map.heroCustom ?? {})) say(c, "biography", `heroes.${id}.biography`);
  for (const o of map.objects) {
    const d = o.data as Record<string, any>;
    const at = here(o);
    if (typeof d.message === "string") for (const kind of ["sign", "monster", "guards"]) if (t[`${kind}.${at}.message`]) d.message = t[`${kind}.${at}.message`];
    if (typeof d.name === "string") say(d, "name", `town.${at}.name`);
    (d.events as { message: string }[] | undefined)?.forEach((e, i) => say(e, "message", `town.${at}.event.${i}.description`));
    for (const q of [d, ...((d.quests as Record<string, any>[] | undefined) ?? [])]) for (const f of ["firstVisit", "nextVisit", "completed"]) if (typeof q[f] === "string") say(q, f, `quest.${at}.${f}`);
  }
  return map;
}
