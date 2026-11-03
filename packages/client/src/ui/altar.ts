// The Altar of Sacrifice, with the original screens: evil heroes give creatures (ALTARMON), the
// rest give artifacts (ALTRART2, the hero's paper doll on the left). Layout after VCMI's
// CAltarCreatures / CAltarArtifacts.
import { artifactHold } from "./artifactHold.ts";
import { resolveText } from "./gameText.ts";
import { type CreatureStats, type Hero } from "@heroes/core";
import { Container, Sprite } from "pixi.js";
import { creaturePortrait, loadDef } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { SLOT_POS } from "./heroScreen.ts";
import { DefButton, label, loadImagePlayer } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { tr, type Text, said, fmt, fallback } from "../i18n/index.ts";
import { StackGrid } from "./blocks/stackGrid.ts";
import { Slider } from "./blocks/slider.ts";
import { infoCard } from "./stackWindow.ts";
import { mobileAltar } from "./mobileAltar.ts";
import { phoneSized } from "./screen.ts";

const ARMY = [[0, 0], [83, 0], [166, 0], [0, 98], [83, 98], [166, 98], [83, 196]];
const ALTAR_ARTS = [
  [0, 0], [54, 0], [108, 0], [162, 0], [216, 0], [0, 70], [54, 70], [108, 70], [162, 70], [216, 70], [0, 140],
  [54, 140], [108, 140], [162, 140], [216, 140], [0, 210], [54, 210], [108, 210], [162, 210], [216, 210], [81, 280], [135, 280],
];

export interface AltarOptions {
  hero: () => Hero;
  evil: boolean;
  /** HotA's Altar of Mana: creatures for spell points. */
  mana?: { value: (creature: number) => number; current: () => number; cap: () => number };
  creatures: CreatureStats[];
  artifacts: { name: string; tier: string; description?: string }[];
  creatureXp: (creature: number) => number;
  artifactXp: (id: number) => number;
  sacrifice: (a: { stacks?: [number, number][]; artifacts?: number[] }) => void;
  toNextLevel: () => number;
  listen: (fn: () => void) => () => void;
}

