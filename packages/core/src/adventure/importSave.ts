// A saved game of the original (HoMM3 SoD / HotA .GM1, read by formats' h3save.ts) carried on here:
// the scenario is started from the same map, then what the save holds is put in: the heroes (where
// they stand, level, skills, spells, army, artifacts), the towns (owner, garrison, name, buildings,
// creatures to recruit), what has been taken or beaten off the map, how random objects turned out,
// monster counts, mine and dwelling owners, resources, the date, who plays and the fog. What the
// reader can't find (HotA's own shapes so far, visited places, quests) stays as the scenario starts
// it; the report says which.
import type { H3Map, H3Save, SaveHero } from "@heroes/formats";
import { type GameData, boatIfAtSea, createAdventure, isInteractive, makeHero, tavernOffer } from "./create.ts";
import { MACHINE_SLOT, SLOT, SPELLBOOK_ARTIFACT, equipArtifact, initEquipment } from "./artifacts.ts";
import { maxMovement } from "./movement.ts";
import { initialTown, townInfo } from "./town.ts";
import { type AdventureState, type Hero, Obj } from "./types.ts";
import { type World, maskTiles, revealOwned } from "./world.ts";

export interface SaveImportReport {
  heroes: number;
  /** Owned heroes left out (off the map and not in a town's garrison, or a creature or hero this game doesn't know). */
  heroesSkipped: number;
  towns: number;
  /** Monsters set to the save's counts. */
  monsters: number;
  /** Map objects gone in the save (picked up, beaten, used up) and removed here. */
  objectsGone: number;
  /** Random objects (monsters, artifacts, resources, towns, dwellings) set to what the save rolled. */
  randomsResolved: number;
  fog: boolean;
  /** Not carried over: the scenario's own start stands for these. */
  notRead: string[];
}

export interface SaveImportOptions {
  seed: number;
  /** The map file as the server knows it (the scenario list's entry). */
  mapFile: string;
  /** The colours a person plays (the rest of the living ones: the computer). Default: the first that may be human. */
  humans?: number[];
  difficulty?: number;
}

/** How far the save's map is from this map file: undefined when they're the same map, else why not. */
export function saveMapDiffers(save: H3Save, map: H3Map): string | undefined {
  if (save.size !== map.size || save.levels !== map.levels) return `the save's map is ${save.size}x${save.size}x${save.levels}, this one ${map.size}x${map.size}x${map.levels}`;
  let differ = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    const a = map.tiles[i], b = save.tiles[i];
    if (!b || a.terrain !== b.terrain || a.river !== b.river || a.road !== b.road) differ++;
  }
  if (differ > map.tiles.length / 50) return `${differ} of ${map.tiles.length} tiles differ`;
  if (alignObjects(save, map).aligned < map.objects.length * 0.95) return "the objects differ";
  return undefined;
}

/** Each of the map's objects' entry in the save's list (by position, in order; the save may add objects of its own). */
function alignObjects(save: H3Save, map: H3Map): { at: number[]; aligned: number } {
  const at: number[] = Array(map.objects.length).fill(-1);
  let j = 0;
  for (let i = 0; i < save.objects.length && j < map.objects.length; i++) {
    const o = save.objects[i], mo = map.objects[j];
    if (o.x === mo.x && o.y === mo.y && o.z === mo.z) at[j++] = i;
  }
  return { at, aligned: j };
}

/** Players still in the game in the save: owning a hero or a town. */
export function savePlayers(save: H3Save): number[] {
  const alive = new Set<number>();
  for (const h of save.heroes) if (h.owner < 8) alive.add(h.owner);
  for (const t of save.towns) if (t.owner < 8) alive.add(t.owner);
  return [...alive].sort((a, b) => a - b);
}

