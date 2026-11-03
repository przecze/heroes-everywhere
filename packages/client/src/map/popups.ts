// Right-click on the adventure map: the original's popup while the button is held — a hero's or
// town's quick view, a monster's portrait and rough number, or what an object is.
import { type AdvObject, type Hero, equipArtifact, activeQuest, upperArmy, allied, disguisedArmy, heroMoraleLuck, mapData, monsterIntent, portalLinks, questRef, seesNumbers, tavernLevel } from "@heroes/core";
import { type Container, Sprite } from "pixi.js";
import { creaturePortrait } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { resolveText, englishLine } from "../ui/gameText.ts";
import { label, windowFrame } from "../ui/kit.ts";
import { garrisonQuickView, heroQuickView, townQuickView } from "../ui/quickView.ts";
import { type AdvContext, colorOf } from "./context.ts";
import { extra } from "../settings.ts";
import { tr, said, type Text, fallback, fmt } from "../i18n/index.ts";
import { armyPhrase, armyRange, describeTile, objectName, seenBy } from "./describe.ts";

/**
 * What a monster's popup says: "A pack (10-19) of Gnolls", or under Visions (or near Rogues) the
 * exact number and what they'll do when the hero comes (GENRLTXT 243-246, as VCMI's getPopupText).
 */
export async function monsterText(ctx: AdvContext, o: AdvObject, selected: number): Promise<Text> {
  const s = ctx.state();
  const name = objectName(o, ctx.world().creatures, ctx.data.artifacts);
  const n = o.amount ?? 1;
  if (!seesNumbers(s, ctx.world(), ctx.me(), o.x, o.y, o.z)) return fmt`${armyPhrase(n)} ${name}`;
  const mine = (h?: Hero) => h && !h.removed && h.owner === ctx.me();
  const hero = mine(s.heroes[selected]) ? s.heroes[selected] : s.heroes.find(mine);
  const intent = hero && monsterIntent(s, ctx.world(), hero, o);
  if (!intent) return fmt`${n} ${name}`;
  const id = { join: 243, pay: 244, flee: 245, fight: 246 }[intent.kind];
  return fmt`${n} ${name}\n\n${(await resolveText({ file: "genrltxt", id, args: [intent.cost] })) ?? englishLine("genrltxt", id, [intent.cost])}`;
}

// (Looked up when drawn: the language may have changed since.)
const tierName = (tier: string): Text | undefined => ({ T: tr("Treasure"), N: tr("Minor artifact"), J: tr("Major artifact"), R: tr("Relic") })[tier];
/** An artifact on the map, beyond its name: its effect, class and price, and the selected hero's view of it. */
function artifactLines(ctx: AdvContext, id: number, selected: number): Text {
  const a = ctx.data.artifacts[id];
  if (!a) return said("");
  let out = a.description ? fmt`\n\n${said(a.description)}` : said("");
  const tier = tierName(a.tier);
  if (tier) out = fmt`${out}\n\n${a.cost > 0 ? tr("%1, worth %2 gold", tier, a.cost) : tier}`;
  const h = ctx.state().heroes[selected];
  if (!h || h.removed || h.owner !== ctx.me()) return out;
  const carried = [...(h.equipped ?? []), ...(h.backpack ?? [])];
  if (carried.includes(id)) return fmt`${out}\n${tr("%1 has one already.", said(h.name))}`;
  // (Worn at once if a slot for it is free, as picking it up does: tried on a copy of the hero.)
  const wears = equipArtifact(structuredClone(h), ctx.data.artifacts, id);
  return fmt`${out}\n${wears ? tr("%1 can wear it at once.", said(h.name)) : tr("%1's slot for it is taken: it would go to the backpack.", said(h.name))}`;
}

