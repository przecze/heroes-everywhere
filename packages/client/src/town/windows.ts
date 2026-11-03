// Original town building windows: Town Hall + build, Fort, Mage Guild, Tavern, Marketplace,
// Shipyard and dwellings (recruit). Positions follow VCMI's town windows.
import { MOD_TEXTS } from "@heroes/core";
import { FRAME_PAD, SPLIT, fitUpright, placeSideways, sidewaysScale, splitLine } from "../ui/blocks/phoneWindow.ts";
import { spellText } from "../ui/spellText.ts";
import { untilReleased } from "../touch.ts";
import {
  hallLevel,
  fortLevel,
  BANK_LOAN,
  townService,
  townFeature,
  townWindow,
  cannotBorrow,
  type AdventureAction,
  makeHero,
  heroArmy,
  tavernArmy,
  mapHeroesOf,
  MAX_HEROES,
  type AdventureState,
  type AdvObject,
  B,
  AIRSHIP_PRICE,
  BOAT_PRICE,
  boatCost,
  isAirshipYard,
  HERO_CLASSES,
  HERO_COST,
  HERO_INFO,
  SPELLBOOK_COST,
  TOWNS,
  type World,
  buildingCost,
  buildingDescription,
  buildingName,
  cannotBuild,
  NOT_IN_TOWN,
  FORBIDDEN_HERE,
  SHORT_OF_RESOURCES,
  missingBuildings,
  hallChoice,
  recruitOffers,
  townLevelCreature,
  cannotBuildBoat,
  boatKind,
  cannotBuyMachine,
  blacksmithMachine,
  MACHINE_CREATURE,
  machinePrice,
  cannotHire,
  dwellingId,
  recruitsLevel,
  levelCount,
  guildLevel,
  marketCount,
  artifactOffer,
  tavernLevel,
  thievesGuild,
  tradeRate,
  PLAYER_NAMES,
  visitingHero,
  weeklyGrowth,
  blackMarketStock,
  junkmanPrice,
  cannotBuyMachineAt,
  cannotLearnSkill,
  universityOffer,
  universityCost,
  freelancerPrice,
  isEvil,
  creatureSacrificeXp,
  artifactSacrificeXp,
  experienceForLevel,
  SKILLS,
  castleGateTowns,
  manaVortexRefusal,
  weekIndex,
  maxMana,
  visitTile,
  SPECIAL,
  hasSpecial,
  dateLine,
} from "@heroes/core";
import { thievesGuildWindow } from "../ui/thievesGuild.ts";
import { gameLines, heroClassName, originalWords, resolveText, tavernRumours, textTable, englishLine } from "../ui/gameText.ts";
import { objectListWindow } from "../ui/objectList.ts";
import { phoneSized, screenSize } from "../ui/screen.ts";
import { openPage } from "../ui/mobilePage.ts";
import { type HallEntry, mobileHall } from "./mobileHall.ts";
import { extra } from "../settings.ts";
import { mobileMarket } from "./mobileMarket.ts";
import { mobileTavern } from "./mobileTavern.ts";
import { mobileGuild } from "./mobileGuild.ts";
import { guildSpellTap } from "./research.ts";
import { heroScreen } from "../ui/heroScreen.ts";
import { blackMarketWindow, freelancerWindow, junkmanWindow } from "../ui/tradeObjects.ts";
import { transformerWindow, universityWindow } from "../ui/markets.ts";
import { altarWindow } from "../ui/altar.ts";
import { Slider } from "../ui/blocks/slider.ts";
import { RESOURCE_SHOWCASE, RESOURCE_SLOT, centredText, fill, frameSprite, marketTexts, resourcePanel, selectionFrame, showcase, traderText } from "../ui/marketKit.ts";
import { videoSprite } from "../ui/video.ts";
import { AnimatedSprite, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { type FrameTexture, creaturePortrait, loadDef, loadImage, loadPng, heroPortrait, textureCanvas } from "../assets.ts";
import { WHITE, YELLOW } from "../text.ts";
import { DefButton, label, loadImagePlayer, smallFont } from "../ui/kit.ts";
import { type Modals } from "../ui/modals.ts";
import { YES_NO, messageBox, textPopup } from "../ui/dialogs.ts";
import { creatureHold } from "../ui/stackWindow.ts";
import { recruitWindow } from "../ui/recruit.ts";
import { creaturePic } from "../ui/creaturePic.ts";
import { massRecruitWindow } from "../ui/massRecruit.ts";
import { TOWN_UI } from "./townUi.ts";
import { townBackground, townDef, unpatched } from "./art.ts";
import { reason, rulesText, tr, said, fallback, fmt, type Text, NONE } from "../i18n/index.ts";
import { resourceName } from "../ui/resourceNames.ts";
import { GOLD } from "../ui/blocks/resourceBar.ts";
import { resourceFoot } from "../ui/blocks/shopTiles.ts";

export interface TownCtx {
  modals: Modals;
  player: number;
  state: () => AdventureState;
  world: () => World;
  town: () => AdvObject;
  send: (a: AdventureAction) => void;
  listen: (fn: () => void) => () => void;
  say: (text: string) => void;
  /** Shows another of the player's towns in this screen (the Castle Gate's destination). */
  goTo?: (townId: number) => void;
}

const faction = (o: AdvObject) => TOWNS[o.subid]?.faction ?? "castle";
export const ui = (o: AdvObject) => TOWN_UI[faction(o)] ?? TOWN_UI.castle;

/**
 * The hall's pictures of the town's buildings, by building id. VCMI numbers the frames by its own
 * building ids, where a level's second upgrade (the Cove's Gunpowder Warehouse) is 43 + its level.
 */
export async function buildingIcons(o: AdvObject): Promise<(id: number) => FrameTexture | undefined> {
  const info = TOWNS[o.subid];
  const icons = await townDef(ui(o).buildingsIcons.toLowerCase().replace(/\.def$/, "")).catch(() => null);
  // A HotA building in a classic town (the Conflux's Vault of Ashes) has no picture in the classic
  // hall's DEF: it gets its view on the town screen instead.
  const views = new Map<number, FrameTexture>();
  if (!/^hota\//i.test(ui(o).buildingsIcons))
    for (const [id, b] of Object.entries(info?.buildings ?? {})) if (/^hota\//i.test(b.def)) {
      const view = await townView(info.background, b).catch(() => null);
      if (view) views.set(Number(id), view);
    }
  return (id) => {
    const up2 = /^dwellingUp2Lvl(\d)$/.exec(info?.buildings[id]?.key ?? "");
    return views.get(id) ?? icons?.get(0)?.[up2 ? 43 + Number(up2[1]) : id];
  };
}

/** A hall-sized picture (150 x 70) of a building as it stands on the town screen, its scenery around it. */
async function townView(background: string, b: { def: string; x: number; y: number }): Promise<FrameTexture | null> {
  const [bg, def] = await Promise.all([townBackground(background), townDef(b.def)]);
  const f = def.get(0)?.[0];
  const canvasOf = textureCanvas;
  if (!f) return null;
  const W = 150;
  const H = 70;
  // The building's box with a margin, widened to the hall picture's shape.
  const pad = 12;
  let [x, y, w, h] = [b.x + f.x - pad, b.y + f.y - pad, f.texture.width + 2 * pad, f.texture.height + 2 * pad];
  if (w / h < W / H) (x -= (h * (W / H) - w) / 2), (w = h * (W / H));
  else (y -= (w * (H / W) - h) / 2), (h = w * (H / W));
  // Kept on the scenery.
  x = Math.max(0, Math.min(x, bg.width - w));
  y = Math.max(0, Math.min(y, bg.height - h));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;
  const k = W / w;
  c.drawImage(canvasOf(bg), -x * k, -y * k, bg.width * k, bg.height * k);
  c.drawImage(canvasOf(f.texture), (b.x + f.x - x) * k, (b.y + f.y - y) * k, f.texture.width * k, f.texture.height * k);
  return { texture: Texture.from(canvas), x: 0, y: 0, fullWidth: W, fullHeight: H };
}

/** Loads a town image named in the faction config (.bmp names are .pcx in the archives; HotA ones are PNGs). */
function townImage(name: string, player = -1, colorKey = false): Promise<Texture> {
  // The HotA towns name their guild picture without an extension ("hota/cove/town/mageguild") and
  // the base game's TPMAGE as "TPMAGE.png", which only the archives have (as a .pcx).
  if (!/\.[a-z]+$/i.test(name)) name += ".png";
  if (name.toLowerCase().endsWith(".png")) {
    const png = player >= 0 ? loadImagePlayer(name.toLowerCase(), player) : loadPng(name.toLowerCase(), colorKey);
    const base = unpatched(name) ?? (name.includes("/") ? null : name.slice(0, -4));
    return base ? png.catch(() => townImage(`${base}.pcx`, player)) : png;
  }
  const base = name.toLowerCase().replace(/\.(bmp|pcx)$/, "");
  return player >= 0 ? loadImagePlayer(`${base}.pcx`, player) : loadImage(`${base}.pcx`);
}

/**
 * The bottom bar of the full-screen town windows (hall, fort): KRESBAR in the player's colour over
 * the window's own bottom edge, amounts centred under the icons and the date on the right
 * (VCMI's CMinorResDataBar). The background's bar shows through otherwise, with its icons in
 * the player's colour and the amounts off their places.
 */
async function resourceRow(win: Container, res: number[], player: number, day: number) {
  const bar = await loadImagePlayer("kresbar.pcx", Math.max(0, player)).catch(() => null);
  const h = bar?.height ?? 22;
  if (bar) win.addChild(Object.assign(new Sprite(bar), { x: 7, y: 575 }));
  res.forEach((r, i) => {
    const l = label(said(String(r)), "smalfont", WHITE, "center", 70);
    l.centreOn(7 + 50 + 76 * i, 575 + Math.floor(h / 2));
    win.addChild(l);
  });
  // GENRLTXT 62-64: the original's words for the date (as the adventure map's bar).
  const words = await originalWords("genrltxt", { Month: 62, Week: 63, Day: 64 });
  const date = label(said(dateLine(day, ": ", [words("Month"), words("Week"), words("Day")])), "smalfont", WHITE, "center", 240);
  date.centreOn(7 + 545 + Math.floor(((bar?.width ?? 785) - 545) / 2), 575 + Math.floor(h / 2));
  win.addChild(date);
}

/** Opens the window for a clicked building: the one core's townWindow names (the wiki links the building to it the same way). */
export async function buildingClicked(ctx: TownCtx, id: number) {
  const o = ctx.town();
  switch (townWindow(o, id)) {
    case "hall":
      return hallWindow(ctx);
    case "fort":
      return fortWindow(ctx);
    case "mageGuild":
      return mageGuildWindow(ctx);
    case "tavern":
      return tavernWindow(ctx);
    case "market":
      return marketWindow(ctx);
    // The Cove's Thieves' Guild: the guild's report on the other players.
    case "thievesGuild":
      return void (await thievesGuildWindow(ctx.modals, ctx.player, thievesGuild(ctx.state(), ctx.world(), tavernLevel(ctx.state(), o.owner)), ctx.world().creatures, { resources: ctx.state().players[o.owner].resources, day: ctx.state().day }));
    // Dungeon's Mana Vortex (HotA): the town's hero asks for it.
    case "manaVortex":
      return manaVortexWindow(ctx);
    case "shipyard":
      return shipyardWindow(ctx);
    case "blacksmith":
      return blacksmithWindow(ctx);
    case "dwelling":
      return recruitLevel(ctx, recruitsLevel(o, id));
    case "info":
      break;
    default:
      if (await serviceWindow(ctx, id)) return;
  }
  // Anything else (Stables, Lighthouse, Library...) shows its picture and what it does, as the original.
  await buildingInfo(ctx, id);
}

/** The Mana Vortex (HotA's manual visit, the mod's texts): yes doubles the town's hero's spell points. */
async function manaVortexWindow(ctx: TownCtx) {
  const s = ctx.state();
  const o = ctx.town();
  // HotA: for the visiting hero only.
  const h = visitingHero(s, ctx.world(), o);
  if (!h) return buildingInfo(ctx, 21);
  const why = reason(manaVortexRefusal(o, h, weekIndex(s.day), maxMana));
  if (why) return void (await messageBox(ctx.modals, why, ctx.player));
  const yes = await messageBox(ctx.modals, tr(MOD_TEXTS["building.core.dungeon.special2.rewards.0"]), ctx.player, {
    buttons: [
      { def: "iokay.def", value: "yes" },
      { def: "icancel.def", value: "no" },
    ],
  });
  if (yes === "yes") ctx.send({ type: "manaVortex", town: o.id });
}

/**
 * Phones: the town's built buildings that do something beyond the bar's (hall, fort, guild, tavern,
 * market) and the creatures' (dwellings): the Blacksmith, the Shipyard and the factions' own
 * services (Castle Gate, Portal of Summoning, Mana Vortex, Thieves' Guild, Ballista Yard, the
 * traders and teachers), in the hall's order. They're shown as buttons with their names.
 */
export function townServices(w: World, o: AdvObject, possible?: AdventureState): { id: number; name: string }[] {
  const t = o.town;
  if (!t) return [];
  // `possible`: also those this town could build (as if built, for what they'd offer), for the phone's buttons.
  const as = (id: number): AdvObject => (t.built.includes(id) || !possible ? o : { ...o, town: { ...t, built: [...t.built, id] } });
  const could = (id: number) => t.built.includes(id) || (!!possible && cannotBuild(possible, w, o, id) !== NOT_IN_TOWN);
  // (The Bulwark's Fair is the bar's Market.)
  const own = (id: number) => { const f = townFeature(as(id), id); return !!f && f !== "market"; };
  const has = (id: number) => could(id) && (id === B.BLACKSMITH || id === B.SHIPYARD || own(id) || !!townService(as(id), id));
  const info = TOWNS[o.subid];
  const keyToId = (key: string) => Number(Object.entries(info.buildings).find(([, b]) => b.key === key)?.[0] ?? -1);
  const ids = ui(o).hallSlots.flat(2).map(keyToId).filter((id, i, all) => id >= 0 && all.indexOf(id) === i && has(id));
  return ids.map((id) => ({ id, name: buildingName(w, o, id) }));
}

/**
 * Special buildings that trade or teach, with the same windows as their map counterparts:
 * Artifact Merchants, Magic University, Freelancer's Guild, Skeleton Transformer, the Grotto,
 * Sieidi of Runes and the Factory's Bank. True when it handled the click.
 */
async function serviceWindow(ctx: TownCtx, id: number): Promise<boolean> {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  if (![17, 21, 22, 23].includes(id) || !o.town?.built.includes(id)) return false;
  const name = said(buildingName(w, o, id));
  const listen = ctx.listen;
  // Dungeon's Portal of Summoning: this week's creature from one of the player's dwellings.
  if (townFeature(o, id) === "portal") {
    const portal = o.data?.portal as { creature: number; available: number } | undefined;
    // TCOMMAND 30 (no flagged dwelling outside); 21 (recruit).
    const tc = await textTable("tcommand");
    if (!portal) return void (await messageBox(ctx.modals, tc(30, tr(`{%1}\n\nThe portal is dark: you own no creature dwellings on the map.`, name)), ctx.player)), true;
    const c = w.creatures[portal.creature];
    const r = await recruitWindow(ctx.modals, ctx.player, tc(21, tr(`Recruit %1`, c.plural), c.plural), [{ creature: c, available: portal.available, cost: c.cost }], s.players[o.owner].resources);
    if (r) ctx.send({ type: "recruitPortal", town: o.id, count: r.count });
    return true;
  }
  // Inferno's Castle Gate: to another town with one.
  if (townFeature(o, id) === "castleGate") {
    const hero = visitingHero(s, w, o);
    // GENRLTXT 126: only a visiting hero may use the Town Gate.
    if (!hero) return void (await messageBox(ctx.modals, (await resolveText({ file: "genrltxt", id: 126 })) ?? tr(`{%1}\n\nA hero must be visiting the town to use it.`, name), ctx.player)), true;
    const towns = castleGateTowns(s, o, (t) => visitTile(w, t) >= 0 && !w.heroAt[visitTile(w, t)], hero.owner);
    if (!towns.length) return void (await messageBox(ctx.modals, tr(`{%1}\n\nThere is no other town with a Castle Gate to go to.`, name), ctx.player)), true;
    // The original's list (TPGATE, JKTEXT 40 / 41) with the Castle Gate's picture, as VCMI's.
    const icon = await buildingIcons(o);
    const i = await objectListWindow(ctx.modals, ctx.player, {
      title: (await resolveText({ file: "jktext", id: 40 })) ?? name,
      description: (await resolveText({ file: "jktext", id: 41 })) ?? fallback("Select a town to go to."),
      items: towns.map((t) => t.name ?? fallback("Town")),
      picture: icon(22)?.texture,
    });
    if (i >= 0) {
      ctx.send({ type: "castleGate", hero: hero.id, town: o.id, to: towns[i].id });
      // As the original: the hero's new town takes the screen.
      ctx.goTo?.(towns[i].id);
    }
    return true;
  }
  // Stronghold's Ballista Yard: a ballista for the visiting hero.
  if (townFeature(o, id) === "ballistaYard") {
    // The blacksmith's window with the ballista (VCMI: the Ballista Yard opens the blacksmith dialog for it).
    const hero = visitingHero(s, w, o);
    const why = hero ? reason(cannotBuyMachineAt(s, w, hero, o, 4, o.owner)) : tr("A hero must be visiting the town to buy a ballista.");
    await blacksmithWindow(ctx, { art: 4, why, buy: () => hero && ctx.send({ type: "buyMachineAt", hero: hero.id, object: o.id, artifact: 4 }) });
    return true;
  }
  const kind = townService(o, id);
  if (!kind) return false;
  if (kind === "bank") {
    // (A loan still being paid back: said here, not left to the rules' refusal.)
    const why = cannotBorrow(o, o.owner);
    if (why) {
      await messageBox(ctx.modals, fmt`{${name}}\n\n${tr(why)}`, ctx.player);
      return true;
    }
    const ok = await messageBox(ctx.modals, tr(`{%1}\n\nBorrow %2 gold? The town's income drops by %3 for %4 days.`, name, BANK_LOAN.gold, BANK_LOAN.daily, BANK_LOAN.days), ctx.player, { buttons: YES_NO });
    if (ok === "yes") ctx.send({ type: "bankLoan", town: o.id });
    return true;
  }
  const hero = visitingHero(s, w, o);
  if (!hero) {
    await messageBox(ctx.modals, tr(`{%1}\n\nA hero must be visiting the town to use it.`, name), ctx.player);
    return true;
  }
  const h = () => ctx.state().heroes[hero.id];
  const at = { hero: hero.id, object: o.id };
  switch (kind) {
    case "artifacts": {
      // Straight into buying, as the original's Artifact Merchants (VCMI's CMarketWindow in RESOURCE_ARTIFACT mode), the
      // market's own button switching to selling and back; not a list of two lines to pick from first (2026-10-27).
      for (let selling = false; ; selling = !selling) {
        const again = !selling
          ? await blackMarketWindow(ctx.modals, ctx.player, {
              stock: () => blackMarketStock(ctx.state(), ctx.world(), ctx.state().objects[o.id]),
              artifacts: w.data.artifacts,
              gold: () => ctx.state().players[o.owner].resources[6],
              buy: (slot, resource) => ctx.send({ type: "buyArtifact", ...at, slot, resource }),
              listen,
              // Any resource pays, the better the more marketplaces the player has (VCMI's IMarket).
              market: { title: name, price: (a, r) => artifactOffer(marketCount(ctx.state(), o.owner), w.data.artifacts[a]?.cost ?? 0, r, "buy"), resources: () => ctx.state().players[o.owner].resources },
              other: tr("Sell artifacts"),
            })
          : await junkmanWindow(ctx.modals, ctx.player, {
              hero: h,
              artifacts: w.data.artifacts,
              price: (a) => junkmanPrice(w, a),
              sell: (artifact, resource) => ctx.send({ type: "sellArtifact", ...at, artifact, resource }),
              listen,
              market: { title: name, price: (a, r) => artifactOffer(marketCount(ctx.state(), o.owner), w.data.artifacts[a]?.cost ?? 0, r, "sell"), resources: () => ctx.state().players[o.owner].resources },
              other: tr("Buy artifacts"),
            });
        if (!again) break;
      }
      return true;
    }
    case "university":
      await universityWindow(ctx.modals, ctx.player, {
        hero: h,
        gold: () => ctx.state().players[o.owner].resources[6],
        skills: universityOffer(s, o),
        learn: (skill) => ctx.send({ type: "learnSkill", ...at, skill }),
        why: (skill) => reason(cannotLearnSkill(ctx.state(), h(), o, skill, w)),
        listen,
        // The Conflux's Magic University: the building's own name and picture, the schools' prices.
        town: { title: name, picture: (await buildingIcons(o))(id)?.texture, resources: () => ctx.state().players[o.owner].resources, cost: (skill) => universityCost(o, skill) },
      });
      return true;
    case "freelancers":
      // Paid by the marketplaces owned, in any resource.
      await freelancerWindow(ctx.modals, ctx.player, { title: name, hero: h, creatures: w.creatures, price: (c, n, r) => freelancerPrice(w, c, n, marketCount(ctx.state(), o.owner), r), sell: (slot, count, resource) => ctx.send({ type: "sellStack", ...at, slot, count, resource }), listen });
      return true;
    case "transformer":
      await transformerWindow(ctx.modals, ctx.player, { hero: h, creatures: w.creatures, transform: (slots) => ctx.send({ type: "transform", ...at, slots }) });
      return true;
    case "altar":
      await altarWindow(ctx.modals, ctx.player, {
        hero: h,
        evil: isEvil(hero),
        creatures: w.creatures,
        artifacts: w.data.artifacts,
        creatureXp: (c) => creatureSacrificeXp(w, c),
        artifactXp: (a) => artifactSacrificeXp(w, a),
        sacrifice: (a) => ctx.send({ type: "sacrifice", ...at, ...a }),
        toNextLevel: () => experienceForLevel(h().level + 1) - h().experience,
        listen,
      });
      return true;
    case "runes": {
      const ok = await messageBox(ctx.modals, tr(`{%1}\n\n${MOD_TEXTS["building.hota.bulwark.bulwark.special2.rewards.0"]}`, name), ctx.player, { buttons: YES_NO });
      if (ok === "yes") ctx.send({ type: "learnSkill", ...at, skill: SKILLS.indexOf("runes") });
      return true;
    }
  }
  return false;
}

/** HotA's recruit-all window: every built dwelling's best creature, counts preset to what the treasury buys. */
/**
 * HotA's Recruit all window. EXTRAS oneRecruitWindow (2026-10-26: one recruit window, no dwelling's own): `only`
 * a dwelling level, opened from that dwelling (or the creature's picture) with its creature counted to the most it
 * buys; none, from the fort's button, with the most of all, the strongest first.
 */
export async function massRecruit(ctx: TownCtx, only?: number) {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const t = o.town!;
  // Each level's best offer (the Cove's Sea Dogs first, as the dwelling's own window); the one asked for even with
  // none left this week.
  // One recruit window: every built dwelling, none left too (2026-10-26: the window with its zeros, not a message).
  const one = extra("oneRecruitWindow");
  const levels = Array.from({ length: levelCount(o) }, (_, l) => l).filter((l) => recruitOffers(o, l).length && (one || t.available[l] > 0 || l === only));
  if (!levels.length) return void messageBox(ctx.modals, tr("There are no creatures to recruit this week."), ctx.player);
  const offers = levels.map((l) => recruitOffers(o, l));
  const choices = levels.map((l, i) => {
    const c = w.creatures[offers[i][0].creature];
    return { creature: c, available: t.available[l], cost: c.cost, alts: offers[i].map((x) => w.creatures[x.creature]) };
  });
  const preset = !one ? undefined : only === undefined ? ("all" as const) : levels.indexOf(only);
  const picks = await massRecruitWindow(ctx.modals, ctx.player, tr("Recruit Creatures"), choices, s.players[o.owner].resources, preset);
  picks?.forEach(({ count, pick }, i) => {
    const best = offers[i][pick];
    if (count > 0 && best) ctx.send({ type: "recruit", town: o.id, level: levels[i], upgraded: best.upgraded, count, ...(best.second ? { second: true } : {}) });
  });
}

/**
 * The recruit window for one dwelling level: the basic creature and, if built, the upgrade. Its own window on every
 * layout, from the dwelling, the fort's list or the phone town's creatures (2026-10-30: "show the recruitment
 * dialog for this unit only, not shared"; Recruit all only from the fort's button).
 */
async function recruitLevel(ctx: TownCtx, level: number) {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const t = o.town!;
  // (HotA's second upgrade, the Cove's Sea Dogs, first: the best on offer.)
  const offers = recruitOffers(o, level);
  if (!offers.length) return;
  const choices = offers.map(({ creature }) => ({ creature: w.creatures[creature], available: t.available[level], cost: w.creatures[creature].cost }));
  const tc = await textTable("tcommand");
  const r = await recruitWindow(ctx.modals, ctx.player, (c) => tc(21, tr(`Recruit %1`, c.plural), c.plural), choices, s.players[o.owner].resources);
  const pick = r && offers[r.index];
  if (pick) ctx.send({ type: "recruit", town: o.id, level, upgraded: pick.upgraded, count: r.count, ...(pick.second ? { second: true } : {}) });
}

// ---- Blacksmith -------------------------------------------------------------

/** The town's war machine on TPSMITBK, its price, Buy and Cancel (as CBlacksmithDialog). */
async function blacksmithWindow(ctx: TownCtx, other?: { art: number; why: string | null; buy: () => void }) {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const art = other?.art ?? blacksmithMachine(o);
  const c = w.creatures[MACHINE_CREATURE[art]];
  // (The rules' reasons are English: said in the player's language, as every window's.)
  const why = reason(other ? other.why : cannotBuyMachine(s, w, o));
  // The machine on the smithy's backdrop (TPSMITBK).
  const picture = new Container();
  const back = new Sprite(await loadImage("tpsmitbk.pcx"));
  picture.addChild(back);
  const frames = await loadDef(c.def).catch(() => null);
  const f = frames?.get(2)?.[0] ?? frames?.get(0)?.[0];
  if (f) {
    const mask = new Graphics().rect(0, 0, back.width, back.height).fill(0xffffff);
    const sp = new Sprite(f.texture);
    sp.position.set(f.x - 70, f.y - 105);
    // A machine whose frame stands elsewhere on its 450 x 400 battle canvas (the First Aid Tent, at the field's right
    // edge) spilt out of the backdrop: centred on it instead, standing on its ground (a 2026-11-02 note: "Sprite misplaced").
    if (sp.x < 0 || sp.y < 0 || sp.x + sp.width > back.width || sp.y + sp.height > back.height)
      sp.position.set(Math.round((back.width - sp.width) / 2), Math.max(0, Math.round(back.height * 0.92 - sp.height)));
    sp.mask = mask;
    picture.addChild(mask, sp);
  }
  // GENRLTXT 274 "Build a new %s", JKTEXT 43 "Resource cost:" (VCMI's CBlacksmithDialog).
  const titleText = (await resolveText({ file: "genrltxt", id: 274, args: [c.name] })) ?? tr(`Build a new %1`, c.name);
  const costText = (await resolveText({ file: "jktext", id: 43 })) ?? tr("Resource cost:");
  if (phoneSized()) {
    const cost = [0, 0, 0, 0, 0, 0, machinePrice(w, art)];
    await phoneBuy(ctx, { title: titleText, name: said(c.name), picture, note: why ?? costText, why, cost, buy: () => (other ? other.buy() : ctx.send({ type: "buyMachine", town: o.id })) });
    return;
  }
  const win = new Container();
  win.addChild(new Sprite(await loadImagePlayer("tpsmith.pcx", ctx.player)));
  picture.position.set(64, 50);
  win.addChild(picture);
  const title = label(titleText, "bigfont", YELLOW, "center", 300);
  title.centreOn(165, 28);
  win.addChild(title);
  const costTitle = label(costText, "medfont", WHITE, "center", 300);
  costTitle.centreOn(165, 218);
  win.addChild(costTitle);
  const gold = ((await loadDef("resource.def")).get(0) ?? [])[6];
  if (gold) win.addChild(Object.assign(new Sprite(gold.texture), { x: 165 - 16, y: 238 }));
  const cost = label(said(String(machinePrice(w, art))), "medfont", WHITE, "center", 300);
  cost.centreOn(165, 292);
  win.addChild(cost);
  return new Promise<void>((resolve) => {
    let close = () => {};
    const done = () => (close(), resolve());
    const buy = new DefButton("ibuy30.def", 42, 312);
    buy.disabled = !!why;
    buy.explain(ctx.modals, ctx.player, () => why);
    buy.onClick = () => {
      done();
      if (other) other.buy();
      else ctx.send({ type: "buyMachine", town: o.id });
    };
    const cancel = new DefButton("icancel.def", 224, 312);
    buildHints(buy, cancel, c.name);
    cancel.onClick = done;
    win.addChild(buy, cancel);
    if (why) {
      const note = label(tr(why), smallFont(), WHITE, "center", 300);
      // Along the foot of the picture, on a dark band: clear of the price and the gold.
      const band = new Graphics().rect(64, 50 + back.height - 18, back.width, 18).fill({ color: 0x000000, alpha: 0.7 });
      note.position.set(15, 50 + back.height - 15);
      win.addChild(band, note);
    }
    close = ctx.modals.show(win, { onKey: (k) => (k === "Escape" ? done() : k === "Enter" && !why ? buy.onClick!() : undefined, true) });
  });
}

// ---- Town Hall --------------------------------------------------------------

/** Build states as the hall shows them: bar frame (TPTHBAR) and mark (TPTHCHK). */
function buildState(s: AdventureState, w: World, o: AdvObject, id: number): { bar: number; mark: number; why: string | null } {
  if (o.town!.built.includes(id)) return { bar: 0, mark: 0, why: "Already built." };
  const why = cannotBuild(s, w, o, id);
  if (!why) return { bar: 1, mark: -1, why: null };
  if (why === SHORT_OF_RESOURCES) return { bar: 2, mark: 2, why };
  // Grey, without a mark, when it can never be built here: VCMI's CHallInterface::CBuildingBox puts
  // HAVE_CAPITAL and FORBIDDEN on TPTHBAR's grey frame, like a building the town hasn't.
  if (why === NOT_IN_TOWN || why === "You already have a Capitol." || why === FORBIDDEN_HERE) return { bar: 3, mark: -1, why };
  return { bar: 2, mark: 1, why };
}

/**
 * The original's words for why a building can or can't be built (HALLINFO.TXT and GENRLTXT.TXT, as
 * VCMI's CBuildWindow::getTextForState): the build window's line, or with `hover` the hall's status bar.
 */
async function stateText(w: World, o: AdvObject, id: number, why: string | null, hover = false): Promise<Text> {
  const name = buildingName(w, o, id);
  const hall = (n: number) => resolveText({ file: "hallinfo", id: n, args: [name] });
  if (why === null) return (hover ? await hall(7) : await resolveText({ file: "genrltxt", id: 219 })) ?? (hover ? tr("Build %1", name) : englishLine("genrltxt", 219));
  if (why === "Already built.") return (await hall(4)) ?? rulesText(why);
  if (why === "Already built here today.") return (await resolveText({ file: "genrltxt", id: 223 })) ?? rulesText(why);
  if (why === SHORT_OF_RESOURCES) return (await hall(6)) ?? rulesText(why);
  if (why === "You already have a Capitol.") return (await hall(0)) ?? rulesText(why);
  if (why === FORBIDDEN_HERE) return (await hall(2)) ?? tr(why);
  if (why === "Requirements not met." || why.startsWith("Requires ")) {
    if (hover) return (await hall(5)) ?? rulesText(why);
    const missing = missingBuildings(w, o, id);
    return missing.length ? fmt`${(await resolveText({ file: "genrltxt", id: 52 })) ?? fallback("Requires:")}\n${said(missing.join(", "))}` : tr(why);
  }
  // (The rules' reason, in the player's language: i18n tables, test "every refusal of the rules".)
  return tr(why);
}


/** The build window for one of the hall's buildings; answers whether it was built. */
export const buildPick = (ctx: TownCtx, id: number) => buildWindow(ctx, id, buildState(ctx.state(), ctx.world(), ctx.town(), id).why);

/** The hall's buildings as the upright phone's list shows them (each slot's current choice, with its state and picture). */
function hallEntries(ctx: TownCtx, icon: (id: number) => FrameTexture | undefined): () => HallEntry[] {
  const info = TOWNS[ctx.town().subid];
  const keyToId = (key: string) => Number(Object.entries(info.buildings).find(([, b]) => b.key === key)?.[0] ?? -1);
  return () =>
    ui(ctx.town()).hallSlots.flat().flatMap((keys) => {
      const id = hallChoice(ctx.town(), keys.map(keyToId).filter((id) => id >= 0 && info.buildings[id]));
      if (id < 0) return [];
      const st = buildState(ctx.state(), ctx.world(), ctx.town(), id);
      return [{ id, name: buildingName(ctx.world(), ctx.town(), id), bar: st.bar, mark: st.mark, why: st.why, icon: icon(id)?.texture }];
    });
}

async function hallWindow(ctx: TownCtx) {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const info = TOWNS[o.subid];
  const u = ui(o);
  // Phones: the hall's tiles in a list a finger drags, two to a row upright (the 800 x 600 window would be shrunk
  // unreadable, sideways too: its names in the small font at half size).
  if (phoneSized()) {
    const hall = B.VILLAGE_HALL + Math.max(0, hallLevel(o.town!.built));
    const entries = hallEntries(ctx, await buildingIcons(o));
    // Gold and what the buildings still to build cost (the resources that matter here), as the town's docked bar.
    const resources = async (room: number) => {
      const need = new Set(entries().filter((e) => e.bar !== 0).flatMap((e) => buildingCost(ctx.world(), ctx.town(), e.id).flatMap((n, r) => (n > 0 && r !== GOLD ? [r] : []))));
      const show = [GOLD, ...[0, 2, 1, 3, 4, 5].filter((r) => need.has(r))];
      // One row across the page, as the town's docked bar (at most twice its size).
      return resourceFoot(ctx.player, ctx.state().players[ctx.town().owner]?.resources ?? [], show, room);
    };
    return mobileHall(ctx.modals, said(buildingName(w, o, hall)), entries, (id) => buildPick(ctx, id), (e) => void hallTileInfo(ctx, e.id, e.why, e.bar), resources);
  }
  const win = new Container();
  win.addChild(new Sprite(await townImage(u.hallBackground, ctx.player)));
  const keyToId = (key: string) => Number(Object.entries(info.buildings).find(([, b]) => b.key === key)?.[0] ?? -1);
  const icon = await buildingIcons(o);
  const [bars, marks] = await Promise.all([loadDef("tpthbar.def"), loadDef("tpthchk.def")]);
  const hall = B.VILLAGE_HALL + Math.max(0, hallLevel(o.town!.built));
  const title = label(said(buildingName(w, o, hall)), "medfont", WHITE, "center", 400);
  title.centreOn(399, 12);
  win.addChild(title);
  const status = label(said(""), "smalfont", WHITE, "center", 740);
  status.position.set(5, 559);
  win.addChild(status);
  await resourceRow(win, s.players[o.owner].resources, ctx.player, s.day);
  return new Promise<void>((resolve) => {
    let close = () => {};
    u.hallSlots.forEach((row, r) => {
      row.forEach((keys, col) => {
        // The first not-yet-built building of the chain (or the last built one).
        const id = hallChoice(o, keys.map(keyToId).filter((id) => id >= 0 && info.buildings[id]));
        if (id < 0) return;
        const st = buildState(s, w, o, id);
        const x = 400 - (row.length * 154) / 2 - (row.length - 1) * 20 + 194 * col;
        const y = 35 + 104 * r;
        const box = new Container();
        box.position.set(x, y);
        const pic = icon(id);
        if (pic) box.addChild(Object.assign(new Sprite(pic.texture), { x: 2, y: 2 }));
        const bar = bars.get(0)?.[st.bar];
        if (bar) box.addChild(Object.assign(new Sprite(bar.texture), { x: 1, y: 73 }));
        const mark = st.mark >= 0 ? marks.get(0)?.[st.mark] : undefined;
        if (mark) box.addChild(Object.assign(new Sprite(mark.texture), { x: 136, y: 56 }));
        const name = label(said(buildingName(w, o, id)), "smalfont", WHITE, "center", 150);
        name.centreOn(78, 81);
        box.addChild(name);
        box.eventMode = "static";
        box.cursor = "pointer";
        box.label = `building: ${buildingName(w, o, id)}`;
        box.on("pointerover", () => void stateText(w, o, id, st.why, true).then((t) => (status.value = t)));
        box.on("rightdown", (e) => void hallTileInfo(ctx, id, st.why, st.bar));
        box.on("pointertap", async (e) => {
          if (st.bar === 0 || e.button === 2) return;
          const built = await buildWindow(ctx, id, said(st.why));
          if (built) {
            close();
            resolve();
          }
        });
        win.addChild(box);
      });
    });
    const exit = new DefButton("tpmage1.def", 748, 556);
    exit.onClick = () => (close(), resolve());
    win.addChild(exit);
    close = ctx.modals.show(win, {
      x: 0,
      y: 0,
      onKey: (k) => {
        if (k === "Escape" || k === "Enter") (close(), resolve());
        return true;
      },
    });
  });
}

/**
 * Right-click (a long tap on a touch screen) on a hall tile: the building's picture, what it does and
 * whether it can be built, while held (VCMI's CHallInterface::CBuildingBox popup). `bar`: TPTHBAR's state.
 */
async function hallTileInfo(ctx: TownCtx, id: number, why: string | null, bar: number) {
  const ac = new AbortController();
  untilReleased(() => ac.abort(), { popup: true });
  const w = ctx.world();
  const o = ctx.town();
  const pic = (await buildingIcons(o))(id);
  const text = said([buildingDescription(w, o, id), bar === 0 ? "" : await stateText(w, o, id, why)].filter(Boolean).join("\n\n"));
  // Beyond HotA (EXTRAS hallCosts): what it costs under the picture, while it isn't built, so one can see what's
  // short (2026-10-31 19:50): the resource icons with their amounts in a row, as the Build window's.
  let costs: Container | undefined;
  if (bar !== 0 && extra("hallCosts")) {
    const res = (await loadDef("resource.def")).get(0) ?? [];
    const items = buildingCost(w, o, id).map((n, r) => [r, n] as const).filter(([r, n]) => n > 0 && res[r]);
    costs = new Container();
    const STEP = 64;
    items.forEach(([r, n], k) => {
      const f = res[r];
      costs!.addChild(Object.assign(new Sprite(f.texture), { x: k * STEP + (STEP - f.texture.width) / 2, y: 0 }));
      const t = label(said(String(n)), smallFont(), WHITE, "center", STEP);
      t.position.set(k * STEP, f.texture.height + 4);
      costs!.addChild(t);
    });
  }
  void messageBox(ctx.modals, text || said(buildingName(w, o, id)), ctx.player, { title: said(buildingName(w, o, id)), components: pic ? [{ texture: pic.texture, caption: NONE }] : [], signal: ac.signal, held: true, below: costs });
}

/** The build confirmation window (TPUBUILD): picture, name, cost, Buy / Cancel. */
async function buildWindow(ctx: TownCtx, id: number, why: string | null): Promise<boolean> {
  const w = ctx.world();
  const o = ctx.town();
  if (phoneSized()) return mobileBuild(ctx, id, why);
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("tpubuild.pcx", ctx.player));
  win.addChild(bg);
  const icon = await buildingIcons(o);
  const pic = icon(id);
  if (pic) win.addChild(Object.assign(new Sprite(pic.texture), { x: 125, y: 50 }));
  // VCMI's CBuildWindow: HALLINFO 7 ("Build %s") in white.
  const nameText = (await resolveText({ file: "hallinfo", id: 7, args: [buildingName(w, o, id)] })) ?? fallback(`Build ${buildingName(w, o, id)}`);
  const name = label(nameText, "medfont", WHITE, "center", bg.width - 40);
  name.position.set(20, 22);
  win.addChild(name);
  // What the building does (VCMI's CBuildWindow: a 329x67 box under the picture), then whether it can be built.
  const text = said(buildingDescription(w, o, id));
  if (text) {
    let d = label(text, "medfont", WHITE, "center", 329);
    if (d.height > 67) d = label(text, "smalfont", WHITE, "center", 329);
    d.position.set(33, 135 + Math.max(0, (67 - d.height) / 2));
    win.addChild(d);
  }
  // Whether it can be built: a box (33, 216, 329 x 67), the lines centred in it.
  const stateLine = await stateText(w, o, id, why);
  const note = label(stateLine, "smalfont", WHITE, "center", 329);
  note.position.set(33, 216 + Math.max(0, (67 - note.height) / 2));
  win.addChild(note);
  // Costs: resource icons with amounts in a row.
  const cost = buildingCost(w, o, id);
  const res = (await loadDef("resource.def")).get(0) ?? [];
  const items = cost.map((n, i) => [i, n]).filter(([, n]) => n > 0);
  // The costs as small components centred in the box (25, 300, w - 50 x 130) as VCMI's CComponentBox: as many to a
  // row as its width holds, the rest on a second row (six costs ran out of the window, a player's note 2026-10-28).
  const iconH = res[0]?.texture.height ?? 32;
  const STEP = 70;
  const perRow = Math.max(1, Math.floor((bg.width - 50) / STEP));
  const rows = Math.ceil(items.length / perRow);
  const inRow = Math.ceil(items.length / rows);
  const lineH = iconH + 22;
  const rowTop = 300 + (130 - rows * lineH) / 2;
  items.forEach(([r, n], k) => {
    const row = Math.floor(k / inRow);
    const count = Math.min(inRow, items.length - row * inRow);
    const x = bg.width / 2 - (count * STEP) / 2 + (k % inRow) * STEP + STEP / 2;
    const y = rowTop + row * lineH;
    const f = res[r];
    if (f) win.addChild(Object.assign(new Sprite(f.texture), { x: x - f.texture.width / 2, y }));
    const t = label(said(String(n)), smallFont(), WHITE, "center", 64);
    t.position.set(x - 32, y + iconH + 4);
    win.addChild(t);
  });
  // The status bar (9, 494, 380 x 18): what Buy and Cancel do.
  const status = label(said(""), "smalfont", WHITE, "center", 380);
  status.position.set(9, 494 + 2);
  win.addChild(status);
  return new Promise((resolve) => {
    let close = () => {};
    const buy = new DefButton("ibuy30.def", 45, 446);
    buy.disabled = !!why;
    buy.explain(ctx.modals, ctx.player, () => (why ? stateLine : null));
    buy.onClick = () => {
      ctx.send({ type: "build", town: o.id, building: id });
      close();
      resolve(true);
    };
    const cancel = new DefButton("icancel.def", 290, 445);
    buildHints(buy, cancel, buildingName(w, o, id));
    for (const btn of [buy, cancel]) btn.onHint = (t) => (status.value = t);
    cancel.onClick = () => (close(), resolve(false));
    win.addChild(buy, cancel);
    close = ctx.modals.show(win, { onKey: (k) => (k === "Escape" ? (close(), resolve(false), true) : k === "Enter" && !why ? (buy.onClick(), true) : true) });
  });
}

/**
 * The Build window on a phone (2026-10-27: "looks like desktop dialogue scaled down"; centred, bigger
 * elements and text): the same parts as the desktop's (the title, the picture, what it does, whether it can be built,
 * the costs, Build and Cancel) as phoneBuy lays them out.
 */
async function mobileBuild(ctx: TownCtx, id: number, why: string | null): Promise<boolean> {
  const w = ctx.world();
  const o = ctx.town();
  const name = buildingName(w, o, id);
  const [icon, note, title] = await Promise.all([buildingIcons(o), stateText(w, o, id, why), resolveText({ file: "hallinfo", id: 7, args: [name] })]);
  const pic = icon(id);
  return phoneBuy(ctx, {
    title: title ?? tr("Build %1", name),
    name: said(name),
    picture: pic ? new Sprite(pic.texture) : null,
    text: said(buildingDescription(w, o, id)),
    note,
    why: why ? note : null,
    cost: buildingCost(w, o, id),
    buy: () => ctx.send({ type: "build", town: o.id, building: id }),
  });
}

/**
 * A window that buys one thing (a building, a war machine) on a phone, in the windows' rim at the page's size:
 * its title in the rim's band, the picture twice as big, the words centred at the phone pages' size (a reason it can't be
 * bought in yellow), the costs' icons half as big again with the amounts under them, Buy and Cancel a finger's size.
 * Upright all in one column; sideways the picture on the left and the rest in a column beside it (one column would be
 * shrunk to the short side).
 * Enter buys (when it can), Escape or a tap beside it cancels. Resolves whether it bought.
 */
async function phoneBuy(ctx: TownCtx, o: { title: Text; name: Text; picture: Container | null; text?: Text; note: Text; why: Text | null; cost: number[]; buy: () => void }): Promise<boolean> {
  const res = (await loadDef("resource.def")).get(0) ?? [];
  let enter = () => {};
  const page = await openPage(ctx.modals, { bare: true, title: o.title, keys: (k) => k === "Enter" && (enter(), true) });
  const upright = screenSize.portrait;
  // Upright: one column D wide. Sideways: the picture's column L wide, then the words' D.
  const D = upright ? 560 : 520;
  const L = upright ? 0 : 400;
  // The words centred line by line across the window, `k` times the medium font.
  const centred = (t: Text, k: number, color: readonly [number, number, number]) => {
    const l = label(t, "medfont", color, "center", Math.floor(D / k));
    l.scale.set(k);
    return l;
  };
  return new Promise<boolean>((resolve) => {
    let done = false;
    const end = (bought: boolean) => {
      if (done) return;
      done = true;
      page.close();
      resolve(bought);
    };
    const buy = new DefButton("ibuy30.def", 0, 0, ctx.player);
    buy.disabled = !!o.why;
    buy.explain(ctx.modals, ctx.player, () => o.why);
    buy.onClick = () => {
      o.buy();
      end(true);
    };
    enter = () => !o.why && buy.onClick();
    const cancel = new DefButton("icancel.def", 0, 0, ctx.player);
    cancel.onClick = () => end(false);
    buildHints(buy, cancel, o.name);
    void Promise.all([buy.ready, cancel.ready]).then(() => {
      const P = FRAME_PAD;
      const root = new Container();
      root.label = "window: buy";
      let y = P;
      // Where the words' column starts.
      const X = P + (L ? L + SPLIT : 0);
      if (o.picture) {
        o.picture.label = "picture: what it buys";
        o.picture.scale.set(Math.min(2.4, (L || D) / o.picture.width));
        o.picture.position.set(P + Math.round(((L || D) - o.picture.width) / 2), y);
        root.addChild(o.picture);
        if (!L) y += o.picture.height + 18;
      }
      for (const [t, k, color] of [
        [o.text, 1.8, WHITE],
        [o.note, 1.7, o.why ? YELLOW : WHITE],
      ] as const) {
        if (!t) continue;
        const l = centred(t, k, color);
        l.position.set(X, y);
        root.addChild(l);
        y += l.height + 18;
      }
      y += 6;
      const items = o.cost.map((c, i) => [i, c]).filter(([, c]) => c > 0);
      const step = Math.min(120, D / Math.max(1, items.length));
      let rowH = 0;
      items.forEach(([r, c], k) => {
        const cx = X + D / 2 - (items.length * step) / 2 + k * step + step / 2;
        let h = 0;
        if (res[r]) {
          const s = new Sprite(res[r].texture);
          s.scale.set(1.5);
          s.position.set(Math.round(cx - s.width / 2), y);
          root.addChild(s);
          h = s.height;
        }
        const t = label(said(String(c)), "medfont", WHITE);
        t.scale.set(1.8);
        t.position.set(Math.round(cx - t.width / 2), y + h + 4);
        root.addChild(t);
        rowH = Math.max(rowH, h + 4 + t.height);
      });
      y += rowH + 28;
      for (const b of [buy, cancel]) b.scale.set(2.1);
      buy.position.set(X + 20, y);
      cancel.position.set(X + D - 20 - cancel.width, y);
      root.addChild(buy, cancel);
      const dw = X + D + P;
      const dh = Math.max(y + buy.height, P + (o.picture?.height ?? 0)) + P;
      if (upright) fitUpright(root, dw, dh);
      else {
        // The picture in the middle of its column's height.
        if (o.picture) o.picture.y = Math.round((dh - o.picture.height) / 2);
        splitLine(root, P + L, P, dh - 2 * P, true);
        // (Its rim may run under the page's buttons, the words and buttons not.)
        placeSideways(root, dw, dh, sidewaysScale(dw, dh, P), P);
      }
      page.setContent(root);
      void page.show().then(() => end(false));
    });
  });
}

/** The status bar texts of a build window's two buttons (GENRLTXT 595/596, a ship's 598/599). */
function buildHints(buy: DefButton, cancel: DefButton, what?: string) {
  buy.hint = what ? tr(`Build %1`, what) : tr("Build ship");
  cancel.hint = what ? tr(`Don't build %1`, what) : tr("Don't build ship");
  const at = what ? 595 : 598;
  void resolveText({ file: "genrltxt", id: at, args: what ? [what] : [] }).then((t) => t && (buy.hint = t));
  void resolveText({ file: "genrltxt", id: at + 1, args: what ? [what] : [] }).then((t) => t && (cancel.hint = t));
}

// ---- Fort -------------------------------------------------------------------

async function fortWindow(ctx: TownCtx): Promise<void> {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const t = o.town!;
  const win = new Container();
  // The Factory's eight levels get the eight-slot fort screen.
  const eight = levelCount(o) === 8;
  win.addChild(new Sprite(await loadImagePlayer(eight ? "tpcastl8.pcx" : "tpcastl7.pcx", ctx.player)));
  const fort = B.FORT + Math.max(0, fortLevel(t.built) - 1);
  const title = label(said(buildingName(w, o, fort)), "bigfont", WHITE, "center", 400);
  title.position.set(200, 2);
  win.addChild(title);
  await resourceRow(win, s.players[o.owner].resources, ctx.player, s.day);
  const positions = [[10, 22], [404, 22], [10, 155], [404, 155], [10, 288], [404, 288], ...(eight ? [[10, 421], [404, 421]] : [[206, 421]])];
  const icon = await buildingIcons(o);
  const infoPic = await loadImage("tpcainfo.pcx").catch(() => null);
  // GENRLTXT 217 "Available: " (VCMI's CFortScreen).
  const availableWord = (await resolveText({ file: "genrltxt", id: 217 })) ?? fallback("Available: ");
  const tcommand = await textTable("tcommand");
  // The status bar along the bottom (4, 554, 740 x 18): "Recruit %s" over a built dwelling (CFortScreen::RecruitArea).
  const bar = label(said(""), "smalfont", WHITE, "center", 740);
  bar.position.set(4, 556);
  win.addChild(bar);
  const statWord = await originalWords("genrltxt", { Attack: 190, Defense: 191, Damage: 199, Health: 388, Speed: 193, Growth: 194 });
  return new Promise<void>((resolve) => {
    let close = () => {};
    positions.forEach(async ([x, y], level) => {
      const up = t.built.includes(dwellingId(level, true));
      const builtId = dwellingId(level, up);
      const c = new Container();
      c.position.set(x, y);
      win.addChild(c);
      const pic = icon(builtId);
      if (pic) c.addChild(Object.assign(new Sprite(pic.texture), { x: 4, y: 21 }));
      const name = label(said(buildingName(w, o, builtId)), "smalfont", WHITE, "center", 152);
      name.position.set(2, 94);
      c.addChild(name);
      // Every level's creature with its numbers, built or not (VCMI's CFortScreen); only a built
      // dwelling has creatures available and opens recruiting.
      const built = t.built.includes(dwellingId(level));
      const creature = w.creatures[townLevelCreature(o, level) ?? -1];
      if (!creature) return;
      // A right click on any level's area: the creature's window, built or not.
      creatureHold(c, ctx.modals, ctx.player, creature, () => ({ count: t.available[level] ?? 0 }));
      c.hitArea = new Rectangle(0, 0, 386, 126);
      c.eventMode = "static";
      // The small (100 x 120) picture, unscaled, as VCMI's CFortScreen (CCreaturePic, not big).
      const card = await creaturePic(creature, false);
      card.position.set(159, 4);
      c.addChild(card);
      // The creature's name over the dwelling's picture (CFortScreen::RecruitArea: centred at 78, 11).
      const cname = label(said(creature.plural), "smalfont", WHITE, "center", 152);
      cname.centreOn(78, 11);
      c.addChild(cname);
      if (infoPic) c.addChild(Object.assign(new Sprite(infoPic), { x: 261, y: 3 }));
      // (Their names GENRLTXT 190 / 191 / 199 / 388 / 193 / 194.)
      const stats = [
        [statWord("Attack"), creature.attack],
        [statWord("Defense"), creature.defense],
        [statWord("Damage"), `${creature.minDamage}-${creature.maxDamage}`],
        [statWord("Health"), creature.hp],
        [statWord("Speed"), creature.speed],
        [statWord("Growth"), `+${weeklyGrowth(w, o, level, s)}`],
      ];
      // TPCAINFO has the icons in its left column: VCMI's LabeledValue boxes (287, 4, 96 x 18), 20
      // apart, the name 3 in from the left, the value 3 in from the right.
      stats.forEach(([k, v], i) => {
        const l = label(said(String(k)), "smalfont", WHITE);
        l.position.set(290, 4 + i * 20);
        const r = label(said(String(v)), "smalfont", WHITE);
        r.position.set(380 - r.width, 4 + i * 20);
        c.addChild(l, r);
      });
      if (!built) return;
      const avail = label(fmt`${availableWord}${t.available[level]}`, "smalfont", WHITE, "center", 152);
      avail.position.set(2, 112);
      c.addChild(avail);
      c.cursor = "pointer";
      const recruitText = tcommand(21, tr(`Recruit %1`, creature.plural), creature.plural);
      c.on("pointerover", () => (bar.value = recruitText)).on("pointerout", () => (bar.value = said("")));
      // Recruiting opens over the fort and comes back to it, redrawn with what's left (as the original).
      c.on("pointertap", async () => {
        await recruitLevel(ctx, level);
        close();
        resolve(fortWindow(ctx));
      });
    });
    const exit = new DefButton("tpmage1.def", 748, 556);
    exit.onClick = () => (close(), resolve());
    win.addChild(exit);
    close = ctx.modals.show(win, { x: 0, y: 0, onKey: (k) => (k === "Escape" || k === "Enter" ? (close(), resolve(), true) : true) });
  });
}

// ---- Mage Guild -------------------------------------------------------------

/** Spells on each guild level (VCMI's spellsAtLevel; the Tower's Library adds one). */
const GUILD_SPELLS = [5, 4, 3, 2, 1];
/** Where the scrolls go when the town's config doesn't say (VCMI's legacy positions; the HotA towns use them). */
const GUILD_POSITIONS = [
  [{ x: 222, y: 445 }, { x: 312, y: 445 }, { x: 402, y: 445 }, { x: 520, y: 445 }, { x: 610, y: 445 }, { x: 700, y: 445 }],
  [{ x: 48, y: 53 }, { x: 48, y: 147 }, { x: 48, y: 241 }, { x: 48, y: 335 }, { x: 48, y: 429 }],
  [{ x: 570, y: 82 }, { x: 672, y: 82 }, { x: 570, y: 157 }, { x: 672, y: 157 }],
  [{ x: 183, y: 42 }, { x: 183, y: 148 }, { x: 183, y: 253 }],
  [{ x: 491, y: 325 }, { x: 591, y: 325 }],
];

async function mageGuildWindow(ctx: TownCtx) {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const u = ui(o);
  const hero = visitingHero(s, w, o);
  // A hero without a spellbook is offered one first, as in the original.
  if (hero && !hero.spells) {
    // GENRLTXT 214: the offer of a spell book.
    const answer = await messageBox(ctx.modals, (await resolveText({ file: "genrltxt", id: 214 })) ?? tr(`To cast spells, %1 needs a spellbook. Buy one for %2 gold?`, hero.name, SPELLBOOK_COST), ctx.player, {
      buttons: YES_NO,
    });
    if (answer === "yes") ctx.send({ type: "buySpellbook", hero: hero.id });
  }
  const level = guildLevel(o);
  const win = new Container();
  const bgName = Array.isArray(u.guildBackground) ? u.guildBackground[0] : u.guildBackground;
  // The guild's picture: one per level where the town has them (VCMI: guildWindow[level - 1]).
  const winName = Array.isArray(u.guildWindow) ? u.guildWindow[u.guildWindow.length === 1 ? 0 : Math.max(0, Math.min(u.guildWindow.length, level) - 1)] : u.guildWindow;
  const bg = await townImage(bgName ?? "tpmage.bmp", ctx.player);
  const wp = u.guildWindowPosition ?? { x: 332, y: 76 };
  const view = winName ? await townImage(winName, -1, true) : null;
  win.addChild(new Sprite(bg));
  if (view) win.addChild(Object.assign(new Sprite(view), { x: wp.x, y: wp.y }));
  const [scrolls, empty] = await Promise.all([loadDef("spellscr.def").then((d) => d.get(0) ?? []), loadDef("tpmages.def").then((d) => d.get(0) ?? []).catch(() => [])]);
  const status = label(said(""), "smalfont", WHITE, "center", 737);
  status.position.set(7, 559);
  win.addChild(status);
  // Every place the town's guild can ever have (VCMI's CMageGuildScreen): its spell once built, an
  // empty scroll before that; the Aurora Borealis fills them all with its every-spell scroll.
  const roomPositions = u.guildSpellPositions ?? GUILD_POSITIONS;
  const positions = roomPositions;
  const aurora = faction(o) === "conflux" && !!o.town?.built.includes(B.GRAIL);
  const auroraText = aurora ? ((await resolveText({ file: "genrltxt", id: 714, args: [buildingName(w, o, B.GRAIL)] })) ?? tr("Every spell")) : said("");
  const library = hasSpecial(o, "tower", SPECIAL.s3) ? 1 : 0;
  // An upright phone: the guild as one of phoneWindow's sheets (town/mobileGuild.ts: the room's picture, a row of scrolls
  // a level).
  if (phoneSized() && screenSize.portrait) {
    const scrollTex = (await loadDef("spellscr.def").then((d) => d.get(0) ?? []).catch(() => [])) as { texture: Texture }[];
    return new Promise<void>((resolve) =>
      void mobileGuild(ctx.modals, {
        player: ctx.player,
        title: buildingName(w, o, Math.max(0, level - 1)),
        room: bg,
        view: view ? { texture: view, x: wp.x, y: wp.y } : null,
        levels: TOWNS[o.subid]?.mageGuild ?? 5,
        built: level,
        spells: (l) => (l < level ? (ctx.town().town?.guild?.[l] ?? []).map((id) => w.data.spells?.[id]) : undefined),
        slots: (l) => GUILD_SPELLS[l] + library,
        scroll: (id) => scrollTex[id]?.texture,
        research: () => ctx.town().town?.researchSlot as [number, number] | undefined,
        aurora: aurora ? auroraText : undefined,
        tap: (l, i) => guildSpellTap(ctx, l, i),
        onClose: () => resolve(),
      }),
    );
  }
  // The scrolls and the resources, drawn again after a spell research.
  const layer = new Container();
  win.addChild(layer);
  let busy = false;
  const draw = async () => {
    const t = ctx.town().town;
    const st = ctx.state();
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (let l = 0; l < (TOWNS[o.subid]?.mageGuild ?? 5); l++) {
      for (let i = 0; i < GUILD_SPELLS[l] + library; i++) {
        const p = positions[l]?.[i];
        if (!p) continue;
        const id = t?.guild?.[l]?.[i];
        const f = aurora ? scrolls[70] : l < level && id !== undefined ? scrolls[id] : empty[1];
        if (!f) continue;
        const sp = new Sprite(f.texture);
        sp.position.set(p.x, p.y);
        layer.addChild(sp);
        if (aurora) {
          sp.eventMode = "static";
          sp.on("pointerover", () => (status.value = auroraText));
          sp.on("pointertap", () => void messageBox(ctx.modals, auroraText, ctx.player));
          continue;
        }
        const spell = l < level && id !== undefined ? w.data.spells?.[id] : undefined;
        if (!spell) continue;
        // HotA marks the spell under research: here a gold frame, and the status line says so.
        const open = t?.researchSlot?.[0] === l + 1 && t.researchSlot[1] === i;
        if (open) layer.addChild(new Graphics().rect(p.x - 2, p.y - 2, f.texture.width + 4, f.texture.height + 4).stroke({ color: 0xffd700, width: 2 }));
        sp.eventMode = "static";
        sp.cursor = "pointer";
        sp.on("pointerover", () => (status.value = open ? tr("%1 (being researched)", spell.name) : said(spell.name)));
        sp.on("pointertap", () => {
          if (busy) return;
          busy = true;
          void guildSpellTap(ctx, l + 1, i).finally(() => ((busy = false), void draw()));
        });
        // Held: the spell's text, as the spellbook's (the original's right click on a scroll).
        sp.on("rightdown", (e) => textPopup(spellText(spell), ctx.player, e.global.x, e.global.y, [{ texture: f.texture, caption: said(spell.name) }]));
      }
    }
    await resourceRow(layer, st.players[o.owner]?.resources ?? [], ctx.player, st.day);
  };
  await draw();
  const exitHint = (await resolveText({ file: "genrltxt", id: 593 })) ?? tr("Exit");
  return new Promise<void>((resolve) => {
    let close = () => {};
    const exit = new DefButton("tpmage1.def", 748, 556);
    exit.onClick = () => (close(), resolve());
    // Its hover on the status bar (VCMI: allTexts[593] over the exit button).
    exit.hint = exitHint;
    exit.onHint = (t) => (status.value = t);
    win.addChild(exit);
    const onKey = (k: string) => (k === "Escape" || k === "Enter" ? (close(), resolve(), true) : true);
    close = ctx.modals.show(win, { x: 0, y: 0, onKey });
  });
}

// ---- Tavern -----------------------------------------------------------------

/** The tavern; a Tavern on the map uses it too, hiring onto the tile next to it. */
export async function tavernWindow(ctx: TownCtx, map?: { hire: (slot: number) => void; why: string | null }) {
  const s = ctx.state();
  const w = ctx.world();
  const o = ctx.town();
  const offer = s.players[o.owner].tavern ?? [];
  const why = reason(map ? map.why : cannotHire(s, w, o));
  const openThieves = () => void thievesGuildWindow(ctx.modals, ctx.player, thievesGuild(ctx.state(), ctx.world(), tavernLevel(ctx.state(), o.owner)), ctx.world().creatures, { resources: ctx.state().players[o.owner].resources, day: ctx.state().day });
  // VCMI's CTavernWindow: the title and "Heroes for Hire" in the medium font, yellow (JKTEXT.TXT).
  const [titleText, forHireText, tipText, describeText, classNames] = await Promise.all([
    resolveText({ file: "jktext", id: 37 }),
    resolveText({ file: "jktext", id: 38 }),
    resolveText({ file: "genrltxt", id: 216, args: ["%s"] }),
    resolveText({ file: "genrltxt", id: 215, args: ["%s", "%d", "%s", "%d"] }),
    Promise.all(HERO_CLASSES.map((_, i) => heroClassName(i))),
  ]);
  // This week's rumour: one of the map's own, else from the game's list (RANDTVRN.TXT).
  const week = weekIndex(s.day);
  const mapRumors = w.map.rumors.map((r) => r.text).filter(Boolean);
  const general = await tavernRumours();
  const pool = mapRumors.length && week % 2 === 0 ? mapRumors : general;
  const rumorText = pool.length ? pool[(week * 7 + o.id) % pool.length] : tr("Visit the tavern for the latest rumors.");
  // The original wraps it in GENRLTXT 216 (the barkeep's whisper).
  const whispered = tipText ? tipText.replace("%s", rumorText) : rumorText;
  // The hero for hire in a line (VCMI's CTavernWindow: "%s is a level %d %s with %d artifacts.", GENRLTXT 215):
  // its class, and a retreated hero's own level and artifacts (war machines and the spellbook don't count).
  const heroLine = (type: number) => {
    const classId = HERO_INFO[type]?.heroClass ?? 0;
    const key = HERO_CLASSES[classId]?.key ?? "";
    const cls = classNames[classId] || key.charAt(0).toUpperCase() + key.slice(1);
    const back = s.heroes.find((h) => h.type === type && h.retired);
    const arts = back ? (back.equipped ?? []).filter((a, sl) => a >= 0 && sl < 14).length + (back.backpack?.length ?? 0) : 0;
    const level = back?.level ?? 1;
    const name = w.data.heroNames[type] ?? "";
    return { name, cls, level, arts, text: describeText ? describeText.replace("%s", name).replace("%d", String(level)).replace("%s", cls).replace("%d", String(arts)) : `${name}, ${cls}` };
  };
  if (phoneSized()) {
    const info = why && !map ? await gameLines("tvrninfo") : [];
    return mobileTavern(ctx.modals, {
      // JKTEXT 37, the desktop window's title.
      title: titleText ?? tr("Tavern"),
      player: ctx.player,
      offer,
      heroes: offer.map((type) => heroLine(type)),
      rumor: whispered,
      cost: HERO_COST,
      why: why && (map ? why : (hireNote(s, w, o, info) ?? why)),
      hire: (slot) => (map ? map.hire(slot) : ctx.send({ type: "hireHero", town: o.id, slot })),
      preview: (type) => void previewHero(ctx, type),
      thieves: openThieves,
    });
  }
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("tptavern.pcx", ctx.player));
  win.addChild(bg);
  // The tavern's own little film, as in the original.
  win.addChild(Object.assign(videoSprite(["tavern"], 256, 120, win), { x: 70, y: 56 }));
  const title = label(titleText ?? tr("Tavern"), "medfont", YELLOW, "center", 300);
  title.centreOn(197, 32);
  const forHire = label(forHireText ?? tr("Heroes for Hire"), "medfont", YELLOW, "center", 260);
  forHire.centreOn(145, 283);
  // A text box (32, 188, 330 x 66), the lines centred in it.
  const rumor = label(said(whispered), "smalfont", WHITE, "center", 330);
  const centreRumor = () => rumor.position.set(32, 188 + Math.max(0, (66 - rumor.height) / 2));
  centreRumor();
  const cost = label(said(String(HERO_COST)), smallFont(), WHITE, "center", 60);
  cost.centreOn(320, 328);
  const desc = label(said(""), "smalfont", WHITE, "center", 233);
  desc.position.set(30, 373);
  win.addChild(title, forHire, rumor, cost, desc);
  // The status bar along the bottom (8, h - 26, w - 16 x 19): what the pointer is over (TVRNINFO.TXT).
  const info = await gameLines("tvrninfo");
  const status = label(said(""), "smalfont", WHITE, "center", bg.width - 16);
  status.position.set(8, bg.height - 26 + 2);
  win.addChild(status);
  const hover = (target: Container, text: () => Text) => {
    target.on("pointerover", () => (status.value = text()));
    target.on("pointerout", () => (status.value = said("")));
  };
  const heroName = (slot: number) => w.data.heroNames[offer[slot]] ?? "";
  // The first hero for hire is picked; with none in that place, the other (VCMI's CTavernWindow).
  let chosen = offer[0] !== undefined ? 0 : 1;
  const frames: Graphics[] = [];
  const describe = (slot: number) => {
    const type = offer[slot];
    if (type === undefined) return (desc.value = said(""));
    desc.value = said(heroLine(type).text);
  };
  await Promise.all(
    offer.map(async (type, slot) => {
      const tex = await heroPortrait(type).catch(() => null);
      const c = new Container();
      c.position.set(slot === 0 ? 72 : 162, 299);
      if (tex) c.addChild(new Sprite(tex));
      const sel = new Graphics().rect(-2, -2, 62, 68).stroke({ color: 0xffff00, width: 2 });
      sel.visible = slot === chosen;
      frames.push(sel);
      c.addChild(sel);
      c.eventMode = "static";
      c.cursor = "pointer";
      const pick = () => {
        chosen = slot;
        frames.forEach((f, i) => (f.visible = i === slot));
        describe(slot);
      };
      // A double click hires (when hiring is possible); a right click picks too and shows the hero (CTavernWindow::HeroPortrait).
      let lastTap = 0;
      c.on("pointertap", () => {
        pick();
        const now = performance.now();
        if (now - lastTap < 400 && !recruit.disabled) recruit.onClick();
        lastTap = now;
      });
      c.on("rightdown", () => {
        pick();
        void previewHero(ctx, offer[slot]);
      });
      hover(c, () => said((info[4] ?? fallback("Select %s")).replace("%s", heroName(slot))));
      win.addChild(c);
    }),
  );
  describe(chosen);
  const recruit = new DefButton("tptav01.def", 272, 355);
  return new Promise<void>((resolve) => {
    let close = () => {};
    recruit.disabled = !!why || !offer.length;
    recruit.explain(ctx.modals, ctx.player, () => why);
    recruit.onClick = () => {
      if (map) map.hire(chosen);
      else ctx.send({ type: "hireHero", town: o.id, slot: chosen });
      close();
      resolve();
    };
    const cancel = new DefButton("icancel.def", 310, 428);
    cancel.onClick = () => (close(), resolve());
    // The Thieves' Guild: more to learn the more taverns the player owns.
    const thieves = new DefButton("tptav02.def", 22, 428);
    thieves.onClick = openThieves;
    win.addChild(recruit, cancel, thieves);
    const className = (slot: number) => {
      const id = HERO_INFO[offer[slot]]?.heroClass ?? 0;
      return said(classNames[id] || HERO_CLASSES[id]?.key || "");
    };
    // Why not, on the button (TVRNINFO 0-2), the rumour stays; else "Recruit %s the %s".
    hover(recruit, () => (map ? why : why && (hireNote(s, w, o, info) ?? why)) ?? said((info[3] || fallback("Recruit %s the %s")).replace("%s", heroName(chosen)).replace("%s", className(chosen))));
    cancel.hint = info[7] ?? fallback("Exit tavern");
    thieves.hint = info[5] ?? fallback("Thieves' Guild");
    for (const b of [cancel, thieves]) b.onHint = (t) => (status.value = t);
    close = ctx.modals.show(win, { onKey: (k) => (k === "Escape" ? (close(), resolve(), true) : k === "Enter" && !why ? (recruit.onClick(), true) : true) });
  });
}

