// A stack's own window (the original's creature window from an army): the creature card with its
// numbers, Dismiss (IVIEWCR2) and Upgrade (IVIEWCR) when they apply, and OK.
import type { CreatureStats } from "@heroes/core";
import { GameText, WHITE, YELLOW } from "../text.ts";
import { type CreatureInfo, creatureOnRightClick, creaturePopup } from "./creatureInfo.ts";
import { componentView, resolveText, englishLine } from "./gameText.ts";
import { DefButton, label } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { YES_NO, messageBox } from "./dialogs.ts";
import { breakdownPanel } from "./stackBreakdown.ts";
import { extra } from "../settings.ts";
import { tr, said, fallback, fmt, type Text } from "../i18n/index.ts";
import { screenSize } from "./screen.ts";
import { type Container, Graphics } from "pixi.js";

export interface StackWindowOptions {
  info: CreatureInfo;
  /** Upgrade: what it costs (shown under the card) and whether it can be paid. */
  upgrade?: { text: Text; afford: boolean; apply: () => void; /** The price, asked with its resource pictures. */ cost?: number[] };
  /** Dismiss the stack (asked first). */
  dismiss?: () => void;
}

const NO_NAMES = { creature: () => undefined, artifact: () => "", spell: () => "" };

export async function stackWindow(modals: Modals, player: number, c: CreatureStats, o: StackWindowOptions): Promise<void> {
  const askDismiss = async () => {
    const ask = (await resolveText({ file: "genrltxt", id: 12 })) ?? englishLine("genrltxt", 12);
    return (await messageBox(modals, ask, player, { buttons: YES_NO })) === "yes";
  };
  // As the original's creature window from an army (VCMI's CCreInfoWindow, left click): the card
  // itself (CRSTKPU) with Dismiss (IVIEWCR2) at 21,237, Upgrade (IVIEWCR) at 76,237 and OK at 216,237,
  // its bottom strip telling what the pointer is over.
  const win = await creaturePopup(c, { player, ...o.info });
  const status = label(said(""), "smalfont", WHITE, "center", 278);
  status.position.set(10, 288);
  win.addChild(status);
  const hint = (b: DefButton, text: Text) => {
    b.on("pointerover", () => (status.value = text));
    b.on("pointerout", () => (status.value = said("")));
  };
  // The effects behind the numbers: a panel beside the card, shown and hidden by a tap on the picture.
  const lines = o.info.breakdown ?? [];
  if (extra("stackBonus") && lines.length) {
    let panel: Container | null = null;
    const toggle = Object.assign(new Graphics().rect(20, 47, 120, 130).fill({ color: 0, alpha: 0.001 }), { eventMode: "static" as const, cursor: "pointer" });
    toggle.on("pointerover", () => (status.value = tr("Effects on this stack")));
    toggle.on("pointerout", () => (status.value = said("")));
    toggle.on("pointertap", async () => {
      if (panel) {
        panel.destroy({ children: true });
        panel = null;
        return;
      }
      const p = await breakdownPanel(lines, 250, 311);
      if (panel) return void p.destroy({ children: true });
      // A touch screen's card already fills the screen's width: beside it the panel was off the screen (the owner,
      // 2026-10-27 22:05 "opens the card in a way that is not really visible"). There it is a window of its own,
      // over the card, whole on screen; a tap closes it.
      if (screenSize.touch) {
        p.eventMode = "static";
        let shut = () => {};
        p.on("pointertap", () => shut());
        shut = modals.show(p, { onKey: (k) => (k === "Escape" || k === "Enter" ? (shut(), true) : true) });
        return;
      }
      p.position.set(304, 0);
      panel = p;
      win.addChild(p);
    });
    win.addChild(toggle);
    // A small badge in the picture's corner says it opens.
    const badge = new Graphics().roundRect(23, 50, 16, 16, 3).fill({ color: 0x2a1c10, alpha: 0.85 }).stroke({ color: 0xe5d77b, width: 1 });
    const plus = new GameText("smalfont", YELLOW);
    plus.value = said("+");
    plus.position.set(31 - plus.width / 2, 51);
    win.addChild(badge, plus);
  }
  return new Promise(async (resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    const ok = new DefButton("iokay.def", 216, 237, player);
    ok.onClick = done;
    win.addChild(ok);
    if (o.dismiss) {
      const dismiss = new DefButton("iviewcr2.def", 21, 237, player);
      hint(dismiss, tr("Dismiss"));
      dismiss.onClick = async () => {
        if (!(await askDismiss())) return;
        o.dismiss!();
        done();
      };
      win.addChild(dismiss);
    }
    if (o.upgrade) {
      // The original's upgrade arrows, greyed out when the player can't pay; it asks first (GENRLTXT 207).
      const up = new DefButton("iviewcr.def", 76, 237, player);
      up.hint = o.upgrade.text;
      hint(up, o.upgrade.text);
      up.disabled = !o.upgrade.afford;
      up.explain(modals, player, () => tr("Not enough resources."));
      up.onClick = async () => {
        const ask = (await resolveText({ file: "genrltxt", id: 207 })) ?? fallback("Do you wish to upgrade?");
        const cost = o.upgrade!.cost;
        const components = cost && (await Promise.all(cost.map((n, id) => (n > 0 ? componentView({ kind: "resource", id, amount: n }, NO_NAMES) : null)).reverse())).filter((c): c is NonNullable<typeof c> => !!c);
        const yes = await messageBox(modals, components?.length ? ask : fmt`${ask}\n\n${o.upgrade!.text}`, player, { buttons: YES_NO, components: components || undefined });
        if (yes !== "yes") return;
        o.upgrade!.apply();
        done();
      };
      win.addChild(up);
    }
    close = modals.show(win, { onKey: (k) => (k === "Escape" || k === "Enter" ? (done(), true) : false) });
  });
}

/** The card of a stack where the army is only shown or picked from (no Dismiss, no Upgrade): StackGrid's `card`. */
export function infoCard(modals: Modals, player: number, creatures: readonly CreatureStats[], army: () => readonly ({ creature: number; count: number } | null | undefined)[]) {
  return (slot: number) => {
    const a = army()[slot];
    const c = a && creatures[a.creature];
    if (a && c) void stackWindow(modals, player, c, { info: { count: a.count } });
  };
}

/**
 * One creature's picture (not a stack: a recruit card, a dwelling, a split side, a message picture): the right
 * button held shows its popup, as the original; a finger held opens the same card as a stack's, which stays.
 */
export function creatureHold(target: Container, modals: Modals, player: number, c: CreatureStats, info: () => CreatureInfo) {
  creatureOnRightClick(target, () => ({ c, info: info() }), () => void stackWindow(modals, player, c, { info: info() }));
}