export function importOriginalSave(map: H3Map, data: GameData, save: H3Save, opts: SaveImportOptions): { state: AdventureState; world: World; report: SaveImportReport } {
  const alive = savePlayers(save);
  const savedHumans = save.players.filter((p) => p.human && alive.includes(p.color)).map((p) => p.color);
  const humans = opts.humans ?? (savedHumans.length ? savedHumans : [alive.find((c) => map.players[c]?.canHuman) ?? alive[0] ?? 0]);
  const controllers = map.players.map((_, c) => (humans.includes(c) ? "human" : alive.includes(c) ? "ai" : "none") as "human" | "ai" | "none");
  const { state: s, world: w } = createAdventure(map, data, { seed: opts.seed, mapFile: opts.mapFile, controllers, difficulty: opts.difficulty ?? map.difficulty });
  const notRead: string[] = [];
  if (!save.date) notRead.push("date");
  if (!save.players.length) notRead.push("resources");
  if (!save.towns.some((t) => t.built)) notRead.push("buildings");
  if (save.missing.includes("mines and dwellings") || (save.hota && !save.mines.length)) notRead.push("flagged mines and dwellings");
  notRead.push("visited objects", "quests");
  const report: SaveImportReport = { heroes: 0, heroesSkipped: 0, towns: 0, objectsGone: 0, randomsResolved: 0, monsters: 0, fog: false, notRead };

  // The map's interactive objects became state objects in order (heroes, placeholders and the grail aside: create.ts).
  const objectOf: number[] = Array(map.objects.length).fill(-1);
  let next = 0;
  map.objects.forEach((mo, i) => {
    if (!isInteractive(map, i) || mo.id === Obj.HERO || mo.id === Obj.RANDOM_HERO || mo.id === Obj.HERO_PLACEHOLDER || mo.id === Obj.GRAIL) return;
    objectOf[i] = next++;
  });

  const { at } = alignObjects(save, map);
  map.objects.forEach((mo, i) => {
    const o = s.objects[objectOf[i]];
    const so = save.objects[at[i]];
    if (!o || !so) return;
    if (!so.present && !o.town && !o.removed) {
      o.removed = true;
      report.objectsGone++;
      return;
    }
    // A random object as the save rolled it (its picture says which), when this game has that picture.
    const st = save.templates[so.template];
    const tmpl = st && data.templates.find((t) => t.def === st.def);
    if (tmpl && mo.id !== tmpl.id && (o.type !== tmpl.id || o.subid !== tmpl.subid)) {
      Object.assign(o, { type: tmpl.id, subid: tmpl.subid, def: tmpl.def, block: tmpl.blockMask, visit: tmpl.visitMask, flat: !!tmpl.printPriority, x: so.x, y: so.y, z: so.z });
      if (o.town) o.town = initialTown(s, o, mo.data);
      report.randomsResolved++;
    }
  });

  for (const t of save.towns) {
    const o = s.objects.find((x) => x.town && x.x === t.x && x.y === t.y && x.z === t.z);
    if (!o?.town) continue;
    o.owner = t.owner < 8 && controllers[t.owner] !== "none" ? t.owner : -1;
    o.town.garrison = t.army.map((a) => (a && data.creatures[a.creature] ? { ...a } : null));
    if (t.name) o.name = t.name;
    const info = townInfo(o);
    if (t.built && info) {
      o.town.built = t.built.filter((id) => id === 10 || info.buildings[id]).sort((a, b) => a - b);
      if (t.recruits) o.town.available = o.town.available.map((_, k) => (t.recruits![0][k] ?? 0) + (t.recruits![1][k] ?? 0));
    }
    report.towns++;
  }

  // Monsters as many as the save has them (a monster's count is in its tile's setup bits).
  const mapIndexOf = new Map<number, number>();
  at.forEach((si, mi) => si >= 0 && mapIndexOf.set(si, mi));
  for (const t of save.tiles) {
    if (t.cls !== Obj.MONSTER) continue;
    const mi = mapIndexOf.get(t.object);
    const o = mi === undefined ? undefined : s.objects[objectOf[mi]];
    const n = t.setup & 0xfff;
    if (o && !o.removed && o.type === Obj.MONSTER && n > 0 && o.amount !== n) {
      o.amount = n;
      report.monsters++;
    }
  }

  // Mines and dwellings: their flags.
  const flag = (types: number[], f: { owner: number; x: number; y: number; z: number }) => {
    if (f.x < 0) return;
    const o = s.objects.find((x) => !x.removed && types.includes(x.type) && x.x === f.x && x.y === f.y && x.z === f.z);
    if (o) o.owner = f.owner < 8 && controllers[f.owner] !== "none" ? f.owner : -1;
  };
  for (const m of save.mines) flag([Obj.MINE, Obj.ABANDONED_MINE], m);
  for (const d of save.dwellings) flag([17, 20], d);

  // The heroes: the save's own, every one of them (the scenario's starting heroes go, and the boats
  // they sat in; the map's conditions naming a hero name the same hero again).
  const named = { victory: s.heroes[s.conditions?.victory.hero ?? -1]?.type, loss: s.heroes[s.conditions?.loss.hero ?? -1]?.type };
  for (const o of s.objects) if (o.carriedBy !== undefined) o.removed = true;
  s.heroes = [];
  w.refresh(s);
  for (const sh of save.heroes) {
    if (sh.owner > 7 || controllers[sh.owner] === "none") continue;
    const h = heroFrom(s, w, data, sh);
    if (h) {
      s.heroes.push(h);
      report.heroes++;
    } else report.heroesSkipped++;
  }
  for (const h of s.heroes) boatIfAtSea(s, data, map, h);
  if (s.conditions) {
    s.conditions.victory.hero = s.heroes.find((h) => h.type === named.victory)?.id;
    s.conditions.loss.hero = s.heroes.find((h) => h.type === named.loss)?.id;
  }
  w.refresh(s);
  for (const h of s.heroes) h.maxMovement = maxMovement(w, h);

  if (save.date) s.day = (save.date.month - 1) * 28 + (save.date.week - 1) * 7 + save.date.day;
  // What each player has seen, and has.
  for (const p of s.players) {
    if (!p.alive) continue;
    const sp = save.players[p.color];
    if (sp) p.resources = sp.resources.map((n) => Math.max(0, n));
    p.revealed = [];
    if (save.fog) {
      p.revealed = new Array(Math.ceil(save.fog.length / 32)).fill(0);
      for (let i = 0; i < save.fog.length; i++) if ((save.fog[i] >> p.color) & 1) p.revealed[i >> 5] |= 1 << (i & 31);
      report.fog = true;
    }
    revealOwned(s, w, p.color);
    delete p.tavern;
    delete p.tavernRoles;
    tavernOffer(s, p.color, data.classTavernOdds);
  }
  s.current = s.players.findIndex((p) => p.alive);
  s.log.push(`Carried on from the original's saved game of ${save.mapFile || save.name}.`);
  w.refresh(s);
  return { state: s, world: w, report };
}

