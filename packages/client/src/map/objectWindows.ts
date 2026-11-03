// The windows of map objects that trade with a visiting hero: Trading Post, University, Hill Fort,
// altars, Black Market, Freelancer's Guild, Junkman, Warlock's Lab, Tavern, War Machine Factory...
import { objectListWindow } from "../ui/objectList.ts";
import { resolveText } from "../ui/gameText.ts";
import {
  BLACK_MARKET_MARKETS,
  FREELANCER_MAP_MARKETS,
  JUNKMAN_MARKETS,
  MACHINE_CREATURE,
  factoryMachines,
  MACHINE_SLOT,
  artifactOffer,
  artifactSacrificeXp,
  blackMarketStock,
  creatureManaValue,
  creatureSacrificeXp,
  experienceForLevel,
  freelancerPrice,
  gateTowns,
  hillFortUpgrade,
  isEvil,
  junkmanPrice,
  maxMana,
  thievesGuild,
  cannotHireAt,
  cannotLearnSkill,
  universityOffer,
} from "@heroes/core";
import { hillFortWindow, transformerWindow, universityWindow } from "../ui/markets.ts";
import { marketWindow, tavernWindow } from "../town/windows.ts";
import { blackMarketWindow, freelancerWindow, junkmanWindow } from "../ui/tradeObjects.ts";
import { thievesGuildWindow } from "../ui/thievesGuild.ts";
import { altarWindow } from "../ui/altar.ts";
import { recruitWindow } from "../ui/recruit.ts";
import { type AdvContext, colorOf } from "./context.ts";
import { reason, tr, fallback, type Text } from "../i18n/index.ts";
import { objectName } from "./describe.ts";