/** A right click on a tavern portrait: the hero's screen as it would start (a made one, not kept), read only. */
async function previewHero(ctx: TownCtx, type: number) {
  const s = structuredClone(ctx.state());
  const w = ctx.world();
  const owner = ctx.town().owner;
  // The army the hire brings (the tavern's kept roll, or a returned hero's), not a roll of its own.
  const slot = s.players[owner].tavern?.indexOf(type) ?? -1;
  const army = slot >= 0 ? tavernArmy(s, owner, slot) : heroArmy(s, type);
  const back = s.heroes.find((h) => h.type === type && h.retired);
  const hero = back ? Object.assign(back, { army }) : makeHero(s, w.data, type, owner, 0, 0, 0, army);
  await heroScreen(ctx.modals, ctx.player, {
    data: w.data,
    hero: () => hero,
    send: () => {},
    listen: () => () => {},
    moraleLuck: () => ({ morale: 0, luck: 0 }),
    canDismiss: () => false,
  });
}

/** The game's own words (TVRNINFO 0-2) for why the tavern can't hire now, VCMI's order: gold, hero cap, a hero in the gate. */
function hireNote(s: AdventureState, w: World, o: AdvObject, info: Text[]): Text | null {
  if (s.players[o.owner].resources[6] < HERO_COST) return info[0] || null;
  if (mapHeroesOf(s, o.owner).length >= MAX_HEROES) return info[1] ? said(info[1].replace("%d", String(MAX_HEROES))) : null;
  if (o.town && visitingHero(s, w, o)) return info[2] || null;
  return null;
}

