// Player settings, kept in this browser: the game's own (System Options, the combat options), the page's
// (☰ → Settings) and the switches of the additions beyond HotA (EXTRAS, ☰ → Settings → Additions).
import { onPageEnd } from "./pages.ts";
/** Player settings; the additions' switches (EXTRAS) are settings too, by their keys. */
export interface Settings extends Record<Extra, boolean> {
  /** Own heroes' walking speed: 0 slow .. 3 instant. */
  heroSpeed: number;
  /** Enemy heroes: 0 canter, 1 gallop, 2 jump, 3 not shown. */
  enemySpeed: number;
  /** Battle animations: 0 slow, 1 normal, 2 fast (the original's combat options). */
  battleSpeed: number;
  /** Battle animations, fine-tuned on top of the three speed buttons (1: as the buttons say). */
  battleSpeedFine: number;
  /** The battlefield's hex grid (F6 in battle, as VCMI's battleToggleGrid). */
  battleGrid: boolean;
  /** Battle: shade the hexes the active stack can reach (the combat options' Movement Shadow). */
  battleMoveShadow: boolean;
  /** Battle: shade the hex under the pointer and what an action would hit (Cursor Shadow). */
  battleMouseShadow: boolean;
  /** Auto combat (the combat options' Auto-Combat Options): the computer plays these for you; what's
   * unchecked is left to you while it plays the rest (Spells: the hero's spells). */
  autoCreatures: boolean;
  autoSpells: boolean;
  autoCatapult: boolean;
  autoBallista: boolean;
  autoFirstAid: boolean;
  /** Battle: what pointing at a stack says (the combat options' Creature Info): all its stats, only the
   * spells on it, or ("none", both unchecked) only its name. */
  creatureInfo: "all" | "spells" | "none";
  /** Map scrolling: 0 slow .. 2 fast. */
  scrollSpeed: number;
  /** Ask before ending the turn while heroes can still move. */
  moveReminder: boolean;
  /** A click on the map shows the hero's route first, a second click walks it (off: the first click walks). */
  showPath: boolean;
  /** The player's battles are fought by the computer at once; only the results show. */
  quickCombat: boolean;
  /** Campaign prologues and epilogues: their text under the video. */
  subtitles: boolean;
  /** Videos drawn smooth ("high") or as their pixels ("low"). */
  videoQuality: "low" | "high";
  /** The town screen: an outline around the building under the mouse. */
  townOutlines: boolean;
  /** The spellbook's page-turning animation. */
  spellbookAnimation: boolean;
  /** A wide window: the adventure map takes the extra width (HotA), or the original 800 x 600 in the middle. */
  wideScreen: boolean;
  /** Desktops: "fit" enlarges the game to the window; a fixed size shows more of the map in a bigger window. */
  uiSize: "fit" | "large" | "medium" | "small";
  /** Wide screen with big touch buttons: "auto" on touch screens. */
  touchLayout: "auto" | "on" | "off";
  /** A touch screen held upright: laid out upright ("portrait", the default: the map, towns, battles
   * and pages arranged for the tall screen) or small and upright ("off"). "on" (the game turned sideways) only for
   * one page, from ?set=sideways:on (for probes); ☰ → Rotate's turn is ui/screen.ts toggleTurn. */
  sideways: "on" | "off" | "portrait";
  /** Settings' version: 2 made the upright layout the default (older devices kept "on" only as the default then). */
  v: number;
  /** The classic HotA interface: every addition of ours beyond it off at once (each also has its own switch). */
  classic: boolean;
  /** The interface's language ("auto": the player invite's, else the browser's). Only our own texts so far. */
  language: "auto" | import("./i18n/languages.ts").Lang;
  /** Touch screens held sideways: everything used in play within reach of one thumb ("left" / "right"). */
  oneHand: "off" | "left" | "right";
  /** Where the phone's camera (punch hole, notch) is along the screen's top as held upright (☰ → Layouts): the page's
   * own buttons go up into the corners it leaves free. */
  camera: "left" | "middle" | "right";
}

