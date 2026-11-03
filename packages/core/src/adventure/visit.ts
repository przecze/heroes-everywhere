// Heroes visiting what's on the map: towns, dwellings, mines, banks, shrines, chests, monsters,
// rewards and offers (rules.ts applies the actions that lead here).
import { withLearning } from "../specialty.ts";
import { spellAllowed } from "./bans.ts";
import { SPELL } from "../spells.ts";
import { visitTownSpecials } from "./townSpecials.ts";
import { type RewardCtx, grantReward, presetOf, visitRewardable } from "./rewardable.ts";
import { randInt } from "../rng.ts";
import { boatIfAtSea, customizeHero, heroArmy, heroesInUse, makeHero, randomHeroOf, startingKit, rollAggression } from "./create.ts";
import { experienceForLevel } from "./experience.ts";
import { boxReward, mapData, mapGarrisonArmy, randomArtifact, sawEmpty, visitObject } from "./objects.ts";
import { type Quest, activeQuest, questComponents, questDone, questRewardComponents, questExpired, questPay, questRef, questReward, questStepDone, questText, seerName } from "./quests.ts";
import { effectivePrimary, giveArtifact, giveScroll, hasBonus, randomArtifactPool, takeArtifact, wornArtifacts } from "./artifacts.ts";
import { learnFromGuild, maxMana, stockGuild } from "./magic.ts";
import { SKILL_NAMES, skillLevel } from "../skills.ts";
import { maxMovement } from "./movement.ts";
import { type AdventureState, type AdvObject, type ArmySlot, type Component, type Hero, Obj, RESOURCE_NAMES, type TextRef } from "./types.ts";
import { Terrain, heroSight, MONOLITH_ONE_WAY_ENTRANCE, MONOLITH_ONE_WAY_EXIT, MONOLITH_TWO_WAY, SUBTERRANEAN_GATE, type World, isRevealed, reveal, revealOwned, teleportExits, visitTile } from "./world.ts";
import { catchUpLevels, fight, gainExperience, siege, startFight } from "./combat.ts";
import { B, townInfo, garrisonHero } from "./town.ts";
import { type AdventureEvent, ART_TIER, GRAIL_ARTIFACT, MAX_HEROES, PRIMARY_NAMES, PRIMARY_SHRINES, REFUGEE_CAMP, SHRINE_NAMES, SPECIAL_DWELLING, UPGRADE_OF, abandonedMine, addToArmy, allied, bankOf, dwellingGuards, dwellingOf, mapHeroesOf, rollRefugees, week } from "./rules.ts";
import { Refusal } from "../refusal.ts";
import { blackMarketStock, universityOffer } from "./trades.ts";
import { resumeScript, runScript, scriptedQuest } from "./scripts.ts";
import { lineText } from "../gameLines.ts";

/** Objects players flag as theirs: towns, mines, dwellings, shipyards, garrisons, lighthouses... */
const FLAGGED = new Set([Obj.TOWN, Obj.MINE, Obj.ABANDONED_MINE, 17, 20, 33, 42, 87, 219]);

