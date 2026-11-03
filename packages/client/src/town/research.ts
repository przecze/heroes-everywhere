// HotA's spell research from the mage guild (core research.ts): a tap on a guild spell offers to
// research it away for its cost, then lets the player pick one of the new spells; a slot under
// research offers to research again or to finalize it. The same flow serves the desktop window and
// the phone's guild page.
import { spellText } from "../ui/spellText.ts";
import type { Texture } from "pixi.js";
import { type AdventureAction, type AdventureState, type AdvObject, type World, researchCost, researchRefusal } from "@heroes/core";
import { loadDef } from "../assets.ts";
import { componentView } from "../ui/gameText.ts";
import { type Modals } from "../ui/modals.ts";
import { YES_NO, choiceBox, messageBox, pickBox } from "../ui/dialogs.ts";
import { tr, fmt, reason, said } from "../i18n/index.ts";

export interface ResearchCtx {
  modals: Modals;
  player: number;
  state: () => AdventureState;
  world: () => World;
  town: () => AdvObject;
  send: (a: AdventureAction) => void;
  listen: (fn: () => void) => () => void;
}

/** Whether a tap on this guild slot is about research (else it just reads the spell). */
export const researchable = (o: AdvObject) => !!o.town?.research && o.town.guild !== undefined;

/** Sends an action and waits for the state it brings (at most a few seconds). */
function sendAndWait(ctx: ResearchCtx, a: AdventureAction): Promise<void> {
  return new Promise((resolve) => {
    let off = () => {};
    const timer = setTimeout(() => (off(), resolve()), 3000);
    off = ctx.listen(() => (clearTimeout(timer), off(), resolve()));
    ctx.send(a);
  });
}

async function scrollOf(id: number): Promise<Texture | undefined> {
  return (await loadDef("spellscr.def")).get(0)?.[id]?.texture;
}

/** Picks one of the offered spells for the open slot; cancelling leaves the choice for later. */
async function pick(ctx: ResearchCtx): Promise<void> {
  const o = ctx.town();
  const offer = o.town?.researchOffer ?? [];
  if (!offer.length) return;
  const spells = ctx.world().data.spells ?? [];
  const choices = await Promise.all(offer.map(async (id) => ({ texture: (await scrollOf(id)) ?? (await loadDef("spellscr.def")).get(0)![0].texture, caption: said(spells[id]?.name ?? ""), help: spells[id] ? spellText(spells[id]) : undefined })));
  const i = await pickBox(ctx.modals, tr("Choose the spell to take its place."), choices, ctx.player);
  if (i >= 0) await sendAndWait(ctx, { type: "researchPick", town: o.id, spell: offer[i] });
}

/** A tap on the guild's spell at this level (1-5) and slot. */
export async function guildSpellTap(ctx: ResearchCtx, level: number, slot: number): Promise<void> {
  const o = ctx.town();
  const t = o.town!;
  const id = t.guild?.[level - 1]?.[slot];
  const sp = id === undefined ? undefined : ctx.world().data.spells?.[id];
  if (!sp) return;
  const info = spellText(sp);
  if (!researchable(o) || o.owner !== ctx.player) return void (await messageBox(ctx.modals, info, ctx.player));
  const open = t.researchSlot?.[0] === level && t.researchSlot[1] === slot;
  if (open && t.researchOffer?.length) return pick(ctx);
  if (open) {
    const n = await choiceBox(ctx.modals, tr(`%1 is being researched. Heroes can learn it once the research is finalized.`, sp.name), [tr("Research another spell"), tr("Finalize the research")], ctx.player);
    if (n === 1) return sendAndWait(ctx, { type: "researchFinalize", town: o.id });
    if (n !== 0) return;
  }
  const why = reason(researchRefusal(ctx.state(), o, level, slot));
  if (why) return void (await messageBox(ctx.modals, fmt`${info}\n\n${why}`, ctx.player));
  // The price as the original's resource pictures, each explaining itself when held.
  const names = { creature: () => undefined, artifact: () => "", spell: () => "" };
  const components = (await Promise.all(researchCost(level).map((n, r) => (n ? componentView({ kind: "resource", id: r, amount: n }, names) : null)))).filter((c) => !!c);
  const answer = await messageBox(ctx.modals, tr(`%1Research a new spell to replace %2?`, open ? "" : `${info}\n\n`, sp.name), ctx.player, {
    components,
    buttons: YES_NO,
  });
  if (answer !== "yes") return;
  await sendAndWait(ctx, { type: "research", town: o.id, level, slot });
  await pick(ctx);
}