// ---- Marketplace ------------------------------------------------------------

/**
 * The marketplace (TPMRKRES) laid out as VCMI's CMarketResources: your resources on the left, the
 * market's on the right with their rates for the one you give, the trader's words top right, the two
 * picked under the panels with the amounts, the slider, Max and the deal button. A Trading Post on the
 * map uses it with five marketplaces' rates.
 */
export async function marketWindow(ctx: TownCtx, opts: { title?: Text; minMarkets?: number; rate?: (from: number, to: number) => { give: number; get: number } | null } = {}) {
  // Phones: a page of big tiles (the original window is too small to read there).
  if (phoneSized()) return mobileMarket(ctx, opts);
  const o = ctx.town();
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("tpmrkres.pcx", ctx.player));
  win.addChild(bg);
  const icons = (await loadDef("resource.def")).get(0) ?? [];
  const { kingdom, available, na, browse, bargain, unit, units, offerResources } = await marketTexts();
  // (Each line with its blanks: they are filled below.)
  const line = async (id: number) => (await gameLines("genrltxt"))[id] || englishLine("genrltxt", id);
  // The "transfer resources" mode (VCMI's CTransferResources): to whom, the lines GENRLTXT 165-169.
  const [giveTo, giveMore, giveBrowse, players] = await Promise.all([
    line(165),
    line(166),
    line(167),
    line(169),
  ]);
  const crests = (await loadDef("crest58.def").catch(() => null))?.get(0) ?? [];
  // Giving has its own background (TPMRKPTS: the players' slots on the right).
  const backs = { trade: bg.texture, players: await loadImagePlayer("tpmrkpts.pcx", ctx.player).catch(() => bg.texture) };
  /** Trading resources, or giving them to another player (only where it's a plain marketplace). */
  let mode: "trade" | "players" = "trade";
  const rightTitle = centredText(available, "smalfont", WHITE, 445, 148);
  win.addChild(centredText(opts.title ?? tr("Marketplace"), "bigfont", YELLOW, 299, 27), centredText(kingdom, "smalfont", WHITE, 156, 148), rightTitle);
  const layer = new Container();
  win.addChild(layer);
  // Special traders start on something they trade (the Warlock's Lab: mercury for sulfur); otherwise
  // nothing is picked until the player picks, as in the original.
  let give = opts.rate ? 1 : -1;
  let take = opts.rate ? 3 : -1;
  let dealt = false;
  // The shared slider (ui/blocks/slider.ts) where VCMI's CSlider sits.
  const slider = new Slider(137);
  slider.position.set(230, 489);
  const maxB = new DefButton("ircbtns.def", 228, 520);
  const deal = new DefButton("tpmrkb.def", 306, 520);
  const done = new DefButton("iok6432.def", 516, 520);
  const status = centredText(said(""), "smalfont", WHITE, bg.width / 2, bg.height - 17);
  win.addChild(slider, maxB, deal, done, status);
  for (const b of [maxB, deal, done]) b.onHint = (t) => (status.value = t);
  let rateNow: { give: number; get: number } | null = null;
  const rateOf = (a: number, b: number) => {
    if (mode === "players") return { give: 1, get: 1 };
    const markets = Math.max(marketCount(ctx.state(), o.owner), opts.minMarkets ?? 0);
    // Special traders (the Warlock's Lab) have their own rates; null: not traded there.
    return opts.rate ? opts.rate(a, b) : tradeRate(markets, a, b);
  };
  /** The two showcases and the trader's words follow the slider without redrawing the panels. */
  const showcases = new Container();
  win.addChild(showcases);
  const showAmounts = () => {
    showcases.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (give < 0 || take < 0 || (mode === "trade" && give === take) || !rateNow) return;
    const n = slider.value;
    const [lx, ly] = RESOURCE_SHOWCASE;
    showcases.addChild(showcase(39 + lx, 182 + ly, frameSprite(icons[give], RESOURCE_SLOT.image[0], RESOURCE_SLOT.image[1]), said(String(n * rateNow.give))));
    if (mode === "players") showcases.addChild(showcase(416, 450, frameSprite(crests[take], 0, 0), tr(PLAYER_NAMES[take]) ?? "", [29, 76]));
    else showcases.addChild(showcase(327 + lx, 182 + ly, frameSprite(icons[take], RESOURCE_SLOT.image[0], RESOURCE_SLOT.image[1]), said(String(n * rateNow.get))));
  };
  const draw = () => {
    const have = ctx.state().players[o.owner].resources;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    rateNow = give >= 0 && take >= 0 && (mode === "players" || give !== take) ? rateOf(give, take) : null;
    const pickGive = (r: number) => ((give = r), (dealt = false), slider.set(0, false), draw());
    const pickTake = (r: number) => ((take = r), (dealt = false), slider.set(0, false), draw());
    layer.addChild(resourcePanel(39, 182, { icons, caption: (r) => said(String(have[r])), selected: give, pick: pickGive }));
    // The market's side: what one lot of each brings for the resource given ("get/give"; "get" when one is given).
    const caption = (r: number): Text => {
      if (give < 0) return NONE;
      if (r === give) return na;
      const x = rateOf(give, r);
      if (!x || !x.get) return na;
      return said(x.give === 1 ? String(x.get) : `${x.get}/${x.give}`);
    };
    const plural = (n: number) => (n === 1 ? unit : units);
    let words: Text = dealt ? bargain : browse;
    if (mode === "players") {
      // The other players still in the game, each under their flag (VCMI's PlayersPanel at 333, 84).
      const others = ctx.state().players.filter((p) => p.alive && p.color !== o.owner);
      others.forEach((p, i) => {
        const [sx, sy] = [[0, 0], [83, 0], [166, 0], [0, 118], [83, 118], [166, 118], [83, 236]][i] ?? [0, 0];
        const slot = new Container();
        slot.position.set(333 + sx, 84 + sy);
        slot.addChild(new Graphics().rect(0, 0, 58, 64).fill({ color: 0, alpha: 0.001 }));
        const f = frameSprite(crests[p.color], 0, 0);
        if (f) slot.addChild(f);
        slot.addChild(centredText(tr(PLAYER_NAMES[p.color]) ?? "", "smalfont", WHITE, 29, 76));
        if (take === p.color) slot.addChild(selectionFrame(58, 64));
        slot.eventMode = "static";
        slot.cursor = "pointer";
        slot.on("pointertap", () => pickTake(p.color));
        layer.addChild(slot);
      });
      words = take >= 0 && give >= 0 ? fill(giveTo, [resourceName(give), tr(PLAYER_NAMES[take]) ?? ""]) : dealt ? said(giveMore) : said(giveBrowse);
    } else {
      layer.addChild(resourcePanel(327, 182, { icons, caption, selected: take, pick: pickTake }));
      if (rateNow && rateNow.get) words = fill(offerResources, [rateNow.get, plural(rateNow.get), resourceName(take), rateNow.give, plural(rateNow.give), resourceName(give)]);
    }
    bg.texture = backs[mode];
    rightTitle.value = mode === "players" ? said(players) : available;
    // Centred on its point as the left title (a plain y put its top there, 8 px low).
    rightTitle.centreOn(445, mode === "players" ? 56 : 148);
    layer.addChild(traderText(words, mode === "players"));
    const max = rateNow && rateNow.get ? Math.floor(have[give] / rateNow.give) : 0;
    slider.range(max);
    const blocked = !rateNow || !rateNow.get;
    slider.block(blocked);
    maxB.disabled = blocked || !max;
    deal.disabled = blocked || slider.value <= 0;
    maxB.explain(ctx.modals, ctx.player, () => (blocked ? tr("Pick two different resources.") : tr("Not enough resources.")));
    deal.explain(ctx.modals, ctx.player, () => (blocked ? tr("Pick two different resources.") : tr("Move the slider to pick how many.")));
    showAmounts();
  };
  slider.onChange = () => {
    deal.disabled = !rateNow || slider.value <= 0;
    showAmounts();
  };
  maxB.onClick = () => slider.toMax();
  deal.onClick = () => {
    const lots = slider.value;
    if (!rateNow || lots <= 0) return;
    if (mode === "players") ctx.send({ type: "giveResources", to: take, resource: give, amount: lots });
    else ctx.send({ type: "trade", from: give, to: take, lots });
    // As the original: the deal done, nothing stays picked and the trader says so.
    if (!opts.rate) give = take = -1;
    dealt = true;
    slider.set(0, false);
  };
  // The mode buttons down the left (VCMI's createChangeModeButtons at 18, 520): give resources to
  // another player (TPMRKBU1), and back to trading resources (TPMRKBU5). Not at special traders.
  if (!opts.rate) {
    const toPlayers = new DefButton("tpmrkbu1.def", 18, 520);
    const toTrade = new DefButton("tpmrkbu5.def", 18, 520);
    toTrade.visible = false;
    const switchTo = (m: typeof mode) => {
      mode = m;
      give = take = -1;
      dealt = false;
      slider.set(0, false);
      toPlayers.visible = m === "trade";
      toTrade.visible = m === "players";
      draw();
    };
    toPlayers.hint = tr("Send resources to another player");
    toTrade.hint = tr("Trade resources");
    for (const b of [toPlayers, toTrade]) b.onHint = (t) => (status.value = t);
    toPlayers.onClick = () => switchTo("players");
    toTrade.onClick = () => switchTo("trade");
    win.addChild(toPlayers, toTrade);
  }
  draw();
  const unlisten = ctx.listen(draw);
  win.once("destroyed", unlisten); // (taken down with the others, not by Done: the town's changes stop drawing it)
  return new Promise<void>((resolve) => {
    let close = () => {};
    done.onClick = () => (unlisten(), close(), resolve());
    close = ctx.modals.show(win, {
      onKey: (k) => {
        // The original's keys (VCMI's): M the most, Space the deal, the arrows one lot less or more.
        if (k === "Escape" || k === "Enter") done.onClick();
        else if (k === "m") maxB.onClick();
        else if (k === " ") deal.onClick();
        else if (k === "ArrowLeft") slider.step(-1);
        else if (k === "ArrowRight") slider.step(1);
        return true;
      },
    });
  });
}