export function visit(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  const p = s.players[h.owner];
  // An ally's town, mine, dwelling, shipyard or garrison: neither fought for nor taken.
  // (Nothing is said, as in the original: VCMI's CGMine / CGDwelling / CGLighthouse return at once.)
  if (o.owner >= 0 && allied(s, o.owner, h.owner) && FLAGGED.has(o.type)) return [];
  switch (o.type) {
    case Obj.RESOURCE: {
      const amount = o.amount ?? 0;
      p.resources[o.subid] += amount;
      o.removed = true;
      s.log.push(`${h.name} picks up ${amount} ${RESOURCE_NAMES[o.subid]}.`);
      // A pile with its own text from the map is a window with that text (VCMI's CGResource: INFO
      // without a text, AUTO with one); without one it only shows in the info box.
      const said = mapData(w, o).message;
      if (typeof said === "string" && said)
        return [{ e: "pickup", hero: h.id, object: o.id, resource: o.subid, amount, own: true }, { e: "visit", hero: h.id, object: o.id, message: said, components: [{ kind: "resource", id: o.subid, amount }] }];
      return [{ e: "pickup", hero: h.id, object: o.id, resource: o.subid, amount }];
    }
    case Obj.TREASURE_CHEST: {
      // 1000 gold or 500 experience (32%), 1500 or 1000 (32%), 2000 or 1500 (31%), else a treasure artifact.
      // (What the map chose: one of the three amounts, or the artifact, its own if it named one.)
      const pre = presetOf(w, o);
      const roll = pre ? [0, 40, 80, 99][pre.content] ?? 0 : randInt(s, 0, 99);
      if (roll >= 95) {
        o.removed = true;
        const id = pre?.artifact ?? randomArtifact(s, w, "T");
        if (id >= 0) giveArtifact(h, w.data.artifacts, id);
        const name = w.data.artifacts[id]?.name ?? "an artifact";
        s.log.push(`${h.name} opens a treasure chest: ${name}.`);
        return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 145, args: [name] }), text: { file: "advevent", id: 145, args: [name] }, components: id >= 0 ? [{ kind: "artifact", id }] : [] }];
      }
      const tier = roll < 32 ? 0 : roll < 64 ? 1 : 2;
      const [gold, xp] = [[1000, 500], [1500, 1000], [2000, 1500]][tier];
      // The AI takes the gold (the fresh engine's main hero the experience: Hero.aiChestXp); A player chooses.
      if (s.players[h.owner]?.controller !== "human") return openChest(s, w, h, o, tier, h.aiChestXp ? 1 : 0);
      h.offer = { object: o.id, kind: "chest", cost: tier };
      return [{ e: "offer", hero: h.id, object: o.id, kind: "chest", cost: tier, text: lineText({ file: "advevent", id: 146 }), textRef: { file: "advevent", id: 146 }, components: [{ kind: "resource", id: 6, amount: gold }, { kind: "experience", amount: withLearning(h, xp) }] }];
    }
    case Obj.CAMPFIRE: {
      // (What the map chose: its resource and amount, and its gold.)
      const pre = presetOf(w, o);
      // (The map keeps two resources and amounts; one of them the gold.)
      const chosen = pre ? [[pre.res, pre.amount], [pre.resB, pre.amountB]].filter(([r, n]) => r !== undefined && r >= 0 && n !== undefined) as [number, number][] : [];
      // Otherwise 4, 5 or 6 of a resource with as many hundred gold (VCMI's campfire: 4 + 400, 5 + 500, 6 + 600).
      const [res, amount] = chosen.find(([r]) => r !== 6) ?? [randInt(s, 0, 5), randInt(s, 4, 6)];
      const gold = chosen.find(([r]) => r === 6)?.[1] ?? amount * 100;
      p.resources[6] += gold;
      p.resources[res] += amount;
      o.removed = true;
      s.log.push(`${h.name} finds a campfire: ${gold} gold and ${amount} ${RESOURCE_NAMES[res]}.`);
      return [
        { e: "pickup", hero: h.id, object: o.id, resource: res, amount },
        { e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 23 }), text: { file: "advevent", id: 23 }, components: [{ kind: "resource", id: res, amount }, { kind: "resource", id: 6, amount: gold }] },
      ];
    }
    case 220:
    case Obj.MINE:
    case Obj.TOWN: {
      const lost = abandonedMine(s, w, o);
      // Troops a player left in a mine defend it (VCMI's CGMine: its garrison).
      const mineGuards = o.type !== Obj.TOWN && o.owner !== h.owner ? (o.army ?? []).filter((a): a is ArmySlot => !!a) : [];
      if ((lost && !lost.cleared) || mineGuards.length) {
        // A player is asked first: ADVEVENT 84 (the abandoned mine's Troglodytes), 187 (the owner's guards).
        const asked = h.offer?.kind === "attack" && h.offer.object === o.id;
        if (asked) delete h.offer;
        if (s.players[h.owner]?.controller === "human" && !asked) {
          h.offer = { object: o.id, kind: "attack", cost: 0 };
          const textRef: TextRef = { file: "advevent", id: lost && !lost.cleared ? 84 : 187 };
          return [{ e: "offer", hero: h.id, object: o.id, kind: "attack", cost: 0, text: lineText(textRef), textRef }];
        }
        if (lost && !lost.cleared) return startFight(s, w, h, o, lost.guards, "Abandoned Mine's guards");
        return fight(s, w, h, { name: "Mine's guards", stacks: mineGuards.map((g) => ({ ...g })), owner: o.owner >= 0 ? o.owner : undefined }, o.id);
      }
      if (o.owner === h.owner) {
        if (o.type === Obj.TOWN) {
          learnFromGuild(s, w, h, o);
          const grail = placeGrailBuilding(s, w, h, o);
          const gifts = visitTownSpecials(s, o, h, { maxMana, gainExperience: (x, xp) => gainExperience(s, w, x, xp) });
          for (const g of gifts) s.log.push(g.message.replace(/[{}]/g, "").replace(/\n+/g, " "));
          h.maxMovement = maxMovement(w, h);
          return [...grail, ...gifts.map((g) => ({ e: "visit" as const, hero: h.id, object: o.id, ...g })), { e: "town", hero: h.id, object: o.id }];
        }
        // One's own mine: the garrison window, to leave troops there or take them back (the original's).
        mapGarrisonArmy(w, o);
        return [{ e: "garrison", hero: h.id, object: o.id }];
      }
      if (o.town?.garrison.some((x) => x) || (o.town && garrisonHero(s, o))) return siege(s, w, h, o);
      return captureObject(s, w, h, o);
    }
    case Obj.MONSTER:
      return meetMonster(s, w, h, o);
    case Obj.ARTIFACT: {
      o.removed = true;
      giveArtifact(h, w.data.artifacts, o.subid);
      const name = w.data.artifacts[o.subid]?.name ?? "an artifact";
      s.log.push(`${h.name} picks up ${name}.`);
      // The artifact's own line (ARTEVENT), with its picture.
      return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "artevent", id: o.subid }), text: { file: "artevent", id: o.subid }, components: [{ kind: "artifact", id: o.subid }] }];
    }
    case 93: {
      // Spell Scroll: the hero can cast its spell while carrying it. A random one is never Town Portal or Water Walk (HotA).
      const spell = Number(mapData(w, o).spell ?? -1);
      // (A random map's scroll may name its spell's level, as the original's generator values them.)
      const level = Number(mapData(w, o).level ?? 0);
      const pool = (w.data.spells ?? []).filter((x) => x.id < 70 && x.level > 0 && (level ? x.level === level : x.level <= 3) && x.id !== SPELL.TOWN_PORTAL && x.id !== SPELL.WATER_WALK && spellAllowed(s, x.id));
      const sp = w.data.spells?.find((x) => x.id === spell) ?? (pool.length ? pool[randInt(s, 0, pool.length - 1)] : undefined);
      o.removed = true;
      w.refresh(s);
      if (sp) giveScroll(h, w.data.artifacts, sp.id);
      s.log.push(`${h.name} picks up a scroll of ${sp?.name ?? "magic"}.`);
      return [{ e: "visit", hero: h.id, object: o.id, message: `${h.name} found a Spell Scroll: {${sp?.name ?? "a spell"}}.`, ...(sp ? { text: { file: "advevent" as const, id: 135, args: [sp.name] }, components: [{ kind: "spell" as const, id: sp.id }] } : {}) }];
    }
    case 55: // Mystical Garden: 5 gems or 500 gold, weekly
    case 112: // Windmill: 3-6 of a rare resource, weekly
    case 109: {
      // Water Wheel: 500 gold in the first week, then 1000, weekly
      const name = o.type === 55 ? "Mystical Garden" : o.type === 112 ? "Windmill" : "Water Wheel";
      // The original's lines: [given, nothing this week].
      const [given, empty] = o.type === 55 ? [92, 93] : o.type === 112 ? [170, 169] : [164, 165];
      if (o.visitedWeek === week(s)) {
        sawEmpty(o, h.owner);
        return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: empty }), text: { file: "advevent", id: empty } }];
      }
      o.visitedWeek = week(s);
      o.weekVisitor = h.owner;
      o.weekSeen = undefined;
      let res = 6;
      let amount = s.day > 7 ? 1000 : 500;
      if (o.type === 55) [res, amount] = randInt(s, 0, 1) ? [5, 5] : [6, 500];
      if (o.type === 112) [res, amount] = [[1, 2, 3, 4, 5][randInt(s, 0, 4)], randInt(s, 3, 6)];
      p.resources[res] += amount;
      s.log.push(`${h.name} visits the ${name}: ${amount} ${RESOURCE_NAMES[res]}.`);
      return [
        { e: "pickup", hero: h.id, object: o.id, resource: res, amount },
        { e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: given }), text: { file: "advevent", id: given }, components: [{ kind: "resource", id: res, amount }] },
      ];
    }
    case 32:
    case 51:
    case 23:
    case 61: {
      const [skill, n] = PRIMARY_SHRINES[o.type];
      const name = SHRINE_NAMES[o.type];
      // The original's lines: Garden of Revelation, Mercenary Camp, Marletto Tower, Star Axis.
      const [given, seen] = ({ 32: [59, 60], 51: [80, 81], 23: [39, 40], 61: [100, 101] } as Record<number, [number, number]>)[o.type];
      if (o.visitors?.includes(h.id)) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: seen }), text: { file: "advevent", id: seen } }];
      (o.visitors ??= []).push(h.id);
      h.primary[skill] += n;
      s.log.push(`${h.name} visits the ${name}: +${n} ${PRIMARY_NAMES[skill]}.`);
      return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: given }), text: { file: "advevent", id: given }, components: [{ kind: "primary", id: skill, amount: n }] }];
    }
    case 100: {
      // Learning Stone: +1000 experience once per hero
      if (o.visitors?.includes(h.id)) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 144 }), text: { file: "advevent", id: 144 } }];
      (o.visitors ??= []).push(h.id);
      const before = h.experience;
      const notes = gainExperience(s, w, h, 1000);
      return [{ e: "visit", hero: h.id, object: o.id, message: [`Learning Stone: ${h.name} gains 1000 experience.`, ...notes].join(" "), text: { file: "advevent", id: 143 }, components: [{ kind: "experience", amount: h.experience - before }] }];
    }
    case 4:
    case 47:
    case 107: {
      // Arena: +2 Attack or Defense, free. Schools of Magic / War: 1000 gold for +1 Power/Knowledge or Attack/Defense.
      // The hero takes the weaker of the two skills (choosing comes with the original dialog).
      const { skills: [a, b], cost } = training(o);
      // The original's lines (ADVEVENT): the offer, already trained here, no gold for the fee.
      const [offerLine, doneLine, poorLine] = o.type === 4 ? [0, 1, 1] : o.type === 47 ? [71, 72, 73] : [158, 159, 160];
      if (o.visitors?.includes(h.id)) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: doneLine }), text: { file: "advevent", id: doneLine } }];
      if (p.resources[6] < cost) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: poorLine }), text: { file: "advevent", id: poorLine } }];
      // A human picks with the original two-icon dialog; the AI takes the weaker skill.
      if (s.players[h.owner]?.controller === "human") {
        h.offer = { object: o.id, kind: "primary", cost };
        return [{ e: "offer", hero: h.id, object: o.id, kind: "primary", cost, text: lineText({ file: "advevent", id: offerLine }), textRef: { file: "advevent", id: offerLine }, options: [a, b] }];
      }
      return trainAt(s, h, o, h.primary[b] < h.primary[a] ? b : a);
    }
    case SUBTERRANEAN_GATE:
    case MONOLITH_ONE_WAY_ENTRANCE:
    case MONOLITH_TWO_WAY: {
      const exits = teleportExits(s, o);
      if (!exits.length) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 70 }), text: { file: "advevent", id: 70 } }];
      const turn = portalTurn(s, w, h.owner, o, exits);
      const dest = turn ? turn.exit : exits[randInt(s, 0, exits.length - 1)];
      const to = visitTile(w, dest);
      // Every exit taken: nothing happens (VCMI's CGMonolith says nothing either).
      if (to < 0 || w.heroAt[to]) return [];
      if (turn) (s.players[h.owner].portalLast ??= {})[turn.key] = turn.at;
      [h.x, h.y, h.z] = [to % w.size, Math.floor(to / w.size) % w.size, Math.floor(to / (w.size * w.size))];
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      w.refresh(s);
      return [{ e: "teleport", hero: h.id, object: o.id, to }];
    }
    case MONOLITH_ONE_WAY_EXIT:
      return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 70 }), text: { file: "advevent", id: 70 } }];
    case Obj.WHIRLPOOL: {
      // Another whirlpool at random (heroes.thelazy.net Whirlpool); the sea takes half, rounded up,
      // of the stack with the least fight value, unless that's the army's one creature (not with a
      // Sea Captain's Hat). The map's only whirlpool takes its toll and leads nowhere.
      // Only a boat sails into one: a hero on foot (Water Walk, Dimension Door) isn't carried off.
      if (h.boat === undefined) return [];
      const exits = s.objects.filter((x) => !x.removed && x.type === Obj.WHIRLPOOL && x !== o);
      const dest = exits.length ? exits[randInt(s, 0, exits.length - 1)] : undefined;
      const to = dest ? visitTile(w, dest) : -1;
      if (dest && (to < 0 || w.heroAt[to])) return [];
      let message = "Your boat is caught in a whirlpool!";
      let lostStack: Component | undefined;
      const slots = h.army.map((a, i) => ({ a: a!, i })).filter((x) => x.a);
      if (!hasBonus(h, "WHIRLPOOL_PROTECTION") && (slots.length > 1 || slots[0]?.a.count > 1)) {
        const power = (a: ArmySlot) => a.count * (w.creatures[a.creature]?.fightValue ?? 1);
        const weakest = slots.reduce((x, y) => (power(y.a) < power(x.a) ? y : x));
        const lost = Math.ceil(weakest.a.count / 2);
        weakest.a.count -= lost;
        if (!weakest.a.count) h.army[weakest.i] = null;
        message += ` ${lost} ${w.creatures[weakest.a.creature]?.plural ?? "creatures"} are lost.`;
        lostStack = { kind: "creature", id: weakest.a.creature, amount: lost };
      }
      // (Nothing lost, nothing said: VCMI's CGWhirlpool shows ADVEVENT 168 only with the loss.)
      const said: AdventureEvent[] = lostStack ? [{ e: "visit", hero: h.id, object: o.id, message, text: { file: "advevent" as const, id: 168 }, components: [lostStack] }] : [];
      if (!dest) return said;
      [h.x, h.y, h.z] = [to % w.size, Math.floor(to / w.size) % w.size, Math.floor(to / (w.size * w.size))];
      [s.objects[h.boat].x, s.objects[h.boat].y, s.objects[h.boat].z] = [h.x, h.y, h.z];
      reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
      w.refresh(s);
      return [{ e: "teleport", hero: h.id, object: o.id, to }, ...said];
    }
    case 42: {
      // Lighthouse: the owner's ships sail 500 further each day.
      // (One's own: nothing to say, as VCMI's CGLighthouse.)
      if (o.owner === h.owner) return [];
      o.owner = h.owner;
      w.refresh(s);
      s.log.push(`${h.name} flags a lighthouse.`);
      return [{ e: "flag", object: o.id, owner: h.owner }, { e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 69 }), text: { file: "advevent", id: 69 } }];
    }
    case 99:
    case 221:
      return [{ e: "market", hero: h.id, object: o.id }];
    case 104:
      universityOffer(s, o);
      return [{ e: "market", hero: h.id, object: o.id }];
    case 106:
    case 35:
    case 213:
    case 2:
    case 95:
    // Den of Thieves: the full Thieves' Guild report.
    case 97:
      return [{ e: "market", hero: h.id, object: o.id }];
    case 7:
      blackMarketStock(s, w, o);
      return [{ e: "market", hero: h.id, object: o.id }];
    case REFUGEE_CAMP:
      if (!o.dwelling) rollRefugees(s, w, o);
      return [{ e: "dwelling", hero: h.id, object: o.id }];
    case 37: {
      // Hut of the Magi: a look through every Eye of the Magi.
      for (const eye of s.objects) if (eye.type === 27 && !eye.removed) reveal(s, w, h.owner, eye.x, eye.y, eye.z, 5);
      if (!o.visitors?.includes(h.id)) (o.visitors ??= []).push(h.id);
      return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 61 }), text: { file: "advevent", id: 61 } }];
    }
    case Obj.SHIPYARD:
      if (o.owner !== h.owner) {
        o.owner = h.owner;
        s.log.push(`${h.name} flags a shipyard.`);
      }
      return [{ e: "flag", object: o.id, owner: h.owner }, { e: "shipyard", hero: h.id, object: o.id }];
    case SPECIAL_DWELLING:
    case 17: {
      if (!dwellingOf(w, o)) return [{ e: "visit", hero: h.id, object: o.id, message: "This dwelling isn't implemented yet." }];
      const guards = dwellingGuards(s, w, o, h);
      if (!guards.length) return claimDwelling(s, w, h, o);
      // The original asks first (VCMI's CGDwelling::onHeroVisit, GENRLTXT 421); the computer just fights.
      const asked = h.offer?.kind === "attack";
      if (asked) delete h.offer;
      if (s.players[h.owner]?.controller !== "human" || asked) return startFight(s, w, h, o, guards, `${w.creatures[guards[0].creature]?.plural ?? "Dwelling"} guarding the dwelling`);
      const n = guards[0].count;
      const q = Math.max(0, [1, 5, 10, 20, 50, 100, 250, 500, 1000].findLastIndex((b) => n >= b));
      const plural = w.creatures[guards[0].creature]?.plural ?? "creatures";
      const textRef: TextRef = { file: "genrltxt", id: 421, args: [{ file: o.type === SPECIAL_DWELLING ? "crgen4" : "crgen1", id: o.subid }, { file: "arraytxt", id: 176 + 3 * q }, plural] };
      h.offer = { object: o.id, kind: "attack", cost: 0 };
      return [{ e: "offer", hero: h.id, object: o.id, kind: "attack", cost: 0, text: lineText(textRef), textRef }];
    }
    case 57: {
      // Obelisk: another piece of the puzzle map.
      const seen = (p.obelisks ??= []);
      if (seen.includes(o.id)) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 97 }), text: { file: "advevent", id: 97 } }];
      seen.push(o.id);
      return [{ e: "obelisk", hero: h.id, object: o.id }];
    }
    case 10: {
      // Keymaster's Tent: the key of its colour.
      const keys = (p.keys ??= []);
      const had = keys.includes(o.subid);
      if (!had) keys.push(o.subid);
      return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: had ? 20 : 19 }), text: { file: "advevent", id: had ? 20 : 19 } }];
    }
    case 9: {
      // Border Guard: leaves for good once you have the key.
      if (!p.keys?.includes(o.subid)) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 18 }), text: { file: "advevent", id: 18 } }];
      // With the key, a player is asked first (ADVEVENT 17).
      if (s.players[h.owner]?.controller === "human" && h.offer?.kind !== "quest") {
        h.offer = { object: o.id, kind: "quest", cost: 0 };
        return [{ e: "offer", hero: h.id, object: o.id, kind: "quest", cost: 0, text: lineText({ file: "advevent", id: 17 }), textRef: { file: "advevent", id: 17 } }];
      }
      h.offer = undefined;
      o.removed = true;
      w.refresh(s);
      s.log.push(`The border guard lets ${h.name} pass.`);
      return [];
    }
    case 212: {
      // HotA's Grave (subid 1001): dug up like any configurable object.
      if (o.subid === 1001) return visitRewardable(s, w, rewardCtx(s, w), h, o) ?? [];
      // Border Gate (a key) or HotA Quest Gate (subid 1000): step through when allowed.
      const data = mapData(w, o);
      // HotA 1.8: a gate whose quest is a script's opens when the script says so.
      if (o.subid === 1000 && !o.data?.opened && scriptedQuest(w, o)) return runScript(s, w, "quest", scriptedQuest(w, o)!.script.id, h.owner, { hero: h, object: o });
      const ok = o.subid === 1000 ? !!o.data?.opened || questDone(s, w, h, data as unknown as Quest) && !questExpired(s, data as unknown as Quest) : !!p.keys?.includes(o.subid);
      if (!ok && o.subid === 1000) {
        const q = data as unknown as Quest;
        return [{ e: "visit", hero: h.id, object: o.id, message: q.firstVisit || questText(w, q), ...(q.firstVisit ? {} : { text: questRef(s, w, o, q, 0) }) }];
      }
      if (!ok) return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 18 }), text: { file: "advevent", id: 18 } }];
      return stepOnto(s, w, h, o);
    }
    case 50:
      // The Market of Time: in the original it does nothing at all (heroes.thelazy.net: "functionally useless").
      return [];
    case 33:
    case 219: {
      // Garrison: an enemy's or neutral one fights; your own lets you through.
      const guards = mapGarrisonArmy(w, o).filter((a): a is ArmySlot => !!a);
      if (o.owner !== h.owner && guards.length) return fight(s, w, h, { name: "Garrison", stacks: guards.map((g) => ({ ...g })), owner: o.owner >= 0 ? o.owner : undefined }, o.id);
      // In it: the garrison window, to leave guards or take them along.
      const window: AdventureEvent = { e: "garrison", hero: h.id, object: o.id };
      if (o.owner !== h.owner) {
        o.owner = h.owner;
        s.log.push(`${h.name} takes over the garrison.`);
        return [{ e: "flag", object: o.id, owner: h.owner }, ...stepOnto(s, w, h, o), window];
      }
      return [...stepOnto(s, w, h, o), window];
    }
    case 83:
    case 215: {
      // Seer's Hut / Quest Guard.
      const q = activeQuest(w, o, s, h);
      // Done, a hut without a quest, or its time run out: deserted (the original's "this should be the home of %s").
      if (o.data?.done || !q.mission || (o.type === 83 && questExpired(s, q)))
        return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "seerhut", id: 1, col: 1 + (o.id % 3), args: [seerName(o)] }), text: { file: "seerhut", id: 1, col: 1 + (o.id % 3), args: [seerName(o)] } }];
      // The player has been told the quest: it's in their quest log from now on (also when it's
      // done on the spot, so the log lists it, done, once it's handed in).
      const first = !o.visitors?.includes(h.owner);
      if (first) (o.visitors ??= []).push(h.owner);
      // HotA 1.8: a quest of the map's scripts, which say what's asked, given and when it's done.
      const scripted = scriptedQuest(w, o, s, h);
      if (scripted) return runScript(s, w, "quest", scripted.script.id, h.owner, { hero: h, object: o });
      // (A guard past its time stays: it says what it asked, and never lets anyone by.)
      if (!questDone(s, w, h, q) || questExpired(s, q)) {
        const custom = first ? q.firstVisit : q.nextVisit;
        return [{ e: "visit", hero: h.id, object: o.id, message: custom || questText(w, q), ...(custom ? {} : { text: questRef(s, w, o, q, first ? 0 : 1) }), components: questComponents(q) }];
      }
      // Done: a player is asked first ("... Do you accept?").
      if (s.players[h.owner]?.controller === "human" && h.offer?.kind !== "quest") {
        h.offer = { object: o.id, kind: "quest", cost: 0 };
        // (A Seer's Hut shows what it gives, as the original's question does: it was what it takes, so a big reward came
        // without a word of it: the owner, 2026-10-29, five levels at once. A Quest Guard or Gate gives only the way on.)
        return [{ e: "offer", hero: h.id, object: o.id, kind: "quest", cost: 0, text: q.completed || "Do you accept?", ...(q.completed ? {} : { textRef: questRef(s, w, o, q, 2) }), components: o.type === 83 ? questRewardComponents(q) : questComponents(q) }];
      }
      h.offer = undefined;
      questPay(s, h, q);
      if (o.type === 215) {
        o.removed = true;
        w.refresh(s);
        // (The question said it all: the guard just steps aside.)
        return [];
      }
      questStepDone(w, o, q);
      // (The question showed the reward: it's given without another window, as in the original.)
      questReward(s, w, h, q, (xp) => gainExperience(s, w, h, xp), (c, n) => addToArmy(h, c, n));
      return [];
    }
    case Obj.PANDORAS_BOX:
    case Obj.EVENT: {
      const data = mapData(w, o);
      if (o.type === Obj.EVENT) {
        // Events fire for the players they're set for (bit mask), humans and maybe computers.
        const mask = typeof data.players === "number" ? data.players : 0xff;
        const human = s.players[h.owner].controller === "human";
        if (!(mask & (1 << h.owner)) || (!human && data.computer === false) || (human && data.human === false)) return [];
      }
      // A player is asked before opening a Pandora's Box (the original's line 14).
      if (o.type === Obj.PANDORAS_BOX && s.players[h.owner]?.controller === "human") {
        h.offer = { object: o.id, kind: "pandora", cost: 0 };
        return [{ e: "offer", hero: h.id, object: o.id, kind: "pandora", cost: 0, text: lineText({ file: "advevent", id: 14 }), textRef: { file: "advevent", id: 14 } }];
      }
      return openPandora(s, w, h, o, data);
    }
    case Obj.PRISON: {
      if (mapHeroesOf(s, h.owner).length >= MAX_HEROES) return [{ e: "visit", hero: h.id, object: o.id, message: `You already have ${MAX_HEROES} heroes; the prisoner stays.` , text: { file: "advevent", id: 103 } }];
      const data = mapData(w, o);
      const type = typeof data.hero === "number" && data.hero >= 0 ? data.hero : randomHeroOf(s, undefined, heroesInUse(s));
      o.removed = true;
      w.refresh(s);
      const gate = visitTile(w, o);
      const g = { x: gate % w.size, y: Math.floor(gate / w.size) % w.size };
      const freed = makeHero(s, w.data, type, h.owner, g.x, g.y, o.z, heroArmy(s, type), typeof data.name === "string" ? data.name : undefined);
      // The map's settings for the hero, then the prisoner's own: experience, skills, artifacts...
      customizeHero(freed, w.data, w.map.heroCustom?.[type], data);
      if (Array.isArray(data.army) && (data.army as { creature: number }[]).some((a) => a.creature >= 0))
        freed.army = Array.from({ length: 7 }, (_, slot) => {
          const a = (data.army as { slot: number; creature: number; count: number }[]).find((x) => x.slot === slot);
          return a && a.creature >= 0 ? { creature: a.creature, count: a.count } : null;
        });
      s.heroes.push(freed);
      startingKit(freed);
      catchUpLevels(s, w, freed);
      boatIfAtSea(s, w.data, w.map, freed);
      freed.mana = maxMana(freed);
      w.refresh(s);
      return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 102 }), text: { file: "advevent", id: 102 } }];
    }
    default: {
      // HotA traders and services with their own windows: Skeleton Transformer, Junkman,
      // Warlock's Lab, Seafaring Academy, Altar of Mana, Town Gate.
      if ((o.type === 144 && [1, 7, 9].includes(o.subid)) || (o.type === 146 && [0, 2, 3].includes(o.subid))) {
        if (o.type === 146 && o.subid === 0) universityOffer(s, o, true);
        return [{ e: "market", hero: h.id, object: o.id }];
      }
      const configured = visitRewardable(s, w, rewardCtx(s, w), h, o);
      if (configured) return configured;
      const handled = visitObject(s, w, objectCtx(s, w), h, o);
      if (handled) return handled;
      const found = bankOf(s, o);
      if (found) {
        const def = found.def;
        if (found.bank.cleared) {
          // Searching the dead's places again (VCMI's CBank, heroes.thelazy.net): nothing, and morale -1 until the next battle.
          if (def.revisitMorale) {
            h.temp ??= { morale: 0, luck: 0, from: [] };
            if (!h.temp.from.includes(o.type)) {
              h.temp.from.push(o.type);
              h.temp.morale -= 1;
            }
            const id: Record<number, number> = { 84: 120, 85: 123, 24: 42 };
            const message = def.empty ?? `The ${def.name} has already been plundered. Your army's morale drops.`;
            return [{ e: "visit", hero: h.id, object: o.id, message, ...(id[o.type] ? { text: { file: "advevent" as const, id: id[o.type] } } : {}), components: [{ kind: "morale", amount: -1 }] }];
          }
          // The empty Pyramid: luck -2 until the next battle (VCMI's pyramid.json), once.
          if (def.revisitLuck) {
            h.temp ??= { morale: 0, luck: 0, from: [] };
            const first = !h.temp.from.includes(o.type);
            if (first) {
              h.temp.from.push(o.type);
              h.temp.luck += def.revisitLuck;
            }
            return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 107, args: [def.name] }), text: { file: "advevent", id: 107, args: [def.name] }, ...(first ? { components: [{ kind: "luck" as const, amount: def.revisitLuck }] } : {}) }];
          }
          // The Ruins' tower still shows the land around (heroes.thelazy.net: the shroud goes without a fight).
          const sight = def.levels[0].reveal;
          if (sight) reveal(s, w, h.owner, o.x, o.y, o.z, sight);
          if (def.empty) return [{ e: "visit", hero: h.id, object: o.id, message: def.empty }];
          return [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: o.type === 63 ? 107 : 33, args: [def.name] }), text: { file: "advevent", id: o.type === 63 ? 107 : 33, args: [def.name] } }];
        }
        // A player is asked first, with the bank's own line (Shipwreck, Derelict Ship, Crypt, Dragon Utopia, Pyramid, HotA's).
        if (s.players[h.owner]?.controller === "human") {
          const own: Record<number, number> = { 85: 122, 24: 41, 84: 119, 25: 47, 63: 105 };
          h.offer = { object: o.id, kind: "attack", cost: 0 };
          const text = def.ask ?? `${def.name}: attack the guards?`;
          return [{ e: "offer", hero: h.id, object: o.id, kind: "attack", cost: 0, text, ...(def.ask ? {} : { textRef: { file: "advevent" as const, id: own[o.type] ?? 32, args: [def.name] } }) }];
        }
        return startFight(s, w, h, o, found.bank.guards, `${def.name} guards`);
      }
      return [{ e: "visit", hero: h.id, object: o.id, message: "Nothing happens… yet. This location isn't implemented." }];
    }
  }
}

