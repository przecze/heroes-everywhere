// Every quick start's computer players play from the first days: New Game's advanced starts (☰ → Play's Week three is
// the first) and the guided first game. The owner, 2026-10-27: on Week three the rival's only hero held its castle from the
// gate day after day (a rival as strong as it two days off), the tavern shut behind it: nothing of theirs ever moved.
// Each start is played twice: the player idle at home, and the player's main hero as strong as the rival's best
// (Week three's promise: "just as far along"), the case that pinned the rival.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ADVANCED_STARTS, type AdventureState, type RandomMapOptions, applyAdventureAction, battleFor, buildGameData, createAdventure, findPaths, finishBattle, generateRandomMap, nextAiPlayer, playAiTurn, randomMapName } from "../src/index.ts";
import { runAi } from "../src/battle/runner.ts";
import { fakeRes } from "../../../tools/shots/fake.ts";

const files = ["crtraits", "objects", "hotraits", "hctraits", "artraits", "building", "bldgneut", "bldgspec", "dwelling", "sptraits"] as const;
const data = buildGameData({ ...Object.fromEntries(files.map((f) => [f, fakeRes(`${f}.txt`)!])), rmg: fakeRes("rmgtemplates.txt") } as never);

const QUICK: Omit<RandomMapOptions, "seed">[] = [...ADVANCED_STARTS, { size: 36, players: 2, humans: 1, monsters: 0, guided: true }];
const DAYS = 4;

/** Where each player's heroes stand (a hero hired, or gone into a garrison or out of one, counts as moved). */
const spots = (s: AdventureState, c: number) => new Set(s.heroes.filter((h) => !h.removed && h.owner === c).map((h) => `${h.id}:${h.x},${h.y},${h.z}:${h.garrison ?? ""}`));

test("every quick start: no computer player stands still two days running in its first days", { timeout: 600_000 }, () => {
  const idle: string[] = [];
  for (const o of QUICK)
    for (const matched of [false, true]) {
      const name = randomMapName({ ...o, seed: 7 });
      const map = generateRandomMap(data, { ...o, seed: 7 });
      const { state: s, world: w } = createAdventure(map, data, { seed: 3, mapFile: name, controllers: map.players.map((p, i) => (!p.canHuman && !p.canComputer ? "none" : i === 0 ? "human" : "ai")) });
      const rivals = s.players.filter((p) => p.alive && p.controller === "ai").map((p) => p.color);
      if (matched) {
        const best = s.heroes.filter((h) => !h.removed && rivals.includes(h.owner)).sort((a, b) => b.level - a.level)[0];
        const mine = s.heroes.filter((h) => !h.removed && h.owner === 0).sort((a, b) => b.level - a.level)[0];
        if (best && mine) {
          mine.army = best.army.map((x) => x && { ...x });
          // (Parked about a day's walk from the rival's hero, as the player's hero was.)
          const park = [...findPaths(w, s, best)].find(([i, n]) => n.cost >= 600 && n.cost <= 1200 && !n.passOnly && !w.visitBy[i] && !w.guardedBy[i] && !w.heroAt[i] && !w.blocked(i));
          if (park) [mine.x, mine.y, mine.z] = [park[0] % w.size, Math.floor(park[0] / w.size) % w.size, Math.floor(park[0] / (w.size * w.size))];
          w.refresh(s);
        }
      }
      const first = s.day;
      // (Each player's heroes compared before and after its own turn: one it hires may be beaten by the next player.)
      const moved = rivals.map(() => false);
      const quiet = rivals.map(() => 0);
      for (let guard = 0; guard < 500 && s.winner === undefined && s.day < first + DAYS; guard++) {
        // (The player ends each day where they stand; a fight a computer player brings them is fought by the battle AI.)
        const fight = battleFor(s, 0);
        if (fight) {
          for (const side of fight.pb.battle.sides) side.controller = "ai";
          runAi(fight.pb.battle);
          finishBattle(s, w, fight.key);
          continue;
        }
        const day = s.day;
        const p = nextAiPlayer(s);
        if (p >= 0) {
          const before = spots(s, p);
          playAiTurn(s, w, p);
          if ([...spots(s, p)].some((x) => !before.has(x))) moved[rivals.indexOf(p)] = true;
        } else if (!s.ended[0]) applyAdventureAction(s, w, { type: "endTurn" }, 0);
        if (s.day !== day) {
          // (One quiet day can be right, every hero holding a town against a stronger enemy; two in a row is a stall.)
          rivals.forEach((c, k) => {
            quiet[k] = s.players[c].alive && !moved[k] ? quiet[k] + 1 : 0;
            moved[k] = false;
            if (quiet[k] === 2) idle.push(`${name}${matched ? " (matched)" : ""}: player ${c} moved nothing on days ${day - 1} and ${day}`);
          });
        }
      }
    }
  assert.deepEqual(idle, []);
});
