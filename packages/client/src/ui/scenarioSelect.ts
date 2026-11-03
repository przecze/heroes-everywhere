// The original "New Game" scenario selection screen: the scenario list (SCSELBCK) on the left,
// the scenario card (GSELPOP1) with name, description, victory and loss conditions, allies and
// enemies, and the difficulty buttons on the right. Layout after VCMI's SelectionTab / InfoCard.
// The same window loads and saves games (saved games listed, SCNRLOD / SCNRSAV, a name strip).
// Its setup state and rules are newGameModel.ts's (the touch screens' New Game, mobileNewGame.ts, draws the same).
import { townName } from "../i18n/towns.ts";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { loadDef, loadImage, loadPng, townIcon } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { barButton } from "./mobilePage.ts";
import { DefButton, helpRow, hoverHelp, label, loadButtonHelp, withHelp } from "./kit.ts";
import { type Modals } from "./modals.ts";
import { messageBox, textPopup } from "./dialogs.ts";
import { FACTIONS, TOWNS, RANDOM_MAP_SIZES, rmgIndex, rmgTemplateFacts, rmgTitle } from "@heroes/core";
import { heroPortrait } from "../assets.ts";
import { originalWords, resolveText, textTable } from "./gameText.ts";
import { loadData } from "../gameData.ts";
import { extra } from "../settings.ts";
import { formatIcon, hotaContentCheck, pickHero, pickTown, rulesScroll, setHotaContent, startHeroes, startTowns } from "./blocks/setupBlocks.ts";
import { tr, said, fmt, type Text, fallback } from "../i18n/index.ts";
import { rowSwipe } from "./blocks/rowSwipe.ts";
import {
  BONUS_NAMES, DEFAULT_DIFFICULTY, FLAG_LETTERS, HANDICAPS, type InfoPicks, type MapInfo, RATINGS, RandomMapSetup, type ScenarioChoice, SetupOptions, SIZES, SIZE_FILTERS,
  type SortKey, TURN_MINUTES, bonusFrame, firstChoice, hotaLock, keptOnTop, putRandomMap, resourceOf, scenarioChoice, setTown, setTurnStep, sortedMaps, stepBonus,
  stepHandicap, stepHero, stepPersonality, stepTown, toggleHuman, turnStep,
} from "./newGameModel.ts";
import { PERSONALITY_HELP, RANDOM_AI_HELP, difficultyNames, newGameBackdrop, personalityName, templatedMapInfo, textLines, turnMinutesName } from "./newGameParts.ts";

const ROWS_ALL = 18;

