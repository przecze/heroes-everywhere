// HotA 1.8's map scripts: timed and town events, scripted quests, questions and variables.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { HotaAction, HotaScripts } from "@heroes/formats";
import { timedEvents, type AdventureState, type Hero, type World } from "../src/index.ts";
import { TOWNS } from "../src/townData.ts";
import { buildingsFromBits } from "../src/adventure/town.ts";
import { pickTavernHero } from "../src/adventure/create.ts";
import { afterScriptBattle, answerPlayerScript, resumeScript, runScript } from "../src/adventure/scripts.ts";

const scripts = (events: Partial<HotaScripts["events"]>, vars: Record<number, number> = {}): HotaScripts => ({
  events: { hero: {}, player: {}, town: {}, quest: {}, ...events },
  names: {},
  variables: Object.fromEntries(Object.entries(vars).map(([id, initial]) => [id, { name: `v${id}`, initial, persist: false, imported: false }])),
});
const world = (sc: HotaScripts, extra: Record<string, unknown> = {}) =>
  ({ map: { hotaOptions: { scripts: sc }, events: [], ...extra }, data: { artifacts: [] }, creatures: [], refresh() {} }) as unknown as World;
const hero = () => ({ id: 0, owner: 0, type: 5, heroClass: 1, army: [{ creature: 10, count: 5 }, null, null, null, null, null, null], primary: [1, 1, 1, 1], skills: [], equipped: [], backpack: [] }) as unknown as Hero;
const state = (h?: Hero, objects: unknown[] = []) =>
  ({ day: 1, difficulty: 1, rng: 1, objects, heroes: h ? [h] : [], players: [{ alive: true, controller: "human", resources: [0, 0, 0, 0, 0, 0, 100] }] }) as unknown as AdventureState;

test("scripts: a timed event's script runs instead of its own resources, and keeps the map's variables", () => {
  // Invasion's "Week": once the blacksmith took the order, count the weeks.
  const week: HotaAction[] = [{ k: "if", cond: { k: ">", l: { k: "var", id: 2 }, r: 0 }, then: [{ k: "setVar", id: 3, mode: 2, value: { k: "+", l: { k: "var", id: 3 }, r: 1 } }], else: [] }];
  const w = world(scripts({ player: { 1: week } }, { 2: 0, 3: 0 }), { events: [{ name: "", message: "", resources: [0, 0, 0, 0, 0, 0, 500], players: 255, human: true, computer: true, first: 0, every: 7, script: { id: 1, sync: true } }] });
  const s = state();
  timedEvents(s, w);
  assert.equal(s.players[0].resources[6], 100, "no gold: the script runs instead");
  assert.equal(s.scripts!.vars[3], 0);
  s.scripts!.vars[2] = 1;
  s.day = 8;
  timedEvents(s, w);
  assert.equal(s.scripts!.vars[3], 1);
});

test("scripts: a town event tells its story, adds recruits and turns itself off", () => {
  const ev: HotaAction[] = [
    { k: "rewardsMessage", text: "The Pixies come.", body: [{ k: "hire", level: 0, amount: 14, show: false }] },
    { k: "disable" },
  ];
  const town = { id: 0, type: 98, subid: 8, owner: 0, x: 1, y: 1, z: 0, town: { built: [], available: [0, 0, 0, 0, 0, 0, 0], garrison: [null, null, null, null, null, null, null] } };
  const w = world(scripts({ town: { 17: ev } }));
  (w as unknown as Record<string, unknown>).visitBy = [];
  (w as unknown as Record<string, unknown>).index = () => 0;
  const events = [{ name: "", message: "", resources: [0, 0, 0, 0, 0, 0, 0], players: 255, human: true, computer: false, first: 0, every: 1, script: { id: 17, sync: true } }];
  (w as unknown as Record<string, unknown>).mapObjectsAt = () => [{ id: 98, data: { events } }];
  const s = state(undefined, [town]);
  const day = () => timedEvents(s, w);
  const first = day();
  assert.deepEqual(first, [{ e: "message", player: 0, text: "The Pixies come.", components: [] }]);
  assert.equal((s.objects[0] as unknown as typeof town).town.available[0], 14);
  s.day = 2;
  assert.deepEqual(day(), [], "turned off");
  assert.equal((s.objects[0] as unknown as typeof town).town.available[0], 14);
});

