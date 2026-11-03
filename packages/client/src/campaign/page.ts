// Campaigns: the original campaign selection screens (CAMPBACK / CAMPBKX2 with each campaign's
// picture) and the scenario screen (the campaign's region map, CAMPBRF with the texts, bonuses
// and difficulty). Progress lives in this browser; the map page plays the scenarios.
import { centre, onLayout, phoneSized, screenSize } from "../ui/screen.ts";
import { pictureSurround } from "../ui/backdrops.ts";
import { barButton, bigText, contentArea, openPage, pageColumn, pageSize, scrollList } from "../ui/mobilePage.ts";
import { CAMPAIGN_INTRO, CAMPAIGN_REGIONS, type CampaignStart, type CarriedHero, campaignMapRef, readCampaign, trimCarried } from "@heroes/core";
import { type CampaignBonus, parseH3m } from "@heroes/formats";
import { type Application, Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import { GSELPOP1, tiledPart } from "../ui/blocks/windowParts.ts";
import { panelBack, panelBox } from "../ui/blocks/menuBlocks.ts";
import { creaturePortrait, fetchRes, heroPortrait, loadDef, loadImage, loadPng } from "../assets.ts";
import { WHITE, YELLOW, loadFonts } from "../text.ts";
import { fullVideo, prologue } from "../ui/prologue.ts";
import { videoSprite } from "../ui/video.ts";
import { DefButton, helpRow, hoverHelp, label, loadButtonHelp } from "../ui/kit.ts";
import { Modals } from "../ui/modals.ts";
import { playMusic } from "../audio.ts";
import { loadData } from "../gameData.ts";
import { resolveText } from "../ui/gameText.ts";
import { en, tr, said, type Text } from "../i18n/index.ts";

interface CampaignItem {
  file: string;
  /** Its animation, played over the picture while the mouse is on it (VCMI's campaignSets.json). */
  video: string;
  image: string;
  x: number;
  y: number;
  /** Campaigns (ids in this set) that must be finished first. */
  requires: number[];
}

/** The campaign sets with their screens (VCMI's campaignSets.json; AB and HotA reuse the SoD screen). */
const SETS: { name: string; background: string; items: CampaignItem[] }[] = [
  {
    name: "Restoration of Erathia",
    background: "campback.pcx",
    items: [
      { file: "good1", video: "cgood1", image: "campgd1s", x: 90, y: 72, requires: [] },
      { file: "evil1", video: "cevil1", image: "campev1s", x: 539, y: 72, requires: [] },
      { file: "good2", video: "cgood2", image: "campgd2s", x: 43, y: 245, requires: [1, 2, 4] },
      { file: "neutral1", video: "cneutral", image: "campneus", x: 313, y: 244, requires: [] },
      { file: "evil2", video: "cevil2", image: "campev2s", x: 586, y: 244, requires: [1, 2, 4] },
      { file: "good3", video: "cgood3", image: "campgd3s", x: 34, y: 417, requires: [3, 5] },
      { file: "secret1", video: "csecret", image: "campscts", x: 404, y: 414, requires: [6] },
    ],
  },
  {
    name: "Armageddon's Blade",
    background: "campbkx2.pcx",
    items: [
      { file: "ab", video: "c1ab7", image: "camp1ab7", x: 90, y: 72, requires: [] },
      { file: "blood", video: "c1db2", image: "camp1db2", x: 539, y: 72, requires: [] },
      { file: "slayer", video: "c1ds1", image: "camp1ds1", x: 43, y: 245, requires: [] },
      { file: "festival", video: "c1fl3", image: "camp1fl3", x: 313, y: 244, requires: [] },
      { file: "fire", video: "c1pf2", image: "camp1pf2", x: 586, y: 244, requires: [] },
      { file: "fool", video: "c1fw1", image: "camp1fw1", x: 33, y: 417, requires: [1, 2, 3, 4, 5] },
    ],
  },
  {
    name: "Shadow of Death",
    background: "campbkx2.pcx",
    items: [
      { file: "gem", video: "new", image: "campnb1", x: 90, y: 72, requires: [] },
      { file: "gelu", video: "elixir", image: "campel1", x: 539, y: 72, requires: [] },
      { file: "crag", video: "hack", image: "camphs1", x: 43, y: 245, requires: [] },
      { file: "sandro", video: "rise", image: "camprn1", x: 313, y: 244, requires: [1, 2, 3, 5] },
      { file: "yog", video: "birth", image: "campbb1", x: 586, y: 244, requires: [] },
      { file: "final", video: "unholy", image: "campua1", x: 34, y: 417, requires: [4] },
      { file: "secret", video: "spectre", image: "campsp1", x: 404, y: 414, requires: [6] },
    ],
  },
  {
    // (HotA's own screen, CAMPHOTA, and pictures, as its campaignSets.json.)
    name: "Horn of the Abyss",
    background: "camphota.pcx",
    items: [
      { file: "h1roger", video: "mvroger", image: "campujr1", x: 90, y: 72, requires: [] },
      { file: "h2terror", video: "mvterror", image: "campts1", x: 539, y: 72, requires: [] },
      { file: "h3horn", video: "mvhorn", image: "campha1", x: 43, y: 245, requires: [] },
      { file: "h4fact", video: "mvnight", image: "campfa1", x: 313, y: 244, requires: [] },
      { file: "h5allin", video: "mvallin", image: "campal1", x: 586, y: 246, requires: [] },
    ],
  },
];

/** One campaign in progress (or finished) in this browser. */
export interface CampaignProgress {
  file: string;
  conquered: number[];
  /** The heroes of the last scenario won, whole (older progress: already cut to what that scenario kept). */
  carried: CarriedHero[];
  /** Each won scenario's heroes, whole, strongest first (a bonus can bring an earlier scenario's). */
  pools?: Record<number, CarriedHero[]>;
  /** Every hero carried so far, as last seen (placeholders by name). */
  heroes?: CarriedHero[];
  /** The scenario won last. */
  last?: number;
  difficulty: number;
  /** The scenario being played and its bonus. */
  current?: number;
  bonus?: number;
  finished?: boolean;
  /** HotA's script variables the scenarios won hand on, by name. */
  vars?: Record<string, number>;
}

const KEY = "heroes.campaigns";
export function loadProgress(): Record<string, CampaignProgress> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
export function saveProgress(p: CampaignProgress) {
  try {
    const all = loadProgress();
    all[p.file] = p;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // not kept
  }
}

/** What the map page should start next: a campaign scenario with its start options. */
export const PENDING = "heroes.campaign.pending";

const tex = (name: string): Promise<Texture | null> =>
  name.includes("/")
    ? loadPng(`${name.toLowerCase()}.png`, true).catch(() => null)
    : // (HotA's own campaign pictures are PNGs in its mod.)
      loadImage(`${name.toLowerCase()}.pcx`).catch(() => loadPng(`${name.toLowerCase()}.png`).catch(() => null));

/**
 * The campaign screens. `overMenu`: opened from the main menu, which stays the page underneath (its
 * music going on, as in HotA); the set screen's Back then takes this away and calls `back`.
 */
export async function startCampaignPage(app: Application, toolbar: HTMLElement | null, overMenu?: { modals: Modals; back: () => void }) {
  await loadFonts();
  const root = new Container();
  app.stage.addChild(root);
  centre(root);
  const modals = overMenu?.modals ?? new Modals(app);
  const gone = new AbortController();
  // (The menu's own name for the track: another spelling would start it again.)
  playMusic("MAINMENU.MP3");
  let set = Number(localStorage.getItem("heroes.campaignSet") ?? 0) || 0;
  const pick = document.createElement("select");
  SETS.forEach((st, i) => pick.add(new Option(st.name, String(i))));
  pick.value = String(set);
  pick.onchange = () => {
    set = Number(pick.value);
    localStorage.setItem("heroes.campaignSet", String(set));
    void showSet();
  };
  toolbar?.append(pick);
  // The campaign screen's keys (VCMI's CBonusSelection: Enter begins, Esc goes back, Left / Right the difficulty); set by the scenario screen.
  let keys: ((key: string) => boolean) | null = null;
  window.addEventListener(
    "keydown",
    (e) => {
      if (modals.open || e.ctrlKey || e.metaKey || e.altKey || !keys?.(e.key)) return;
      e.preventDefault();
    },
    { signal: gone.signal },
  );

  /** Around a screen's picture, whatever the screen's shape: its own edges, not black (pictureSurround, as the menus'). */
  const surrounded = (bg: Texture, own = false) => {
    const s = pictureSurround();
    if (own) s.view.once("destroyed", () => bg.destroy(true));
    const stop = onLayout(() => (s.view.destroyed ? queueMicrotask(() => stop()) : s.place(bg, { origin: { x: screenSize.ox, y: screenSize.oy } })));
    return s.view;
  };
  /** The set's screen: each campaign's picture; locked ones dimmed until their predecessors are won. */
  const showSet = async () => {
    keys = null;
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
    const st = SETS[set];
    const bg = await tex(st.background.replace(/\.pcx$/, ""));
    if (bg) root.addChild(surrounded(bg), new Sprite(bg));
    const progress = loadProgress();
    const check = await tex("campchk");
    /** The campaign's name under its picture while the mouse is over it (VCMI's CCampaignButton). */
    const hover = label(said(""), "medfont", YELLOW, "center", 300);
    for (const item of st.items) {
      // A locked campaign isn't drawn: the screen's own grey picture stays (as the original).
      const open = item.requires.every((r) => progress[st.items[r - 1]?.file]?.finished);
      if (!open) continue;
      const pic = await tex(item.image);
      if (!pic) continue;
      const sp = new Sprite(pic);
      sp.position.set(item.x, item.y);
      sp.eventMode = "static";
      sp.cursor = "pointer";
      sp.on("pointertap", () => void showCampaign(item.file));
      let name: Text = said("");
      // The original's campaign animation while the mouse is over the picture.
      let film: Container | null = null;
      sp.on("pointerover", async (e) => {
        if (e.pointerType === "mouse" && !film) {
          film = root.addChild(new Container());
          film.position.set(item.x, item.y);
          film.eventMode = "none";
          film.addChild(videoSprite([item.video], pic.width, pic.height, film));
        }
        name ||= await fetchRes(`${item.file}.h3c`).then((b) => said(readCampaign(b).name), () => said(""));
        if (hover.destroyed) return;
        hover.value = name;
        hover.position.set(item.x + pic.width / 2 - 150, item.y + pic.height + 20 - Math.round(hover.height / 2));
        hover.visible = true;
      });
      sp.on("pointerout", () => {
        hover.visible = false;
        film?.destroy({ children: true });
        film = null;
      });
      root.addChild(sp);
      // Won: the check mark in the picture's corner (CAMPCHK).
      if (progress[item.file]?.finished && check) root.addChild(Object.assign(new Sprite(check), { x: item.x, y: item.y }));
    }
    hover.visible = false;
    root.addChild(hover);
    // Back to the main menu's campaign buttons.
    const exit = new DefButton("cmpscan.def", 658, 482);
    exit.onClick = () => {
      if (!overMenu) return void (location.hash = "#menu?campaign");
      gone.abort();
      pick.remove();
      root.destroy({ children: true });
      overMenu.back();
    };
    root.addChild(exit);
  };

  /** The scenario screen for one campaign. */
  const showCampaign = async (file: string) => {
    const c = readCampaign(await fetchRes(`${file}.h3c`));
    const progress = loadProgress()[file] ?? { file, conquered: [], carried: [], difficulty: 1 };
    if (progress.finished) Object.assign(progress, { conquered: [], carried: [], pools: {}, heroes: [], last: undefined, finished: false, vars: undefined });
    root.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    const region = CAMPAIGN_REGIONS[c.region];
    const playable = c.scenarios.map((sc, i) => !!sc.mapName && !progress.conquered.includes(i) && sc.requires.every((r) => progress.conquered.includes(r)));
    let chosen = playable.findIndex((x) => x);
    let bonus = 0;
    // The campaign's own difficulty unless the player may pick (then the last choice).
    let difficulty = c.difficultyChosenByPlayer ? (progress.difficulty ?? 1) : (c.scenarios[Math.max(0, chosen)]?.difficulty ?? 1);
    // Scenario names from the maps themselves.
    // (And their sizes and teams, for the card's size icon and flags.)
    const heads = c.maps.map((m) => {
      try {
        return m ? parseH3m(m) : undefined;
      } catch {
        return undefined;
      }
    });
    const mapNames = heads.map((h) => said(h?.name));
    const map = new Container();
    const panel = new Container();
    root.addChild(map, panel);

    const regionImage = (i: number, kind: 0 | 1 | 2) => {
      const d = region.desc[i];
      const colors = [[""], ["R", "B", "N", "G", "O", "V", "T", "P"], ["Re", "Bl", "Br", "Gr", "Or", "Vi", "Te", "Pi"]][region.colorSuffixLength] ?? [""];
      const color = colors[c.scenarios[i].regionColor] ?? colors[0] ?? "";
      const suffix = (region.suffix ?? ["En", "Se", "Co"])[kind];
      return `${region.prefix}${d.infix}_${suffix}${color}`;
    };
    const drawMap = async () => {
      map.removeChildren().forEach((ch) => ch.destroy({ children: true }));
      const bg = await tex(region.background ?? `${region.prefix}_BG`);
      if (bg) map.addChild(new Sprite(bg));
      for (const [i, d] of region.desc.entries()) {
        if (!c.scenarios[i]?.mapName) continue;
        const conquered = progress.conquered.includes(i);
        if (!conquered && !playable[i]) continue;
        const t = await tex(regionImage(i, conquered ? 2 : i === chosen ? 1 : 0));
        if (!t) continue;
        const sp = new Sprite(t);
        sp.position.set(d.x, d.y);
        if (playable[i]) {
          sp.eventMode = "static";
          sp.cursor = "pointer";
          sp.on("pointertap", () => {
            chosen = i;
            bonus = 0;
            void drawMap();
            void drawPanel();
          });
        }
        map.addChild(sp);
      }
    };

    const bonusIcon = async (b: CampaignBonus): Promise<{ texture: Texture | null; text: string }> => {
      const frame = async (def: string, i: number) => (await loadDef(def).catch(() => null))?.get(0)?.[i]?.texture ?? null;
      const { texture, text } = await bonusIconOurs(b, frame);
      return { texture, text: (await originalBonusText(b)) ?? text };
    };
    const bonusIconOurs = async (b: CampaignBonus, frame: (def: string, i: number) => Promise<Texture | null>): Promise<{ texture: Texture | null; text: string }> => {
      switch (b.type) {
        case "spell":
          return { texture: await frame("spellbon.def", b.spell), text: tr("Start with a spell") };
        case "scroll":
          return { texture: await frame("spellbon.def", b.spell), text: tr("Start with a spell scroll") };
        case "creatures":
          // (HotA's creatures aren't in TWCRPORT: their own portraits.)
          return { texture: (await frame("twcrport.def", b.creature + 2)) ?? (await creaturePortrait({ id: b.creature }, "large").catch(() => null)), text: tr("Start with %1 creatures", b.amount) };
        case "artifact":
          return { texture: (await frame("artifbon.def", b.artifact)) ?? (await frame("artifact.def", b.artifact)), text: tr("Start with an artifact") };
        case "primary":
          return { texture: await frame("pskilbon.def", b.amounts.indexOf(Math.max(...b.amounts))), text: tr("Start with +%1 to primary skills", b.amounts.join("/")) };
        case "secondary":
          return { texture: await frame("sskilbon.def", b.skill * 3 + b.mastery - 1), text: tr("Start with a secondary skill") };
        case "resource":
          return { texture: await frame("bores.def", b.resource === 0xfd ? 7 : b.resource === 0xfe ? 8 : b.resource), text: tr("Start with %1 extra resources", b.amount) };
        case "building":
          return { texture: null, text: tr("Start with a building") };
        case "hero":
          return { texture: b.hero >= 0 ? await heroPortrait(b.hero, "large").catch(() => null) : await loadImage("hpsrand.pcx").catch(() => null), text: tr("Start with this hero") };
        case "previousHeroes":
          return { texture: await frame("crest58.def", b.player), text: tr("Heroes from an earlier scenario") };
      }
    };

    /**
     * Phones: the panel's small text is unreadable, so beside the region map go the scenario's name
     * and big buttons; the briefing (descriptions, bonuses, difficulty) is a page of its own.
     */
    const drawPhonePanel = async () => {
      panel.removeChildren().forEach((ch) => ch.destroy({ children: true }));
      const sc = c.scenarios[chosen];
      // In CAMPBRF's place, the menus' blue window (menuBlocks' panelBack) with its recessed boxes (panelBox), the
      // original's Begin and Back (CBBEGIB, CBCANCB) half as big again for a finger; without the pictures, dark boxes.
      const [x0, y0, pw, ph] = [456, 6, 338, 588];
      const back = new Container();
      panel.addChild(back);
      back.addChild(Object.assign(panelBack(pw, ph), { x: x0, y: y0 }));
      const box = (x: number, y: number, w: number, h: number) => void back.addChild(Object.assign(panelBox(w, h), { x, y }));
      const x = x0 + 18;
      const w = pw - 36;
      const name = bigText(sc ? (mapNames[chosen] ?? said(sc.mapName.replace(/\.h3m$/i, ""))) : said(c.name), "bigfont", YELLOW, 1.5, { wrap: w });
      name.position.set(x, y0 + 22);
      box(x0 + 10, y0 + 14, pw - 20, name.height + 16);
      const say = bigText(tr("Tap a region on the map to pick a scenario."), "medfont", WHITE, 1.5, { wrap: w });
      say.position.set(x, y0 + 22 + name.height + 22);
      box(x0 + 10, say.y - 8, pw - 20, say.height + 16);
      panel.addChild(name, say);
      const K = 1.5;
      const start = new DefButton("cbbegib.def", 0, 0);
      start.label = "button: Begin";
      start.disabled = !sc;
      start.onClick = () => void begin();
      const cancel = new DefButton("cbcancb.def", 0, 0);
      cancel.label = "button: Back";
      cancel.onClick = () => void showSet();
      let by = y0 + ph - 14;
      for (const b of [cancel, start]) {
        b.scale.set(K);
        by -= 40 * K;
        b.position.set(x0 + Math.round((pw - 146 * K) / 2), by);
        by -= 8;
        panel.addChild(b);
      }
      // The briefing and the bonus (their own page: the panel's small text is unreadable on a phone).
      const brief = await barButton(tr(en("Briefing and bonus")), 146 * K, 52, () => void briefing());
      brief.position.set(x0 + Math.round((pw - 146 * K) / 2), by - 52);
      panel.addChild(brief);
    };
    const briefing = async () => {
      const sc = c.scenarios[chosen];
      const page = await openPage(modals, { draw: () => draw() });
      const draw = async () => {
        // The original's BEGIN and BACK (CBBEGIB, CBCANCB), as on the campaign screen beside it.
        const parts = await pageColumn(said(c.name), { buttons: [["Begin", () => (page.close(), void begin()), !!sc, "cbbegib.def"], ["Back", () => page.close(), true, "cbcancb.def"]] });
        const area = contentArea();
        const content = new Container();
        let y = 0;
        const say = (t: Text, color: readonly [number, number, number], gap = 10) => {
          if (!t) return;
          const l = bigText(t, "medfont", color, 1.5, { wrap: area.w });
          l.y = y;
          content.addChild(l);
          y += l.height + gap;
        };
        say(tr("Campaign"), YELLOW, 4);
        say(said(c.description), WHITE, 18);
        if (sc) {
          say(mapNames[chosen] ?? said(sc.mapName.replace(/\.h3m$/i, "")), YELLOW, 4);
          say(said(sc.regionText), WHITE, 18);
          if (sc.bonuses.length) say(tr("Choose a bonus:"), YELLOW, 8);
          for (const [i, b] of sc.bonuses.entries()) {
            const { texture, text: hint } = await bonusIcon(b);
            const card = new Container();
            card.y = y;
            // On the menus' recessed box (menuBlocks' panelBox), the chosen one framed in yellow as the original's.
            card.addChild(panelBox(area.w, 76));
            if (i === bonus) card.addChild(new Graphics().rect(0, 0, area.w, 76).stroke({ color: 0xffff00, width: 3 }));
            if (texture) {
              const k = Math.min(1, 64 / texture.height, 58 / texture.width);
              card.addChild(Object.assign(new Sprite(texture), { x: 6, y: 6, scale: { x: k, y: k } }));
            }
            card.addChild(Object.assign(bigText(said(hint), "medfont", WHITE, 1.5, { w: area.w - 90 }), { x: 80, y: 22 }));
            card.eventMode = "static";
            card.cursor = "pointer";
            card.on("pointertap", () => !list.moved() && ((bonus = i), void draw()));
            content.addChild(card);
            y += 84;
          }
        }
        if (c.difficultyChosenByPlayer) {
          say(tr("Difficulty"), YELLOW, 8);
          // The original's five chess pieces (GSPBUT3-7), the chosen one pressed, as the New Game card's.
          const K = Math.min(1.5, area.w / (5 * 34));
          for (let i = 0; i < 5; i++) {
            const b = new DefButton(`gspbut${i + 3}.def`, i * 34 * K, y, -1, i === difficulty ? [1, 1, 2, 3] : [0, 1, 2, 3]);
            b.scale.set(K);
            b.label = `button: ${["Easy", "Normal", "Hard", "Expert", "Impossible"][i]}`;
            b.onClick = () => ((difficulty = i), void draw());
            content.addChild(b);
          }
          y += 32 * K + 12;
        }
        const list = scrollList(content, area);
        // The whole briefing on the menus' blue marble (CAMPBRF's, GSELPOP1's ground), title and buttons too, not brown
        // bands round a blue middle (2026-10-26: "colors mixed blue brown, we sure?"); the bonuses in their recessed boxes.
        const { w: pw, h: ph } = pageSize();
        const ground = await tiledPart(GSELPOP1, "ground", -1, pw, ph);
        if (ground) parts.addChildAt(ground, 0);
        parts.addChild(list.view);
        page.setContent(parts);
      };
      await draw();
      await page.show();
    };

    const drawPanel = async () => {
      if (phoneSized()) return drawPhonePanel();
      panel.removeChildren().forEach((ch) => ch.destroy({ children: true }));
      const brf = await loadImage("campbrf.pcx");
      panel.addChild(Object.assign(new Sprite(brf), { x: 456, y: 6 }));
      const text = (t: Text, x: number, y: number, font: "bigfont" | "smalfont" | "medfont", color: readonly [number, number, number] = WHITE, w = 286) => {
        const l = label(t, font, color, "left", w);
        l.position.set(x, y);
        panel.addChild(l);
        return l;
      };
      text(said(c.name), 481, 28, "bigfont", YELLOW);
      text(tr("Campaign Description"), 481, 63, "smalfont", YELLOW);
      text(wrap(c.description, 50, 8), 480, 86, "smalfont");
      const sc = c.scenarios[chosen];
      if (sc) {
        text(mapNames[chosen] ?? said(sc.mapName.replace(/\.h3m$/i, "")), 481, 219, "bigfont", YELLOW);
        // The scenario's size (SCNRMPSZ) in the corner, as VCMI's CBonusSelection.
        const head = heads[chosen];
        const sizeFrame = head ? ({ 36: 0, 72: 1, 108: 2, 144: 3 } as Record<number, number>)[head.size] ?? 4 : -1;
        const sz = sizeFrame >= 0 ? (await loadDef("scnrmpsz.def")).get(0)?.[sizeFrame] : undefined;
        if (sz) panel.addChild(Object.assign(new Sprite(sz.texture), { x: 735, y: 26 }));
        text(tr("Scenario Description"), 481, 253, "smalfont", YELLOW);
        text(wrap(sc.regionText, 50, 8), 480, 276, "smalfont");
        if (sc.bonuses.length) text(tr("Choose a bonus:"), 475, 432, "smalfont");
        for (const [i, b] of sc.bonuses.entries()) {
          const box = new Container();
          box.position.set(475 + i * 68, 455);
          const { texture, text: hint_ } = await bonusIcon(b);
          box.addChild(new Graphics().rect(0, 0, 60, 66).fill({ color: 0, alpha: 0.4 }));
          if (texture) {
            const s = new Sprite(texture);
            s.width = Math.min(58, s.width);
            s.height = Math.min(64, s.height);
            s.position.set(1, 1);
            box.addChild(s);
          }
          if (i === bonus) box.addChild(new Graphics().rect(0, 0, 60, 66).stroke({ color: 0xffff00, width: 2 }));
          box.eventMode = "static";
          box.cursor = "pointer";
          box.on("pointertap", () => {
            bonus = i;
            void drawPanel();
          });
          box.on("pointerover", () => hint(said(hint_)));
          box.on("pointerout", () => hint(said("")));
          panel.addChild(box);
        }
      }
      // Allies and enemies (VCMI's CFlagBox at 486, 407); a bonus's words there while the mouse is on it.
      const flagBox = new Container();
      const head = heads[chosen];
      if (head) {
        const flags = (await loadDef("itgflags.def")).get(0) ?? [];
        const me = Math.max(0, head.players.findIndex((p) => p.canHuman));
        const active = head.players.map((p, i) => (p.canHuman || p.canComputer ? i : -1)).filter((i) => i >= 0 && i !== me);
        const team = head.players[me]?.team;
        const allies = active.filter((i) => team !== undefined && head.players[i].team === team);
        const enemies = active.filter((i) => !allies.includes(i));
        for (const [x, title, who] of [[486, "Allies:", [me, ...allies]], [619, "Enemies:", enemies]] as const) {
          const t = label(said(title), "smalfont", YELLOW);
          t.position.set(x, 407);
          flagBox.addChild(t);
          who.forEach((p, k) => {
            const f = flags[p];
            if (f) flagBox.addChild(Object.assign(new Sprite(f.texture), { x: x + t.width + 4 + 12 * k, y: 407 }));
          });
        }
      }
      panel.addChild(flagBox);
      const status = text(said(""), 486, 407, "smalfont");
      status.visible = false;
      const hint = (t: Text) => {
        status.value = t;
        status.visible = !!t;
        flagBox.visible = !t;
      };
      // Difficulty: the current one's icon; arrows when the campaign lets the player choose.
      const diffLabel = label(tr("Difficulty"), "medfont", WHITE, "center", 100);
      diffLabel.position.set(724 - 50, 432);
      panel.addChild(diffLabel);
      const diffIcon = (await loadDef(`gspbut${difficulty + 3}.def`)).get(0)?.[0];
      if (diffIcon) {
        // A right-click on it says what the level means (HELP.TXT 24-28, VCMI's difficultyIconAreas).
        await loadButtonHelp().catch(() => {});
        const icon = Object.assign(new Sprite(diffIcon.texture), { x: 709, y: 455, eventMode: "static" as const });
        const row = helpRow(24 + difficulty);
        if (row) hoverHelp(icon, () => row);
        panel.addChild(icon);
      }
      if (c.difficultyChosenByPlayer) {
        const less = new DefButton("scnrblf.def", 694, 508);
        less.onClick = () => ((difficulty = Math.max(0, difficulty - 1)), void drawPanel());
        const more = new DefButton("scnrbrt.def", 738, 508);
        more.onClick = () => ((difficulty = Math.min(4, difficulty + 1)), void drawPanel());
        panel.addChild(less, more);
      }
      const start = new DefButton("cbbegib.def", 475, 536);
      start.disabled = !sc;
      start.onClick = () => void begin();
      const back = new DefButton("cbcancb.def", 624, 536);
      back.onClick = () => void showSet();
      panel.addChild(start, back);
      keys = (k) => {
        if (k === "Enter" && !start.disabled) return (void begin(), true);
        if (k === "Escape") return (void showSet(), true);
        if (!c.difficultyChosenByPlayer || (k !== "ArrowLeft" && k !== "ArrowRight")) return false;
        difficulty = Math.max(0, Math.min(4, difficulty + (k === "ArrowLeft" ? -1 : 1)));
        return (void drawPanel(), true);
      };
    };

    const begin = async () => {
      const sc = c.scenarios[chosen];
      if (!sc) return;
      // A campaign's own intro before its first scenario, then the scenario's prologue: its video, music and scrolling text.
      if (!progress.conquered.length && CAMPAIGN_INTRO[file]) await fullVideo(modals, CAMPAIGN_INTRO[file]);
      if (sc.prologue) await prologue(modals, sc.prologue);
      const b = sc.bonuses[bonus];
      // The heroes come from the scenario won last, or the one the bonus names; the scenario's own
      // travel options say what of them comes along (VCMI's CGameStateCampaign). Dragon Slayer's
      // third scenario takes no creatures, as VCMI's special case.
      const source = b?.type === "previousHeroes" ? b.scenario : progress.last;
      const pool = source === undefined ? progress.carried : (progress.pools?.[source] ?? (source === progress.last ? progress.carried : []));
      const slayerThird = file === "slayer" && progress.conquered.length === 2;
      const start: CampaignStart = { carried: trimCarried(pool, sc, slayerThird), byType: trimCarried(progress.heroes ?? progress.carried, sc, slayerThird), bonus: b, ...(progress.vars ? { vars: progress.vars } : {}) };
      saveProgress({ ...progress, current: chosen, bonus, difficulty });
      localStorage.setItem(PENDING, JSON.stringify({ ref: campaignMapRef(file, chosen), start, difficulty }));
      location.hash = "#map";
    };

    await drawMap();
    await drawPanel();
    // Around it, the screen as drawn (the region map and the blue panel beside it): the map picture alone is black
    // where CAMPBRF goes, and that black came back mirrored above and below the panel.
    // (A render of the whole screen, not a picture cut into parts: windowParts has nothing to do with it.)
    const screen = new Rectangle(0, 0, 800, 600);
    if (!root.destroyed) root.addChildAt(surrounded(app.renderer.generateTexture({ target: root, frame: screen }), true), 0);
  };

  const resume = localStorage.getItem("heroes.campaign.open");
  if (resume) {
    localStorage.removeItem("heroes.campaign.open");
    // (The set picker shows the campaign's own set.)
    const own = SETS.findIndex((st) => st.items.some((it) => it.file === resume));
    if (own >= 0) {
      set = own;
      pick.value = String(own);
      localStorage.setItem("heroes.campaignSet", String(own));
    }
    await showCampaign(resume);
  } else await showSet();
}

/** The texts carry the original's line breaks: keep paragraphs, let the label wrap the rest. */
function wrap(text: string, _width: number, _lines: number): Text {
  return said(text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .join("\n\n"));
}

/**
 * A campaign bonus's words as the original's (VCMI's CBonusSelection, GENRLTXT 715-722): "Start with %s",
 * "Start with a scroll of %s", "Start with %d %s", "Start with %s %s", "Start with a random hero"; null
 * without the game files (ours then).
 */
async function originalBonusText(b: CampaignBonus): Promise<string | null> {
  const data = await loadData().catch(() => null);
  if (!data) return null;
  const g = (id: number, ...args: (string | number)[]) => resolveText({ file: "genrltxt", id, args });
  const spell = (id: number) => data.spells?.find((x) => x.id === id)?.name ?? "";
  switch (b.type) {
    case "spell":
      return g(715, spell(b.spell));
    case "scroll":
      return g(716, spell(b.spell));
    case "creatures":
      return g(717, b.amount, data.creatures[b.creature]?.plural ?? "");
    case "artifact":
      return g(715, data.artifacts[b.artifact]?.name ?? "");
    case "secondary": {
      const level = (await resolveText({ file: "skilllev", id: b.mastery - 1 }))?.trim() ?? "";
      const skill = (await resolveText({ file: "sstraits", id: b.skill }))?.trim() ?? "";
      return g(718, level, skill);
    }
    case "resource": {
      const name = b.resource === 0xfd ? await g(721) : b.resource === 0xfe ? await g(722) : (await resolveText({ file: "restypes", id: b.resource }))?.trim();
      return name ? g(717, b.amount, name) : null;
    }
    case "hero":
      return b.hero < 0 ? g(720) : g(715, data.heroNames[b.hero] ?? "");
    default:
      return null;
  }
}
