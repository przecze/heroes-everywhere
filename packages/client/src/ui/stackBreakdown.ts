// A stack's numbers told apart (an addition, EXTRAS stackBonus): what the hero, his specialty, his
// artifacts, the places he visited and the like add to the creature's own. Shown collapsed in the
// stack's window (stackWindow.ts).
import { type CreatureStats, type Hero, type MoraleLuckPart, type StackPart, stackSkillParts, stackSkills } from "@heroes/core";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { heroPortrait, loadDef } from "../assets.ts";
import { tr, said, fmt } from "../i18n/index.ts";
import { screenSize } from "./screen.ts";
import { GameText, WHITE, YELLOW } from "../text.ts";
import { resolveText } from "./gameText.ts";

export type StatKey = "attack" | "defense" | "speed" | "morale" | "luck";

export interface BreakLine {
  stat: StatKey;
  val: number;
  icon: () => Promise<Texture | null>;
  text: () => Promise<string> | string;
  /** The text already says the value (the original's morale and luck lines). */
  valued?: boolean;
}

export interface MoraleLuck {
  morale: number;
  luck: number;
  moraleParts?: MoraleLuckPart[];
  luckParts?: MoraleLuckPart[];
}

export const GOOD = [128, 224, 96] as const;
export const BAD = [240, 100, 84] as const;
export const tint = (n: number) => (n < 0 ? BAD : GOOD);

type Names = { artifacts?: Record<number, { name?: string }> | { name?: string }[] };

const frame = (def: string, i: number) => async () => (await loadDef(def).catch(() => null))?.get(0)?.[i]?.texture ?? null;

/**
 * What a creature window takes for a stack under a hero out of battle: his attack, defense and speed
 * for it, his morale and luck when known, and the breakdown behind them.
 */
export function stackInfo(h: Hero, c: CreatureStats, data: Names, ml?: MoraleLuck) {
  const parts = stackSkillParts(h, c);
  const lines: BreakLine[] = [];
  const artifactName = (id: number | undefined) => (id === undefined ? "" : ((data.artifacts as Record<number, { name?: string }> | undefined)?.[id]?.name ?? ""));
  for (const stat of ["attack", "defense", "speed"] as const)
    for (const p of parts[stat] as StackPart[]) {
      const icon =
        p.kind === "artifact" ? frame("artifact.def", p.artifact ?? 0) : p.kind === "specialty" ? async () => heroPortrait(h, "small").catch(() => null) : stat === "speed" ? frame("spellint.def", 54) : frame("pskil42.def", stat === "attack" ? 0 : 1);
      const text = p.kind === "artifact" ? artifactName(p.artifact) : p.kind === "specialty" ? `${h.name}: ${tr("Specialty")}` : p.kind === "hero" ? h.name : tr("Other");
      lines.push({ stat, val: p.val, icon, text: () => text });
    }
  if (ml) {
    for (const [stat, ps] of [["morale", ml.moraleParts], ["luck", ml.luckParts]] as const)
      for (const p of ps ?? []) {
        lines.push({
          stat,
          val: p.val,
          icon: frame(stat === "morale" ? "imrl42.def" : "ilck42.def", Math.max(-3, Math.min(3, p.val)) + 3),
          valued: p.id !== undefined,
          text: async () => (p.id !== undefined ? ((await resolveText({ file: "arraytxt", id: p.id, args: p.args })) ?? "") : (p.name ?? "")).trim(),
        });
      }
  }
  return { ...stackSkills(h, c), ...(ml ? { morale: ml.morale, luck: ml.luck } : {}), breakdown: lines };
}

const STAT_WORD: Record<StatKey, string> = { attack: "Attack", defense: "Defense", speed: "Speed", morale: "Morale", luck: "Luck" };
export const LINE_H = 24;

/** The breakdown's lines as rows: picture, source, the stat it changes and by how much (down the panel's `w`). */
export async function drawBreakdown(lines: BreakLine[], w: number, k = 1, font: "smalfont" | "medfont" = "smalfont"): Promise<Container> {
  const box = new Container();
  const row = LINE_H * k;
  let y = 0;
  for (const l of lines) {
    const [tex, text] = await Promise.all([l.icon(), Promise.resolve(l.text())]);
    if (tex) {
      const s = new Sprite(tex);
      s.scale.set(Math.min((row - 2) / s.width, (row - 2) / s.height));
      s.position.set(0, y + (row - s.height) / 2);
      box.addChild(s);
    }
    const val = new GameText(font, tint(l.val));
    val.value = fmt`${tr(STAT_WORD[l.stat])} ${l.val > 0 ? said("+") : said("")}${l.val}`;
    val.scale.set(k);
    val.position.set(w - val.width, y + (row - val.height) / 2);
    const name = new GameText(font, WHITE);
    name.value = l.valued ? said(text.replace(/\s*[+-]\d+\s*/g, " ").replace(/[:\s]+$/, "").trim()) : said(text);
    name.scale.set(k);
    // A long source gives way to the numbers.
    const room = w - val.width - row - 8;
    if (name.width > room) name.scale.x = (k * room) / (name.width / name.scale.x);
    name.position.set(row, y + (row - name.height) / 2);
    box.addChild(name, val);
    y += row;
  }
  return box;
}

/** The desktop window's side panel (frame, title, rows). */
export async function breakdownPanel(lines: BreakLine[], width: number, height: number): Promise<Container> {
  const panel = new Container();
  panel.addChild(new Graphics().roundRect(0, 0, width, height, 4).fill({ color: 0x2a1c10, alpha: 0.96 }).stroke({ color: 0xe5d77b, width: 2 }));
  const title = new GameText(screenSize.touch ? "medfont" : "smalfont", YELLOW);
  title.value = tr("Effects on this stack");
  title.position.set(Math.round((width - title.width) / 2), 8);
  panel.addChild(title);
  const rows = await drawBreakdown(lines.slice(0, Math.floor((height - 40) / LINE_H)), width - 20);
  rows.position.set(10, 32);
  panel.addChild(rows);
  return panel;
}