test("scripts: a quest proposes, then reminds, then asks and gives its reward and lets the hero by", () => {
  const quest: HotaAction[] = [
    {
      k: "quest",
      cond: { k: ">=", l: { k: "resource", player: -1, res: 6 }, r: 1000 },
      proposal: "Bring 1000 gold.",
      progression: "Not yet.",
      completion: "Pay?",
      hint: "Bring 1000 Gold",
      reward: [{ k: "resources", mode: 1, amounts: [0, 0, 0, 0, 0, 0, 1000], show: false }, { k: "creatures", take: false, creature: 20, count: 3, show: false }, { k: "removeObject" }],
    },
  ];
  const h = hero();
  const guard = { id: 0, type: 215, subid: 0, owner: -1, x: 2, y: 2, z: 0 } as unknown as AdventureState["objects"][number];
  const w = world(scripts({ quest: { 4: quest } }));
  const s = state(h, [guard]);
  const visit = () => runScript(s, w, "quest", 4, 0, { hero: h, object: guard });
  assert.equal((visit()[0] as { message: string }).message, "Bring 1000 gold.");
  assert.equal(guard.data?.questHint, "Bring 1000 Gold");
  assert.deepEqual(guard.visitors, [0], "in the quest log");
  assert.equal((visit()[0] as { message: string }).message, "Not yet.");
  s.players[0].resources[6] = 1500;
  const asked = visit();
  assert.equal(asked[0].e, "offer");
  assert.equal(h.offer?.kind, "script");
  assert.equal(s.players[0].resources[6], 1500, "nothing taken before the answer");
  delete h.offer;
  resumeScript(s, w, h, true);
  assert.equal(s.players[0].resources[6], 500);
  assert.deepEqual(h.army[1], { creature: 20, count: 3 });
  assert.equal(guard.removed, true);
});

test("scripts: a question with two pictures: the second choice, then the rest of the script", () => {
  const ev: HotaAction[] = [
    {
      k: "chain",
      branches: [
        {
          cond: { k: "const", value: true },
          body: [
            {
              k: "question",
              mode: 2,
              text: "Which?",
              yes: [{ k: "creatures", take: false, creature: 191, count: 25, show: false }],
              no: [{ k: "creatures", take: false, creature: 195, count: 10, show: false }],
              cancel: [],
              images: [{ kind: 8, sub: 191, isVar: false, value: 25 }, { kind: 8, sub: 195, isVar: false, value: 10 }],
            },
            { k: "setVar", id: 1, mode: 0, value: 2 },
          ],
        },
      ],
    },
    { k: "message", text: "Farewell.", images: [] },
  ];
  const h = hero();
  const hut = { id: 0, type: 83, subid: 0, owner: -1, x: 2, y: 2, z: 0 } as unknown as AdventureState["objects"][number];
  const w = world(scripts({ quest: { 2: ev } }, { 1: 0 }));
  const s = state(h, [hut]);
  const asked = runScript(s, w, "quest", 2, 0, { hero: h, object: hut });
  assert.deepEqual(asked[0], { e: "offer", hero: 0, object: 0, kind: "script", cost: 2, text: "Which?", components: [{ kind: "creature", id: 191, amount: 25 }, { kind: "creature", id: 195, amount: 10 }], options: [0, 1] });
  delete h.offer;
  const after = resumeScript(s, w, h, true, 1);
  assert.deepEqual(h.army[1], { creature: 195, count: 10 });
  assert.equal(s.scripts!.vars[1], 2, "what came after the question in its branch");
  assert.equal((after[0] as { message: string }).message, "Farewell.", "and after the branch");
});

const gold = (n: number): HotaAction => ({ k: "resources", mode: 0, amounts: [0, 0, 0, 0, 0, 0, n], show: false });
const timed = (id: number) => ({ name: "", message: "", resources: [0, 0, 0, 0, 0, 0, 0], players: 255, human: true, computer: true, first: 0, every: 0, script: { id, sync: true } });

test("scripts: a timed event's question is put to its player (no hero), then the rest runs", () => {
  const ev: HotaAction[] = [
    { k: "question", mode: 0, text: "Pay the toll?", yes: [gold(-50)], no: [gold(10)], images: [] },
    { k: "setVar", id: 1, mode: 2, value: 7 },
  ];
  const w = world(scripts({ player: { 3: ev } }, { 1: 0 }), { events: [timed(3)] });
  const s = state();
  const asked = timedEvents(s, w);
  assert.deepEqual(asked, [{ e: "scriptAsk", player: 0, text: "Pay the toll?", mode: 0, components: [] }]);
  assert.equal(s.scripts!.vars[1], 0, "nothing after the question before the answer");
  answerPlayerScript(s, w, 0, false);
  assert.equal(s.players[0].resources[6], 110, "the No branch");
  assert.equal(s.scripts!.vars[1], 7, "then the rest");
  assert.equal(s.players[0].script, undefined);
  // The computer says yes at once.
  const t = state();
  t.players[0].controller = "ai";
  assert.deepEqual(timedEvents(t, w), []);
  assert.equal(t.players[0].resources[6], 50);
  assert.equal(t.scripts!.vars[1], 7);
});

