// The adventure map's questions and announcements: offers a visited object makes (join, pursue,
// pay, pick a skill or the chest's gold), a dwelling's recruiting, the astrologers' week, and the
// values the end-of-game line names.
import { spellText } from "../ui/spellText.ts";
import { type AdventureEvent, type AdventureState, type Component, MONTH_NAMES, MONTH_NAME_LINE, PLAYER_NAMES, type TextRef, WEEK_NAMES, WEEK_NAME_LINE, type World, dwellingCreatures, dwellingPrice, startsMonth, startsWeek } from "@heroes/core";
import { loadDef } from "../assets.ts";
import { componentView, resolveText, withHints, englishLine } from "../ui/gameText.ts";
import { YES_NO, messageBox as dialog, pickBox } from "../ui/dialogs.ts";
import { recruitWindow } from "../ui/recruit.ts";
import { artifactText } from "../ui/artifactText.ts";
import { type AdvContext, colorOf } from "./context.ts";
import { objectName } from "./describe.ts";

// i18n-keys
/** The rules' own sentences that reach a window without a line of the game's (rulesText finds them in the tables). */
export const RULES_SENTENCES = ["Do you accept?", "A traveller presses a purse of gold into your hand.", "Your troops are already united.", "Your troops swear loyalty to one another: no morale penalty for mixed armies until tomorrow."];
import { resourceAmount, resourceName } from "../ui/resourceNames.ts";
import { tr, said, fallback, rulesText } from "../i18n/index.ts";


/** What reward pictures need to name their creature, artifact or spell. */
export const componentNames = (w: World | null) => ({
  creature: (id: number) => w?.creatures[id],
  artifact: (id: number) => w?.data.artifacts[id]?.name ?? "",
  spell: (id: number) => w?.data.spells?.[id]?.name ?? "",
  artifactHelp: (id: number) => (w ? artifactText(w.data, id) : ""),
  spellHelp: (id: number) => {
    const sp = w?.data.spells?.[id];
    return sp ? spellText(sp) : "";
  },
});

/** The reward pictures of a message, drawn. */
export async function componentViews(w: World | null, comps: Component[] = []) {
  return (await Promise.all(comps.map((c) => componentView(c, componentNames(w))))).filter((c): c is NonNullable<typeof c> => !!c);
}

/**
 * A bank's loot line (ADVEVENT 34 "...you take the loot (%s)"): the rules fill its list in English ("12 Gems, 6000
 * Gold"); made again here from the pictures it shows, in the player's language (2026-11-01, "Gems gold not translated").
 */
export async function localLoot(w: World | null, ref: TextRef | undefined, comps: Component[] = []): Promise<TextRef | undefined> {
  if (!ref || ref.file !== "advevent" || ref.id !== 34 || !ref.args || ref.args.length < 2) return ref;
  // (Each picture's own caption: a component without a picture has none, so not componentViews' filtered list.)
  const words = (await Promise.all(comps.map(async (c) => (c.kind === "resource" ? resourceAmount(c.id, c.amount, true) : ((await componentView(c, componentNames(w)))?.caption ?? "").replace(/\n/g, " "))))).filter(Boolean);
  return { ...ref, args: [ref.args[0], words.length ? words.join(", ") : tr("nothing")] };
}

type Offer = Extract<AdventureEvent, { e: "offer" }>;