export function claimDwelling(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  if (o.owner !== h.owner) {
    o.owner = h.owner;
    s.log.push(`${h.name} flags a dwelling.`);
    events.push({ e: "flag", object: o.id, owner: h.owner });
  }
  events.push({ e: "dwelling", hero: h.id, object: o.id });
  return events;
}

/** A free passable land tile next to (x, y). */
export function freeTileNear(w: World, x: number, y: number, z: number): number {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const i = w.index(x + dx, y + dy, z);
    if (i >= 0 && !w.blocked(i) && !w.visitBy[i] && !w.heroAt[i] && w.map.tiles[i].terrain !== Terrain.WATER) return i;
  }
  return -1;
}

/** Uncovers every tile for a player (the Skyship). */
function revealAll(s: AdventureState, w: World, player: number) {
  const p = s.players[player];
  if (p) p.revealed = new Array(Math.ceil((w.levels * w.size * w.size) / 32)).fill(-1);
}

/** A hero bringing the Grail home builds the town's Grail structure. */
function placeGrailBuilding(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  const t = o.town;
  if (!t || t.built.includes(B.GRAIL)) return [];
  if (!takeArtifact(h, GRAIL_ARTIFACT)) return [];
  t.built.push(B.GRAIL);
  t.built.sort((a, b) => a - b);
  // The Aurora Borealis puts every spell in the Conflux's mage guild (on the levels it has).
  if (townInfo(o)?.faction === "conflux") stockGuild(s, w.data.spells ?? [], o);
  // The Skyship shows the whole world.
  if (townInfo(o)?.faction === "tower") revealAll(s, w, o.owner);
  s.log.push(`${h.name} brings the Grail to ${o.name ?? "the town"}.`);
  return [{ e: "visit", hero: h.id, object: o.id, message: `The townsfolk build a great monument to hold the Grail. ${o.name ?? "The town"} now earns 5000 more gold a day and its creatures grow faster.` }];
}