/** Where an addition acts, in the order the Additions window lists its boxes. */
// i18n-keys (the Additions window shows them through `tr`)
export const AREAS = ["Advanced Options and Random Map", "Battle", "Chat", "Creatures", "Feedback", "Game consoles", "Hero list", "Info box", "Load Game", "Loading screen", "Main menu", "Map", "Menu", "Multiplayer", "New Game", "Random Map", "Sieges", "Spells", "Town", "Windows", "Everywhere"] as const;

export interface ExtraDef {
  /** Its short name, as the original's System Options names its switches ("Show Move Path"). */
  name: string;
  area: (typeof AREAS)[number];
  /** What it does, against what the original does (the Additions window's status line). */
  help: string;
  /** Its default (on unless said). */
  on?: boolean;
  /** The owner's alone (2026-10-25: pointing in Feedback): a player neither lists it nor gets it. */
  ownerOnly?: boolean;
  /** It acts only on a touch screen (a mouse-only device doesn't list it). */
  touchOnly?: boolean;
}

/**
 * The interface additions beyond HotA, defined once: the key is its switch (a setting, read with
 * `extra(key)`; "classic" turns them all off), the rest is how the Additions window shows it.
 */
// i18n-keys (the Additions window shows them through `tr`)
export const EXTRAS = {
  speedSlider: { name: "Animation speed slider", area: "Battle", on: false, help: "Battle: fine-tune the animation speed with a slider (Options)" },
  floatNumbers: { name: "Floating damage numbers", area: "Battle", help: "Battle: damage and losses float over the stacks" },
  routeCost: { name: "Movement left at the route's end", area: "Map", help: "Map: movement left at the end of the route" },
  guardedRoute: { name: "Red arrow on a guarded step", area: "Map", on: false, help: "Map: the route's step into a monster's guard (a fight) marked with a red arrow" },
  listGarrisoned: { name: "Garrisoned heroes listed", area: "Hero list", help: "Hero list: garrisoned heroes too (dimmed)" },
  advancedStarts: { name: "Advanced starts", area: "New Game", help: "New Game: advanced starts (mid / late game)" },
  deviceOffer: { name: "Offer another device's newer game", area: "Everywhere", help: "Offer the newer game from another device" },
  otherDevices: { name: "Other devices' games", area: "Load Game", help: "Load Game: your other devices' games too, behind a button (the original lists only this computer's)" },
  visitToasts: { name: "Visit messages as toasts", area: "Map", on: false, help: "Map: short visit messages as toasts, not windows to confirm" },
  statusToasts: { name: "Status line as toasts", area: "Map", on: false, help: "Map (touch): every status line as a toast: what a tap names, the route's cost, visit lines" },
  ambientNearOnly: { name: "Ambient sounds only on a visit", area: "Map", help: "Map: an object's ambient loop only while the selected hero stands at it, on your turn (otherwise every object up to three tiles from the selected hero or town)" },
  railNextHero: { name: "Next hero over End turn", area: "Map", touchOnly: true, help: "Map (touch): the buttons' block is More and Next hero over a wide End turn and the week's days, the spellbook in More's grid, More drawn as tiles (otherwise the spellbook and Adventure Options over End turn)" },
  emptyFindSound: { name: "Empty find sound", area: "Map", help: "Map: an empty sea chest or junk flotsam sounds like bad luck, not like a find" },
  hallCosts: { name: "Costs in a building's popup", area: "Town", help: "Town Hall: a building's right-click (long tap) popup shows what it costs" },
  monsterRange: { name: "Numbers beside a monster's size word", area: "Map", help: "Map: a monster's status-bar size word shows its numbers too (A pack (10-19) of ...)" },
  heroListPanel: { name: "Right-click opens the hero panel", area: "Hero list", help: "Hero list: right-click your hero for the battle's hero panel" },
  trayAvailable: { name: "Tray shows what can be bought", area: "Town", help: "Town: the creature tray shows what can be bought, not only the growth" },
  infoBoxHero: { name: "Click opens the hero screen", area: "Info box", help: "Info box: a click on the selected hero opens the hero screen (the original steps through its views instead)" },
  battleColours: { name: "Coloured targets and hexes", area: "Battle", help: "Battle: the pointed-at target, the spot you'd strike from and spell targets lit in colour, the active stack's hexes gold (the original only shades hexes)" },
  sideCounts: { name: "Stack counts rimmed in the player's colour", area: "Battle", help: "Battle: each stack's count box rimmed in its player's flag colour (grey for monsters), to tell whose is whose in a crowd; the inside keeps the original's spell colours (the original rims them all gold)" },
  flagsOnTop: { name: "Owners' flags never hidden", area: "Map", help: "Map: an owned mine's or dwelling's flag drawn over the mountains and trees in front of it (the original lets them hide it)" },
  routeFightSword: { name: "Crossed swords where a route ends in a fight", area: "Map", help: "Map, touch screens: a route that ends in a battle (a monster, its guard, an enemy hero or town) shows the attack cursor's crossed swords at its end, as the mouse pointer does on a desktop" },
  stopAtNewGuard: { name: "Stop when a monster comes into sight", area: "Map", help: "Map: a hero walking a route with no fight on it stops when a step uncovers a monster whose zone the rest of the route crosses; the route is shown again with the fight on it" },
  padTwoHands: { name: "Touchpad held in both hands", area: "Battle", touchOnly: true, help: "Battle (a phone sideways in both hands): the touchpad on the right, the buttons in a row under it, as one-handed" },
  moveWidgets: { name: "Move the map's panels", area: "Map", touchOnly: true, help: "Map (touch): the more button's Move the panels lets you drag the hero's panel, the hero and town list, the buttons and the resource bar where you want them (kept for each way of holding the phone)" },
  appFullHeight: { name: "Whole screen in the installed app", area: "Everywhere", touchOnly: true, help: "Installed app (phones): the first tap hides the phone's own bars, so the game takes the whole screen" },
  zoomButtons: { name: "Zoom buttons", area: "Map", touchOnly: true, help: "Map (touch): + and − buttons by the map's buttons, to zoom with one thumb" },
  tapOutside: { name: "Tap beside a window", area: "Windows", touchOnly: true, help: "Touch: a tap beside a window closes it as its cancel (Escape) does" },
  townFloating: { name: "Town on phones: floating", area: "Town", on: false, touchOnly: true, help: "Town (phones): the armies, creatures and buttons float over the picture's blurred copy instead of a frame round the picture" },
  oneRecruitWindow: { name: "One recruit window", area: "Town", help: "Town: the fort's Recruit all window lists every dwelling, those with none left too, its counts preset to the most the treasury buys, the strongest first (a dwelling or a creature opens its own window)" },
  holdStays: { name: "Held pop-ups stay", area: "Everywhere", touchOnly: true, help: "Touch: what a held finger shows stays up after the finger lifts, beside the finger, not under it; the next touch takes it away" },
  throughGarrisons: { name: "Walk through your garrisons", area: "Map", help: "Map: a route may run through your own garrisons; your hero walks on instead of stopping there (the original stops at each one)" },
  artifactEffect: { name: "What a map artifact does", area: "Map", help: "Map: an artifact's popup also says what it does, its class and price, and whether your hero can wear it at once" },
  monsterDetails: { name: "A monster's level and kind", area: "Map", help: "Map: a monster's popup also says its level and whether it flies or shoots" },
  arrowsScroll: { name: "Arrow keys scroll the map", area: "Map", help: "Map: the arrow keys scroll the map; Shift + an arrow walks the selected hero a tile (the original walks the hero with the arrows and scrolls with Ctrl + an arrow)" },
  wasdScroll: { name: "W, A, S, D scroll the map", area: "Map", on: false, help: "Map: W, A, S and D scroll the map as the arrows do; their original hotkeys (W wake the hero, A adventure options, S save, D dig) are then only on the buttons" },
  cyclicPortals: { name: "Monoliths' exits in turn", area: "Map", help: "Map: a colour's monoliths and one-way portals send your heroes to their exits one after another, in order across the map, not at random, so you know when you have seen them all" },
  portalLinks: { name: "Where a portal leads", area: "Map", help: "Map: holding (or right-clicking) a monolith, a one-way portal or a subterranean gate draws lines to its exits and entrances you have found, the next one in turn marked" },
  tapObject: { name: "Tap anywhere on an object", area: "Map", help: "Map: a tap on any part of an object walks to its entrance (the original only on the entrance tile itself)" },
  phoneNumbers: { name: "Bigger numbers on phones", area: "Windows", touchOnly: true, help: "Windows (phones): the prices and notes the original writes small (Recruit, Build, Blacksmith, Shipyard, Tavern, Hill Fort) in the medium font" },
  greyedWhy: { name: "Greyed buttons say why", area: "Windows", help: "A tap on a greyed button (build, buy, upgrade, dismiss, trade...) tells why it can't be pressed now" },
  portraitHold: { name: "Hold a portrait for the hero screen", area: "Map", help: "Wherever your hero's portrait shows (the level-up, the hero list, the kingdom...): a long press or right click opens the hero's screen" },
  leaveAsk: { name: "Back asks whether to leave", area: "Map", touchOnly: true, help: "Map (phone's Back): with nothing open, a small question (Main Menu, Quit, Return) instead of System Options" },
  dialogGuard: { name: "Double-tap guard", area: "Windows", help: "Windows: one that opens right after another closed ignores taps for a moment, so a double tap does not skip the next message unread (VCMI)" },
  battleLoupe: { name: "Magnifier under the finger", area: "Battle", touchOnly: true, help: "Battle (touch): drag a finger over the field, or on the one-handed touchpad, and a magnifier shows the hex; lifting the finger acts there" },
  padTips: { name: "Touchpad tips", area: "Battle", touchOnly: true, help: "Battle (touch): the first time the aiming touchpad shows, a short explanation; a faint finger glides over the pad until you have used it, and again when the field is tapped instead" },
  stackPanel: { name: "Stack panel on hover", area: "Battle", help: "Battle (mouse): the pointed-at stack's attack, defence, damage, health, morale, luck, losses and spells in a panel beside the field, as the HD mod's and VCMI's (the original: right-click it)" },
  spellTargets: { name: "Spell targets shaded", area: "Battle", help: "Battle: once a spell is chosen, every stack it can be cast on is shaded (the original shades only the one pointed at)" },
  battleCues: { name: "Arrow over the stack to move", area: "Battle", touchOnly: true, help: "Battle (touch): a gold arrow over the stack to move, its cell in the queue a size up, and a shooter out of arrows shown (its shots left float up as it fires, a crossed-out arrow instead of the shoot cursor)" },
  rmgTemplate: { name: "Choose the template", area: "Random Map", help: "Random Map: choose the template (else one that fits, at random, as the original)" },
  webEmblem: { name: "Remade for the web emblem", area: "Main menu", help: "Main menu and loading screen: \"Remade for the web\" and a desktop, a sideways and an upright phone under the logo" },
  about: { name: "About this remake", area: "Main menu", help: "Main menu: Credits (or a tap on the emblem) first shows what this remake is, that it is independent, and whose work it stands on, with links; the original's credits from its button" },
  backdrops: { name: "Every menu picture in turn", area: "Main menu", help: "Main menu and loading screen: HotA's pictures, its earlier menu's and the original game's, one after another across visits (else HotA's own each time)" },
  continueGame: { name: "Continue", area: "Main menu", help: "Main menu: Continue in the Quick game's place, straight back into the game you were last playing (alone or with friends), shown as in Your games: the map, your town in your colour, your best hero" },
  quickGame: { name: "Quick game", area: "Main menu", help: "Main menu: Quick game, a first game with no setup screens (a Medium map for two, Normal)" },
  rmgRoads: { name: "Choose the roads", area: "Random Map", help: "Random Map: choose the kinds of road, or none (VCMI's option; HotA's templates set roads per passage)" },
  battleUndo: { name: "Undo in battle", area: "Battle", help: "Battle: Undo in Combat Options (or Ctrl+Z) takes the battle back to just before the last move a player made, for a misclick, after asking with the move named; when two players fight, the other one agrees too (the original has no undo)" },
  battleLog: { name: "Battle log on phones", area: "Battle", help: "Battle: on phones a few lines of the log in words, and Menu, then Battle log (or a tap on the lines) opens the whole battle's log to scroll through (the original: the console's two lines and its arrows)" },
  fastAuto: { name: "Auto combat twice as fast", area: "Battle", help: "Battle: auto combat plays twice as fast as the animation speed set (the original plays it at that speed)" },
  listHoverStats: { name: "Movement and spell points on hover", area: "Hero list", help: "Hero list: the pointed-at hero's movement and spell points on the status bar (the original: its name and class)" },
  asyncGames: { name: "Games with friends by notification", area: "Multiplayer", help: "Multiplayer: play by notification with friends, and My games (your games with friends, kept or past a week); Load Game lists only those of other devices' games, and the 3 newest in progress" },
  townExchange: { name: "Exchange button", area: "Town", help: "Town: a button (and on phones a tab) opens the garrison and visiting heroes' exchange window, for their troops and artifacts (the original: the E key only)" },
  installPrompt: { name: "Install card", area: "Main menu", help: "Main menu: a card offers to install the game on the home screen (on an iPhone, how), and the ☰ menu keeps the item" },
  keepMusic: { name: "Music in the background", area: "Everywhere", on: false, help: "Keep the music playing in the background (else it pauses when you switch apps or take a call)" },
  chatRoom: { name: "Chat room", area: "Menu", help: "Menu: the chat room (Polish, English and German rooms as tabs, with an unread dot on ☰)" },
  chatReactions: { name: "Reactions in the chat", area: "Chat", help: "Chat: react to a message or an event (a long press, or ☺ on hover), the reactions counted under it" },
  chatTabs: { name: "Language rooms", area: "Chat", help: "Chat: a room for each of Polish, English and German as tabs (all open to everyone, each player starting in their own; the timeline's lines in every room); off: one room with everything" },
  chatProfiles: { name: "Profiles behind avatars", area: "Chat", help: "Chat: tap an avatar for a player's profile (games played, notes sent, last seen) with an \"Invite to play\" button" },
  deviceVoice: { name: "Voice notes on this device", area: "Feedback", on: false, help: "Feedback: voice notes are turned into words by a speech model on this device (Whisper, a one-time ~100 MB download), not by an online service: they work offline too, and the words come when you finish speaking" },
  pointNote: { name: "Point-and-send mode", area: "Feedback", help: "Feedback: a third mode (long press cycles): tap or circle an element on the screenshot and send, no words needed", ownerOnly: true },
  layoutSwitcher: { name: "Layout previews", area: "Menu", help: "Menu: Layouts…, small previews of the current screen in each layout (upright, sideways, one-handed) to switch with a tap" },
  gateSeeThrough: { name: "See-through gate", area: "Sieges", help: "Sieges: the gate's arch turns see-through while a stack stands in the gateway, so it can be seen and aimed at (the original hides it)" },
  stackBonus: { name: "Stack bonuses", area: "Creatures", help: "Creatures: base value, bonus and total (7 +1 = 8) in their windows, and a list of where the bonuses come from" },
  spellHotkeys: { name: "Spell hotkeys 0-9", area: "Spells", help: "Spells: hotkeys as in the HD mod (in the spellbook press 0-9 over a spell; in battle or on the map that key casts it)" },
  aiPersonality: { name: "Computer players' personalities", area: "Advanced Options and Random Map", help: "Advanced Options and Random Map: each computer player's personality (Warrior, Builder, Explorer; the original takes the map's AI tactic)" },
  gameRules: { name: "Game rules in New Game", area: "New Game", help: "New Game: game rules on the scenario's card and in the multiplayer room (play without Horn of the Abyss content; take back its rule changes: dwellings' stock, arrow towers, the moat, war machines)" },
  iconMenu: { name: "Icon tiles", area: "Menu", help: "Menu: ☰ as one panel of icons (else the list of words)" },
  pageSwap: { name: "Into a game without a reload", area: "Menu", help: "Menu: the main menu gives way to the game (a new game, a saved one, multiplayer, a campaign) without reloading the page, its music going on (off: the page reloads in between)" },
  menuViews: { name: "Views over the game", area: "Menu", help: "Menu: what ☰ opens that isn't the game (the UI catalog, Completeness, the owner's pages) comes up over the game with a tick back to it (off: each is its own page, the game reloads after)" },
  hotSeatSwap: { name: "Hand a colour to the computer", area: "Menu", help: "Menu: in a hot seat game, Players hands a colour to the computer when someone has to leave (or back to a person)" },
  timeline: { name: "Games as timelines", area: "Load Game", help: "Load Game: your games as timelines instead of saved games (points taken by themselves each day and at big happenings; Load lists your games, tap a point to go back, playing on from it makes a branch; off: the classic Save and Load)" },
  followAllies: { name: "Follow allies' turns live", area: "Multiplayer", help: "Multiplayer: while the others move, the view follows your allies live (their walks, the town screen they open, their battles); drag the map to look around freely, then Follow (the info box, or the button by End Turn on a phone) to go back to them" },
  absentFriends: { name: "Allies, caretaker and vacations", area: "Multiplayer", help: "Multiplayer: in games by notification, allied computer colours, a soft turn deadline after which a cautious caretaker plays an absent friend's turn, and vacations" },
  firstSteps: { name: "First steps", area: "Main menu", help: "Main menu: the first Quick game is a small map with a few weak monsters by your town and a checklist of first goals (move, fight, build, recruit, end the turn, send a note)" },
  notifyAsk: { name: "Offer notifications after the first turn", area: "Map", help: "Map: after your first turn ends, offer notifications on this device once (invitations, your turn in games with friends)" },
  loadSteps: { name: "Loading checklist", area: "Loading screen", help: "Loading screen: a live checklist of the real loading steps (spinner, then a tick and the milliseconds; steps that ran side by side are marked as parallel)" },
  padHud: { name: "Big resource bar on a TV", area: "Game consoles", help: "Game consoles: the map's resource bar half as tall again, in the bigger font, the amounts short (1.2k) and the date as three numbers (month, week, day), so it reads from the sofa" },
  padPrompts: { name: "Controller prompts", area: "Game consoles", help: "Game consoles (a PlayStation's browser, ?pad=1): a bar of what the controller's buttons do along the foot of the screen, and each button's glyph beside the on-screen button it presses" },
  netStatus: { name: "Connection status", area: "Everywhere", help: "Everywhere: say when the connection is lost and when it is back, an \"offline\" tag on Feedback with the notes kept on the device, and what needs the connection (the chat, multiplayer, voice notes) greyed, a press saying why" },
  loadingNote: { name: "Loading note in the corner", area: "Everywhere", help: "While game files are still loading (a town, a battle, a window): a small note in the corner names them, with a bar" },
} satisfies Record<string, ExtraDef>;
export type Extra = keyof typeof EXTRAS;

