// What the adventure map tells the player in windows, one at a time and after the battle on screen:
// a visited object's message, the windows queued behind it (a level-up, a dwelling, an offer), HotA's
// tutorial hints and a new player's first-steps guide.
import type { Component, TextRef } from "@heroes/core";
import { extra as extraOn } from "../settings.ts";
import { tr, type Text, said } from "../i18n/index.ts";
import { messageBox as dialog } from "../ui/dialogs.ts";
import { phoneSized } from "../ui/screen.ts";
import { resolveText, withHints } from "../ui/gameText.ts";
import { objectListWindow } from "../ui/objectList.ts";
import { mobileTutorialMessages } from "../ui/mobileTutorial.ts";
import { levelUpWindow } from "../ui/levelUp.ts";
import { componentViews, localLoot } from "./dialogs.ts";
import { noteTutorialHints, seenTutorialHints, tutorialGuide, tutorialTitle } from "./tutorial.ts";
import { firstStepsGuide } from "./firstSteps.ts";
import type { MapSession } from "./session.ts";

export class MapMessages {
  /** Adventure messages (what a visited object did): the original message box, one at a time. */
  chain: Promise<unknown> = Promise.resolve();
  /** Level-up: the original window; pick one of the offered secondary skills. */
  private levelUpOpen = false;
  // A new player's guided first game: its checklist (firstSteps.ts).
  readonly firstSteps = firstStepsGuide(() => !this.s.modals.open && !this.s.town.open && !this.s.battle);
  // HotA's tutorial: its hints at the moments the game itself shows them (tutorial.ts).
  readonly tutorial = tutorialGuide(
    (text) => this.show(said(text)),
    (text) => void withHints(text).then((t) => (noteTutorialHints(text), dialog(this.s.modals, t, this.s.color()))),
  );

  private readonly s: MapSession;
  constructor(s: MapSession) {
    this.s = s;
  }

  /** Queues a window after the messages before it and the battle's results. */
  later = (fn: () => Promise<unknown> | unknown) => {
    const epoch = this.s.battles.restarts;
    this.chain = this.chain.then(async () => {
      await this.s.untilLoaded();
      await this.s.battles.afterBattle();
      if (epoch !== this.s.battles.restarts) return;
      await fn();
    });
  };

  show = (text: Text, extra: { text?: TextRef; components?: Component[]; toast?: boolean } = {}) => {
    const s = this.s;
    const epoch = s.battles.restarts;
    this.chain = this.chain.then(async () => {
      await s.untilLoaded();
      await s.battles.afterBattle();
      // (A battle restarted meanwhile: what came of its first try never happened.)
      if (epoch !== s.battles.restarts) return;
      // The original's own line when the game files have it, with its reward pictures.
      const original = extra.text ? await resolveText((await localLoot(s.world, extra.text, extra.components)) ?? extra.text) : text.includes("#HINT_ID=") ? await withHints(text) : null;
      noteTutorialHints(text);
      const components = await componentViews(s.world, extra.components);
      // Nothing to say (a map event with no text and no reward): no empty box, as in the original.
      if (!(original ?? text).trim() && !components.length) return;
      // Options: a short visit's message as a toast (a story-length text still gets its window).
      if (extra.toast && extraOn("visitToasts") && (original ?? text).length <= 160) return s.hud.showComponents(components, original ?? text);
      return dialog(s.modals, original ?? text, s.color(), { components });
    });
  };

  /**
   * Once everything queued is told (a battle's follow-ups: necromancy, level-ups, the artifacts taken), the queue as
   * it stands by then too: a siege's town opens after them on the adventure map, and the next player's moves wait
   * for them (notes of 2026-11-02 "Siege battle follow-ups... should be on the adventure map, town view opens later",
   * "Enemy turn shouldn't continue until I'm done with the battle follow-ups").
   */
  async settled() {
    for (let i = 0; i < 50; i++) {
      const c = this.chain;
      await c;
      // (A level-up comes up as the battle screen closes: give it the moment to be queued.)
      await new Promise((r) => setTimeout(r, 0));
      if (c === this.chain && !this.levelUpOpen) return;
    }
  }

  private pendingLevelUp() {
    return this.s.state?.heroes.find((x) => !x.removed && x.owner === this.s.me() && x.levelUps?.length);
  }
  showLevelUps() {
    const s = this.s;
    if (this.levelUpOpen || !this.pendingLevelUp()) return;
    this.levelUpOpen = true;
    // After the messages before it, as in the original: the Learning Stone's "+1000 experience"
    // (a Tree of Knowledge's, a Pandora's Box's...) is dismissed first, then the hero levels up.
    this.later(async () => {
      const h = this.pendingLevelUp();
      if (!h) return void (this.levelUpOpen = false);
      const level = h.level - (h.levelUps!.length - 1);
      // (A window that fails must not stop the messages queued after it.)
      const option = await levelUpWindow(s.modals, h, level, h.levelUpPrimary?.[0] ?? 0, h.levelUps![0], s.color(), () => s.panel.openHeroScreen(h.id, true)).catch(() => null);
      this.levelUpOpen = false;
      if (option !== null) s.sendAct({ type: "chooseSkill", hero: h.id, option });
    });
  }

  /**
   * HotA's View Tutorial Messages (the Getting Help hint: "the button in the top-right corner"): the
   * hints this tutorial has shown, by title, in the original's list window; one picked shows again.
   */
  async viewTutorialMessages() {
    const { modals } = this.s;
    const keys = seenTutorialHints();
    const texts = await Promise.all(keys.map((k) => withHints(`#HINT_ID=${k}`)));
    const shown = texts.map((t, i) => ({ text: t, title: said(t.startsWith("#HINT_ID=") ? keys[i] : tutorialTitle(t)) }));
    if (phoneSized()) return void mobileTutorialMessages(modals, shown);
    if (!shown.length) return void dialog(modals, tr("No tutorial messages yet."), this.s.color());
    const i = await objectListWindow(modals, this.s.color(), { title: tr("Tutorial Messages"), description: tr("Select a message to read again."), items: shown.map((x) => x.title) });
    if (i >= 0) await dialog(modals, shown[i].text, this.s.color());
  }
}