/** Moves the hero onto an object's tile (gates and garrisons you may pass). */
function stepOnto(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  const gate = visitTile(w, o);
  if (gate < 0 || w.heroAt[gate]) return [];
  const from = w.index(h.x, h.y, h.z);
  [h.x, h.y] = [gate % w.size, Math.floor(gate / w.size) % w.size];
  h.movement = Math.max(0, h.movement - 100);
  reveal(s, w, h.owner, h.x, h.y, h.z, heroSight(h));
  w.refresh(s);
  return [{ e: "move", hero: h.id, path: [from, gate] }];
}

/** Lends the objects module the rules it needs. */
function rewardCtx(s: AdventureState, w: World): RewardCtx {
  return {
    addToArmy,
    randomArtifact: (cls) => {
      // "TREASURE|MINOR": any of those classes.
      const tier = cls.split("|").map((c) => ART_TIER[c] ?? "").join("") || "T";
      const ids = randomArtifactPool(w.data.artifacts, tier, s.banned?.artifacts);
      return ids.length ? ids[randInt(s, 0, ids.length - 1)] : -1;
    },
    giveArtifact: (h, id) => {
      giveArtifact(h, w.data.artifacts, id);
      return w.data.artifacts[id]?.name ?? "an artifact";
    },
    gainExperience: (h, xp) => gainExperience(s, w, h, xp),
    skillName: (id) => SKILL_NAMES[id] ?? "skill",
  };
}