/** Opens the window of the object a hero of ours just visited. */
export function openObjectWindow(ctx: AdvContext, heroId: number, objectId: number) {
  const { modals, data, send, listen } = ctx;
  const s = ctx.state();
  const w = ctx.world();
  const player = colorOf(ctx);
  const hero = () => ctx.state().heroes[heroId];
  const gold = () => ctx.state().players[ctx.me()].resources[6];
  const o = s.objects[objectId];
  // Town windows reused on the map see the object as a town of ours.
  // The window's title: the place's own name, as the map calls it, in the player's language (2026-11-01:
  // "Trading post dialog title not translated": the titles were English words passed as they were).
  const named = (english: string): Text => objectName(o, w.creatures, data.artifacts) || tr(english);
  const asTown = () => ({ modals, player, state: ctx.state, world: ctx.world, town: () => ({ ...ctx.state().objects[objectId], owner: ctx.me() }), send, listen, say: () => {} });
  if (o.type === 99 || o.type === 221) {
    void marketWindow(asTown(), { title: named("Trading Post"), minMarkets: 5 });
  } else if (o.type === 104 || (o.type === 146 && o.subid === 0)) {
    void universityWindow(modals, player, {
      hero,
      gold,
      skills: universityOffer(s, o),
      learn: (skill) => send({ type: "learnSkill", hero: heroId, object: objectId, skill }),
      why: (skill) => reason(cannotLearnSkill(ctx.state(), hero(), o, skill)),
      listen,
      academy: o.type === 146,
    });
  } else if (o.type === 144 && o.subid === 1) {
    void transformerWindow(modals, player, { hero, creatures: w.creatures, transform: (slots) => send({ type: "transform", hero: heroId, object: objectId, slots }) });
  } else if (o.type === 146 && o.subid === 3) {
    const towns = gateTowns(s, w, hero());
    if (!towns.length) return ctx.say(tr("{Town Gate}\n\nThere is no allied town to go to."));
    // The original's destination list (TPGATE).
    void (async () => {
      const i = await objectListWindow(modals, player, {
        title: named("Town Gate"),
        description: (await resolveText({ file: "jktext", id: 41 })) ?? fallback("Select a town to go to."),
        items: towns.map((t) => t.name ?? "Town"),
      });
      if (i >= 0) send({ type: "townGate", hero: heroId, object: objectId, town: towns[i].id });
    })();
  } else if (o.type === 144 && o.subid === 7) {
    void junkmanWindow(modals, player, {
      hero,
      artifacts: data.artifacts,
      price: (id) => junkmanPrice(w, id),
      sell: (artifact, resource) => send({ type: "sellArtifact", hero: heroId, object: objectId, artifact, resource }),
      listen,
      // Any resource, at seven marketplaces' merchant prices (half the price in gold).
      market: { title: named("Junkman"), price: (a, r) => artifactOffer(JUNKMAN_MARKETS, data.artifacts[a]?.cost ?? 0, r, "sell"), resources: () => ctx.state().players[ctx.me()].resources },
    });
  } else if (o.type === 144 && o.subid === 9) {
    const precious = [1, 3, 4, 5];
    void marketWindow(asTown(), { title: named("Warlock's Lab"), minMarkets: 1, rate: (a, b) => (precious.includes(a) && precious.includes(b) ? { give: 1, get: 1 } : null) });
  } else if (o.type === 35) {
    void hillFortWindow(modals, player, {
      hero,
      resources: () => ctx.state().players[ctx.me()].resources,
      creatures: w.creatures,
      data,
      send,
      offer: (slot) => hillFortUpgrade(w, hero(), slot),
      upgrade: (slot) => send({ type: "upgradeStack", hero: heroId, object: objectId, slot }),
      listen,
      openHero: ctx.openHero,
    });
  } else if (o.type === 7) {
    void blackMarketWindow(modals, player, {
      stock: () => blackMarketStock(ctx.state(), w, ctx.state().objects[objectId]),
      artifacts: data.artifacts,
      gold,
      buy: (slot, resource) => send({ type: "buyArtifact", hero: heroId, object: objectId, slot, resource }),
      listen,
      // Any resource pays, at the prices of five marketplaces' Artifact Merchants.
      market: { title: named("Black Market"), price: (a, r) => artifactOffer(BLACK_MARKET_MARKETS, data.artifacts[a]?.cost ?? 0, r, "buy"), resources: () => ctx.state().players[ctx.me()].resources },
    });
  } else if (o.type === 213) {
    void freelancerWindow(modals, player, {
      hero,
      creatures: w.creatures,
      price: (creature, n, r) => freelancerPrice(w, creature, n, FREELANCER_MAP_MARKETS, r),
      sell: (slot, n, resource) => send({ type: "sellStack", hero: heroId, object: objectId, slot, count: n, resource }),
      listen,
    });
  } else if (o.type === 2 || (o.type === 146 && o.subid === 2)) {
    const manaAltar = o.type === 146;
    void altarWindow(modals, player, {
      hero,
      evil: manaAltar || isEvil(hero()),
      mana: manaAltar ? { value: (c) => creatureManaValue(w, c), current: () => hero().mana ?? 0, cap: () => 4 * maxMana(hero()) } : undefined,
      creatures: w.creatures,
      artifacts: data.artifacts,
      creatureXp: (c) => creatureSacrificeXp(w, c),
      artifactXp: (id) => artifactSacrificeXp(w, id),
      sacrifice: (a) => send({ type: "sacrifice", hero: heroId, object: objectId, ...a }),
      toNextLevel: () => experienceForLevel(hero().level + 1) - hero().experience,
      listen,
    });
  } else if (o.type === 97) {
    void thievesGuildWindow(modals, player, thievesGuild(s, w, 20), w.creatures, { resources: s.players[ctx.me()].resources, day: s.day });
  } else if (o.type === 95) {
    void tavernWindow(asTown(), { hire: (slot) => send({ type: "hireAt", hero: heroId, object: objectId, slot }), why: reason(cannotHireAt(s, w, hero(), ctx.me())) });
  } else if (o.type === 106) {
    // War Machine Factory (the three machines) or Cannon Yard (the cannon): the recruit window.
    const arts = factoryMachines(o);
    const choices = arts.map((art) => {
      const c = w.creatures[MACHINE_CREATURE[art]];
      const owned = hero().equipped?.[MACHINE_SLOT[art]] === art;
      return { creature: c, available: owned ? 0 : 1, cost: c.cost };
    });
    void recruitWindow(modals, player, o.subid === 1 ? tr("Cannon Yard") : tr("War Machine Factory"), choices, s.players[ctx.me()].resources).then((r) => {
      if (r) send({ type: "buyMachineAt", hero: heroId, object: objectId, artifact: arts[r.index] });
    });
  }
}