export async function scenarioSelect(modals: Modals, maps: MapInfo[], current?: string, heroNames: string[] = [], mode: "new" | "load" | "save" | "info" = "new", saveName = "", cardFallback?: MapInfo, infoDifficulty = 1, infoPicks?: InfoPicks, overMenu = false): Promise<ScenarioChoice | null> {
  const ROWS = mode === "save" ? ROWS_ALL - 2 : ROWS_ALL;
  let typed = saveName;
  // The buttons' rollover and right-click texts are HELP.TXT's (VCMI's zelp numbers); ours without it.
  await loadButtonHelp().catch(() => {});
  const help = <T extends DefButton>(b: T, row: number, ours: string): T => withHelp(b, row, ours);
  // The screen's fixed words as the game's files have them (GENRLTXT, VCMI's numbers: HotA's own file
  // reads "Map Rating:", "Difficulty Level", "Score" where SoD's had "Map Diff:"...).
  const W = await originalWords("genrltxt", {
    "Advanced Options": 515, "Advanced options, explained": 516, "Player Name": 517,
    "Starting Town": 518, "Starting Hero": 519, "Starting Bonus": 520, "Player Turn Duration": 521, Random: 522,
    "Scenario Name:": 495, "Scenario Description:": 496, "Victory Condition:": 497, "Loss Condition:": 498, Allies: 390, Enemies: 391,
    "Map Diff:": 494, "Player Difficulty:": 492, "Rating:": 218, "Map Sizes": 510, "Show Advanced Options": 501, "Show Available Scenarios": 500, "Random Map": 740,
  });
  // The list's title (ARRAYTXT 229-231).
  const A = await originalWords("arraytxt", { "Select a Scenario to Play": 229, "Select a Saved Game to Load": 230, "Select a Saved Game": 231 });
  const diffNames = await difficultyNames();
  const win = new Container();
  const [bg, card, listBg, sizeIcons, victIcons, lossIcons, flags, vc, lc] = await Promise.all([
    // HotA's nine backgrounds (one a day), else the original's.
    overMenu || mode === "info" ? Promise.resolve(Texture.EMPTY) : loadPng(newGameBackdrop()).catch(() => loadImage("gamselb0.pcx")),
    loadImage("gselpop1.pcx"),
    loadImage("scselbck.pcx"),
    loadDef("scnrmpsz.def"),
    loadDef("scnrvict.def"),
    loadDef("scnrloss.def"),
    loadDef("itgflags.def"),
    textLines("vcdesc.txt"),
    textLines("lcdesc.txt"),
  ]);
  // Opened from the main menu, the window's pieces sit over the menu's own picture (as HotA's New
  // Game over its main menu, the music going on), and the game's scenario information over the
  // adventure map (VCMI's CScenarioInfoScreen has no picture of its own); elsewhere HotA's backdrop behind them.
  win.addChild(overMenu || mode === "info" ? new Graphics().rect(0, 0, 800, 600).fill({ color: 0, alpha: 0.001 }) : new Sprite(bg));
  const frame = (d: typeof sizeIcons, i: number) => d.get(0)?.[i]?.texture;
  // Size filter (0 = all) and sort column, as the original's toggle and header buttons.
  let sizeFilter = 0;
  let sortBy: SortKey = "name";
  const sorted: MapInfo[] = [];
  const resort = (keep?: string) => {
    // (Loading: this device's games, as the original's list; other devices' (cloud:) behind their button.)
    sorted.splice(0, sorted.length, ...sortedMaps(maps, { sizeFilter, sortBy }, (m) => mode !== "load" || !hasOthers || m.file.startsWith("cloud:") === showOthers));
    chosen = firstChoice(sorted, keep);
    top = Math.max(0, Math.min(chosen - Math.floor(ROWS / 2), sorted.length - ROWS));
  };
  let chosen = 0;
  let top = 0;
  const hasOthers = mode === "load" && maps.some((m) => m.file.startsWith("cloud:"));
  /** Loading: other devices' games shown instead of this one's (none here: those straight away). */
  let showOthers = hasOthers && !maps.some((m) => !m.file.startsWith("cloud:"));
  resort(current);
  // Opened with the advanced starts in sight (the map played last stays chosen, further down).
  if (sorted.some((m) => keptOnTop(m.file))) top = 0;
  // Scenario information (I): the game's own difficulty, not to be changed.
  let difficulty = mode === "info" ? infoDifficulty : DEFAULT_DIFFICULTY;
  /** Left side: the scenario list, the advanced options, or nothing. */
  // (Scenario information shows the game's own picks, read-only, as VCMI's CScenarioInfoScreen.)
  let panel: "list" | "options" | "random" | "none" = mode === "info" ? (infoPicks ? "options" : "none") : "list";
  // Advanced options per colour, reset when another scenario is picked.
  // Hot seat: several colours may be human, taking turns at this one screen.
  const setup = new SetupOptions(mode === "info" && infoPicks && current ? { file: current, humans: [infoPicks.human], ...infoPicks } : undefined);
  const optionsFor = (m: MapInfo) => setup.for(m);

  // ---- scenario list ---------------------------------------------------------
  const list = new Container();
  list.position.set(0, 6);
  win.addChild(list);
  /** Bumped by every redraw: an older one still loading images stops instead of drawing twice. */
  let drawGen = 0;
  const drawList = () => {
    const gen = ++drawGen;
    list.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (panel === "options") return void drawOptions();
    if (panel === "random") return void drawRandom();
    if (panel !== "list") return;
    list.addChild(new Sprite(listBg));
    // (VCMI's SelectionTab: the title and "Map Sizes" CENTER labels on their points.)
    // (EXTRAS asyncGames: Load Game is where games with friends are carried on too, so it says so.)
    const title = mode === "load" && extra("asyncGames") ? tr("Your games") : A(mode === "load" ? "Select a Saved Game to Load" : mode === "save" ? "Select a Saved Game" : "Select a Scenario to Play");
    const head = label(title, "medfont", YELLOW).centreOn(205, 28);
    list.addChild(head);
    list.addChild(label(W("Map Sizes"), "smalfont", YELLOW).centreOn(87, 62));
    // Size filters (S, M, L, XL, All): the chosen one stays pressed.
    ["scsmbut", "scmdbut", "sclgbut", "scxlbut", "scalbut"].forEach((d, i) => {
      const size = SIZE_FILTERS[i];
      // (VCMI's SelectionTab places these from the list's picture, SCSELBCK, which has them drawn in.)
      const b = new DefButton(`${d}.def`, 158 + 47 * i, 46, -1, size === sizeFilter ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      help(b, 54 + i, size ? `Show only ${["small", "medium", "large", "extra large"][i]} maps.` : "Show all maps.");
      b.onClick = () => {
        sizeFilter = size;
        resort(sorted[chosen]?.file);
        drawList();
        drawCard();
      };
      list.addChild(b);
    });
    // Column headers sort the list.
    ([["scbutt1", 23, "players"], ["scbutt2", 55, "size"], ["scbutcp", 88, "format"], ["scbutt3", 121, "name"], ["scbutt4", 306, "victory"], ["scbutt5", 339, "loss"]] as const).forEach(([d, x, by], i) => {
      const b = help(new DefButton(`${d}.def`, x, 86), 107 + i, `Sort by ${by}.`);
      b.onClick = () => {
        sortBy = by;
        resort(sorted[chosen]?.file);
        drawList();
        drawCard();
      };
      list.addChild(b);
    });
    for (let i = 0; i < ROWS && top + i < sorted.length; i++) {
      const m = sorted[top + i];
      const y = 123 + i * 25 - 6;
      const color = top + i === chosen ? YELLOW : WHITE;
      const row = new Container();
      row.position.set(24, y);
      row.addChild(new Graphics().rect(0, 0, 350, 24).fill({ color: 0, alpha: 0.001 }));
      const humans = m.players.filter((p) => p.human).length;
      const total = m.players.filter((p) => p.human || p.computer).length;
      // (VCMI's ListItem at 30, 129 + 25 * i: CENTER labels on 8, 41 and 184 from there, the icons 12 above.)
      const players = label(fmt`${humans}/${total}`, "smalfont", color).centreOn(8 + 6, 12);
      const size = label(said(SIZES[m.size]?.[0]) ?? said("C"), "smalfont", color).centreOn(41 + 6, 12);
      // One line, clipped to the column.
      const full = m.title ?? (said(m.name) || said(m.file.replace(/\.h3m$/i, "")));
      let name = label(full, "smalfont", color, "center", 185);
      for (let n = full.length - 1; name.height > 16 && n > 0; n--) {
        name.destroy();
        name = label(said(full.slice(0, n) + "..."), "smalfont", color, "center", 185);
      }
      // (One line: the label's own width, centred on the column's point.)
      const cut = name.value;
      name.destroy();
      name = label(cut, "smalfont", color).centreOn(184 + 6, 12);
      row.addChild(players, size, name);
      // (Its format: SCSELC's, HotA's horn for a HotA map.)
      void formatIcon(m).then((fmt) => fmt && !row.destroyed && gen === drawGen && row.addChild(Object.assign(new Sprite(fmt), { x: 59 + 6 - Math.max(0, Math.round((fmt.width - 25) / 2)), y: 0 })));
      const v = frame(victIcons, m.victory < 0 ? 11 : m.victory);
      if (v) row.addChild(Object.assign(new Sprite(v), { x: 277 + 6, y: 0 }));
      const l = frame(lossIcons, m.loss < 0 ? 3 : m.loss);
      if (l) row.addChild(Object.assign(new Sprite(l), { x: 310 + 6, y: 0 }));
      row.label = `row: ${full}`;
      row.eventMode = "static";
      row.cursor = "pointer";
      const at = top + i;
      row.on("pointertap", () => {
        if (swipe.moved()) return;
        if (chosen === at) return finish();
        chosen = at;
        if (mode === "save") typed = sorted[at].title ?? typed;
        drawList();
        drawCard();
      });
      // Right button held: the map's name and file (VCMI's CMapOverview, without its picture and author), as the original's popups.
      if (mode !== "save") row.on("rightdown", (e) => void textPopup(/\.h3m$/i.test(m.file) ? fmt`${m.title ?? said(m.name)}\n${said(m.file)}` : (m.title ?? said(m.name)), 0, e.global.x, e.global.y));
      list.addChild(row);
    }
    // The slider beside the rows (VCMI's blue CSlider at 372, 86: the arrows, the knob between).
    const length = mode === "save" ? 430 : 480;
    const most = Math.max(0, sorted.length - ROWS);
    const up = new DefButton("scnrbup.def", 372, 86);
    up.onClick = () => scrollTo(top - 1);
    const down = new DefButton("scnrbdn.def", 372, 86 + length - 16);
    down.onClick = () => scrollTo(top + 1);
    const track = new Graphics().rect(372, 86 + 16, 16, length - 32).fill({ color: 0, alpha: 0.001 });
    track.eventMode = "static";
    track.on("pointerdown", (e) => {
      const y = list.toLocal(e.global).y;
      scrollTo(y < knobY() ? top - ROWS : top + ROWS);
    });
    const knobY = () => 86 + 16 + (most ? Math.round((top / most) * (length - 48)) : 0);
    list.addChild(track, up, down);
    if (most) {
      void loadDef("scnrbsl.def").then((d) => {
        const f = d.get(0)?.[0];
        if (!f || list.destroyed || gen !== drawGen) return;
        const knob = Object.assign(new Sprite(f.texture), { x: 372, y: knobY(), eventMode: "static" as const, cursor: "pointer" });
        knob.on("pointerdown", (e) => {
          e.stopPropagation();
          knobDrag = { length };
        });
        list.addChild(knob);
      });
    }
    // Saving: the name strip under the list.
    if (mode === "save") {
      void loadImage("gsstrip.pcx").then((strip) => {
        if (panel !== "list" || list.destroyed) return;
        list.addChildAt(Object.assign(new Sprite(strip), { x: 0, y: 514 }), 1);
      });
      nameText = label(said(typed + "_"), "smalfont", WHITE, "center", 350);
      nameText.position.set(32, 539 + 4);
      list.addChild(nameText);
    }
  };
  let nameText: ReturnType<typeof label> | null = null;
  // ---- advanced options -------------------------------------------------------
  const drawOptions = async () => {
    const gen = drawGen;
    const m = sorted[chosen];
    if (!m) return;
    const o = optionsFor(m);
    const [optBg, stars, gen0] = await Promise.all([loadImage("advoptbk.pcx"), loadDef("scnrstar.def"), textTable("genrltxt")]);
    if (panel !== "options" || gen !== drawGen) return;
    list.removeChildren().forEach((c) => c.destroy({ children: true }));
    list.addChild(new Sprite(optBg));
    // (VCMI's positions are CENTER points on the tab, whose picture sits 6 below its top: 6 up here.)
    const centred = (text: Text, x: number, y: number, width: number, font: "tiny" | "smalfont" | "bigfont" = "smalfont", color: readonly [number, number, number] = WHITE) => {
      list.addChild(label(text, font, color, "center", width).centreOn(x, y - 6));
    };
    centred(W("Advanced Options"), 222, 36, 300, "bigfont", YELLOW);
    // (VCMI's OptionsTab: the column titles centred in their boxes of ADVOPTBK, two lines high.)
    centred(W("Advanced options, explained"), 220, 66, 320);
    centred(W("Player Name"), 108, 108, 100, "smalfont", YELLOW);
    centred(W("Starting Town"), 198, 108, 70, "smalfont", YELLOW);
    centred(W("Starting Hero"), 274, 108, 70, "smalfont", YELLOW);
    centred(W("Starting Bonus"), 350, 108, 70, "smalfont", YELLOW);
    // The turn timer under the rows: VCMI's blue CSlider at 55, 551 (194 wide; its arrows are in the
    // picture), the steps 1 .. 30 minutes then Unlimited, the choice's name beside it.
    centred(W("Player Turn Duration"), 222, 544, 200, "smalfont", YELLOW);
    centred((turnMinutesName(o.turnMinutes)), 319, 565, 120);
    {
      const at = turnStep(o);
      const set = (i: number) => (setTurnStep(o, i), drawList());
      const knobX = (i: number) => 55 + 16 + Math.round((i * (194 - 48)) / (TURN_MINUTES.length - 1));
      const knob = (await loadDef("scnrbsl.def")).get(0)?.[0];
      if (panel !== "options" || gen !== drawGen) return;
      if (knob) list.addChild(Object.assign(new Sprite(knob.texture), { x: knobX(at), y: 551 }));
      if (mode !== "info") {
        const help = tr("{Player Turn Duration}\n\nHow long each human player's turn may last; when it runs out the turn ends.");
        const zone = (x: number, w: number, click: (lx: number) => void) => {
          const z = new Graphics().rect(0, 0, w, 16).fill({ color: 0, alpha: 0.001 });
          z.position.set(x, 551);
          z.eventMode = "static";
          z.cursor = "pointer";
          z.on("pointertap", (e) => e.button === 0 && click(z.toLocal(e.global).x));
          hoverHelp(z, () => ({ hover: tr("Player Turn Duration"), help }));
          list.addChild(z);
        };
        zone(55, 16, () => set(at - 1));
        zone(55 + 194 - 16, 16, () => set(at + 1));
        // The bar between: the step nearest the tap.
        zone(55 + 16, 194 - 32, (lx) => set(Math.round(((lx - 8) * (TURN_MINUTES.length - 1)) / (194 - 48))));
      }
    }
    /** The right-click on a town, hero or bonus box: {title}, what it is, what is picked (the game's own lines, ours without them). */
    const boxTip = (box: Container, title: number, desc: number, subtitle: string) => {
      const place = box.parent ? box : list.addChild(box);
      place.addChild(new Graphics().rect(0, 0, 58, 50).fill({ color: 0, alpha: 0.001 }));
      place.eventMode = "static";
      const t = gen0(title, said("")).trim();
      hoverHelp(place, () => ({ hover: said(subtitle.split("\n")[0]), help: said(`${t ? `{${t}}\n\n` : ""}${gen0(desc, said("")).trim()}\n\n${subtitle}`.trim()) }));
    };
    let row = 0;
    for (const [color, p] of m.players.entries()) {
      if (!p.human && !p.computer) continue;
      const y = 128 + 50 * row++ - 6;
      const pick = o.picks[color];
      const panelBg = await loadImage(`adop${FLAG_LETTERS[color]}pnl.pcx`).catch(() => null);
      if (panel !== "options" || gen !== drawGen) return;
      if (panelBg) list.addChild(Object.assign(new Sprite(panelBg), { x: 54, y }));
      if (p.human && mode !== "info") {
        const flag = new DefButton(`aoflgb${FLAG_LETTERS[color]}.def`, 54 - 43, y + 2);
        help(flag, 180, tr("Human or computer: several humans take turns at this screen (hot seat)."));
        flag.onClick = () => {
          // A human colour back to the computer (one human stays), a computer's to a human.
          if (toggleHuman(m, o, color)) return void (extra("greyedWhy") && messageBox(modals, tr("One colour at least is played by a human."), color));
          drawList();
        };
        list.addChild(flag);
      }
      // A computer's personality (an addition: the original takes the map's AI tactic): the town / hero / bonus
      // boxes' own arrows at the name plate's ends step through them (a bare name read as a label: the owner, 11-02),
      // and so does a click on the name.
      if (!o.humans.includes(color) && extra("aiPersonality")) {
        const step = (dir: number) => (stepPersonality(pick, dir), drawList());
        const box = new Container({ label: `personality: ${FLAG_LETTERS[color]}` });
        box.position.set(54 + 55 - 47, y + 6);
        box.addChild(new Graphics().rect(0, 0, 94, 18).fill({ color: 0, alpha: 0.001 }));
        const editable = mode !== "info";
        box.addChild(label(personalityName(pick.personality), "smalfont", pick.personality ? YELLOW : WHITE, "center", editable ? 70 : 94).centreOn(47, 10 - 6 + 6));
        if (editable) {
          box.eventMode = "static";
          box.cursor = "pointer";
          box.on("pointertap", (e) => e.button === 0 && step(1));
        }
        hoverHelp(box, () => ({ hover: personalityName(pick.personality), help: tr(PERSONALITY_HELP) }));
        list.addChild(box);
        if (editable) {
          // (ADOPLFA / ADOPRTA are 23 high, the plate 18: shrunk to it, as small as the plate's own text.)
          const k = 18 / 23;
          const l = new DefButton("adoplfa.def", 54 + 55 - 47 + 1, y + 6);
          const r = new DefButton("adoprta.def", 54 + 55 + 47 - 1, y + 6);
          void r.ready.then(() => (r.x -= r.width));
          for (const [b, dir] of [[l, -1], [r, 1]] as const) {
            b.scale.set(k);
            b.hint = dir < 0 ? tr("Previous") : tr("Next");
            b.help = tr(PERSONALITY_HELP);
            b.onClick = () => step(dir);
            list.addChild(b);
          }
        }
      } else centred(o.humans.includes(color) ? tr("Human") : tr("Computer"), 54 + 55, y + 10 + 6, 95);
      centred(p.human ? tr("Human or CPU") : tr("CPU Only"), 54 + 28, y + 34 + 6, 45, "tiny");
      // The handicap beside it (VCMI's 55, 23, 46 x 24): a click steps No / Mild / Severe.
      {
        const box = new Container();
        box.position.set(54 + 53, y + 23);
        box.addChild(new Graphics().rect(0, 0, 50, 24).fill({ color: 0, alpha: 0.001 }));
        box.addChild(label(tr(HANDICAPS[pick.handicap ?? 0]), "tiny", WHITE, "center", 46).centreOn(25, 12));
        if (mode !== "info") {
          box.eventMode = "static";
          box.cursor = "pointer";
          box.on("pointertap", (e) => {
            if (e.button !== 0) return;
            stepHandicap(pick);
            drawList();
          });
        }
        const help = tr("{Handicap}\n\nA smaller start for this player. Mild: 15% less to start with and from each day's income; Severe: 30% less.");
        hoverHelp(box, () => ({ hover: tr(HANDICAPS[pick.handicap ?? 0]), help }));
        list.addChild(box);
      }
      // Town: only a random main town can be chosen (HotA's greyed while its content is off).
      const towns = startTowns(m, color, o);
      const allowed = towns.filter((t) => !t.why).map((t) => t.faction);
      const town = new Container({ label: `town: ${FLAG_LETTERS[color]}` });
      town.position.set(54 + 119, y + 2);
      const fi = pick.faction ? FACTIONS.indexOf(pick.faction) : -1;
      // A random town: ITPA's own picture for it (ITPRAND, the last frame), as VCMI's TOWN_RANDOM.
      const tf = fi >= 0 ? await townIcon(fi, true, false, "small") : ((await loadDef("itpa.def")).get(0)?.[38]?.texture ?? null);
      if (panel !== "options" || gen !== drawGen) return;
      if (tf) town.addChild(new Sprite(tf));
      else centred(W("Random"), 54 + 119 + 24, y + 18 + 6, 48, "tiny");
      list.addChild(town);
      // (The boxes' names: VCMI's SelectedBox subtitle, a CENTER label 23, 39 into the box at 2 down.)
      centred(pick.faction ? townName(pick.faction) : tr("Random"), 54 + 142, y + 41 + 6, 70, "tiny");
      // The arrows' own texts (HELP.TXT 132 / 133, 148 / 149, 164 / 165, as VCMI's zelp) and, on the boxes,
      // the right-click window of VCMI's CPlayerOptionTooltipBox: its title, what it is, what is picked.
      const arrows = (x: number, enabled: boolean, step: (dir: number) => void, rows: [number, number]) => {
        if (!enabled || mode === "info") return;
        const l = help(new DefButton("adoplfa.def", 54 + x, y + 5), rows[0], tr("Previous"));
        l.onClick = () => (step(-1), drawList());
        const r = help(new DefButton("adoprta.def", 54 + x + 61, y + 5), rows[1], tr("Next"));
        r.onClick = () => (step(1), drawList());
        list.addChild(l, r);
      };
      // A chosen town says which creatures it brings (as the phone's list does); a random one, what random means.
      const roster = fi >= 0 ? (await loadData().catch(() => null))?.creatures : undefined;
      const brings = roster ? (TOWNS[fi]?.creatures ?? []).slice(0, 7).map(([base]) => roster[base]?.name).filter(Boolean).join(", ") : "";
      boxTip(town, pick.faction ? 80 : 103, 104, pick.faction ? `${townName(pick.faction)}${brings ? `\n${brings}` : ""}` : tr("Random"));
      arrows(107, allowed.length > 1, (dir) => stepTown(pick, allowed, dir), [132, 133]);
      // A click on the town: HotA's grid of the towns to pick from (the right button there: a town's creatures).
      if (towns.length && mode !== "info") {
        town.cursor = "pointer";
        town.on("pointertap", (e) => e.button === 0 && void pickTown(modals, towns, pick.faction, color).then((r) => r && setTown(pick, r.faction) && drawList()));
      }
      // Hero: one of the town's heroes, or random.
      const heroList = startHeroes(pick.faction, o);
      const heroes = heroList.filter((h) => !h.why).map((h) => h.hero);
      const portrait = pick.hero >= 0 ? await heroPortrait(pick.hero, "small").catch(() => null) : await loadImage("hpsrand.pcx");
      if (panel !== "options" || gen !== drawGen) return;
      if (portrait) list.addChild(Object.assign(new Sprite(portrait), { x: 54 + 195, y: y + 2 }));
      const heroBox = list.addChild(new Container({ label: `hero: ${FLAG_LETTERS[color]}`, x: 54 + 195, y: y + 2 }));
      boxTip(heroBox, pick.hero >= 0 ? 77 : 101, 102, pick.hero >= 0 ? (heroNames[pick.hero] ?? fallback("Hero")) : tr("Random"));
      // A click on the hero: HotA's grid of the town's heroes (the right button there: a hero's specialty).
      if (p.chooseHero && heroList.length && mode !== "info") {
        heroBox.cursor = "pointer";
        heroBox.on("pointertap", (e) => e.button === 0 && void pickHero(modals, heroList, pick.hero, heroNames, color).then((h) => h !== null && h !== pick.hero && ((pick.hero = h), drawList())));
      }
      centred(pick.hero >= 0 ? (said(heroNames[pick.hero]) ?? fallback("Hero")) : tr("Random"), 54 + 218, y + 41 + 6, 70, "tiny");
      arrows(183, !!p.chooseHero && heroes.length > 0, (dir) => stepHero(pick, heroes, dir), [148, 149]);
      // Bonus: random, an artifact, gold or the town's resource.
      const bf = stars.get(0)?.[bonusFrame(pick.bonus, pick.faction)];
      if (bf) list.addChild(Object.assign(new Sprite(bf.texture), { x: 54 + 271, y: y + 2 }));
      centred(tr(BONUS_NAMES[pick.bonus]), 54 + 294, y + 41 + 6, 70, "tiny");
      {
        // VCMI's getTitle / getSubtitle / getDescription: gold 84 (500-1000: 87 / 92), an artifact 83 (90), the town's own resource 85 (688-695), random 86 (94).
        const res = resourceOf(pick.faction);
        const own = ({ 4: [688, 692], 5: [689, 693], 1: [690, 694], 3: [691, 695] } as Record<number, [number, number]>)[res] ?? [93, 89];
        const [title, desc, sub] = { random: [86, 94, 0], artifact: [83, 90, 0], gold: [84, 92, 87], resource: [85, own[0], own[1]] }[pick.bonus];
        boxTip(Object.assign(new Container(), { x: 54 + 271, y: y + 2 }), title, desc, sub ? gen0(sub, said("")) : tr(BONUS_NAMES[pick.bonus]));
      }
      arrows(259, true, (dir) => stepBonus(pick, dir), [164, 165]);
    }
  };

  /** The list scrolled to a row (the slider's arrows, its bar, its knob). */
  const scrollTo = (to: number) => {
    const next = Math.max(0, Math.min(sorted.length - ROWS, to));
    if (next === top) return;
    top = next;
    drawList();
  };
  /** The slider's knob held: the list follows the pointer. */
  let knobDrag: { length: number } | null = null;
  list.eventMode = "static";
  // The wheel: three rows a mouse wheel's notch (about 100 pixels), a touchpad's or tablet's many small events summed
  // to the same (each event was three rows: far too fast there; The owner 2026-11-02 "lower scroll sensitivity").
  let wheelSum = 0;
  list.on("wheel", (e) => {
    wheelSum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const rows = Math.trunc(wheelSum / 33);
    if (!rows) return;
    wheelSum -= rows * 33;
    if (panel === "random" && picking) return void ((pickTop = Math.max(0, pickTop + rows)), drawList());
    top = Math.max(0, Math.min(sorted.length - ROWS, top + rows));
    drawList();
  });
  list.on("globalpointermove", (e) => {
    if (!knobDrag) return;
    if (e.buttons === 0) return void (knobDrag = null);
    const most = Math.max(0, sorted.length - ROWS);
    const y = list.toLocal(e.global).y - (86 + 16 + 8);
    scrollTo(Math.round((Math.max(0, Math.min(knobDrag.length - 48, y)) / (knobDrag.length - 48)) * most));
  });
  // Touch: drag the list up and down, a row per row's height.
  const swipe = rowSwipe(list, 25, () => top, scrollTo);
  const endKnob = () => (knobDrag = null);
  list.on("pointerup", endKnob);
  list.on("pointerupoutside", endKnob);

  // ---- scenario card ---------------------------------------------------------
  const cardBox = new Container();
  cardBox.position.set(393, 6);
  win.addChild(cardBox);
  /** Bumped by every card drawn: an older one's pieces still loading are dropped. */
  let cardGen = 0;
  const drawCard = () => {
    cardGen++;
    cardBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    cardBox.addChild(new Sprite(card));
    // Saving with no saves yet: the card shows the game being saved.
    const m = sorted[chosen] ?? cardFallback;
    if (!m) return;
    const put = (text: Text, x: number, y: number, font: "smalfont" | "medfont" | "bigfont" = "smalfont", color: readonly [number, number, number] = YELLOW, width?: number) => {
      const t = label(text, font, color, "left", width);
      t.position.set(x, y);
      cardBox.addChild(t);
      return t;
    };
    // (VCMI's InfoCard: the headings are TOPLEFT labels, their tops at these points, 5-6 px under
    // the frames of GSELPOP1; the difficulty and rating values CENTER labels.)
    put(W("Scenario Name:"), 26, 22);
    // One line beside the size icon: a long name ("Archmage (random M, 3 players)") in the smaller
    // font, cut short with "..." if even that runs over.
    const title = said(m.name) || said(m.file);
    const lineOf = (font: "bigfont" | "medfont") => {
      const t = label(said("X"), font, YELLOW);
      const h = t.height;
      t.destroy();
      return h;
    };
    let nameText = label(title, "bigfont", YELLOW, "left", 280);
    let dy = 0;
    if (nameText.height > lineOf("bigfont") * 1.5) {
      nameText.destroy();
      nameText = label(title, "medfont", YELLOW, "left", 280);
      const medLine = lineOf("medfont");
      for (let n = title.length - 1; nameText.height > medLine * 1.5 && n > 0; n--) {
        nameText.destroy();
        nameText = label(said(title.slice(0, n).trimEnd() + "..."), "medfont", YELLOW, "left", 280);
      }
      dy = 4;
    }
    nameText.position.set(26, 39 + dy);
    cardBox.addChild(nameText);
    const sz = frame(sizeIcons, SIZES[m.size]?.[1] ?? 0);
    if (sz) cardBox.addChild(Object.assign(new Sprite(sz), { x: 313, y: 25 }));
    // HotA content and the game rules (additions, EXTRAS gameRules): beside the scenario and random map bars, on the
    // card of the game about to begin: the horn's check (locked on for a map made with HotA's content), the blue scroll.
    if (mode === "new" && extra("gameRules")) {
      const gen = cardGen;
      const o = setup.peek(m);
      const changed = () => (panel === "options" && drawList(), drawCard());
      void Promise.all([
        hotaContentCheck(modals, !o.noHota, hotaLock(m), (on) => (setHotaContent(optionsFor(m), on), changed()), 0.75),
        rulesScroll(modals, optionsFor(m), changed, 0.75),
      ]).then(([hota, rules]) => {
        if (gen !== cardGen || cardBox.destroyed) return void (hota.destroy({ children: true }), rules.destroy({ children: true }));
        hota.position.set(224, 78);
        rules.position.set(224, 101);
        cardBox.addChild(hota, rules);
      });
    }
    put(W("Scenario Description:"), 26, 132);
    put(said(m.description), 26, 149, "smalfont", WHITE, 320);
    put(W("Victory Condition:"), 26, 283);
    const v = frame(victIcons, m.victory < 0 ? 11 : m.victory);
    if (v) cardBox.addChild(Object.assign(new Sprite(v), { x: 24, y: 302 }));
    put(said(vc[m.victory + 1]) ?? said(""), 60, 307, "smalfont", WHITE, 290);
    put(W("Loss Condition:"), 26, 339);
    const l = frame(lossIcons, m.loss < 0 ? 3 : m.loss);
    if (l) cardBox.addChild(Object.assign(new Sprite(l), { x: 24, y: 359 }));
    put(said(lc[m.loss + 1]) ?? said(""), 60, 366, "smalfont", WHITE, 290);
    // Allies and enemies of the first human-playable colour.
    const me = Math.max(0, m.players.findIndex((p) => p.human));
    const team = m.players[me]?.team;
    const active = m.players.map((p, i) => (p.human || p.computer ? i : -1)).filter((i) => i >= 0 && i !== me);
    const allies = active.filter((i) => team !== undefined && m.players[i].team === team);
    const enemies = active.filter((i) => !allies.includes(i));
    // (VCMI's CFlagBox at 24, 400: white labels, the flags side by side 5 px after them.)
    const al = put(fmt`${W("Allies")}:`, 24, 400, "smalfont", WHITE);
    const flag = (p: number, x: number) => {
      const f = flags.get(0)?.[p];
      if (f) cardBox.addChild(Object.assign(new Sprite(f.texture), { x: x + f.x, y: 400 + f.y }));
      return f?.fullWidth ?? 12;
    };
    let fx = 24 + al.width + 5;
    for (const p of [me, ...allies]) fx += flag(p, fx);
    const en = put(fmt`${W("Enemies")}:`, 157, 400, "smalfont", WHITE);
    fx = 157 + en.width + 5;
    for (const p of enemies) fx += flag(p, fx);
    // (Their tops on the 17 px strip of GSELPOP1 at 430, as the labels fill it.)
    put(W("Map Diff:"), 33, 430);
    put(W("Player Difficulty:"), 133, 430);
    put(W("Rating:"), 290, 430);
    const md = label(said(diffNames[m.difficulty]) ?? said(diffNames[1]), "smalfont", WHITE).centreOn(62, 472);
    const rating = label(fmt`${RATINGS[difficulty]}%`, "smalfont", WHITE).centreOn(311, 472);
    cardBox.addChild(md, rating);
    // Difficulty: five toggle buttons; the chosen one stays pressed.
    for (let i = 0; i < 5; i++) {
      const b = new DefButton(`gspbut${i + 3}.def`, 110 + i * 32, 450, -1, i === difficulty ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      b.hint = tr(`%1: %2% rating`, diffNames[i], RATINGS[i]);
      // (The right click: the piece's meaning, HELP.TXT 24-28.)
      const row = helpRow(24 + i);
      if (row) b.help = row.help;
      b.onClick = () => {
        if (mode === "info") return;
        difficulty = i;
        drawCard();
      };
      cardBox.addChild(b);
    }
  };
  drawList();
  drawCard();

  // ---- random map ------------------------------------------------------------
  // The original's Random Map panel, shortened: size, players and monster strength. "Make the map"
  // puts it at the top of the scenario list, where Begin and the advanced options take it as any map.
  // (Its choices and their limits: newGameModel's RandomMapSetup; the Random buttons' rows left in `randomPick`.)
  const rnd = new RandomMapSetup();
  const random = rnd.o;
  const randomPick = rnd.pick;
  const templates = (await loadData().catch(() => null))?.rmgTemplates ?? [];
  const fitting = () => rnd.fitting(templates);
  const templateName = () => {
    const t = rnd.template(templates);
    return t ? rmgTitle(t) : "Random";
  };
  /** The template list open (in the Random Map panel's place), and the first row it shows. */
  let picking = false;
  let pickTop = 0;
  let randomBusy = false;
  let randomDraw = 0;
  const drawRandom = async () => {
    const my = ++randomDraw;
    const box = new Container();
    // (Touch screens have the phone's New Game, mobileNewGame.ts: this is the computer's window.)
    if (picking) await drawTemplates(box);
    else await drawRandomClassic(box);
    // A newer draw (a quick second click) wins; the list may have moved on meanwhile.
    if (my === randomDraw && panel === "random") list.addChild(box);
    else box.destroy({ children: true });
  };
  /**
   * The original's Random Map panel (RANMAPBK, VCMI's randomMapTab): size and the underground
   * level, then rows of toggles for the players who may be human, their teams, the computer-only
   * players and their teams, the water and the monsters, each with Random. A row's teams number
   * fewer than its players (more are greyed).
   */
  const drawRandomClassic = async (box: Container) => {
    const ids = [738, 739, 752, 753, 754, 755, 756, 757, 758];
    const [back, ...texts] = await Promise.all([loadImage("ranmapbk.pcx").catch(() => listBg), ...ids.map((id) => resolveText({ file: "genrltxt", id }).catch(() => null))]);
    box.addChild(new Sprite(back));
    const t = (id: number, english: string): Text => texts[ids.indexOf(id)]?.trim() || tr(english);
    const text = (s: Text, font: "bigfont" | "smalfont", color: readonly [number, number, number], x: number, y: number, align: "left" | "center" = "center") => {
      // (VCMI's randomMapTab: CENTER points or TOPLEFT corners ("left"), the panel's picture 6 below
      // the tab's top, so 6 up here.)
      const l = label(s, font, color, align, align === "center" ? 360 : undefined);
      if (align === "center") l.centreOn(x, y - 6);
      else l.position.set(x, y - 6);
      box.addChild(l);
    };
    text(t(738, "Random Map"), "bigfont", YELLOW, 222, 36);
    // The template (an addition: the original picks one that fits) in the subtitle's place: a click steps on, a right-click back.
    if (extra("rmgTemplate") && templates.length) {
      const line = label(tr(`Template: %1`, templateName()), "smalfont", fitting().length ? YELLOW : WHITE, "center", 360).centreOn(222, 56 - 6);
      line.eventMode = "static";
      line.cursor = "pointer";
      line.on("pointertap", () => ((picking = true), drawList()));
      box.addChild(line);
    } else text(t(739, "Choose the options for a random map"), "smalfont", WHITE, 222, 56);
    text(t(752, "Map Size"), "smalfont", WHITE, 104, 97);
    /** A toggle: pressed while chosen, greyed when this generator can't make it. */
    // `row`: the button's HELP.TXT row (198-252, VCMI's randomMapTab).
    const toggle = (def: string, x: number, y: number, on: boolean, set: (() => void) | null, hint: string, row: number) => {
      // (As VCMI's imageOrder [0, 1, 1, 3]: a greyed one looks pressed, as the chosen one.)
      const b = help(new DefButton(`${def}.def`, x, y - 6, -1, on ? [1, 1, 1, 3] : [0, 1, 1, 3]), row, hint);
      if (set) b.onClick = () => (set(), drawList());
      else b.disabled = true;
      box.addChild(b);
    };
    RANDOM_MAP_SIZES.forEach((n, i) =>
      toggle(["ransizs", "ransizm", "ransizl", "ransizx"][i], 158 + 47 * i, 81, random.size === n, () => rnd.setSize(n), `${["Small", "Medium", "Large", "Extra large"][i]} map (${n}x${n}).`, 198 + i),
    );
    toggle("ranundr", 346, 81, !!random.underground, () => rnd.setUnderground(!random.underground), "An underground level, joined by Subterranean Gates.", 202);
    const rows = [753, 754, 755, 756, 757, 758];
    const titles = ["Human or Computer Players", "Human or Computer Teams", "Computer Only Players", "Computer Only Teams", "Water Content", "Monster Strength"];
    rows.forEach((id, k) => text(t(id, titles[k]), "smalfont", WHITE, 68, [133, 199, 265, 331, 398, 465][k], "left"));
    const computers = rnd.computers;
    // Who may be human (1-8), then the computer-only players (0-7); the map holds `max` in all.
    for (let n = 1; n <= 8; n++)
      toggle(`rannum${n}`, 67 + 32 * (n - 1), 153, random.humans === n && !randomPick.humans, rnd.canHumans(n) ? () => rnd.setHumansKeepingComputers(n) : null, `${n} player${n > 1 ? "s" : ""} who may be human.`, 203 + n);
    toggle("ranrand", 67 + 256, 153, randomPick.humans, () => (randomPick.humans = true), "Any number of players who may be human.", 212);
    // Teams of the players who may be human (VCMI's teamCount): 0 each alone, up to one fewer than them.
    for (let n = 0; n <= 7; n++)
      toggle(`rannum${n}`, 67 + 32 * n, 219, (random.teams ?? 0) === n && !randomPick.teams, rnd.canTeams(n, random.humans) ? () => rnd.setTeams(n) : null, n === 0 ? "No teams among the players who may be human." : `The players who may be human in ${n} team${n > 1 ? "s" : ""}.`, 214 + n);
    toggle("ranrand", 67 + 256, 219, randomPick.teams, () => (randomPick.teams = true), "Teams among the players who may be human at random.", 222);
    for (let n = 0; n <= 7; n++)
      toggle(`rannum${n}`, 67 + 32 * n, 285, computers === n && !randomPick.computers, rnd.canComputers(n) ? () => rnd.setComputers(n) : null, `${n} computer-only player${n === 1 ? "" : "s"}.`, 224 + n);
    toggle("ranrand", 67 + 256, 285, randomPick.computers, () => (randomPick.computers = true), "Any number of computer-only players.", 232);
    // The computers' teams (VCMI's compOnlyTeamCount): each on its own, or up to one fewer teams than them.
    for (let n = 0; n <= 6; n++)
      toggle(`rannum${n}`, 67 + 32 * n, 351, (random.compTeams ?? 0) === n && !randomPick.compTeams, rnd.canTeams(n, computers) ? () => rnd.setCompTeams(n) : null, n === 0 ? "No teams among the computers." : n === 1 ? "The computers all on one team." : `The computers in ${n} teams.`, 234 + n);
    toggle("ranrand", 67 + 256, 351, randomPick.compTeams, () => (randomPick.compTeams = true), "Computer teams at random.", 241);
    const water = rnd.water;
    ["rannone", "rannorm", "ranisld"].forEach((def, i) =>
      toggle(def, 67 + 85 * i, 419, water === i && !randomPick.water, () => rnd.setWater(i), ["No water.", "Normal water: a sea along the map's edge (from the template), or without one a lake in the middle.", "Islands: the sea between every zone."][i], 243 + i),
    );
    toggle("ranrand", 67 + 256, 419, randomPick.water, () => (randomPick.water = true), "Water at random.", 246);
    ["ranweak", "rannorm", "ranstrg"].forEach((def, i) =>
      toggle(def, 67 + 85 * i, 485, random.monsters === i && !randomPick.monsters, () => rnd.setMonsters(i), `${["Weak", "Normal", "Strong"][i]} monsters.`, 248 + i),
    );
    toggle("ranrand", 67 + 256, 485, randomPick.monsters, () => (randomPick.monsters = true), "Monsters at random.", 251);
    // Show Random Maps: the map made and shown at the top of the list.
    const show = new DefButton("ranshow.def", 54, 535 - 6);
    help(show, 252, "Make the map and show it in the list.");
    show.onClick = () => void makeRandom();
    box.addChild(show);
    // The computers' personality (an addition): on the computer-only players' title line, at its right, between
    // Advanced Options' arrows (a bare line read as a label: the owner, 11-02); a click on the name steps on too.
    if (extra("aiPersonality")) {
      const step = (dir: number) => (rnd.stepAi(dir), drawList());
      const hover = () => ({ hover: tr("Computers: %1", personalityName(random.ai, "Standard")), help: tr(RANDOM_AI_HELP) });
      // (ADOPLFA / ADOPRTA shrunk to the title line, 18 high; the name between them, 80 wide, ending at 372.)
      const k = 18 / 23;
      const nameX = 372 - 12 - 80;
      const name = new Container({ label: "personality: random map", x: nameX, y: 265 - 6 - 2 });
      name.addChild(new Graphics().rect(0, 0, 80, 18).fill({ color: 0, alpha: 0.001 }));
      name.addChild(label(personalityName(random.ai, "Standard"), "smalfont", random.ai ? YELLOW : WHITE, "center", 80).centreOn(40, 9));
      name.eventMode = "static";
      name.cursor = "pointer";
      name.on("pointertap", (e) => e.button === 0 && step(1));
      hoverHelp(name, hover);
      box.addChild(name);
      for (const [def, dir, x] of [["adoplfa.def", -1, nameX - 12], ["adoprta.def", 1, nameX + 80]] as const) {
        const b = new DefButton(def, x, 265 - 6 - 2);
        b.scale.set(k);
        b.hint = dir < 0 ? tr("Previous") : tr("Next");
        b.help = tr(RANDOM_AI_HELP);
        b.onClick = () => step(dir);
        box.addChild(b);
      }
    }
  };
  /**
   * The templates that fit the map as set (an addition: the original picks one at random), listed
   * as the scenarios are: players, sizes and name, Random first; a click takes one. Under them the
   * kinds of road the map may have (an addition, VCMI's).
   */
  const drawTemplates = async (box: Container) => {
    box.addChild(new Sprite(listBg));
    const font = "smalfont";
    // (The scenario list's picture and places: its rows of 25 and its columns.)
    const [rowH, rows] = [25, 16];
    box.addChild(label(tr("Select a Template"), "medfont", YELLOW).centreOn(205, 28));
    box.addChild(label(tr("Map Sizes"), "smalfont", YELLOW).centreOn(87, 62));
    // The size filters choose the map's size here (All greyed: a map has one).
    ["scsmbut", "scmdbut", "sclgbut", "scxlbut", "scalbut"].forEach((d, i) => {
      const size = RANDOM_MAP_SIZES[i];
      const b = new DefButton(`${d}.def`, 158 + 47 * i, 46, -1, size === random.size || !size ? [1, 1, 2, 3] : [0, 1, 2, 3]);
      if (size) {
        b.hint = tr(`%1 map: the templates for it.`, ["Small", "Medium", "Large", "Extra large"][i]);
        b.onClick = () => (rnd.setSize(size), drawList());
      } else b.disabled = true;
      box.addChild(b);
    });
    const keys = rnd.templateKeys(templates);
    pickTop = Math.max(0, Math.min(keys.length - rows, pickTop));
    for (let i = 0; i < rows && pickTop + i < keys.length; i++) {
      const key = keys[pickTop + i];
      const t = key ? rmgIndex(templates).get(key) : undefined;
      const color = key === rnd.templateKey ? YELLOW : WHITE;
      const row = new Container();
      row.position.set(24, 117 + i * rowH);
      row.addChild(new Graphics().rect(0, 0, 340, rowH - 1).fill({ color: 0, alpha: 0.001 }));
      const facts = t ? rmgTemplateFacts(t) : null;
      const mid = Math.round(rowH / 2);
      // Players and size in the list's first columns; the name, with the sizes it makes, in the name's.
      if (facts) row.addChild(label(said(facts.players), font, color).centreOn(8 + 6, mid), label(said(SIZES[random.size]?.[0]) ?? said(""), font, color).centreOn(41 + 6, mid));
      const full = t ? fmt`${said(rmgTitle(t))} (${said(facts!.sizes)})` : tr("Random: one that fits, as the original");
      let name = label(full, font, color);
      for (let n = full.length - 1; name.width > 250 && n > 0; n--) (name.destroy(), (name = label(said(full.slice(0, n) + "..."), font, color)));
      row.addChild(name.centreOn(t ? 184 + 6 : 170, mid));
      row.eventMode = "static";
      row.cursor = "pointer";
      row.on("pointertap", () => ((rnd.templateKey = key), (picking = false), drawList()));
      box.addChild(row);
    }
    // More than fit: the scenario list's arrows beside them (and the wheel).
    if (keys.length > rows) {
      const up = new DefButton("scnrbup.def", 372, 86);
      up.onClick = () => ((pickTop = Math.max(0, pickTop - rows + 1)), drawList());
      const down = new DefButton("scnrbdn.def", 372, 86 + 480 - 16);
      down.onClick = () => ((pickTop += rows - 1), drawList());
      box.addChild(up, down);
    }
    if (extra("rmgRoads")) {
      const y = 117 + rows * rowH + 10;
      box.addChild(Object.assign(label(tr("Roads"), font, YELLOW), { x: 30, y: y + 4 }));
      const kinds = rnd.roads;
      const [h, ws, xs] = [24, [56, 64, 100], [84, 148, 220]];
      for (const [k, name] of ["Dirt", "Gravel", "Cobblestone"].entries()) {
        const b = await barButton(tr(name), ws[k], h, () => (rnd.toggleRoad(k), drawList()), false, font, 1);
        b.position.set(xs[k], y);
        if (kinds & (1 << k)) b.addChild(new Graphics().rect(0, 0, ws[k], h).stroke({ color: 0xffff00, width: 2 }));
        box.addChild(b);
      }
      if (!kinds) box.addChild(Object.assign(label(tr("none: no roads"), font, WHITE), { x: xs[2] + ws[2] + 8, y: y + 4 }));
    }
  };
  const makeRandom = async () => {
    if (randomBusy) return;
    randomBusy = true;
    try {
      const info = await templatedMapInfo(rnd.options(extra("rmgRoads")), rnd.templateKey);
      // One random map in the list at a time: a new one replaces the last (the advanced starts stay).
      putRandomMap(maps, info);
      sizeFilter = 0;
      panel = "list";
      resort(info.file);
      drawList();
      drawCard();
    } finally {
      randomBusy = false;
    }
  };

  // ---- buttons ---------------------------------------------------------------
  let close = () => {};
  let resolveIt: (v: ScenarioChoice | null) => void = () => {};
  const finish = () => {
    const m = sorted[chosen];
    if (mode === "save" ? !typed.trim() : !m) return;
    close();
    resolveIt(m ? scenarioChoice(m, difficulty, setup.touched(m), typed.trim()) : { name: typed.trim(), file: "", difficulty });
  };
  const toggle = new DefButton("gspbutt.def", 411, 80);
  help(toggle, 45, "Show or hide the available scenarios.");
  toggle.onClick = () => {
    panel = panel === "list" ? "none" : "list";
    drawList();
  };
  const randomButton = new DefButton("gspbutt.def", 411, 105);
  help(randomButton, 47, "Make a random map: its size, players and monster strength.");
  randomButton.onClick = () => {
    // (From the template list: back to the Random Map panel.)
    if (panel === "random" && picking) return void ((picking = false), drawList());
    panel = panel === "random" ? "list" : "random";
    drawList();
  };
  const rText = label(W("Random Map"), "smalfont", WHITE, "center", 200);
  rText.position.set(411 + 2, 105 + 4);
  rText.eventMode = "none";
  const advanced = new DefButton("gspbutt.def", 411, 510);
  help(advanced, 46, "Show or hide the advanced options: colour, town, hero and bonus.");
  advanced.onClick = () => {
    panel = panel === "options" ? "none" : "options";
    drawList();
  };
  const aText = label(W("Show Advanced Options"), "smalfont", WHITE, "center", 200);
  aText.position.set(411 + 2, 510 + 4);
  aText.eventMode = "none";
  const tText = label(W("Show Available Scenarios"), "smalfont", WHITE, "center", 200);
  tText.position.set(411 + 2, 80 + 4);
  tText.eventMode = "none";
  const begin = new DefButton(mode === "load" ? "scnrlod.def" : mode === "save" ? "scnrsav.def" : "scnrbeg.def", 411, 535);
  if (mode === "load") begin.hint = tr("Load the selected game.");
  else help(begin, mode === "save" ? 102 : 103, mode === "save" ? "Save the game under this name." : "Begin the scenario.");
  begin.onClick = finish;
  const back = new DefButton("scnrback.def", 581, 535);
  help(back, 105, "Back.");
  back.onClick = () => {
    close();
    resolveIt(null);
  };
  // Scenario information: the card and Back (VCMI's CScenarioInfoScreen).
  if (mode === "info") {
    back.position.set(584, 535);
    win.addChild(back);
  } else win.addChild(toggle, tText, begin, back);
  if (mode === "new") win.addChild(advanced, aText, randomButton, rText);
  // Loading with games from other devices too: a bar (in the Random Map one's place) switches the list.
  if (hasOthers) {
    const others = new DefButton("gspbutt.def", 411, 105);
    others.hint = tr("Show your games from other devices, or this device's again.");
    const oText = label(said(""), "smalfont", WHITE, "center", 200);
    oText.position.set(411 + 2, 105 + 4);
    oText.eventMode = "none";
    const name = () => (oText.value = showOthers ? tr("Show This Device's Games") : tr("Show Other Devices' Games"));
    name();
    others.onClick = () => {
      showOthers = !showOthers;
      name();
      panel = "list";
      resort();
      drawList();
      drawCard();
    };
    win.addChild(others, oText);
  }
  const lobbyKey = (k: string): boolean => {
    if (k === (mode === "new" ? "b" : "l")) return (finish(), true);
    if (mode !== "new") return false;
    if (k === "s") return (toggle.onClick?.(), true);
    if (k === "r") return (randomButton.onClick?.(), true);
    if (k === "a") return (advanced.onClick?.(), true);
    return false;
  };
  return new Promise((resolve) => {
    resolveIt = resolve;
    close = modals.show(win, {
      onKey: (k) => {
        if (k === "Escape") back.onClick();
        else if (k === "Enter") finish();
        else if (k === "ArrowDown" || k === "ArrowUp" || k === "PageDown" || k === "PageUp" || k === "Home" || k === "End") {
          // (VCMI's moveFirst / moveLast too.)
          const step = k.startsWith("Page") ? ROWS : 1;
          chosen = Math.max(0, Math.min(sorted.length - 1, k === "Home" ? 0 : k === "End" ? sorted.length - 1 : chosen + (k.endsWith("Down") ? step : -step)));
          if (chosen < top) top = chosen;
          if (chosen >= top + ROWS) top = chosen - ROWS + 1;
          drawList();
          drawCard();
        } else if (mode !== "save" && mode !== "info" && lobbyKey(k.toLowerCase())) {
          // (VCMI's lobby keys: B begins a new game, L a load, S the scenario list, R the random map, A the advanced options.)
        } else if (mode === "save" && (k === "Backspace" || (k.length === 1 && typed.length < 40))) {
          typed = k === "Backspace" ? typed.slice(0, -1) : typed + k;
          if (nameText) nameText.value = said(typed + "_");
        } else return false;
        return true;
      },
    });
  });
}