export async function altarWindow(modals: Modals, player: number, o: AltarOptions): Promise<void> {
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer(o.mana ? "altrmana.pcx" : o.evil ? "altarmon.pcx" : "altrart2.pcx", player)));
  const worth = (c: number) => (o.mana ? o.mana.value(c) : o.creatureXp(c));
  const centred = (text: Text, x: number, y: number, width = 260, color: readonly [number, number, number] = YELLOW, font: "smalfont" | "medfont" = "smalfont") => {
    const t = label(text, font, color, "center", width);
    t.centreOn(x, y);
    layer.addChild(t);
  };
  const arts = (await loadDef("artifact.def")).get(0) ?? [];
  // The window's words: GENRLTXT 272 "%s's Creatures", 479 "Altar of Sacrifice", 480 (how to sacrifice), 475 / 476
  // (VCMI's CAltarCreatures / CExperienceAltar); the Altar of Mana's (HotA's) ours.
  const gen = async (id: number, ours: string, ...args: string[]): Promise<Text> => (await resolveText({ file: "genrltxt", id, args }))?.trim() || fallback(ours);
  const words = {
    troops: await gen(272, `${o.hero().name}'s Troops`, o.hero().name),
    altar: await gen(479, "Altar of Sacrifice"),
    how: await gen(480, "Sacrifice creatures for experience."),
    toNext: await gen(475, "Experience to next level"),
    onAltar: await gen(476, "Experience on altar"),
  };
  // Phones: the parts framed as the phone trading panel lays them out (readable, no two fingers).
  if (phoneSized()) return mobileAltar(modals, player, o, words);
  const layer = new Container();
  win.addChild(layer);
  /** What's on the altar: creatures per army slot, or artifact ids. */
  const offered = new Map<number, number>();
  const onAltar: number[] = [];
  let chosen = -1;
  const pick = (i: number) => ((chosen = i), void draw());
  const card = infoCard(modals, player, o.creatures, () => o.hero().army);
  const at = (bx: number) => ARMY.map(([x, y]) => [bx + x, 110 + y] as const);
  const armyGrid = new StackGrid({ size: "large", at: at(45), count: "below" }, { creatures: o.creatures, onTap: pick, card, picked: () => chosen });
  const altarGrid = new StackGrid(
    { size: "large", at: at(334), count: "below" },
    { creatures: o.creatures, onTap: pick, card, countText: (i, n) => said(`${n} (${Math.floor(n * worth(o.hero().army[i]?.creature ?? 0))})`) },
  );
  if (o.evil) win.addChild(armyGrid, altarGrid);
  // How many of the picked stack go on the altar: the shared slider (VCMI's CAltarCreatures has one at 231, 481).
  const slider = new Slider(137);
  slider.position.set(231, 487);
  slider.onChange = (v) => chosen >= 0 && (offered.set(chosen, v), void draw());
  await slider.ready;

  const draw = async () => {
    if (o.evil) {
      const a = chosen >= 0 ? o.hero().army[chosen] : null;
      slider.range(a ? a.count : 0, a ? (offered.get(chosen) ?? 0) : 0);
    }
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const h = o.hero();
    let xp = 0;
    if (o.evil) {
      centred(words.troops, 155, 30);
      centred(o.mana ? tr("Altar of Mana") : words.altar, 450, 30);
      centred(o.mana ? tr("Sacrifice creatures for spell points.") : words.how, 448, 76, 256);
      // The two sides are the shared stack row: a tap picks a stack, a long press opens its card.
      await Promise.all([
        armyGrid.set(h.army.map((a, i) => a && { creature: a.creature, count: a.count - (offered.get(i) ?? 0) })),
        altarGrid.set(h.army.map((a, i) => (a && offered.get(i) ? { creature: a.creature, count: offered.get(i)! } : null))),
      ]);
      h.army.forEach((a, i) => a && (xp += (offered.get(i) ?? 0) * worth(a.creature)));
      const a = chosen >= 0 ? h.army[chosen] : null;
      if (a) {
        const tex = await creaturePortrait(o.creatures[a.creature], "large");
        if (tex) layer.addChild(Object.assign(new Sprite(tex), { x: 149, y: 422 }));
        centred(said(String(offered.get(chosen) ?? 0)), 300, 498, 100, WHITE, "medfont");
      }
    } else {
      centred(words.altar, 450, 32);
      centred(tr("Experience"), 302, 424);
      // The hero's paper doll and backpack (VCMI places the hero screen's doll at -365, -11).
      const pick = (id: number) => {
        if (!o.artifactXp(id)) return;
        onAltar.push(id);
        void draw();
      };
      const held = [...(h.equipped ?? [])];
      const bag = [...(h.backpack ?? [])];
      for (const id of onAltar) {
        const b = bag.indexOf(id);
        if (b >= 0) bag.splice(b, 1);
        else held[held.indexOf(id)] = -1;
      }
      SLOT_POS.forEach(([x, y], slot) => {
        const id = held[slot] ?? -1;
        if (id < 0 || !arts[id]) return;
        const sp = Object.assign(new Sprite(arts[id].texture), { x: x - 365, y: y - 11 });
        sp.eventMode = "static";
        sp.cursor = "pointer";
        sp.on("pointertap", () => pick(id));
        artifactHold(sp, player, o, id, h);
        layer.addChild(sp);
      });
      bag.slice(0, 5).forEach((id, k) => {
        if (!arts[id]) return;
        const sp = Object.assign(new Sprite(arts[id].texture), { x: 403 + 46 * k - 365, y: 365 - 11 });
        sp.eventMode = "static";
        sp.cursor = "pointer";
        sp.on("pointertap", () => pick(id));
        artifactHold(sp, player, o, id, h);
        layer.addChild(sp);
      });
      onAltar.forEach((id, k) => {
        const [x, y] = ALTAR_ARTS[k] ?? ALTAR_ARTS[ALTAR_ARTS.length - 1];
        if (!arts[id]) return;
        const sp = Object.assign(new Sprite(arts[id].texture), { x: 315 + x + 12, y: 53 + y + 3 });
        sp.eventMode = "static";
        sp.cursor = "pointer";
        sp.on("pointertap", () => {
          onAltar.splice(k, 1);
          void draw();
        });
        artifactHold(sp, player, o, id, h);
        layer.addChild(sp);
        centred(said(String(o.artifactXp(id))), 315 + x + 34, 53 + y + 58, 60, WHITE);
        xp += o.artifactXp(id);
      });
    }
    // Experience to the next level and on the altar (VCMI's CExperienceAltar: text boxes 15, 415, 125 x 50
    // and 15, 495, 125 x 40, centred both ways).
    if (o.mana) {
      centred(tr("Spell points (up to 4x)"), 77, 440, 125);
      centred(fmt`${o.mana.current()} / ${o.mana.cap()}`, 76, 477, 100, WHITE);
      centred(tr("Spell points on altar"), 77, 515, 125);
    } else {
      centred(words.toNext, 77, 440, 125);
      centred(said(String(Math.max(0, o.toNextLevel()))), 76, 477, 100, WHITE);
      centred(words.onAltar, 77, 515, 125);
    }
    centred(said(String(Math.floor(xp))), 76, 545, 100, WHITE);
  };
  await draw();
  const unlisten = o.listen(() => {
    offered.clear();
    onAltar.length = 0;
    chosen = -1;
    void draw();
  });

  return new Promise((resolve) => {
    let close = () => {};
    const done = () => (unlisten(), close(), resolve());
    const deal = new DefButton("altsacr.def", o.evil ? 306 : 269, 520, player);
    deal.onClick = () => {
      if (o.evil) {
        const stacks = [...offered].filter(([, n]) => n > 0);
        if (stacks.length) o.sacrifice({ stacks });
      } else if (onAltar.length) o.sacrifice({ artifacts: [...onAltar] });
    };
    const all = new DefButton(o.evil ? "altarmy.def" : "altfill.def", 393, 520, player);
    all.onClick = () => {
      const h = o.hero();
      if (o.evil) {
        // Everything but one creature (a hero keeps at least one).
        h.army.forEach((a, i) => a && offered.set(i, a.count));
        const last = [...offered.keys()].pop();
        if (last !== undefined) offered.set(last, offered.get(last)! - 1);
      } else {
        onAltar.length = 0;
        onAltar.push(...[...(h.equipped ?? []), ...(h.backpack ?? [])].filter((id) => id >= 0 && o.artifactXp(id) > 0));
      }
      void draw();
    };
    win.addChild(deal, all);
    if (o.evil) {
      win.addChild(slider);
    } else {
      const backpack = new DefButton("altembk.def", 147, 520, player);
      backpack.onClick = () => {
        onAltar.length = 0;
        onAltar.push(...(o.hero().backpack ?? []).filter((id) => o.artifactXp(id) > 0));
        void draw();
      };
      win.addChild(backpack);
    }
    const ok = new DefButton("iok6432.def", 516, 520, player);
    ok.onClick = done;
    win.addChild(ok);
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? done() : undefined, true) });
  });
}