function objectCtx(s: AdventureState, w: World) {
  return {
    gainExperience: (h: Hero, xp: number) => gainExperience(s, w, h, xp),
    fightGuards: (h: Hero, o: AdvObject, guards: { creature: number; count: number }[], name: string) => startFight(s, w, h, o, guards, name),
    addToArmy,
  };
}

/** A Pandora's Box or event: its guards first (if any), else what's inside. */
function openPandora(s: AdventureState, w: World, h: Hero, o: AdvObject, data: Record<string, unknown>): AdventureEvent[] {
  const guards = ((data.guards as { creature: number; count: number }[] | undefined) ?? []).filter((g) => g.creature >= 0);
  if (guards.length && !o.data?.cleared) {
    // As the original (VCMI's CGPandoraBox / CGEvent): ADVEVENT 16
    // (an event's own words instead, if it has them), then the fight; the computer just fights.
    const custom = o.type === Obj.EVENT && typeof data.message === "string" && data.message ? data.message : "";
    const warn: AdventureEvent[] = h.owner >= 0 && s.players[h.owner]?.controller === "human"
      ? [{ e: "visit", hero: h.id, object: o.id, message: custom || lineText({ file: "advevent", id: 16 }), ...(custom ? {} : { text: { file: "advevent" as const, id: 16 } }) }]
      : [];
    return [...warn, ...startFight(s, w, h, o, guards, o.type === Obj.EVENT ? "Guards" : "Pandora's Box guards")];
  }
  return openBox(s, w, h, o, data);
}

/**
 * A Pandora's Box or event gives what's inside: a window for each kind of reward with the original's
 * line (ADVEVENT 175-188, VCMI's CGPandoraBox), the map's own words in the first one's place
 * (not after a fight: they came before it). An empty box says so (ADVEVENT 15).
 */
