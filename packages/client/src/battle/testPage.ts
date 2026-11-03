// The quick battle page (#battle): two armies from the menu's More… (Left / Right, Human / AI, New
// battle), or a recipe's link (?left=184:2&right=..., the Matrix's "Battle"), fought on the page with
// the local server; kept in this browser, so a reload resumes it.
import {
  COMBAT_SPELLS,
  type BattleHero,
  type BattleSetup,
  type BattleState,
  type Controller,
  type CreatureStats,
  HERO_CLASSES,
  HERO_INFO,
  HERO_PORTRAITS,
  SKILLS,
  type StackSetup,
  manaLimit,
  parseCreatures,
  battleBonuses,
} from "@heroes/core";
import { parseTxt } from "@heroes/formats";
import type { Application } from "pixi.js";
import { buildArmies } from "../armies.ts";
import { fetchRes } from "../assets.ts";
import { setGameOptions } from "../chrome/pageMenu.ts";
import { localConnection } from "../connection.ts";
import { setupFeedback } from "../feedback/index.ts";
import { loadData } from "../gameData.ts";
import { localizeCreatures } from "../i18n/creatures.ts";
import { lang, tr, type Text, said } from "../i18n/index.ts";
import { Modals } from "../ui/modals.ts";
import { messageBox } from "../ui/dialogs.ts";
import { BattleView } from "./view.ts";
import { setMapPadHooks } from "../map/padKeys.ts";
import { onPageEnd } from "../pages.ts";
import { browsersKey, undoKey } from "../chrome/browserKeys.ts";

const SAVE_KEY = "heroes.battle.v1";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSaved(): { state: BattleState; seed: number } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(state: BattleState, seed: number) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, seed }));
  } catch {
    // Storage can be unavailable (private mode); the battle just won't survive a reload.
  }
}

