// The touch HUD's "more" grid: the original's rarer commands as their pictures, opened beside the buttons.
import { Container } from "pixi.js";
import { en, tr, reason } from "../../i18n/index.ts";
import { extra } from "../../settings.ts";
import { YELLOW } from "../../text.ts";
import { placePopup } from "../../ui/blocks/popupPlace.ts";
import { DefButton } from "../../ui/kit.ts";
import { screenSize } from "../../ui/screen.ts";
import { track } from "../../usage.ts";
import type { HudButton } from "../hud.ts";
import type { MobileHud } from "../mobileHud.ts";
import { GAP, K, type Rgb, backing, text } from "./look.ts";

export class MoreMenu {
  readonly box = new Container();

  private readonly hud: MobileHud;
  constructor(hud: MobileHud) {
    this.hud = hud;
    this.box.label = "menu: more commands";
    this.box.visible = false;
  }

  toggle() {
    const hud = this.hud;
    const menu = this.box;
    const open = !menu.visible;
    hud.closePopups();
    if (!open) return;
    menu.visible = true;
    hud.openCatcher();
    menu.removeChildren().forEach((x) => x.destroy({ children: true }));
    // The original's other buttons as their pictures (2026-10-26: icons, not words): the rail's (next hero,
    // kingdom, quest log, sleep, move, system options) and the Adventure Options window's (view world, puzzle map,
    // dig, scenario info); the tutorial's messages in words, as there is no picture for them.
    const player = Math.max(0, hud.player);
    const cell = 32 * K;
    const items: [string, HudButton, string][] = [
      // (Next hero on the buttons' block itself with EXTRAS railNextHero, the spellbook here instead: the owner, 2026-11-01.)
      ...(extra("railNextHero") ? [[en("Cast a spell"), "cast", "iam007.def"] as [string, HudButton, string]] : [[en("Next hero"), "nextHero", "iam000.def"] as [string, HudButton, string]]),
      [en("Kingdom overview"), "kingdom", "iam002.def"],
      [en("Quest log"), "quests", "iam004.def"],
      [hud.asleep ? en("Wake hero") : en("Sleep hero"), "sleep", hud.asleep ? "iam011.def" : "iam005.def"],
      [en("Move hero"), "move", "iam006.def"],
      [en("View world"), "world", "advview.def"],
      [en("Puzzle map"), "puzzle", "advpuz.def"],
      [en("Dig for the Grail"), "dig", "advdig.def"],
      [en("Scenario info"), "info", "advinfo.def"],
      // (The Adventure Options window's fifth, Replay Opponent's Turn: the owner, 2026-11-01 "should be there somewhere".)
      [en("Replay opponent's turn"), "replay", "advturn.def"],
      [en("Save, load, options"), "sysOptions", "iam009.def"],
    ];
    const myTurn = hud.last?.myTurn ?? false;
    const cols = 4;
    const tile = cell + 8;
    const tiles = new Container();
    items.forEach(([name, button, def]) => {
      const wide = def === "iam000.def";
      const b = new DefButton(def, 0, 0, player);
      b.label = `button: ${name}`;
      b.disabled = (!myTurn && ["nextHero", "sleep", "move", "dig"].includes(button)) || (button === "move" && (hud.last?.s.heroes[hud.last.selected]?.movement ?? 1) <= 0);
      if (b.disabled && hud.offTurn) b.explain(hud.offTurn.modals, player, () => reason(hud.offTurn!.why()));
      b.onClick = () => {
        track(`menu:${button}`);
        hud.closePopups();
        hud.onButton(button);
      };
      void b.ready.then(() => {
        if (b.destroyed) return;
        // Each picture in a square place (the wide next hero in two), as big as it fits.
        const k = Math.min(((wide ? 2 : 1) * tile - 8) / (b.width / b.scale.x), cell / (b.height / b.scale.y));
        b.scale.set(k);
      });
      tiles.addChild(b);
    });
    // Laid out in rows of four places, the next hero two wide.
    let col = 0;
    let row = 0;
    for (const b of tiles.children as DefButton[]) {
      const span = b.label === `button: ${en("Next hero")}` ? 2 : 1;
      if (col + span > cols) ((col = 0), (row += 1));
      b.position.set(GAP + col * tile, GAP + row * tile);
      col += span;
    }
    const w = cols * tile + 2 * GAP - 8;
    const h = (row + 1) * tile + 2 * GAP - 8;
    menu.addChild(backing(w, h, 0.9), tiles);
    if (hud.tutorial) {
      const t = text(tr("Tutorial Messages"), "medfont", 1.5, [...YELLOW] as Rgb);
      const row2 = new Container();
      row2.label = "button: Tutorial Messages";
      row2.addChild(backing(w, t.height + 16, 0.9), Object.assign(t, { x: 12, y: 8 }));
      row2.position.set(0, h);
      row2.eventMode = "static";
      row2.cursor = "pointer";
      row2.on("pointertap", () => (hud.closePopups(), hud.onButton("tutorial")));
      menu.addChild(row2);
    }
    if (extra("moveWidgets")) {
      const t = text(tr("Move the panels"), "medfont", 1.5, [...YELLOW] as Rgb);
      const row3 = new Container();
      row3.label = "button: Move the panels";
      row3.addChild(backing(w, t.height + 16, 0.9), Object.assign(t, { x: 12, y: 8 }));
      // (Flush under the grid: a gap let the map's colours through between them; The owner 2026-11-02.)
      row3.position.set(0, menu.height);
      row3.eventMode = "static";
      row3.cursor = "pointer";
      row3.on("pointertap", () => (hud.closePopups(), hud.arranger.start()));
      menu.addChild(row3);
    }
    // Beside the buttons' widget, whole on the screen wherever that was moved.
    menu.position.set(0, 0);
    placePopup(menu, { from: hud.pieces.buttons, sides: screenSize.portrait ? ["above", "below", "left", "right"] : hud.sides.hand === "left" ? ["right", "above", "below", "left"] : ["left", "above", "below", "right"] });
  }
}