// ---- Shipyard ---------------------------------------------------------------

async function shipyardWindow(ctx: TownCtx) {
  return shipyardDialog(ctx.modals, ctx.player, ctx.state(), ctx.world(), ctx.town(), ctx.send);
}

/** The original shipyard window (TPSHIP), for town shipyards and shipyards on the map. */
export async function shipyardDialog(modals: Modals, player: number, s: AdventureState, w: World, o: AdvObject, send: (a: AdventureAction) => void) {
  const ctx = { modals, player, send };
  const why = reason(cannotBuildBoat(s, w, o, o.owner));
  // HotA's Airship Yard: the same window for an airship (5000 gold, 20 wood).
  const air = isAirshipYard(o);
  const cost = boatCost(o);
  const win = new Container();
  const bg = new Sprite(await loadImagePlayer("tpship.pcx", ctx.player));
  win.addChild(bg);
  const pane = Object.assign(new Sprite(await loadImage("tpshipbk.pcx")), { x: 100, y: 69 });
  win.addChild(pane);
  // The boat sails to the right on the pane (VCMI's CShipyardWindow: the DEF's group 7, its 96 x 64
  // frame centred on the water, one frame every 100 ms).
  // (The boat this yard builds: the town's faction's, a map shipyard HotA's neutral one; rules' boatKind.)
  const kind = boatKind(o);
  const boatDef = await loadDef(air ? "airship/aair00.def" : kind === 6 ? "ab07_006.def" : `ab0${kind + 1}_.def`);
  const sailing = air ? [] : (boatDef.get(7) ?? []);
  const boat = sailing[0] ?? boatDef.get(0)?.[0];
  // (The airship's frames are bigger than a boat's: its picture centred on the pane.)
  const at = air && boat ? { x: pane.x + (pane.width - boat.texture.width) / 2, y: pane.y + (pane.height - boat.texture.height) / 2 } : { x: pane.x + Math.floor((pane.width - (boat?.fullWidth ?? 96)) / 2) + (boat?.x ?? 0), y: pane.y + Math.floor((pane.height - (boat?.fullHeight ?? 64)) / 2) + (boat?.y ?? 0) };
  if (boat && sailing.length > 1) {
    const anim = Object.assign(new AnimatedSprite(sailing.map((f) => f.texture)), at);
    anim.animationSpeed = 1 / 6;
    anim.play();
    win.addChild(anim);
  } else if (boat) win.addChild(Object.assign(new Sprite(boat.texture), at));
  const title = label(air ? tr("Build a New Airship") : tr("Build a New Ship"), "bigfont", YELLOW, "center", 300);
  title.centreOn(164, 27);
  const costL = label(why && why !== BOAT_PRICE && why !== AIRSHIP_PRICE ? tr(why) : tr("Resource cost:"), "medfont", WHITE, "center", 300);
  costL.centreOn(164, 220);
  win.addChild(title, costL);
  const res = (await loadDef("resource.def")).get(0) ?? [];
  const gold = res[6];
  const wood = res[0];
  if (gold) win.addChild(Object.assign(new Sprite(gold.texture), { x: 100, y: 244 }));
  if (wood) win.addChild(Object.assign(new Sprite(wood.texture), { x: 196, y: 244 }));
  const g = label(said(String(cost[6])), smallFont(), WHITE, "center", 60);
  g.centreOn(118, 294);
  const wd = label(said(String(cost[0])), smallFont(), WHITE, "center", 60);
  wd.centreOn(212, 294);
  win.addChild(g, wd);
  return new Promise<void>((resolve) => {
    let close = () => {};
    const build = new DefButton("ibuy30.def", 42, 312);
    build.disabled = !!why;
    build.explain(ctx.modals, ctx.player, () => why);
    build.onClick = () => {
      ctx.send({ type: "buildBoat", object: o.id });
      close();
      resolve();
    };
    const quit = new DefButton("icancel.def", 224, 312);
    quit.onClick = () => (close(), resolve());
    buildHints(build, quit);
    win.addChild(build, quit);
    // Enter builds, Escape leaves (VCMI: GLOBAL_ACCEPT, GLOBAL_CANCEL).
    close = ctx.modals.show(win, { onKey: (k) => (k === "Escape" ? (close(), resolve(), true) : k === "Enter" ? (build.disabled || build.onClick(), true) : true) });
  });
}