function heroFrom(s: AdventureState, w: World, data: GameData, sh: SaveHero): Hero | undefined {
  if (sh.x < 0) return undefined;
  const army = sh.army.map((a) => (a && data.creatures[a.creature] ? { ...a } : null));
  const h = makeHero(s, data, sh.id, sh.owner, sh.x, sh.y, sh.z, army, sh.name || undefined);
  if (!sh.onMap) {
    // Off the map at a town: its garrison's hero (the save keeps the town's gate as its place).
    const town = s.objects.find((o) => o.town && !o.removed && o.owner === sh.owner && o.z === sh.z && maskTiles(o.visit, 1).some(({ dx, dy }) => o.x + dx === sh.x && o.y + dy === sh.y));
    if (!town) return undefined;
    h.garrison = town.id;
  }
  h.id = s.heroes.length;
  h.experience = sh.experience;
  h.level = Math.max(1, sh.level);
  h.primary = [...sh.primary];
  h.skills = sh.skills.map(([id, lvl]) => [id, lvl] as [number, number]);
  h.movement = sh.movement;
  h.equipped = Array(19).fill(-1);
  const pack: number[] = [];
  const scrolls: number[] = [];
  let book = false;
  sh.worn.forEach((a, k) => {
    if (a < 0 || !data.artifacts[a]) return;
    // (The game's worn slots: helm .. feet, misc 1-4, the four machines, the spellbook, misc 5.)
    if (k === 17) return void (book = a === SPELLBOOK_ARTIFACT);
    if (MACHINE_SLOT[a] !== undefined && k >= 13 && k <= 16) return void (h.equipped![MACHINE_SLOT[a]] = a);
    if (a === 1 && sh.wornScrolls[k] !== undefined) scrolls.push(sh.wornScrolls[k]);
    if (!equipArtifact(h, data.artifacts, a)) pack.push(a);
  });
  for (const a of sh.backpack) if (data.artifacts[a]) pack.push(a);
  h.backpack = pack;
  if (scrolls.length) h.scrolls = scrolls;
  h.spells = book ? [...sh.spells] : undefined;
  initEquipment(h);
  if (book) h.equipped[SLOT.SPELLBOOK] = SPELLBOOK_ARTIFACT;
  h.mana = sh.mana;
  return h;
}