/** An object's offer to a hero of ours: asked, and the answer sent back. */
export async function offerDialog(ctx: AdvContext, next: AdventureState, ev: Offer, send?: (accept: boolean, option?: number) => void) {
  const w = ctx.world();
  const answer = send ?? ((accept: boolean, option?: number) => ctx.send({ type: "answerOffer", hero: ev.hero, accept, option }));
  if (ev.kind === "primary") {
    // Arena / Schools: pick the skill from the two icons.
    const options = ev.options ?? [];
    const icons = (await loadDef("pskil42.def")).get(0) ?? [];
    // The original's line, the icons captioned with what they give (+2 at an Arena, +1 at a School:
    // PRISKILL's names, as the reward pictures).
    const text = (ev.textRef ? await resolveText(ev.textRef) : null) ?? rulesText(ev.text, "offer");
    const n = next.objects[ev.object]?.type === 4 ? 2 : 1;
    const views = await Promise.all(options.map((k) => componentView({ kind: "primary", id: k, amount: n }, componentNames(w))));
    const i = await pickBox(ctx.modals, text, options.map((k, j) => ({ texture: icons[k].texture, caption: views[j]?.caption ?? said(""), help: views[j]?.help })), colorOf(ctx));
    return answer(i >= 0, options[i]);
  }
  if (ev.kind === "script" && ev.options && (ev.components?.length ?? 0) >= 2) {
    // A map script's question with two pictures to choose from (and Cancel only when it allows one).
    const text = await withHints(ev.text ?? "");
    const views = await componentViews(w, ev.components);
    const extra = await componentViews(w, ev.extra);
    for (;;) {
      const i = await pickBox(ctx.modals, text, views, colorOf(ctx), extra);
      if (i >= 0 || ev.cost === 2) return answer(i >= 0, i);
    }
  }
  if (ev.kind === "chest") {
    // Treasure chest: the gold or the experience, picked from the two pictures.
    const text = (ev.textRef ? await resolveText(ev.textRef) : null) ?? rulesText(ev.text, "chest");
    const i = await pickBox(ctx.modals, text, await componentViews(w, ev.components), colorOf(ctx));
    return answer(i >= 0, i);
  }
  // (No object for a timed event's question.)
  const o = next.objects[ev.object] as (typeof next.objects)[number] | undefined;
  const name = said(o && w.creatures[o.subid]?.plural) ?? tr("creatures");
  // (HotA: only the map's share of the stack may join.)
  const n = ev.count ?? o?.amount ?? 1;
  const text =
    ev.kind === "ask" || ev.kind === "confirm" || ev.kind === "attack" || ev.kind === "pandora" || ev.kind === "quest" || ev.kind === "script"
      ? ev.kind === "script" || ev.textRef ? said(ev.text ?? "") : rulesText(ev.text, `offer ${ev.kind}`)
      : ev.kind === "flee"
        ? tr(`The %1 are afraid of your army and are trying to flee. Do you wish to pursue them?`, name)
        : ev.kind === "pay"
          ? tr(`%1 %2 are willing to join your army for %3 gold. Do you accept?`, n, name, ev.cost)
          : tr(`%1 %2 would like to join your army. Do you accept?`, n, name);
  // Wandering monsters' own lines: join (86), join for gold (89 + 90), flee (91).
  const ref: TextRef | undefined =
    ev.textRef ??
    (ev.kind === "join"
      ? { file: "advevent", id: 86, args: [name] }
      : ev.kind === "pay"
        ? { file: "advevent", id: 89, more: [{ file: "advevent", id: 90, args: [n, name, ev.cost] }] }
        : ev.kind === "flee"
          ? { file: "advevent", id: 91, args: [name] }
          : undefined);
  // The original's own question and what it gives, when the game files have them.
  const original = ref ? await resolveText(ref) : ev.kind === "script" ? await withHints(text) : null;
  const reply = await dialog(ctx.modals, original ?? text, colorOf(ctx), { buttons: YES_NO, components: await componentViews(w, ev.components) });
  answer(reply === "yes");
}

/** A timed or town event's script asks us (no hero to ask): as a hero's script question, answered for the player. */
export function scriptAskDialog(ctx: AdvContext, next: AdventureState, ev: Extract<AdventureEvent, { e: "scriptAsk" }>) {
  const choose = ev.mode === 1 || ev.mode === 2;
  const offer: Offer = { e: "offer", hero: -1, object: -1, kind: "script", cost: ev.mode, text: ev.text, components: ev.components, ...(choose ? { options: [0, 1] } : {}), ...(ev.extra ? { extra: ev.extra } : {}) };
  return offerDialog(ctx, next, offer, (accept, option) => ctx.send({ type: "answerScript", accept, option }));
}

/** A map dwelling a hero of ours visits: asked first, then the recruit window (level 1 creatures are free). */
export async function dwellingDialog(ctx: AdvContext, s: AdventureState, heroId: number, objectId: number) {
  const w = ctx.world();
  const o = s.objects[objectId];
  if (!o?.dwelling) return;
  const choices = (dwellingCreatures(o) ?? []).map((id, slot) => {
    // Map dwellings give level 1 creatures away; the Refugee Camp charges for everyone.
    return { creature: w.creatures[id], available: o.dwelling!.available[slot] ?? 0, cost: dwellingPrice(w, o, id) };
  });
  const place = objectName(o, w.creatures, w.data.artifacts);
  const plurals = choices.map((c) => c.creature.plural).join(", ");
  // The original asks first ({place} Would you like to recruit ...?), or says it's empty for now.
  if (!choices.some((c) => c.available > 0)) {
    const text = (await resolveText({ file: "advevent", id: 44, args: [place] })) ?? englishLine("advevent", 44, [place]);
    return void (await dialog(ctx.modals, text, colorOf(ctx)));
  }
  const ask = (await resolveText({ file: "advevent", id: 35, args: [place, plurals] })) ?? fallback(`${place}\n\nWould you like to recruit ${plurals}?`);
  if ((await dialog(ctx.modals, ask, colorOf(ctx), { buttons: YES_NO })) !== "yes") return;
  const r = await recruitWindow(ctx.modals, colorOf(ctx), (c) => tr(`Recruit %1`, c.plural), choices, s.players[ctx.me()].resources);
  if (r) ctx.send({ type: "recruitDwelling", hero: heroId, object: objectId, slot: r.index, count: r.count });
}