export function openBox(s: AdventureState, w: World, h: Hero, o: AdvObject, data: Record<string, unknown>, afterBattle = false): AdventureEvent[] {
  const pictures: Component[] = [];
  const got = boxReward(s, w, objectCtx(s, w), h, data, pictures);
  if (o.type === Obj.PANDORAS_BOX || data.removeAfterVisit !== false) o.removed = true;
  w.refresh(s);
  let custom = !afterBattle && typeof data.message === "string" && data.message ? data.message : "";
  const out: AdventureEvent[] = [];
  const say = (id: number, english: string, comps: Component[], args: (string | number)[] = [h.name]) => {
    if (!comps.length) return;
    out.push({ e: "visit", hero: h.id, object: o.id, message: custom || english, ...(custom ? {} : { text: { file: "advevent" as const, id, args } }), components: comps });
    custom = "";
  };
  const of = (...kinds: Component["kind"][]) => pictures.filter((c) => kinds.includes(c.kind));
  const signed = (kind: Component["kind"], sign: number) => pictures.filter((c) => c.kind === kind && "amount" in c && Math.sign(c.amount ?? 0) === sign);
  say(175, `${h.name} learns something.`, of("experience", "primary", "skill"));
  const spells = of("spell");
  say(spells.length > 1 ? 188 : 184, `${h.name} learns ${spells.length > 1 ? "spells" : "a spell"}.`, spells);
  say(177, `${h.name} gains magical energy.`, signed("mana", 1));
  say(176, `${h.name} loses magical energy.`, signed("mana", -1));
  say(179, `${h.name}'s spirits rise.`, signed("morale", 1));
  say(178, `${h.name}'s spirits drop.`, signed("morale", -1));
  say(181, `${h.name}'s luck increases.`, signed("luck", 1));
  say(180, `${h.name}'s luck takes a turn for the worse.`, signed("luck", -1));
  say(182, `${h.name} has lost treasure.`, signed("resource", -1));
  say(183, `${h.name} has found treasure.`, signed("resource", 1));
  say(183, `${h.name} has found treasure.`, of("artifact"));
  const troops = of("creature") as Extract<Component, { kind: "creature" }>[];
  if (troops.length) {
    const one = troops.length === 1 && troops[0].amount === 1;
    const names = troops.map((c) => (c.amount === 1 ? w.creatures[c.id]?.name : w.creatures[c.id]?.plural) ?? "creatures");
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    say(one ? 185 : 186, `${one ? `A ${list} joins` : `${list} join`} ${h.name}'s army.`, troops, [list, h.name]);
  }
  // (HotA's movement points have no picture: said in English.)
  if (custom || (!out.length && got.length)) out.push({ e: "visit", hero: h.id, object: o.id, message: custom || `You receive: ${got.join(", ")}.` });
  else if (!out.length && o.type === Obj.PANDORAS_BOX) out.push({ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 15 }), text: { file: "advevent", id: 15 } });
  // HotA 1.8: then the script it runs.
  const script = data.script as { id: number } | undefined;
  return script ? [...out, ...runScript(s, w, "hero", script.id, h.owner, { hero: h, object: o })] : out;
}

const armyStrength = (w: World, army: (ArmySlot | null)[]) => army.reduce((a, x) => a + (x ? x.count * (w.creatures[x.creature]?.fightValue ?? 0) : 0), 0);
const monsterStrength = (w: World, o: AdvObject) => Math.max(1, (o.amount ?? 1) * (w.creatures[o.subid]?.fightValue ?? 1));

/**
 * Splits a wandering monster into battle stacks as the original (VCMI's CGCreature): more stacks the
 * weaker the hero's army is next to theirs, one more or fewer by the tile (or as the map's HotA
 * setting says), the creatures dealt out evenly, and the middle stack sometimes upgraded.
 */
export function splitMonster(s: AdventureState, w: World, h: Hero | undefined, o: AdvObject): ArmySlot[] {
  const data = mapData(w, o);
  const amount = o.amount ?? 1;
  const setting = Number(data.stacksCount ?? -1);
  let n = setting;
  if (setting <= 0) {
    const ratio = (h ? armyStrength(w, h.army) : 0) / monsterStrength(w, o);
    n = ratio < 0.5 ? 7 : ratio < 0.67 ? 6 : ratio < 1 ? 5 : ratio < 1.5 ? 4 : ratio < 2 ? 3 : 2;
    // HotA's average (-3), one fewer (-2) and one more (0); else the tile's hash decides (VCMI's numbers).
    if (setting === -2) n -= 1;
    else if (setting === 0) n += 1;
    else if (setting !== -3) {
      const r1 = (Math.imul(1550811371, o.x) + Math.imul(3359066809 | 0, o.y) + Math.imul(1943276003, o.z) + (3174620878 | 0)) >>> 0;
      const r4 = (((r1 >>> 16) & 0x7fff) % 100) + 1;
      if (r4 <= 20) n -= 1;
      else if (r4 >= 80) n += 1;
    }
  }
  n = Math.max(1, Math.min(n, amount, 7));
  const m = Math.floor(amount / n);
  const big = n - (n * (m + 1) - amount);
  const stacks = Array.from({ length: n }, (_, i) => ({ creature: o.subid, count: i < big ? m + 1 : m }));
  // The upgraded stack: always, never, or by the tile (HotA's setting; -1 as the original).
  const upgraded = Number(data.upgradedStack ?? -1);
  const byTile = Math.floor(2992.911117 * o.x + 14174.264968 * o.y + 5325.181015 * o.z + 32788.72792) % 32768 % 100 < 50;
  const up = UPGRADE_OF[o.subid];
  if (n > 1 && up !== undefined && w.creatures[up] && (upgraded === 1 || (upgraded === -1 && byTile))) stacks[Math.floor(n / 2)].creature = up;
  return stacks;
}

/**
 * How wandering monsters take a hero (heroes.thelazy.net Wandering creature): the army's strength
 * (weighed by the hero's Attack and Defense) against theirs, Diplomacy and kinship decide whether
 * they fight, flee or join. `allowJoin` false: what they do once their offer was turned down.
 */
export function monsterReaction(s: AdventureState, w: World, h: Hero, o: AdvObject, allowJoin = true): { kind: "fight" | "join" | "pay" | "flee"; cost: number } {
  if (!w.creatures[o.subid]) return { kind: "fight", cost: 0 };
  o.data ??= {};
  o.data.aggression ??= rollAggression(s, mapData(w, o));
  return reactionTo(s, w, h, o, Number(o.data.aggression), allowJoin);
}

/** What the monster would do (for Visions): undefined while its aggression isn't rolled yet. */
export function monsterIntent(s: AdventureState, w: World, h: Hero, o: AdvObject): ReturnType<typeof monsterReaction> | undefined {
  const a = o.data?.aggression ?? mapData(w, o).aggression;
  return a === undefined || !w.creatures[o.subid] ? undefined : reactionTo(s, w, h, o, Number(a), true);
}

