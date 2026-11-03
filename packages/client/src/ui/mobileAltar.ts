// The Altar of Sacrifice (and HotA's Altar of Mana) on a phone: the original window's parts as the phone trading
// panel (ui/blocks/tradePanel.ts) lays them out, each framed and titled with the original's words: what the hero
// offers (the stacks through the shared stack row, or the artifacts), the altar with what's on it and what it's
// worth, and the deal: the experience to the next level and on the altar, the slider for the picked stack, All
// (or Fill / Backpack), Sacrifice, OK. Upright one over the other; sideways the deal at the thumb.
import { Container, Graphics, Sprite } from "pixi.js";
import { creaturePortrait, loadDef } from "../assets.ts";
import { tr, type Text, said, fmt } from "../i18n/index.ts";
import { WHITE, YELLOW } from "../text.ts";
import type { AltarOptions } from "./altar.ts";
import { artifactHold } from "./artifactHold.ts";
import { PORTRAIT, StackGrid } from "./blocks/stackGrid.ts";
import { Slider } from "./blocks/slider.ts";
import { GAP, PANEL_W, rowPlaces, tradeLayout } from "./blocks/tradePanel.ts";
import { DefButton, label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { openPage } from "./mobilePage.ts";
import { infoCard } from "./stackWindow.ts";

/** A stack's place: the portrait and its count under it (medfont). */
const STACK_H = PORTRAIT.large.h + 17;
/** An artifact's place: ARTIFACT.DEF's 44 x 44 in a sunken square, its worth under it. */
const ART = { w: 48, h: 48, step: 62, rowH: 70 };

export interface AltarWords {
  troops: string;
  altar: string;
  how: string;
  toNext: string;
  onAltar: string;
}

export async function mobileAltar(modals: Modals, player: number, o: AltarOptions, words: AltarWords): Promise<void> {
  let unlisten = () => {};
  const page = await openPage(modals, { bare: true, draw: () => redraw(), onClose: () => unlisten() });
  const arts = (await loadDef("artifact.def")).get(0) ?? [];
  const worth = (c: number) => (o.mana ? o.mana.value(c) : o.creatureXp(c));
  const card = infoCard(modals, player, o.creatures, () => o.hero().army);
  /** What's on the altar: creatures per army slot, or artifact ids. */
  const offered = new Map<number, number>();
  const onAltar: number[] = [];
  let chosen = -1;

  const titled = (title: Text, body: Container, sub?: Text) => {
    const c = new Container();
    const t = label(title, "bigfont", YELLOW, "center", PANEL_W);
    c.addChild(t);
    let y = t.height + 6;
    if (sub) {
      const s = label(sub, "medfont", WHITE, "center", PANEL_W);
      s.y = y;
      c.addChild(s);
      y += s.height + 8;
    }
    body.y = y;
    c.addChild(body);
    return c;
  };
  const sunken = (w: number, h: number) => new Graphics().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.55 }).rect(0.5, 0.5, w - 1, h - 1).stroke({ color: 0x6b5a3a, width: 1 });
  /** Artifact places five a row, centred; each tap does `tap`, a long press shows its text; `caption`: under it. */
  const artGrid = (ids: number[], places: number, tap: (k: number) => void, caption?: (id: number) => Text) => {
    const g = new Container();
    const n = Math.max(places, ids.length);
    const left = Math.round((PANEL_W - 5 * ART.step + (ART.step - ART.w)) / 2);
    for (let k = 0; k < n; k++) {
      const slot = new Container();
      slot.position.set(left + (k % 5) * ART.step, Math.floor(k / 5) * ART.rowH);
      slot.addChild(sunken(ART.w, ART.w));
      const id = ids[k];
      if (id !== undefined && arts[id]) {
        slot.addChild(Object.assign(new Sprite(arts[id].texture), { x: 2, y: 2 }));
        slot.eventMode = "static";
        slot.cursor = "pointer";
        slot.on("pointertap", (e) => e.button !== 2 && tap(k));
        artifactHold(slot, player, o, id, o.hero());
        if (caption) slot.addChild(label(caption(id), "medfont", WHITE, "center", ART.step).centreOn(ART.w / 2, ART.w + 9));
      }
      g.addChild(slot);
    }
    return g;
  };

  const draw = async () => {
    const h = o.hero();
    let xp = 0;
    let yours: Container;
    let theirs: Container;
    const deal = new Container();
    deal.label = "panel: deal";
    let y = 0;
    if (o.evil) {
      const a = chosen >= 0 ? h.army[chosen] : null;
      if (!a) chosen = -1;
      const mine = new StackGrid(
        { size: "large", at: rowPlaces(7, PORTRAIT.large.w, STACK_H), count: "below", countFont: "medfont", frames: true },
        { creatures: o.creatures, onTap: (i) => ((chosen = i), redraw()), picked: () => chosen, card },
      );
      const altar = new StackGrid(
        { size: "large", at: rowPlaces(7, PORTRAIT.large.w, STACK_H), count: "below", countFont: "medfont", frames: true },
        { creatures: o.creatures, onTap: (i) => ((chosen = i), redraw()), picked: () => chosen, card, countText: (i, n) => said(`${n} (${Math.floor(n * worth(h.army[i]?.creature ?? 0))})`) },
      );
      await Promise.all([
        mine.set(h.army.map((s, i) => s && { creature: s.creature, count: s.count - (offered.get(i) ?? 0) })),
        altar.set(h.army.map((s, i) => (s && offered.get(i) ? { creature: s.creature, count: offered.get(i)! } : null))),
      ]);
      h.army.forEach((s, i) => s && (xp += (offered.get(i) ?? 0) * worth(s.creature)));
      yours = titled(said(words.troops), mine);
      theirs = titled(o.mana ? tr("Altar of Mana") : said(words.altar), altar, o.mana ? tr("Sacrifice creatures for spell points.") : said(words.how));
      // The picked stack and how many of it go on the altar (the shared slider).
      if (a) {
        const tex = await creaturePortrait(o.creatures[a.creature], "large");
        if (tex) deal.addChild(Object.assign(new Sprite(tex), { x: 0, y }));
        deal.addChild(Object.assign(label(tr("%1 on the altar", offered.get(chosen) ?? 0), "medfont", WHITE, "left", PANEL_W - 70), { x: 70, y: y + 22 }));
        y += PORTRAIT.large.h + GAP;
      }
      const slider = new Slider(PANEL_W);
      await slider.ready;
      slider.position.set(0, y);
      slider.range(a ? a.count : 0, a ? (offered.get(chosen) ?? 0) : 0);
      slider.block(!a);
      slider.onChange = (v) => chosen >= 0 && (offered.set(chosen, v), redraw());
      deal.addChild(slider);
      y += 16 + GAP;
    } else {
      const held = [...(h.equipped ?? [])];
      const bag = [...(h.backpack ?? [])];
      for (const id of onAltar) {
        const b = bag.indexOf(id);
        if (b >= 0) bag.splice(b, 1);
        else held[held.indexOf(id)] = -1;
      }
      const offer = [...held, ...bag].filter((id) => id >= 0 && o.artifactXp(id) > 0);
      yours = titled(tr("Artifacts"), artGrid(offer, 10, (k) => (onAltar.push(offer[k]), redraw()), (id: number) => said(String(o.artifactXp(id)))));
      theirs = titled(said(words.altar), artGrid(onAltar, 10, (k) => (onAltar.splice(k, 1), redraw()), (id: number) => said(String(o.artifactXp(id)))), tr("Tap an artifact to put it on the altar or take it back."));
      for (const id of onAltar) xp += o.artifactXp(id);
    }
    // Experience to the next level and on the altar (or the Altar of Mana's spell points).
    const line = (name: Text, value: Text) => {
      const n = label(name, "medfont", YELLOW, "left", PANEL_W - 90);
      const v = label(value, "bigfont", WHITE, "left", 90);
      n.position.set(0, y);
      v.position.set(PANEL_W - v.width, y + Math.max(0, (n.height - v.height) / 2));
      deal.addChild(n, v);
      y += Math.max(n.height, v.height) + 6;
    };
    if (o.mana) {
      line(tr("Spell points (up to 4x)"), fmt`${o.mana.current()} / ${o.mana.cap()}`);
      line(tr("Spell points on altar"), said(String(Math.floor(xp))));
    } else {
      line(said(words.toNext), said(String(Math.max(0, o.toNextLevel()))));
      line(said(words.onAltar), said(String(Math.floor(xp))));
    }
    y += GAP - 6;
    // The original's buttons: All / Fill (and Backpack), Sacrifice, OK.
    const sacrifice = new DefButton("altsacr.def", 0, 0, player);
    const all = new DefButton(o.evil ? "altarmy.def" : "altfill.def", 0, 0, player);
    const backpack = o.evil ? null : new DefButton("altembk.def", 0, 0, player);
    const ok = new DefButton("iok6432.def", 0, 0, player);
    await Promise.all([sacrifice.ready, all.ready, backpack?.ready, ok.ready]);
    sacrifice.label = "button: Sacrifice";
    sacrifice.disabled = xp <= 0;
    sacrifice.explain(modals, player, () => (o.evil ? tr("Pick a stack and move the slider first.") : tr("Put an artifact on the altar first.")));
    sacrifice.onClick = () => {
      if (o.evil) {
        const stacks = [...offered].filter(([, n]) => n > 0);
        if (stacks.length) o.sacrifice({ stacks });
      } else if (onAltar.length) o.sacrifice({ artifacts: [...onAltar] });
    };
    all.onClick = () => {
      if (o.evil) {
        // Everything but one creature (a hero keeps at least one).
        h.army.forEach((s, i) => s && offered.set(i, s.count));
        const last = [...offered.keys()].pop();
        if (last !== undefined) offered.set(last, offered.get(last)! - 1);
      } else {
        onAltar.length = 0;
        onAltar.push(...[...(h.equipped ?? []), ...(h.backpack ?? [])].filter((id) => id >= 0 && o.artifactXp(id) > 0));
      }
      redraw();
    };
    if (backpack)
      backpack.onClick = () => {
        onAltar.length = 0;
        onAltar.push(...(h.backpack ?? []).filter((id) => o.artifactXp(id) > 0));
        redraw();
      };
    ok.onClick = () => page.close();
    let x = 0;
    for (const b of [all, backpack]) if (b) (b.position.set(x, y), deal.addChild(b), (x += b.width + 6));
    sacrifice.position.set(Math.round((PANEL_W - sacrifice.width) / 2 + (backpack ? 30 : 0)), y);
    ok.position.set(PANEL_W - ok.width, y);
    deal.addChild(sacrifice, ok);
    const height = y + Math.max(sacrifice.height, ok.height);
    page.setContent(await tradeLayout("window: Altar of Sacrifice", player, yours, theirs, deal, height));
  };
  let drawing = Promise.resolve();
  const redraw = () => void (drawing = drawing.then(draw).catch((e) => console.error("altar", e)));

  await draw();
  unlisten = o.listen(() => {
    offered.clear();
    onAltar.length = 0;
    chosen = -1;
    redraw();
  });
  return page.show();
}
