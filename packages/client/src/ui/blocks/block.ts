// The standard pieces the views are built from (2026-10-27: "evidence that this view is built from standard
// components: it lists the components I see, each component's page links back to every view it is in; that's evidence
// the experience is consistent"). Each piece marks what it draws with `block(node, id)`; the UI tree the feedback bundle
// and the catalog read carries the mark (feedback/bundle.ts uiTree), the catalog build records which pieces each view
// draws in each layout (catalog/blocks.json), and the Wiki makes a page per piece with the views it was seen on.
// Two pieces for one kind of thing (two status bars) is a finding, not a fault in the list: they share a `term`, and
// the term's page says it is made more than one way.
import type { Container } from "pixi.js";

export interface BlockInfo {
  title: string;
  /** What it is, for a player. */
  what: string;
  /** Where it is made (packages/client/src/...). */
  file: string;
  /** The vocabulary's word for the kind of thing it is (catalog/vocabulary.ts), when it has one. */
  term?: string;
  /** Drawn only in a moment no catalog view holds still (a panel opened by a tap, a fallback without the art): said on its page. */
  when?: string;
}

export const BLOCKS = {
  button: { title: "Button", what: "A picture button from the game's own art: up, pressed, greyed and highlighted faces.", file: "ui/kit.ts DefButton", term: "button" },
  wordButton: { title: "Word button", what: "Our own word on the original's blank button, where the game has no art for that word.", file: "ui/kit.ts textButton", term: "blank word button" },
  goldWordButton: { title: "Gold word button", what: "The options windows' engraved gold buttons.", file: "ui/blocks/menuBlocks.ts gspButton", term: "gold word button" },
  dialog: { title: "Message window", what: "The window that says or asks something: its words, pictures under them, its buttons.", file: "ui/dialogs.ts messageWindow", term: "dialog" },
  windowRim: { title: "Window rim", what: "The original windows' gold-trimmed rim in the player's colour, around any size of window.", file: "ui/blocks/windowParts.ts windowRim", term: "window" },
  leatherWindow: { title: "Phone window", what: "A phone window: the leather ground inside the window rim.", file: "ui/blocks/phoneWindow.ts leatherWindow", term: "window" },
  colourWindow: { title: "Phone town panel", what: "A phone town panel: the owner's colour inside the window rim, its places leather in gold, as the desktop's town panel.", file: "ui/blocks/phoneWindow.ts colourWindow", term: "window" },
  townPanel: { title: "Town panel ground", what: "The town screen's panel ground and frame, reused by windows that want its look.", file: "ui/blocks/windowParts.ts townPanel", term: "panel" },
  advPanel: { title: "Adventure panel", what: "The adventure map's panel ground in the player's colour.", file: "ui/blocks/advFrame.ts advPanel", term: "panel" },
  advRim: { title: "Adventure rim", what: "The adventure map's thin rim round a panel.", file: "ui/blocks/advFrame.ts advRim", term: "panel" },
  advOrnate: { title: "Ornate frame", what: "The adventure map's ornate frame with its corner knots.", file: "ui/blocks/advFrame.ts advOrnate", term: "window", when: "only without the window rim's art (a stand-in for it)" },
  resourceBar: { title: "Resource bar", what: "The seven resources and their amounts, with the date where there is room.", file: "ui/blocks/resourceBar.ts ResourceBar", term: "resource bar" },
  treasury: { title: "Treasury panel", what: "Resources with their daily income, as the kingdom overview shows them.", file: "ui/blocks/resourceBar.ts treasuryPanel", term: "resource bar", when: "on a phone, for a few seconds after a tap on the resource bar (map or town)" },
  armySlots: { title: "Army slots", what: "A row or grid of army slots: unit portraits, counts, the picked one framed.", file: "ui/blocks/stackGrid.ts StackGrid", term: "army slot" },
  slider: { title: "Slider", what: "A bar with a knob to drag and an arrow at each end.", file: "ui/blocks/slider.ts Slider", term: "slider" },
  heroHead: { title: "Hero heading", what: "A hero's portrait, name and level as the hero screen shows them.", file: "ui/blocks/heroBlocks.ts heroHead" },
  heroSkills: { title: "Hero's skills", what: "Primary skills, experience, spell points, morale, luck and the secondary skills.", file: "ui/blocks/heroBlocks.ts heroSkills", term: "skill icon" },
  heroDoll: { title: "Paper doll", what: "The hero's worn artifacts on the figure, and the backpack.", file: "ui/blocks/heroBlocks.ts heroDoll", term: "artifact icon" },
  exchangeHead: { title: "Meeting heading", what: "One hero's banner, portrait and morale and luck when two heroes meet.", file: "ui/blocks/exchangeBlocks.ts exchangeHead" },
  exchangeSkills: { title: "Meeting skills", what: "A hero's secondary skills in a row, when two heroes meet.", file: "ui/blocks/exchangeBlocks.ts exchangeSkills", term: "skill icon" },
  exchangePrimaries: { title: "Meeting primary skills", what: "The two heroes' primary skills side by side.", file: "ui/blocks/exchangeBlocks.ts exchangePrimaries", term: "skill icon" },
  heroPrimaries: { title: "Meeting primary skills, upright", what: "One hero's four primary skills beside its head, when two heroes meet on an upright phone.", file: "ui/blocks/exchangeBlocks.ts heroPrimaries", term: "skill icon" },
  trade: { title: "Trade layout", what: "Your side, their side and the deal: the marketplace's and the trading posts' shape.", file: "ui/blocks/tradePanel.ts tradeLayout", term: "resource icon" },
  townStatus: { title: "Town status bar", what: "The town screen's line at the foot that names what the pointer is over.", file: "town/panel.ts", term: "status bar" },
  mapStatus: { title: "Map status bar", what: "The adventure map's line under the map that names what the pointer is over.", file: "map/hud.ts", term: "status bar" },
} as const satisfies Record<string, BlockInfo>;
export type BlockId = keyof typeof BLOCKS;

/** Marks `c` as drawn by the standard piece `id` (it shows on the piece's Wiki page as a view it is in). */
export function block<T extends Container>(c: T, id: BlockId): T {
  (c as T & { uiBlock?: BlockId }).uiBlock = id;
  return c;
}