function reactionTo(s: AdventureState, w: World, h: Hero, o: AdvObject, character: number, allowJoin: boolean): ReturnType<typeof monsterReaction> {
  const data = mapData(w, o);
  const c = w.creatures[o.subid];
  const [att, def] = effectivePrimary(h);
  // HotA's Diplomat's Cloak makes the army look three times as strong to them (heroes.thelazy.net).
  const cloak = wornArtifacts(h).includes(141) ? 3 : 1;
  const rel = (Math.sqrt((1 + 0.05 * att) * (1 + 0.05 * def)) * armyStrength(w, h.army) * cloak) / monsterStrength(w, o);
  const power = rel >= 7 ? 11 : rel >= 1 ? Math.floor(2 * (rel - 1)) : rel >= 0.5 ? -1 : rel >= 0.333 ? -2 : -3;
  // Kinship: the hero leads the same creature (or its upgrade / base).
  const kin = new Set([c.id, UPGRADE_OF[c.id], ...Object.entries(UPGRADE_OF).filter(([, up]) => up === c.id).map(([base]) => Number(base))]);
  let same = 0;
  let total = 0;
  for (const x of h.army) if (x) (kin.has(x.creature) && (same += x.count), (total += x.count));
  const sympathy = (same ? 1 : 0) + (same * 2 > total ? 1 : 0);
  // Diplomacy counts 1 (none) to 4 (expert); the easiest difficulty adds one, up to 4
  // (heroes.thelazy.net Wandering creature: "Join, Negotiate or Flee").
  const diplomacy = Math.min(4, skillLevel(h.skills, "diplomacy") + 1 + (s.difficulty === 0 ? 1 : 0));
  const charisma = power + diplomacy + sympathy;
  if (charisma < character) return { kind: "fight", cost: 0 };
  // Peaceful: they join when diplomacy and sympathy reach their mood, ask gold one or two short of
  // it, and run off further short. HotA: a share of them may join (0: none), or only for gold.
  const friendly = diplomacy + sympathy;
  const willing = friendly + 2 >= character;
  if (!willing) return data.neverFlees ? { kind: "fight", cost: 0 } : { kind: "flee", cost: 0 };
  if (allowJoin && !data.noJoin && Number(data.joiningPercentage ?? 100) > 0) {
    if (!data.joinOnlyForMoney && friendly >= character) return { kind: "join", cost: 0 };
    return { kind: "pay", cost: c.cost[6] * (o.amount ?? 1) };
  }
  // Turned down (or not allowed to join), they try to run, but fight when only just won over (C = M).
  if (charisma > character && !data.neverFlees) return { kind: "flee", cost: 0 };
  return { kind: "fight", cost: 0 };
}

/** What a monster leaves the hero who beats (or wins over) it: the map's resources and artifact. */
export function monsterReward(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  const data = mapData(w, o);
  const artifact = Number(data.artifact ?? -1);
  const reward = { resources: data.resources, artifacts: artifact >= 0 ? [artifact] : [] };
  const pictures: Component[] = [];
  const got = boxReward(s, w, objectCtx(s, w), h, reward, pictures);
  // "%s has found treasure." (VCMI's CGCreature::giveReward) with what it was.
  return got.length ? [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 183, args: [h.name] }), text: { file: "advevent", id: 183, args: [h.name] }, components: pictures }] : [];
}

/** A hero runs into wandering monsters: the map's message, then a fight or an offer the player answers (the AI at once). */
export function meetMonster(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  const said = mapData(w, o).message;
  const message: AdventureEvent[] = typeof said === "string" && said ? [{ e: "visit", hero: h.id, object: o.id, message: said }] : [];
  return [...message, ...monsterOffer(s, w, h, o, monsterReaction(s, w, h, o))];
}

function monsterOffer(s: AdventureState, w: World, h: Hero, o: AdvObject, r: ReturnType<typeof monsterReaction>): AdventureEvent[] {
  if (r.kind === "fight") return startFight(s, w, h, o);
  const offer = { object: o.id, kind: r.kind, cost: r.cost };
  if (s.players[h.owner]?.controller !== "human") {
    // The AI takes free or affordable joiners when there's room, and lets runaways go.
    const room = h.army.some((x) => !x || x.creature === o.subid);
    const accept = r.kind === "flee" ? false : room && s.players[h.owner].resources[6] >= r.cost;
    return resolveOffer(s, w, h, o, offer, accept);
  }
  h.offer = offer;
  // How many would come (HotA: the map's share of them), told in the question with their picture.
  const joins = r.kind === "flee" ? {} : { count: joiningCount(w, o), components: [{ kind: "creature" as const, id: o.subid, amount: joiningCount(w, o) }] };
  return [{ e: "offer", hero: h.id, object: o.id, kind: r.kind, cost: r.cost, ...joins }];
}

/** How many of a wandering stack join: HotA's map share of them (the price is for all), at least one. */
export function joiningCount(w: World, o: AdvObject): number {
  return Math.max(1, Math.floor(((o.amount ?? 1) * Number(mapData(w, o).joiningPercentage ?? 100)) / 100));
}

/** Opens a treasure chest of the given tier: the gold (choice 0) or the experience (1). */
function openChest(s: AdventureState, w: World, h: Hero, o: AdvObject, tier: number, choice: number): AdventureEvent[] {
  const [gold, xp] = [[1000, 500], [1500, 1000], [2000, 1500]][tier] ?? [1000, 500];
  o.removed = true;
  w.refresh(s);
  if (choice === 1) {
    s.log.push(`${h.name} shares out a treasure chest: ${xp} experience.`);
    gainExperience(s, w, h, xp);
    return [{ e: "pickup", hero: h.id, object: o.id, resource: 6, amount: 0 }];
  }
  s.players[h.owner].resources[6] += gold;
  s.log.push(`${h.name} opens a treasure chest: ${gold} gold.`);
  return [{ e: "pickup", hero: h.id, object: o.id, resource: 6, amount: gold }];
}

/**
 * What the Arena (+2 Attack or Defense, free) and the Schools of Magic (+1 Power or Knowledge) and
 * War (+1 Attack or Defense), 1000 gold each, teach.
 */
export function training(o: AdvObject): { name: string; skills: [number, number]; amount: number; cost: number } {
  if (o.type === 4) return { name: "Arena", skills: [0, 1], amount: 2, cost: 0 };
  if (o.type === 47) return { name: "School of Magic", skills: [2, 3], amount: 1, cost: 1000 };
  return { name: "School of War", skills: [0, 1], amount: 1, cost: 1000 };
}

/** Arena / School of Magic / School of War: the chosen primary skill (0-3). */
function trainAt(s: AdventureState, h: Hero, o: AdvObject, skill: number): AdventureEvent[] {
  const { name, skills, amount: n, cost } = training(o);
  if (!skills.includes(skill)) throw new Refusal("not taught here");
  const p = s.players[h.owner];
  if (p.resources[6] < cost) throw new Refusal(`It costs ${cost} gold.`);
  p.resources[6] -= cost;
  (o.visitors ??= []).push(h.id);
  h.primary[skill] += n;
  s.log.push(`${h.name} trains at the ${name}: +${n} ${PRIMARY_NAMES[skill]}.`);
  // (No window after the choice, as in the original: the hero's skill shows it.)
  return [];
}