test("scripts: a question in an event run by another is asked, and the outer event goes on after it", () => {
  const inner: HotaAction[] = [{ k: "question", mode: 0, text: "Inner?", yes: [{ k: "setVar", id: 1, mode: 2, value: 1 }], no: [], images: [] }, { k: "setVar", id: 2, mode: 2, value: 1 }];
  const outer: HotaAction[] = [{ k: "run", bucket: 1, id: 5 }, { k: "setVar", id: 3, mode: 2, value: 1 }];
  const w = world(scripts({ player: { 4: outer, 5: inner } }, { 1: 0, 2: 0, 3: 0 }), { events: [timed(4)] });
  const s = state();
  assert.equal(timedEvents(s, w)[0].e, "scriptAsk");
  assert.deepEqual([s.scripts!.vars[1], s.scripts!.vars[2], s.scripts!.vars[3]], [0, 0, 0]);
  answerPlayerScript(s, w, 0, true);
  assert.deepEqual([s.scripts!.vars[1], s.scripts!.vars[2], s.scripts!.vars[3]], [1, 1, 1], "the yes branch, the rest of the inner event, then the outer's");
});

test("scripts: a question inside a loop: the loop goes on with its next turns after the answer", () => {
  const ev: HotaAction[] = [
    { k: "for", from: 1, to: 3, variable: 1, body: [{ k: "question", mode: 0, text: "Again?", yes: [gold(1)], no: [], images: [] }] },
    { k: "message", text: "Done.", images: [] },
  ];
  const w = world(scripts({ player: { 6: ev } }, { 1: 0 }), { events: [timed(6)] });
  const s = state();
  timedEvents(s, w);
  assert.equal(answerPlayerScript(s, w, 0, true)[0].e, "scriptAsk", "the second turn asks again");
  assert.equal(answerPlayerScript(s, w, 0, true)[0].e, "scriptAsk", "and the third");
  assert.deepEqual(answerPlayerScript(s, w, 0, true), [{ e: "message", player: 0, text: "Done.", components: [] }]);
  assert.equal(s.players[0].resources[6], 103);
});

test("scripts: after a script's battle, the rest of the script runs if its hero won, and not if it lost", () => {
  const ev: HotaAction[] = [
    { k: "message", text: "Ambush!", images: [] },
    { k: "combat", army: [{ creature: 10, count: 5 }] },
    { k: "message", text: "You won the day.", images: [] },
  ];
  const box = { id: 0, type: 26, subid: 0, owner: -1, x: 2, y: 2, z: 0 } as unknown as AdventureState["objects"][number];
  const w = world(scripts({ hero: { 8: ev } }));
  const h = hero();
  const s = state(h, [box]);
  h.scriptAfterBattle = { bucket: "hero", id: 8, path: [{ i: 1 }], object: 0 };
  assert.deepEqual(afterScriptBattle(s, w, h, true), [{ e: "visit", hero: 0, object: 0, message: "You won the day.", components: [] }]);
  assert.equal(h.scriptAfterBattle, undefined);
  h.scriptAfterBattle = { bucket: "hero", id: 8, path: [{ i: 1 }], object: 0 };
  assert.deepEqual(afterScriptBattle(s, w, h, false), [], "lost: the script ends there");
});

test("scripts: a two-picture question shows its extra pictures beside the choice", () => {
  const ev: HotaAction[] = [
    { k: "question", mode: 1, text: "Pick", yes: [], no: [], images: [{ kind: 0, sub: 6, isVar: false, value: 500 }, { kind: 6, sub: 0, isVar: false, value: 300 }], extra: [{ kind: 1, sub: 7, isVar: false, value: 0 }] },
  ];
  const h = hero();
  const hut = { id: 0, type: 26, subid: 0, owner: -1, x: 2, y: 2, z: 0 } as unknown as AdventureState["objects"][number];
  const w = world(scripts({ hero: { 1: ev } }));
  const s = state(h, [hut]);
  const [asked] = runScript(s, w, "hero", 1, 0, { hero: h, object: hut });
  assert.deepEqual((asked as { extra?: unknown }).extra, [{ kind: "artifact", id: 7 }]);
});

test("map bits: the HotA towns' special buildings (town events, scripts, starting buildings)", () => {
  const town = (subid: number) => ({ subid }) as unknown as AdventureState["objects"][number];
  const names = (subid: number, bits: number[]) => buildingsFromBits(town(subid), bits).map((id) => TOWNS[subid].buildings[id]?.name);
  assert.deepEqual(names(9, [18, 19, 20]), ["Thieves' Guild", "Grotto", "Gunpowder Warehouse"]);
  assert.deepEqual(names(10, [18, 19, 10, 22]), ["Bank", "Mana Generator", "Artifact Merchants", TOWNS[10].buildings[30]?.name]);
  assert.deepEqual(names(11, [18, 19, 20]), ["Fair", "Sieidi of Runes", "Altar of the Runes"]);
});

test("tavern: a HotA map without rehiring keeps out every beaten hero, a level 1 one too", () => {
  const s = { rng: 7, heroes: [{ type: 0, removed: true, level: 1 }], players: [{ tavern: [] }], objects: [], noRehiring: true } as unknown as AdventureState;
  for (let i = 0; i < 40; i++) assert.notEqual(pickTavernHero(s, 0, false), 0);
});