/** The astrologers' proclamation on the first day of a week (and a month): our words and the original's (ARRAYTXT). */
export function weekProclamation(w: World | null, s: AdventureState): { text: string; ref: TextRef } | null {
  const wk = s.week;
  const month = startsMonth(s.day);
  if (!startsWeek(s.day) || !wk) return null;
  const plural = (id: number) => w?.creatures[id]?.plural ?? "";
  const single = (id?: number) => (id !== undefined ? (w?.creatures[id]?.name ?? "") : "");
  const line = wk.creature !== undefined ? `Astrologers proclaim the Week of the ${wk.name}. All ${plural(wk.creature) || wk.name} dwellings gain +5 population.` : `Astrologers proclaim the Week of the ${wk.name}.`;
  const m = month && wk.month;
  const monthLine = !m ? "" : m.plague ? "\n\nA plague sweeps the land! Half of the creatures in every town perish." : m.creature !== undefined ? `\n\nIt is also the Month of the ${m.name}: wandering ${plural(m.creature) || m.name} double their numbers.` : `\n\nIt is also the Month of the ${m.name}.`;
  // A week's or month's animal as the game's own word (ARRAYTXT's lists; The owner's note 2026-11-02 11:00: a Polish game
  // said "hedgehog"); a name from an older save that isn't on the list stays as it was.
  const named = (name: string, list: readonly string[], line: number): string | TextRef => (list.includes(name) ? { file: "arraytxt", id: line + list.indexOf(name) } : name);
  const ref: TextRef = m
    ? m.plague
      ? { file: "arraytxt", id: 132 }
      : m.creature !== undefined
        ? { file: "arraytxt", id: 131, args: [single(m.creature), single(m.creature)] }
        : { file: "arraytxt", id: 130, args: [named(m.name, MONTH_NAMES, MONTH_NAME_LINE)] }
    : wk.creature !== undefined
      ? { file: "arraytxt", id: 134, args: [single(wk.creature), single(wk.creature)] }
      : { file: "arraytxt", id: 133, args: [named(wk.name, WEEK_NAMES, WEEK_NAME_LINE)] };
  return { text: line + monthLine, ref };
}

/** Whether the game's winner is `me` or on my team. */
export function wonBy(s: AdventureState, me: number): boolean {
  const w = s.winner ?? -1;
  return w >= 0 && (w === me || (s.players[me]?.team !== undefined && s.players[w]?.team === s.players[me]?.team));
}

/** The values the end-of-game line names: what the deciding condition was about. */
export function gameOverArgs(s: AdventureState, w: World | null, me: number, won: boolean): (string | number)[] {
  const c = s.conditions;
  const v = c?.victory;
  const lostBy = s.players[me]?.lostBy ?? -1;
  const townName = (id?: number) => (id !== undefined ? (s.objects[id]?.name ?? "the town") : "");
  const heroName = (id?: number) => (id !== undefined ? (s.heroes[id]?.name ?? "") : "");
  if (!won && !(v && (s.victoryType ?? -1) >= 0)) {
    if (lostBy === 0) return [townName(c?.loss.object)];
    if (lostBy === 1) return [heroName(c?.loss.hero)];
    return [PLAYER_NAMES[me] ?? ""];
  }
  if (!v || (s.victoryType ?? -1) < 0) return [];
  switch (v.type) {
    case 0:
    case 10:
      return [w?.data.artifacts[v.artifact ?? -1]?.name ?? "artifact"];
    case 1:
      return [v.amount ?? 0, w?.creatures[v.creature ?? -1]?.plural ?? ""];
    case 2:
      return [v.amount ?? 0, resourceName(v.resource ?? 6)];
    case 5:
      return [heroName(v.hero)];
    case 6:
      return [townName(v.object)];
    default:
      return [];
  }
}