/** Is this addition beyond HotA on? (Its own switch, unless the classic interface is chosen.) */
export const extra = (key: Extra): boolean => !current.classic && current[key];

const DEFAULTS: Settings = {
  ...(Object.fromEntries(Object.entries(EXTRAS).map(([key, e]) => [key, (e as ExtraDef).on ?? true])) as Record<Extra, boolean>),
  heroSpeed: 1, enemySpeed: 1, battleSpeed: 1, battleSpeedFine: 1, battleGrid: true, battleMoveShadow: true, battleMouseShadow: true, autoCreatures: true, autoSpells: true, autoCatapult: true, autoBallista: true, autoFirstAid: true, creatureInfo: "all", scrollSpeed: 1, moveReminder: true, showPath: true, quickCombat: false, subtitles: true, videoQuality: "high", townOutlines: true, spellbookAnimation: true, wideScreen: true, uiSize: "fit", touchLayout: "auto", sideways: "portrait", v: 6, classic: false, language: "auto", oneHand: "off", camera: "middle",
};
let current: Settings = { ...DEFAULTS };
try {
  const stored = JSON.parse(localStorage.getItem("heroes.settings") ?? "{}");
  // Before version 2 "on" (turned sideways) was the default; before 3 a Turn the screen tap that
  // couldn't turn the phone saved it (and every game screen stayed sideways): held upright now means
  // the upright layout. Before 4 the turn note and Layouts… kept "on" too, and every visit opened turned sideways
  // with the phone upright (2026-10-26): the turn is ☰ → Rotate's, for one tab (ui/screen.ts), never kept.
  if ((stored.v ?? 1) < 4 && stored.sideways === "on") stored.sideways = "portrait";
  // Before 5 the red route into a fight was on by default and every saved settings kept it: the original's route
  // (colours by days only) is the default now (2026-10-26: "reproduce that"), the switch stays in Additions.
  if ((stored.v ?? 1) < 5) delete stored.guardedRoute;
  // Before 6 the battle's speed slider (and its "x1") was on by default: the original's three buttons are, the slider
  // stays in Additions (2026-10-27: "what is this 1x slider doing here"); its fine speed goes back to 1.
  if ((stored.v ?? 1) < 6) (delete stored.speedSlider), (stored.battleSpeedFine = 1);
  current = { ...DEFAULTS, ...stored, v: 6 };
} catch {
  // defaults
}
/** What's kept (current without this page's own settings). */
let kept: Settings = { ...current };
// "?set=oneHand:right,sideways:portrait": settings for this page only, not kept (probes).
for (const pair of (new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("set") ?? "").split(",").filter(Boolean)) {
  const [key, value] = pair.split(":");
  if (key in DEFAULTS) (current as unknown as Record<string, unknown>)[key] = value === "true" ? true : value === "false" ? false : Number.isNaN(Number(value)) ? value : Number(value);
}

