// Game rules (EXTRAS gameRules): what a game plays by, chosen on New Game's card and kept with the game: each of
// HotA's famous rule changes put back to the Shadow of Death's. The card's blue scroll (setupBlocks' rulesScroll) opens
// the window, framed in gold when one differs from HotA's. HotA's content itself is the card's own check (the horn).
import { Container, Sprite, type Texture } from "pixi.js";
import { loadDef } from "../assets.ts";
import { RULE_INFO, RULE_KEYS, type RuleOverrides, ruleOn } from "@heroes/core";
import { WHITE, YELLOW } from "../text.ts";
import { languageChanged, tr, type Text } from "../i18n/index.ts";
import { DefButton, FingerArea, hoverHelp, label, windowFrame } from "./kit.ts";
import { webMark } from "./webEmblem.ts";
import { type Modals } from "./modals.ts";

export interface GameRules {
  noHota?: boolean;
  rules?: RuleOverrides;
}

/** Whose a rule is as it stands: HotA's change, the Shadow of Death's own, or this remake's. */
type Whose = "hota" | "sod" | "ours";

/** Does this game differ from HotA's own? */
export const rulesChanged = (g: GameRules): boolean => !!g.noHota || RULE_KEYS.some((k) => !ruleOn(g.rules, k));

/** The window: a check for each rule. */
export async function gameRulesWindow(modals: Modals, g: GameRules, player: number): Promise<void> {
  const rowH = 52;
  const width = 420;
  const height = 70 + RULE_KEYS.length * rowH + 56;
  const win = await windowFrame(width, height, player);
  // Whose rule each one is, as the scenario list's format pictures (SCSELC: 2 the Shadow of Death's, 5 HotA's horn),
  // not the words "from HotA" (2026-11-02); the words are the row's hover / hold help.
  const formats = (await loadDef("scselc.def").catch(() => null))?.get(0);
  // Our own rules (the computer's fair view, the New AI) carry the remake's mark when on (2026-11-03).
  let ours: Texture | null = null;
  const mark = (whose: Whose): Texture | null => (whose === "ours" ? (ours ??= webMark()) : formats?.[whose === "hota" ? 5 : 2]?.texture ?? null);
  const title = label(tr("Game rules"), "bigfont", YELLOW, "center", width - 22);
  title.position.set(11, 18);
  win.addChild(title);
  const layer = new Container();
  win.addChild(layer);
  return new Promise((resolve) => {
    let close = () => {};
    // (The language switched while it's open: drawn again in the new one, the lines' heights with it.)
    const relang = () => (title.value = tr("Game rules"), draw());
    const done = () => (languageChanged.delete(relang), ours?.destroy(true), close(), resolve());
    const draw = () => {
      layer.removeChildren().forEach((c) => c.destroy({ children: true }));
      const rows = RULE_KEYS.map((k): [Text, Text, boolean, () => void, Whose] => {
        const on = ruleOn(g.rules, k);
        return [tr(RULE_INFO[k].name), tr(RULE_INFO[k].help), on, () => toggle(k), !on ? "sod" : RULE_INFO[k].ours ? "ours" : "hota"];
      });
      rows.forEach(([name, help, on, flip, owner], i) => {
        const y = 66 + i * rowH;
        const check = new DefButton("sysopchk.def", 22, y + 6, -1, on ? [1, 1, 2, 3] : [0, 1, 2, 3]);
        check.onClick = () => (flip(), draw());
        // A finger-sized area, the name beside it (tapping the name works too).
        const hit = new Container();
        hit.hitArea = new FingerArea(hit, width - 30, rowH - 4, 12, y);
        hit.eventMode = "static";
        hit.cursor = "pointer";
        hit.on("pointertap", () => (flip(), draw()));
        const whose = owner === "ours" ? tr("This remake's") : owner === "hota" ? tr("HotA's") : tr("Shadow of Death's");
        hoverHelp(hit, () => ({ hover: whose, help }));
        const text = label(name, "medfont", WHITE, "left", width - 62 - 56);
        text.position.set(62, y + Math.max(0, Math.round((rowH - 4 - text.height) / 2)));
        layer.addChild(hit, check, text);
        const t = mark(owner);
        if (t) {
          const icon = Object.assign(new Sprite(t), { label: `icon: ${owner === "ours" ? "this remake's" : owner === "hota" ? "HotA's" : "Shadow of Death's"} rule` });
          icon.position.set(width - 22 - t.width, y + Math.round((rowH - 4 - t.height) / 2));
          layer.addChild(icon);
        } else {
          const sub = label(whose, "medfont", YELLOW, "center", 50);
          sub.position.set(width - 72, y + 4);
          layer.addChild(sub);
        }
      });
    };
    const toggle = (k: (typeof RULE_KEYS)[number]) => {
      const next: RuleOverrides = { ...g.rules };
      if (ruleOn(g.rules, k)) next[k] = false;
      else delete next[k];
      g.rules = Object.keys(next).length ? next : undefined;
    };
    draw();
    languageChanged.add(relang);
    const ok = new DefButton("iokay.def", Math.round((width - 64) / 2), height - 16 - 30);
    ok.onClick = done;
    win.addChild(ok);
    close = modals.show(win, { onKey: (key) => (key === "Enter" || key === "Escape" || key === " " ? (done(), true) : false) });
  });
}