/**
 * Right-click on a building (VCMI's CBuildingRect popup): a dwelling tells its creature, how many
 * wait and the weekly growth; anything else its name, picture and what it does.
 */
/** `held`: from a right-click, so the popup goes when the button is let go (as in the original). */
export async function buildingInfo(ctx: TownCtx, id: number, held = false) {
  const signal = held ? (() => { const ac = new AbortController(); untilReleased(() => ac.abort(), { popup: true }); return ac.signal; })() : undefined;
  const o = ctx.town();
  const w = ctx.world();
  const s = ctx.state();
  for (let level = 0; level < levelCount(o); level++) {
    const upgraded = id === dwellingId(level, true);
    if (id !== dwellingId(level) && !upgraded) continue;
    const c = w.creatures[TOWNS[o.subid]?.creatures[level]?.[upgraded ? 1 : 0] ?? -1];
    if (!c) break;
    const tex = await creaturePortrait(c, "large");
    // GENRLTXT 217 "Available: " (VCMI's CDwellingInfoBox); the growth line ours.
    const text = fmt`${(await resolveText({ file: "genrltxt", id: 217 })) ?? fallback("Available: ")}${o.town?.available[level] ?? 0}\n${tr("Growth: +%1 per week", weeklyGrowth(w, o, level, s))}`;
    return void messageBox(ctx.modals, text, ctx.player, { title: said(c.plural), components: tex ? [{ texture: tex, caption: said(buildingName(w, o, id)) }] : [], signal, held });
  }
  const icon = await buildingIcons(o);
  const pic = icon(id);
  void messageBox(ctx.modals, said(buildingDescription(w, o, id)) || said(buildingName(w, o, id)), ctx.player, {
    title: said(buildingName(w, o, id)),
    components: pic ? [{ texture: pic.texture, caption: NONE }] : [],
    signal,
    held,
  });
}

