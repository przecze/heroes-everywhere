// Casting on the adventure map: the hero's spellbook, then for Town Portal the original's town list
// (TPGATE, JKTEXT 40 / 41). A spell aimed at a tile (Dimension Door, Scuttle Boat) is handed back
// to wait for the map click; any other is cast at once.
import { spellText } from "../ui/spellText.ts";
import { type Hero, type SpellInfo, TARGETED, castRefusal, heroMastery, heroSpellEstimate, heroSpells, portalTowns, skillLevel } from "@heroes/core";
import { loadDef } from "../assets.ts";
import { resolveText, textTable } from "../ui/gameText.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { objectListWindow } from "../ui/objectList.ts";
import { spellbookWindow } from "../ui/spellbook.ts";
import { type AdvContext, colorOf } from "./context.ts";
import { tr, rulesText, type Text, fallback } from "../i18n/index.ts";

/** A spell waiting for its map click. */
export type Aiming = { hero: number; spell: number; name: string };

/** `pick`: a spell hotkey's spell (spellHotkeys.ts), cast without opening the book. */
export async function castWindow(ctx: AdvContext, h: Hero, pick?: number): Promise<Aiming | null> {
  const { modals, data } = ctx;
  const player = colorOf(ctx);
  if (!h.spells) return void dialog(modals, tr(`%1 has no spellbook.`, h.name), player), null;
  const s = ctx.state();
  const w = ctx.world();
  const spells = (heroSpells(h, data.spells ?? []) ?? []).map((id) => data.spells?.[id]).filter((x): x is SpellInfo => !!x);
  // Why each adventure spell can't be cast now, in the original's words (GENRLTXT) when it has them.
  const reasons = new Map<number, Text>();
  await Promise.all(
    spells.map(async (x) => {
      const why = x.id < 10 ? castRefusal(s, w, h, x) : null;
      if (why) reasons.set(x.id, (why.ref ? await resolveText(why.ref) : null) ?? rulesText(why.text, "cast"));
    }),
  );
  // The right-click adds what a damage spell would do (GENRLTXT 343, as VCMI's SpellArea).
  const gen = await textTable("genrltxt");
  const estimate = (x: SpellInfo) => {
    const n = heroSpellEstimate(h, x);
    return n ? gen(343, tr(`\nDoes %1 points of damage.`, n), n) : "";
  };
  const sp = await spellbookWindow(modals, player, {
    pick,
    spells,
    mana: h.mana ?? 0,
    combat: false,
    isCombat: (x) => x.id >= 10,
    cost: (x) => x.cost[heroMastery(h, x)],
    mastery: (x) => heroMastery(h, x),
    schoolLevel: (_x, sc) => skillLevel(h.skills, `${sc}Magic`),
    wrongKind: (x) => x.id >= 10,
    blocked: (x) => (x.id >= 10 ? tr("That spell can only be cast in battle.") : (reasons.get(x.id) ?? null)),
    describe: (x) => spellText(x, heroMastery(h, x), estimate(x)),
    onMessage: (t) => void dialog(modals, t, player),
  });
  if (!sp) return null;
  if (TARGETED.has(sp.id)) return { hero: h.id, spell: sp.id, name: sp.name };
  let target: number | undefined;
  if (sp.id === 9) {
    const towns = portalTowns(s, w, h, heroMastery(h, sp));
    if (towns.length > 1) {
      // The original's list (TPGATE, JKTEXT 40 / 41) with the spell's picture.
      const i = await objectListWindow(modals, player, {
        title: (await resolveText({ file: "jktext", id: 40 })) ?? fallback("Town Portal"),
        description: (await resolveText({ file: "jktext", id: 41 })) ?? fallback("Select a town to go to."),
        items: towns.map((o) => o.name ?? fallback("Town")),
        picture: (await loadDef("spellscr.def").catch(() => null))?.get(0)?.[sp.id]?.texture,
      });
      if (i < 0) return null;
      target = towns[i].id;
    }
  }
  ctx.send({ type: "castSpell", hero: h.id, spell: sp.id, target });
  return null;
}