export function settings(): Settings {
  return current;
}

/** Runs `fn` with these settings in force, quietly (no listener hears it) until it is done; the layout previews' way to lay a screen out as another layout would. */
export async function withSettings<T>(patch: Partial<Settings>, fn: () => Promise<T>): Promise<T> {
  const before = current;
  current = { ...current, ...patch };
  try {
    return await fn();
  } finally {
    current = before;
  }
}

const listeners = new Set<() => void>();

/** Calls `fn` whenever a setting changes; returns what stops it. */
export function onSettings(fn: () => void): () => void {
  listeners.add(fn);
  // (Made by a page: it goes with it, pages.ts.)
  const forget = onPageEnd(() => listeners.delete(fn));
  return () => (forget(), listeners.delete(fn));
}

/** Changes a setting; `keep` false: for this page only (a reload forgets it). */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K], keep = true) {
  current = { ...current, [key]: value };
  if (!keep) return void [...listeners].forEach((fn) => fn());
  kept = { ...kept, [key]: value };
  try {
    localStorage.setItem("heroes.settings", JSON.stringify(kept));
  } catch {
    // not persisted
  }
  for (const fn of [...listeners]) fn();
}

/**
 * Milliseconds per tile for a walking hero (0: jump). The System Options' buttons: own heroes walk,
 * canter, gallop or jump; enemy heroes canter, gallop or jump (or aren't shown: enemyMovesShown).
 */
export function msPerTile(own: boolean): number {
  return own ? [200, 110, 60, 0][current.heroSpeed] ?? 110 : [110, 60, 0, 0][current.enemySpeed] ?? 110;
}

/** Enemy heroes' moves are shown (System Options' fourth enemy speed: "Do not show enemy movement"). */
export function enemyMovesShown(): boolean {
  return current.enemySpeed !== 3;
}

/** Auto combat is playing our side (the battle view says so). */
let autoCombat = false;
export function setAutoCombat(on: boolean) {
  autoCombat = on;
}

/** How much faster than normal battle animations and pauses run (twice that under auto combat, an extra). */
/**
 * The battle's animation speed, times normal (battle/anim/pace.ts): the three buttons are VCMI's speed factors
 * 1 / 2 / 3 measured from the original (slow half as fast, fast one and a half times), then the extras on top.
 */
export function battleSpeed(): number {
  return ([0.5, 1, 1.5][current.battleSpeed] ?? 1) * (extra("speedSlider") ? current.battleSpeedFine || 1 : 1) * (autoCombat && extra("fastAuto") ? 2 : 1);
}