export async function startBattlePage(app: Application) {
  const creatures: CreatureStats[] = parseCreatures(parseTxt(await fetchRes("crtraits.txt")));
  localizeCreatures(creatures, lang());
  const conn = localConnection();
  let seed = 0;
  let current: BattleState | null = null;
  const view = new BattleView(app, (action) => conn.send({ t: "act", action }));
  // A console's controller (map/padKeys.ts): the battle's buttons.
  setMapPadHooks({ context: () => (view.modals.open ? "window" : view.myTactics() ? "tactics" : "battle") });
  onPageEnd(() => setMapPadHooks(null));
  app.stage.addChild(view.root);
  // Dev-only handle for debugging from the console / agent browser (main.ts gives __app and __uiTree).
  if (import.meta.env.DEV) Object.assign(window, { __battle: view });

  conn.onMessage((msg) => {
    if (msg.t === "error") {
      $("status").textContent = tr("Server: %1", msg.message);
      return;
    }
    if (msg.t !== "update") return;
    // Late replies for a battle we've already left (e.g. AI finishing it) are dropped.
    if (msg.state.id !== seed) return;
    localizeCreatures(msg.state.creatures, lang());
    current = msg.state;
    save(msg.state, seed);
    view.update(msg.state, msg.events, msg);
  });
  // An addition (EXTRAS battleUndo): the battle back to before the last decision.
  view.onUndo = () => conn.send({ t: "battleUndo" });
  view.onApplied = (s) => {
    const w = s.winner;
    $("status").textContent = w === null ? tr("Round %1", s.round) : w === "draw" ? tr("Draw") : tr("%1 wins", s.sides[w].name);
  };

  // Toolbar
  const armies = buildArmies(creatures);
  const armyA = $<HTMLSelectElement>("armyA");
  const armyB = $<HTMLSelectElement>("armyB");
  for (const sel of [armyA, armyB]) {
    for (const [i, a] of armies.entries()) sel.add(new Option(a.name, String(i)));
  }
  armyB.value = "2";
  const ctrl = (id: string) => $<HTMLSelectElement>(id).value as Controller;

  // One start at a time: a click during an automatic start would interleave two battles.
  let starting = false;
  /** Said before the next battle starts (a recipe's ?what=). */
  let intro: Text | null = null;
  const data = await loadData();
  const newBattle = async () => {
    if (starting) return;
    starting = true;
    try {
      await startNewBattle();
    } finally {
      starting = false;
    }
  };
  const startNewBattle = async () => {
    seed = (Math.random() * 2 ** 31) | 0;
    const a = armies[Number(armyA.value)];
    const b = armies[Number(armyB.value)];
    // A random might hero of the army's town leads each side.
    const leader = (stacks: StackSetup[], owner: number): BattleHero | undefined => {
      const might = Object.keys(HERO_INFO).map(Number).filter((id) => id < 144 && HERO_CLASSES[HERO_INFO[id].heroClass].affinity === "might");
      // The first stack's town's hero; a town without one here (the Factory's): the next stack's, else any (a recipe's spells need a hero).
      const ids = stacks.map((st) => might.filter((id) => HERO_CLASSES[HERO_INFO[id].heroClass].faction === creatures[st.creature]?.faction)).find((l) => l.length) ?? might;
      if (!ids.length) return undefined;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const info = HERO_INFO[id];
      // Quick battles: a spellbook with six random combat spells of levels 1-3, to try magic.
      const pool = (data.spells ?? []).filter((sp) => COMBAT_SPELLS[sp.id] && sp.level >= 1 && sp.level <= 3);
      // ?spells=40,15 sets the left hero's spellbook instead, ?rspells= the right's; a recipe (?left= / ?right=) gives no random spells.
      const params = new URLSearchParams(location.search);
      const chosen = (params.get(owner === 0 ? "spells" : "rspells") ?? "").split(",").filter(Boolean).map(Number);
      const recipe = params.has("left") || params.has("right");
      const spells = chosen.length ? chosen : recipe ? [] : pool.sort(() => Math.random() - 0.5).slice(0, 6).map((sp) => sp.id);
      const primary = [...data.classPrimary[info.heroClass]] as [number, number, number, number];
      // ?power=10&know=10: the left hero's Spell Power and Knowledge (a recipe's caster); ?rpower= / ?rknow= the right's.
      for (const [key, i] of [["power", 2], ["know", 3]] as const) {
        const k = owner === 0 ? key : `r${key}`;
        if (params.has(k)) primary[i] = Math.max(primary[i], Number(params.get(k)) || 0);
      }
      // ?tactics=1..3 gives the left hero Tactics; ?skills=firstAid:3,ballistics:2 any skills (?rskills= the right's).
      const skills = owner === 0 ? leftSkills() : heroSkills("rskills");
      // A fresh hero starts with its spell points full: never above the maximum (10 per Knowledge, more with Intelligence).
      const maxMana = manaLimit(primary[3], skills);
      return {
        name: data.heroNames[id],
        heroClass: info.heroClass,
        // ?level= / ?rlevel=: the left / right hero's level (a computer hero from level 5 retreats from a lost fight).
        level: Number(params.get(owner === 0 ? "level" : "rlevel")) || undefined,
        female: info.female,
        owner,
        primary,
        portrait: HERO_PORTRAITS[id] || undefined,
        spells,
        mana: maxMana,
        maxMana,
        // Ballista, ammo cart, first aid tent and catapult (used only in sieges); ?machines=146,5,6,3 others (146: the Cannon).
        machines: (params.get("machines") ?? "4,5,6,3").split(",").filter(Boolean).map(Number),
        skills,
        // ?arts=158 / ?rarts=: artifacts the left / right hero wears (their battle bonuses), to try one in a fight.
        bonuses: battleBonuses({ equipped: (params.get(owner === 0 ? "arts" : "rarts") ?? "").split(",").filter(Boolean).map(Number) } as Parameters<typeof battleBonuses>[0]),
      };
    };
    const tacticsLevel = Number(new URLSearchParams(location.search).get("tactics") ?? 0);
    const heroSkills = (key: string) => {
      const list = (new URLSearchParams(location.search).get(key) ?? "")
        .split(",")
        .filter(Boolean)
        .map((x) => x.split(":"))
        .map(([k, lvl]) => [SKILLS.indexOf(k as (typeof SKILLS)[number]), Number(lvl) || 1] as [number, number])
        .filter(([id]) => id >= 0);
      return list.length ? list : undefined;
    };
    const leftSkills = () => {
      const list = heroSkills("skills") ?? [];
      if (tacticsLevel) list.push([SKILLS.indexOf("tactics"), tacticsLevel]);
      return list.length ? list : undefined;
    };
    // ?siege=<faction>: the right side defends that town's castle walls.
    const siegeOf = new URLSearchParams(location.search).get("siege");
    // ?left=184:2,0:20&right=...: try particular creatures (creature id:count, comma separated).
    const custom = (key: string) =>
      new URLSearchParams(location.search)
        .get(key)
        ?.split(",")
        .map((p) => p.split(":").map(Number))
        .filter(([c, n]) => creatures[c] && n > 0)
        .map(([creature, count]) => ({ creature, count }));
    const left = custom("left");
    const right = custom("right");
    const aStacks = left?.length ? left : a.stacks;
    const bStacks = right?.length ? right : b.stacks;
    // ?tight=1: both armies packed together (a recipe for breaths and auras).
    const tight = new URLSearchParams(location.search).get("tight") === "1" || undefined;
    // ?deep=left|right|both: that side two deep (a recipe for breaths).
    const deep = new URLSearchParams(location.search).get("deep");
    // ?field=ship: that battlefield (the map picks it by the ground fought on).
    const field = new URLSearchParams(location.search).get("field") ?? undefined;
    const setup: BattleSetup = {
      seed,
      field,
      // ?fort=1|2: a town with only a Fort / a Citadel.
      siege: siegeOf ? { faction: siegeOf, level: Number(new URLSearchParams(location.search).get("fort") ?? 3) || 3, structures: 12 } : undefined,
      sides: [
        { name: a.name, controller: ctrl("ctrlA"), stacks: aStacks, hero: leader(aStacks, 0), tight, deep: deep === "left" || deep === "both" || undefined },
        { name: b.name, controller: ctrl("ctrlB"), stacks: bStacks, hero: leader(bStacks, 1), tight, deep: deep === "right" || deep === "both" || undefined },
      ],
    };
    view.reset();
    await view.init(seed);
    if (intro) await messageBox(new Modals(app), intro, 0, { title: tr("What this battle shows") });
    intro = null;
    conn.send({ t: "start", setup });
  };
  $("newBattle").onclick = () => void newBattle();
  for (const [id, side] of [["ctrlA", 0], ["ctrlB", 1]] as const) {
    $<HTMLSelectElement>(id).onchange = () => conn.send({ t: "control", side, controller: ctrl(id) });
  }
  view.onAuto = () => {
    if (!current) return;
    // Hand every human side to the AI.
    current.sides.forEach((s, i) => {
      if (s.controller === "human") {
        $<HTMLSelectElement>(i === 0 ? "ctrlA" : "ctrlB").value = "ai";
        conn.send({ t: "control", side: i as 0 | 1, controller: "ai" });
      }
    });
  };

  // The menu's System Options: here the combat options.
  setGameOptions(() => void view.openOptions());

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("textarea, input, select")) return;
    // Ctrl+Z (Cmd+Z): Undo (EXTRAS battleUndo), before the browser's keys take it.
    if (undoKey(e) && view.undo()) return void e.preventDefault();
    if (browsersKey(e)) return;
    if (view.onKey(e.key)) return;
    if (e.key === "n") void newBattle();
    else if (e.key === "m") $("mute").click();
  });

  setupFeedback(app, () => current);

  // Resume where we left off (survives hot reloads and page refreshes).
  const saved = loadSaved();
  // A battle recipe's link (the Matrix's "Battle", ?...&new=1): that battle, not the one left off;
  // the flag goes, so a reload resumes it.
  const fresh = new URLSearchParams(location.search).has("new");
  if (fresh) {
    const q = new URLSearchParams(location.search);
    q.delete("new");
    history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`);
  }
  if (saved && saved.state.winner === null && !fresh) {
    seed = saved.seed;
    saved.state.id ??= saved.seed; // saves from before battles had ids
    localizeCreatures(saved.state.creatures, lang());
    current = saved.state;
    $<HTMLSelectElement>("ctrlA").value = saved.state.sides[0].controller;
    $<HTMLSelectElement>("ctrlB").value = saved.state.sides[1].controller;
    await view.init(seed);
    conn.send({ t: "resume", state: saved.state });
  } else {
    // A recipe's link says what its battle shows (?what=): told before it begins (a faster enemy would act while it's read).
    if (fresh) intro = said(new URLSearchParams(location.search).get("what"));
    await newBattle();
  }
}