export function resolveOffer(s: AdventureState, w: World, h: Hero, o: AdvObject, offer: NonNullable<Hero["offer"]>, accept: boolean, option?: number): AdventureEvent[] {
  // A map script's question (or its quest's "accept?"): the answer, then the rest of the script.
  if (offer.kind === "script") return resumeScript(s, w, h, accept, option);
  if (offer.kind === "primary") return accept && option !== undefined ? trainAt(s, h, o, option) : [];
  if (offer.kind === "ask") return accept ? grantReward(s, w, rewardCtx(s, w), h, o, offer.cost, true) : [];
  // A Pandora's Box: yes opens it (its guards first).
  if (offer.kind === "pandora") return accept ? openPandora(s, w, h, o, mapData(w, o)) : [];
  // A creature bank: yes means the fight with its guards.
  if (offer.kind === "attack") {
    if (dwellingOf(w, o) || o.type === Obj.MINE || o.type === 220) {
      if (!accept) return [];
      h.offer = offer;
      return visit(s, w, h, o);
    }
    const found = bankOf(s, o);
    return accept && found && !found.bank.cleared ? startFight(s, w, h, o, found.bank.guards, `${found.def.name} guards`) : [];
  }
  // Treasure chest: option 0 the gold, 1 the experience (cancelling leaves the chest).
  if (offer.kind === "chest") return accept ? openChest(s, w, h, o, offer.cost, option === 1 ? 1 : 0) : [];
  // An object that asks first (Witch Hut, Scholar, Cartographer): yes means the visit itself.
  if (offer.kind === "confirm") return accept ? ((visitObject(s, w, objectCtx(s, w), h, o, true) ?? []) as AdventureEvent[]) : [];
  // A finished quest (or a Border Guard with its key): yes goes ahead with the visit.
  if (offer.kind === "quest") {
    if (!accept) return [];
    h.offer = offer;
    return visit(s, w, h, o);
  }
  const c = w.creatures[o.subid];
  if (offer.kind === "flee") {
    if (accept) return startFight(s, w, h, o);
    o.removed = true;
    w.refresh(s);
    s.log.push(`The ${c?.plural ?? "monsters"} flee.`);
    // (Let go, they just leave: VCMI's CGCreature::fleeDecision says nothing.)
    return [];
  }
  const gold = s.players[h.owner].resources;
  // Turned down (or too dear: "You don't have enough gold!"), they run if they would anyway, else
  // they take it as an insult and attack (VCMI's joinDecision).
  if (!accept || gold[6] < offer.cost) {
    const poor: AdventureEvent[] = accept ? [{ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "genrltxt", id: 29 }), text: { file: "genrltxt", id: 29 } }] : [];
    if (monsterReaction(s, w, h, o, false).kind === "flee") return [...poor, ...monsterOffer(s, w, h, o, { kind: "flee", cost: 0 })];
    const insult: AdventureEvent = { e: "visit", hero: h.id, object: o.id, message: lineText({ file: "advevent", id: 87 }), text: { file: "advevent", id: 87 } };
    return [...poor, insult, ...startFight(s, w, h, o)];
  }
  // HotA: only the map's share of them joins (the price is for all).
  const joining = joiningCount(w, o);
  // No room: they wait in the original's garrison window for the player to make some.
  const full = !addToArmy(h, o.subid, joining);
  if (full && s.players[h.owner]?.controller !== "human") throw new Refusal("There's no room in the army for them.");
  if (full) h.joiners = [{ creature: o.subid, count: joining }, null, null, null, null, null, null];
  gold[6] -= offer.cost;
  o.removed = true;
  h.maxMovement = maxMovement(w, h);
  w.refresh(s);
  if (full) return [{ e: "joiners", hero: h.id }, ...monsterReward(s, w, h, o)];
  s.log.push(`${joining} ${c?.plural ?? "creatures"} join ${h.name}.`);
  // (They just join: VCMI's CGCreature::joinDecision says nothing more.)
  return monsterReward(s, w, h, o);
}

/** A town or mine changes hands. */
export function captureObject(s: AdventureState, w: World, h: Hero, o: AdvObject): AdventureEvent[] {
  o.owner = h.owner;
  o.taken = s.taken = (s.taken ?? 0) + 1;
  revealOwned(s, w, h.owner);
  s.log.push(`${h.name} claims ${o.type === Obj.TOWN ? o.name ?? "a town" : `${/^[AEIOU]/.test(RESOURCE_NAMES[o.subid] ?? "") ? "an" : "a"} ${RESOURCE_NAMES[o.subid] ?? ""} mine`}.`);
  const out: AdventureEvent[] = [{ e: "flag", object: o.id, owner: h.owner }];
  // A mine: the original's line for it (MINEEVNT, by resource) and what it gives each day.
  if (o.type === 53 || o.type === 220) {
    const res = o.type === 53 ? o.subid : Number(mapData(w, o).resource ?? o.data?.resource ?? 0);
    const daily = res === 6 ? 1000 : res === 0 || res === 2 ? 2 : 1;
    out.push({ e: "visit", hero: h.id, object: o.id, message: lineText({ file: "mineevnt", id: res }), text: { file: "mineevnt", id: res }, components: [{ kind: "income", id: res, amount: daily }] });
  }
  // A town: the hero goes in, as the original's (its guild's spells learnt, the town screen opened; The owner, 2026-10-26).
  if (o.type === Obj.TOWN && o.town) {
    // One Capitol to a kingdom: the captured town's falls to a City Hall when the new owner has one already (VCMI's
    // CGTownInstance::removeCapitols; a 2026-11-02 note: "you cannot have two Capitols").
    const t = o.town;
    if (t.built.includes(B.CAPITOL) && s.objects.some((x) => x !== o && !x.removed && x.owner === h.owner && x.town?.built.includes(B.CAPITOL))) {
      t.built = t.built.filter((b) => b !== B.CAPITOL);
      if (!t.built.includes(B.CITY_HALL)) t.built.push(B.CITY_HALL);
      s.log.push(`${o.name ?? "The town"}'s Capitol falls: one Capitol to a kingdom.`);
    }
    learnFromGuild(s, w, h, o);
    out.push({ e: "town", hero: h.id, object: o.id });
  }
  return out;
}

export { experienceForLevel };
export { MAX_LEVEL } from "./experience.ts";

/**
 * Monoliths' exits in turn (Player.cyclicPortals, beyond HotA): the next exit of the colour after the one taken last,
 * in their order on the map (level, row, column), skipping one a hero stands on. Null: the original's random pick.
 * (`on`: the switch as asked, for the map's lines before any move carried it.)
 */
export function portalTurn(s: AdventureState, w: World, player: number, o: AdvObject, exits: AdvObject[], on = !!s.players[player]?.cyclicPortals): { exit: AdvObject; key: string; at: number } | null {
  if (!on || o.type === SUBTERRANEAN_GATE || exits.length < 2) return null;
  const key = portalChannel(o);
  const order = exits.map((x) => ({ x, at: w.index(x.x, x.y, x.z) })).sort((a, b) => a.at - b.at);
  const last = s.players[player]?.portalLast?.[key] ?? -1;
  const from = Math.max(0, order.findIndex((e) => e.at > last));
  for (let k = 0; k < order.length; k++) {
    const e = order[(from + k) % order.length];
    const to = visitTile(w, e.x);
    if (to >= 0 && !w.heroAt[to]) return { exit: e.x, key, at: e.at };
  }
  return { exit: order[from].x, key, at: order[from].at };
}

/** A monolith's colour, as its exits' "type:subid" (one-way entrances lead to the exits of their colour). */
export const portalChannel = (o: AdvObject): string => `${o.type === MONOLITH_ONE_WAY_ENTRANCE ? MONOLITH_ONE_WAY_EXIT : o.type}:${o.subid}`;

/**
 * Where a teleport leads and what leads to it, of what `player` has explored (EXTRAS portalLinks): a monolith's
 * exits (two-way: they lead back too), a one-way exit's entrances, a gate's other end; `next`: the exit its heroes
 * take next with the exits in turn on. Null for anything else.
 */
export function portalLinks(s: AdventureState, w: World, player: number, o: AdvObject, cyclic: boolean): { exits: AdvObject[]; entrances: AdvObject[]; next?: AdvObject; total: number } | null {
  const known = (x: AdvObject) => isRevealed(s, player, w.index(x.x, x.y, x.z)) || isRevealed(s, player, visitTile(w, x));
  if (o.type === MONOLITH_ONE_WAY_EXIT) {
    const all = s.objects.filter((x) => !x.removed && x.type === MONOLITH_ONE_WAY_ENTRANCE && x.subid === o.subid);
    return { exits: [], entrances: all.filter(known), total: all.length };
  }
  if (o.type !== MONOLITH_ONE_WAY_ENTRANCE && o.type !== MONOLITH_TWO_WAY && o.type !== SUBTERRANEAN_GATE) return null;
  const all = teleportExits(s, o);
  const next = portalTurn(s, w, player, o, all, cyclic)?.exit;
  return { exits: all.filter(known), entrances: [], next: next && known(next) ? next : undefined, total: all.length };
}


/** A player's towns as the original lists them: those owned from the start, then by the order they were taken
 * (2026-11-02T23-49). */
export function ownTowns(s: AdventureState, player: number): AdvObject[] {
  return s.objects.filter((o) => o.town && !o.removed && o.owner === player).sort((a, b) => (a.taken ?? 0) - (b.taken ?? 0));
}