/** The popup for what's on a tile (null when there's nothing to say). `selected` is the hero whose visits count. */
export async function tilePopup(ctx: AdvContext, at: { hero?: Hero; object?: AdvObject }, selected: number): Promise<Container | null> {
  const s = ctx.state();
  const w = ctx.world();
  const me = ctx.me();
  // Your own hero: morale and luck as the hero screen has them (army, skills, artifacts, visits).
  if (at.hero)
    return heroQuickView(at.hero, me, w.creatures, disguisedArmy(s, w, at.hero, me), {
      exact: seesNumbers(s, w, me, at.hero.x, at.hero.y, at.hero.z, "hero"),
      moraleLuck: at.hero.owner === me ? heroMoraleLuck(s, w, at.hero) : undefined,
    });
  const o = at.object;
  if (!o) return null;
  // Someone else's: what shows depends on the viewer's Taverns (allies' as their own).
  const taverns = o.owner === me || (o.owner >= 0 && allied(s, o.owner, me)) ? 2 : tavernLevel(s, me);
  if (o.town) return townQuickView(o, me, w.creatures, upperArmy(s, o), { exact: seesNumbers(s, w, me, o.x, o.y, o.z, "town"), taverns });
  // A garrison: who holds it and its troops (numbers only for its owner, or with Visions / Rogues).
  if (o.type === 33 || o.type === 219) {
    // Its troops are read from the map until someone first visits.
    const fromMap = (mapData(w, o).army as { slot: number; creature: number; count: number }[] | undefined) ?? [];
    const army = o.army ?? Array.from({ length: 7 }, (_, slot) => fromMap.find((a) => a.slot === slot) ?? null);
    return garrisonQuickView(objectName(o, w.creatures, ctx.data.artifacts) || fallback("Garrison"), army, me, o.owner === me, w.creatures, { exact: seesNumbers(s, w, me, o.x, o.y, o.z, "town"), taverns });
  }
  if (o.type === 54) {
    // A monster: its portrait over its number.
    const c = w.creatures[o.subid];
    // (Beyond HotA: which level it is, and whether it flies or shoots, for creatures one doesn't know yet.)
    const kind = c && extra("monsterDetails") ? [tr("Level %1", c.level), ...(c.abilities.some((a) => a.type === "FLYING") ? [tr("Flies")] : []), ...(c.abilities.some((a) => a.type === "SHOOTER") ? [tr("Shoots")] : [])].join(" · ") : "";
    // (With the details on, its size as numbers under the picture, big, the name under them: "10-19", not a phrase.)
    const text = await monsterText(ctx, o, selected);
    const n = o.amount ?? 1;
    const numbers = kind ? (seesNumbers(s, w, me, o.x, o.y, o.z) ? said(String(n)) : armyRange(n)) : said("");
    const count = numbers ? label(numbers, "bigfont", YELLOW, "center", 260) : null;
    const rest = numbers ? text.replace(/^[^\n]*/, objectName(o, w.creatures, ctx.data.artifacts)) : text;
    const body = label(said(rest + (kind ? `\n${kind}` : "")), "medfont", WHITE, "center", 260);
    const tex = await creaturePortrait(w.creatures[o.subid] ?? { id: o.subid }, "large");
    const top = (tex ? tex.height + 12 : 0) + (count ? count.height + 6 : 0);
    const frame = await windowFrame(300, body.height + top + 40, colorOf(ctx));
    if (tex) frame.addChild(Object.assign(new Sprite(tex), { x: 150 - tex.width / 2, y: 20 }));
    if (count) frame.addChild(Object.assign(count, { x: 20, y: 20 + (tex ? tex.height + 8 : 0) }));
    body.position.set(20, 20 + top);
    frame.addChild(body);
    return frame;
  }
  let text = describeTile(o, undefined, me, w.creatures, ctx.data.artifacts, seenBy(s, me, selected, ctx.data.spells), true) || objectName(o, w.creatures, ctx.data.artifacts);
  if (!text) return null;
  // A teleport (EXTRAS portalLinks): how many of its exits (a one-way exit: its entrances) have been found.
  const links = extra("portalLinks") ? portalLinks(s, w, me, o, extra("cyclicPortals")) : null;
  if (links && links.total > 0) {
    const found = links.exits.length + links.entrances.length;
    const below = [...links.exits, ...links.entrances].filter((x) => x.z !== o.z).length;
    text = fmt`${text}\n\n${links.entrances.length ? tr("Entrances found: %1 of %2", found, links.total) : tr("Exits found: %1 of %2", found, links.total)}`;
    if (below) text = fmt`${text}\n${tr("%1 on the other level", below)}`;
    if (links.next && links.next.z === o.z) text = fmt`${text}\n${tr("Next in turn: the gold one")}`;
  }
  // An artifact (EXTRAS artifactEffect, the owner 2026-11-03: "helps to plan, and say if it's worth it"): what it does, its
  // class and price, and whether the selected hero can wear it at once or has one already.
  if (o.type === 5 && extra("artifactEffect")) text = fmt`${text}${artifactLines(ctx, o.subid, selected)}`;
  // A quest you've been given: what it seeks, as the original's "(seeks Badge of Courage)".
  if ((o.type === 83 || o.type === 215) && o.visitors?.includes(me) && !o.data?.done) {
    const q = activeQuest(w, o);
    // (A script's quest: the hint its script gave.)
    const hint = said(typeof o.data?.questHint === "string" ? o.data.questHint : "");
    const seeks = hint || (q.mission ? await resolveText(questRef(s, w, o, q, 3)) : null);
    if (seeks) text = fmt`${text}\n\n${seeks}`;
  }
  return textFramePopup(ctx, text);
}

/** A popup of words alone (what an object is, the ground's name). */
export async function textFramePopup(ctx: AdvContext, text: Text): Promise<Container> {
  const body = label(text, "medfont", WHITE, "center", 260);
  const frame = await windowFrame(300, Math.max(70, body.height + 40), colorOf(ctx));
  body.position.set(20, 20);
  frame.addChild(body);
  return frame;
}
