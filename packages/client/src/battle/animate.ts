// Every battle event's animation (docs/battle-animations.md): moves, blows and shots, spells, the field's own
// events; effects, colour muxers, the floating numbers. All timing on the battle's one clock (anim/clock.ts).
import type { BattleView } from "./view.ts";
import { showBattleResult } from "./result.ts";
import { extra } from "../settings.ts";
import { LOG, COMBAT_SPELLS, SPELL, SPELL_ART, type BattleEvent, type BattleState, type Unit, alive, effectOf, hexRow, stats, unitHexes, gatewayHexes, WALL_HEX, TOWER_POS, defendBonus, stackName, updateGate } from "@heroes/core";
import { phoneSized, screenSize } from "../ui/screen.ts";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { label } from "../ui/kit.ts";
import * as pace from "./anim/pace.ts";
import { creaturePortrait, loadDef, loadImage } from "../assets.ts";
import { playMusic, playSound, playSoundLooped } from "../audio.ts";
import { CREATURE_ANCHOR, SCREEN_W, hexCenter, CROP_X, CROP_W, depthOf } from "./layout.ts";
import { shotOrigin } from "./shotOrigins.ts";
import { walkTime } from "./walkTimes.ts";
import type { EffectPlace } from "./fx.ts";
import { type LookPart, lookOf, muxAt, muxLength } from "./anim/looks.ts";
import type { AttackEvent } from "./blows.ts";
import { SHOT_HITS } from "./shotHits.ts";
import { CMNUMWIN, plateStrip } from "../ui/blocks/windowParts.ts";
import { quick, setQuick } from "../speed.ts";
import { Anim, UnitSprite } from "./unitSprite.ts";
import { tr, fmt, type Text, said } from "../i18n/index.ts";
import { PART_NAMES } from "./texts.ts";

/** Creatures with a sound as they set off and as they land (VCMI's creature configs' startMoving / endMoving: xxxxEXT1 / EXT2). */
const MOVE_EXT_SOUNDS = new Set(["DEVL", "ADVL", "VAMP", "NOSF", "WORM", "NIMP"]);

export class BattleAnimator {
  private readonly v: BattleView;
  constructor(v: BattleView) {
    this.v = v;
  }

  async animate(ev: BattleEvent, final: BattleState, splash: AttackEvent[] = []) {
    const s = this.v.state!;
    switch (ev.e) {
      case "move":
        return this.animateMove(s, ev);
      case "attack":
        return this.animateAttack(s, ev, splash, final);
      case "spell":
        return this.animateSpell(s, ev, final);
      case "death":
        await this.v.syncSprites();
        break;
      // The Horn of the Abyss: Fangarms get up where the stack fell.
      case "rise": {
        const now = final.units[ev.unit];
        if (!now) break;
        s.units[ev.unit] = structuredClone(now);
        this.sfx("ANIMDEAD");
        await this.v.syncSprites();
        this.floatOver(s.units[ev.unit], 0, 0, 0, now.count);
        const from = s.units[ev.from];
        this.v.say(tr(`%1 %2 rise from the fallen%3.`, now.count, stackName(s, now), from ? ` ${stats(s, from).plural}` : ""));
        break;
      }
      case "catapult": {
        const u = s.units[ev.unit];
        const sp = this.v.sprites.get(u.id);
        this.sfx(stats(s, u).sound + "SHOT");
        // As VCMI's CatapultAnimation (a ShootingAnimation): the throw up to its climax frame, held while the
        // stone arcs to the wall part's hex, then a cloud of rubble on a hit (SGEXPL) or dust from the stone
        // bouncing off (CSGRCK).
        const frames = sp?.frames.get(Anim.Shoot)?.length ?? 0;
        const origin = await shotOrigin(u.creature);
        const climax = origin?.climax ? pace.shotFrame(origin.climax, frames) : pace.meleeHitFrame(frames);
        const throwing = sp ? sp.play(Anim.Shoot) : Promise.resolve();
        sp?.holdOn(climax);
        if (sp) await sp.untilFrame(climax);
        const at = hexCenter(u.pos);
        const wall = hexCenter(WALL_HEX[ev.part]);
        const hit = { x: wall.x - 20, y: wall.y - 62 };
        await this.v.fx.lob(stats(s, u).missile, { x: at.x, y: at.y - 70 }, hit);
        sp?.release();
        this.sfx(ev.damage ? "WALLHIT" : "WALLMISS");
        // effectAt centres the picture 20 px above the point it's given.
        const blast = this.v.fx.effectAt(ev.damage ? "sgexpl.def" : "csgrck.def", hit.x, hit.y + 20);
        await this.delay(150);
        if (s.siege) s.siege.walls[ev.part] = Math.max(0, (s.siege.walls[ev.part] ?? 0) - ev.damage);
        const what = PART_NAMES[ev.part];
        const by = u.machine ? tr("The catapult") : tr("The %1", stackName(s, u));
        const v = (verb: string, es = "s") => verb + (u.machine ? es : "");
        this.v.say(ev.damage ? tr(`%1 %2 the %3.`, by, v(ev.destroyed ? "destroy" : "damage"), what) : tr(`%1 %2 the %3 to no effect.`, by, v("hit"), what));
        await this.v.siege.sync(s);
        // A tower down: its archers go with it at once, not at the next redraw (a 2026-11-02 note: "the sprite of the
        // unit inside is shortly visible, it should disappear together with the turret").
        const towerAt = ({ keep: TOWER_POS.keep, bottomTower: TOWER_POS.bottomTower, upperTower: TOWER_POS.upperTower } as Partial<Record<string, number>>)[ev.part];
        if (towerAt !== undefined && s.siege && !s.siege.walls[ev.part])
          for (const t of s.units) if (t.machine === "tower" && t.pos === towerAt) {
            const ts = this.v.sprites.get(t.id);
            if (ts) ts.visible = false;
          }
        await Promise.all([blast, throwing]);
        void sp?.play(Anim.Stand, true);
        break;
      }
      case "moat": {
        const u = s.units[ev.unit];
        const sp = this.v.sprites.get(u.id);
        this.v.say(tr(`The moat does %1 damage.%2`, ev.damage, ev.killed ? tr(` %1 perish.`, ev.killed) : ""));
        if (sp) await this.react(u, ev.damage, ev.killed);
        break;
      }
      case "defend": {
        const du = s.units[ev.unit];
        // GENRLTXT 120 for one creature ("The Pikeman takes..."), 121 for a stack ("The Pikemen take...").
        const one = du?.count === 1;
        if (du && !du.machine) this.v.say(this.v.texts.line(one ? 120 : 121, one ? stats(s, du).name : stats(s, du).plural, defendBonus(s, du)));
        const sp = this.v.sprites.get(ev.unit)!;
        await sp.play(Anim.Defend);
        void sp.play(Anim.Stand, true);
        break;
      }
      case "morale": {
        const u = s.units[ev.unit];
        const un = stackName(s, u);
        this.v.say(ev.good ? this.v.texts.line(33, un) : this.v.texts.line(34, un));
        this.sfx(ev.good ? "GOODMRLE" : "BADMRLE");
        await this.effect(ev.good ? "c09spw0.def" : "c14spe0.def", u, { anchor: "feet" });
        break;
      }
      // As VCMI's BattleEffectsController::battleTriggerEffect: each with its picture and sound.
      case "trigger": {
        const u = s.units[ev.unit];
        if (!u) break;
        const [def, sound] = { fear: ["c0fear.def", "FEAR"], regen: ["sp12_.def", "REGENER"], poison: ["sp11_.def", "POISON"], manaDrain: ["sp08_.def", "MANADRAI"] }[ev.what];
        // GENRLTXT 710 / 711 "The %s freezes / freeze in fear.", 373 / 374 "The %s drains / drain spell points from %s!".
        const one = u.count === 1;
        const who = one ? stats(s, u).name : stats(s, u).plural;
        const foe = s.sides[1 - u.side]?.hero?.name ?? "";
        if (ev.what === "fear") this.v.say(this.v.texts.line(one ? 710 : 711, who));
        else if (ev.what === "manaDrain") this.v.say(this.v.texts.line(one ? 373 : 374, who, foe));
        else if (ev.what === "regen") this.floatOver(u, 0, 0, ev.amount ?? 0), this.v.say(this.v.texts.logLine(LOG.ours("regen", [{ cr: u.creature, n: 2 }, ev.amount ?? 0])));
        else if (ev.what === "poison") this.v.say(this.v.texts.logLine(LOG.ours("poisonBites", [{ cr: u.creature, n: 2 }])));
        this.sfx(sound);
        // (Fear and regeneration see-through, as VCMI draws them; fear rises from the feet as morale does.)
        await this.effect(def, u, { anchor: ev.what === "fear" ? "feet" : "top", alpha: ev.what === "fear" || ev.what === "regen" ? 0.5 : 1 });
        break;
      }
      case "drain": {
        const u = s.units[ev.unit];
        u.count += ev.revived;
        this.v.sprites.get(u.id)?.setCount(u.count);
        this.floatOver(u, 0, 0, ev.amount, ev.revived);
        this.v.say(ev.tent ? tr(`The First Aid Tent heals %1 for %2.`, stackName(s, u), ev.amount) : tr(`%1 drain %2 life%3.`, stats(s, u).plural, ev.amount, ev.revived ? tr(`, %1 rise again`, ev.revived) : ""));
        // The First Aid Tent mends with the regeneration swirl (SP12_, half see-through, REGENER), not the Vampires' green life drain.
        this.sfx(ev.tent ? "REGENER" : "DRAINLIF");
        await this.effect(ev.tent ? "sp12_.def" : "sp06_.def", u, { alpha: ev.tent ? 0.5 : 1 });
        break;
      }
      case "stare": {
        const d = s.units[ev.target];
        // Sea Dogs' Accurate Shot (HotA): the mod's accurateShot spell (SP14 where it strikes, PIRTABIL).
        const accurate = stats(s, s.units[ev.unit]).abilities?.some((b) => b.type === "DEATH_STARE" && b.subtype === "deathStareNoRangePenalty");
        // GENRLTXT 118 / 119 (one / several die under the gaze).
        // (HotA's Sea Dogs' Accurate Shot has no line in the files: ours.)
        const gazer = stackName(s, s.units[ev.unit]);
        const victims = ev.killed === 1 ? stats(s, d).name : stats(s, d).plural;
        this.v.say(
          accurate
            ? tr(`Accurate Shot kills %1 %2.`, ev.killed, victims)
            : ev.killed === 1
              ? this.v.texts.line(118, victims, gazer)
              : this.v.texts.line(119, ev.killed, victims, gazer),
        );
        // As VCMI's ability spells, through the same look as any spell; the victims fall (or flinch) as from any blow.
        const look = lookOf(accurate ? "accurateShot" : "deathStare");
        if (look?.sound) this.sfx(look.sound);
        await Promise.all([this.playLook(look?.hit, { unit: d }, true), this.playLook(look?.affect, { unit: d }), this.react(d, 0, ev.killed)]);
        break;
      }
      case "rebirth": {
        const u = s.units[ev.unit];
        u.count = ev.count;
        const sp = this.v.sprites.get(u.id)!;
        if (sp.parent !== this.v.unitsLayer) this.v.unitsLayer.addChild(sp);
        void sp.play(Anim.Stand, true);
        sp.setCount(u.count);
        this.floatOver(u, 0, 0, 0, ev.count);
        this.v.say(tr(`%1 %2 rise from the ashes!`, ev.count, stats(s, u).plural));
        await this.effect("c12spe0.def", u);
        break;
      }
      case "end": {
        // Whose battle this is for the results: our colour, even if the AI finished it for us.
        const human = [0, 1].find((side) => (this.v.viewer !== undefined && s.sides[side].owner === this.v.viewer) || this.v.mine(side)) ?? -1;
        const won = ev.winner !== "draw" && (human === -1 || ev.winner === human);
        // Quick combat ends with the battle: the results show as usual.
        if (quick) setQuick(false);
        // The winner raises its sword, the loser hangs its head (VCMI's battleFinished: VICTORY / DEFEAT).
        if (ev.winner !== "draw") for (const side of [0, 1] as const) this.v.heroes.heroEnd[side] = { group: side === ev.winner ? 3 : 2, at: 0 };
        // The ending's tune (VCMI's BattleResultWindow): a held town, a retreat, a surrender, a lost town.
        const defended = !!final.siege && human === 1;
        const fled = final.fled && final.fled.side === human ? (final.fled.surrender ? "Surrender Battle.mp3" : "Retreat Battle.mp3") : null;
        playMusic(won ? (defended ? "Defend Castle.mp3" : "Win Battle.mp3") : defended ? "LoseCastle.mp3" : (fled ?? "LoseCombat.mp3"), false);
        // Results window once the last blow has landed.
        const final2 = structuredClone(final);
        const viewer = human === -1 ? -1 : (human as 0 | 1);
        this.v.result = `Battle over: ${ev.winner === "draw" ? "draw" : won ? "victory" : "defeat"}`;
        const restartable = this.v.foughtQuick && !!this.v.onRestart && viewer !== -1;
        const gen = this.v.generation;
        void this.v.clock.wait(700, true).then(() => gen === this.v.generation && void showBattleResult(this.v.modals, this.v.root, final2, viewer, restartable).then((answer) => ((this.v.result = null), (this.v.ended = true), this.v.bar.ownButtons(), answer === "restart" ? this.v.onRestart?.() : this.v.onResultClosed?.())));
        break;
      }
      case "wait": {
        const wu = s.units[ev.unit];
        if (wu) this.v.say(this.v.texts.line(wu.count === 1 ? 136 : 137, stackName(s, wu)));
        break;
      }
      case "round":
        this.v.say(this.v.texts.line(412));
        break;
      case "turn":
        break;
    }
  }

  /** Stacks turned during an action (to strike, to face a blow, to cast) turn back toward the enemy's side. */
  faceHome() {
    const s = this.v.state;
    if (!s) return;
    for (const u of s.units) {
      const sp = this.v.sprites.get(u.id);
      if (!sp || u.machine || !alive(u) || sp.facingLeft === (u.side === 1)) continue;
      sp.setFacing(u.side === 1);
      const p = this.v.anchorFor(u);
      sp.position.set(p.x, p.y);
    }
  }

  /** A stack walks, flies or teleports along its path (through the gate at a siege). */
  private async animateMove(s: BattleState, ev: Extract<BattleEvent, { e: "move" }>) {
    const u = s.units[ev.unit];
    const sp = this.v.sprites.get(u.id)!;
    const pts = ev.fly ? [ev.path[0], ev.path[ev.path.length - 1]] : ev.path;
    // Through the gateway: the stack walks up to it, stops, the drawbridge comes down, and it walks on (the original's
    // and VCMI's moveStack, which opens the gate on the step onto it: the owner 2026-10-27, the bridge was down before the
    // stack set off). Setting off from the gateway itself, it comes down first.
    // (The gateway: the two gate hexes, Fortress's long bridge too, under the stack's head or tail; a stack
    // merely walking up to the bridge's hex in front of it lowers nothing.)
    const gateway = s.siege ? gatewayHexes(s) : [];
    const inGateway = (h: number) => unitHexes(s, u, h).some((x) => gateway.includes(x));
    let throughGate = !!s.siege && !ev.fly && ev.path.some(inGateway);
    if (throughGate && inGateway(pts[0])) {
      await this.v.siege.passGate(s, true);
      throughGate = false;
    }
    // No count box on the way (VCMI hides it while a stack animates).
    sp.countBox.visible = false;
    // Each creature's own pace (CRANIM.TXT's walk animation time).
    const walk = Math.min(2, Math.max(0.5, await walkTime(u.creature, stats(s, u).key)));
    sp.walkTime = walk;
    // Those that vanish and appear (devils, vampires as bats, sandworms) have a sound for each (VCMI's startMoving / endMoving).
    const ext = MOVE_EXT_SOUNDS.has(stats(s, u).sound) ? stats(s, u).sound : "";
    if (ext) this.sfx(`${ext}EXT1`);
    // Devils teleport: they vanish where they stood and appear where they land, no flight between (VCMI's
    // ReverseAnimation skips the MovementAnimation for movementTeleporting).
    const teleports = stats(s, u).abilities.some((a) => a.type === "FLYING" && a.subtype === "movementTeleporting");
    if (sp.has(Anim.MoveStart)) await sp.play(Anim.MoveStart);
    // (Sandworms dig in instead: HotA's own groups, no move start or end.)
    if (teleports && sp.has(Anim.Dive)) await sp.play(Anim.Dive);
    if (!teleports) void sp.play(Anim.Move, true);
    const normalLeft = u.side === 1;
    // The steps loop while the stack walks and stop when it arrives (VCMI's MovementAnimation).
    const steps = teleports || this.v.clock.hurrying ? () => {} : playSoundLooped(`${stats(s, u).sound}MOVE`);
    try {
      if (teleports) {
        const b = this.v.anchorFor(u, pts[pts.length - 1], sp.facingLeft !== normalLeft);
        sp.position.set(b.x, b.y);
        sp.zIndex = depthOf(pts[pts.length - 1]);
      }
      for (let i = 1; i < pts.length && !teleports; i++) {
        if (throughGate && inGateway(pts[i])) {
          throughGate = false;
          void sp.play(Anim.Stand, true);
          await this.v.siege.passGate(s, true);
          void sp.play(Anim.Move, true);
        }
        // Face the way we walk; wide units swap which hex their art hangs from.
        const goingLeft = hexCenter(pts[i]).x < hexCenter(pts[i - 1]).x;
        const goingRight = hexCenter(pts[i]).x > hexCenter(pts[i - 1]).x;
        if (goingLeft || goingRight) sp.setFacing(goingLeft);
        const turned = sp.facingLeft !== normalLeft;
        const a = this.v.anchorFor(u, pts[i - 1], turned);
        const b = this.v.anchorFor(u, pts[i], turned);
        // VCMI's MovementAnimation (anim/pace.ts): hex by hex walking, flying straight there by the pixels covered.
        const ms = ev.fly ? pace.flightMs(Math.hypot(b.x - a.x, b.y - a.y), walk) : pace.walkMsPerHex(walk);
        // Drawn in front of or behind the stacks it passes by where it is now, not where it set out from
        // (2026-10-26T18-34 / 18-35): its depth slides from one hex's to the next's.
        const [za, zb] = [depthOf(pts[i - 1]), depthOf(pts[i])];
        await this.tween(ms, (t) => {
          sp.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
          sp.zIndex = za + (zb - za) * t;
        });
      }
    } finally {
      steps();
    }
    u.pos = ev.path[ev.path.length - 1];
    sp.zIndex = depthOf(u.pos);
    if (ext) this.sfx(`${ext}EXT2`);
    if (teleports && sp.has(Anim.Rise)) await sp.play(Anim.Rise);
    if (sp.has(Anim.MoveEnd)) await sp.play(Anim.MoveEnd);
    // Turn back toward the enemy.
    sp.setFacing(normalLeft);
    void sp.play(Anim.Stand, true);
    await this.v.syncSprites();
    // The bridge as the rules leave it after this step (a defender stopping in the gateway keeps it down: a 2026-11-03
    // note, a Basilisk in the gate under a raised bridge); the shown state only learns it with the next action's.
    if (s.siege) updateGate(s);
    if (s.siege) await this.v.siege.passGate(s, false);
  }

  /** A blow or a shot: the attacker turns and strikes, the target (and any splash) takes it, the console says what it did. */
  private async animateAttack(s: BattleState, ev: AttackEvent, splash: AttackEvent[], final: BattleState = s) {
    const a = s.units[ev.unit];
    const d = s.units[ev.target];
    const asp = this.v.sprites.get(a.id)!;
    const dy = a.pos < 0 ? 1 : hexRow(d.pos) - hexRow(a.pos);
    // A shot aims up or down when the line between the two canvases is steeper than 0.2 radians
    // (VCMI's ShootingAnimation), not by rows: a far target a row or two off is shot at level.
    const dsp = this.v.sprites.get(d.id);
    const steep = dsp ? Math.atan2(Math.abs(dsp.y - asp.y), Math.abs(dsp.x - asp.x)) > 0.2 : dy !== 0;
    const shotDy = dsp ? dsp.y - asp.y : dy;
    const group = ev.ranged
      ? !steep ? Anim.Shoot : shotDy < 0 ? Anim.ShootUp : Anim.ShootDown
      : dy < 0 ? Anim.AttackUp : dy > 0 ? Anim.AttackDown : Anim.Attack;
    const an = stackName(s, a);
    const dn = ev.killed === 1 ? stats(s, d).name : stats(s, d).plural;
    const prefix =
      (ev.luck === "good" ? `${tr("Lucky strike!")} ` : ev.luck === "bad" ? `${tr("Unlucky strike:")} ` : "") +
      (ev.fireShield ? `${tr("Fire Shield:")} ` : ev.deathBlow ? `${tr("Death Blow!")} ` : ev.retaliation ? `${tr("Retaliation:")} ` : "");
    // The original's log: luck, then "The <creatures> do N damage." and who perished.
    const luckLine = ev.luck === "good" ? this.v.texts.line(45, stackName(s, a)) : ev.luck === "bad" ? this.v.texts.line(44, stackName(s, a)) : "";
    const special = ev.fireShield ? `${tr("Fire Shield:")} ` : ev.deathBlow ? `${tr("Death Blow!")} ` : "";
    const hit = prefix + (a.count === 1 ? this.v.texts.line(376, an, ev.damage) : this.v.texts.line(377, an, ev.damage));
    const dead = ev.killed ? (ev.killed === 1 ? this.v.texts.line(378, dn) : this.v.texts.line(379, ev.killed, dn)) : "";
    // (Shown as the blow lands, not as the swing starts: the owner's note 2026-10-27 18:29, the log told the outcome first.)
    const logLine = () => this.v.say(said([luckLine, `${special}${hit}${dead ? " " + dead : ""}`].filter(Boolean).join("\n")), {
      from: stats(s, a),
      to: stats(s, d),
      damage: ev.damage,
      killed: ev.killed,
      fromUnit: a.id,
      toUnit: d.id,
      fromSide: a.side,
      toSide: d.side,
      lead: ev.luck === "good" ? tr("Lucky!") : ev.luck === "bad" ? tr("Unlucky") : ev.deathBlow ? tr("Death Blow!") : ev.fireShield ? tr("Fire Shield") : undefined,
    });
    const ac = stats(s, a);
    // Turn to face a target behind us for the swing (wide units shift onto the other hex).
    const turnToward = (u: Unit, sp: UnitSprite, other: Unit) => {
      if (u.machine || other.pos < 0) return;
      const mine = hexCenter(u.pos).x;
      const theirs = hexCenter(other.pos).x;
      if (mine === theirs) return;
      const wantLeft = theirs < mine;
      if (sp.facingLeft === wantLeft) return;
      sp.setFacing(wantLeft);
      const p = this.v.anchorFor(u, u.pos, wantLeft !== (u.side === 1));
      sp.position.set(p.x, p.y);
    };
    // The turn (VCMI's MOVEMENT stage): the attacker faces its target; in melee the target faces it back (not a
    // statue, not a stack hit by a breath or a second head). Both turn home once the action is over (faceHome).
    if (!ev.splash) {
      turnToward(a, asp, d);
      if (!ev.ranged && dsp && alive(d) && d.pos >= 0 && !effectOf(d, SPELL.STONE_GAZE)) turnToward(d, dsp, a);
    }
    const hits = [ev, ...splash];
    // Before the blow (BEFORE_HIT): luck over the attacker, Death Blow over its target, each with its sound.
    const before: Promise<void>[] = [];
    if (ev.luck) {
      this.sfx(ev.luck === "good" ? "GOODLUCK" : "BADLUCK");
      before.push(this.effect(ev.luck === "good" ? "c09spa0.def" : "c10spf0.def", a, { anchor: "feet" }));
    }
    for (const h of hits.filter((h) => h.deathBlow && s.units[h.target])) {
      this.sfx("DEATHBLO");
      before.push(this.effect("sp03_.def", s.units[h.target]));
    }
    await Promise.all(before);
    // The swing (ATTACK): it starts with its sound, and a defending stack braces with it (VCMI's DefenceAnimation
    // at the ATTACK stage; not against a shot).
    const survives = (h: AttackEvent) => !!s.units[h.target] && s.units[h.target].count - h.killed > 0;
    const braced = new Map<number, Promise<void>>();
    for (const h of hits) {
      const t = s.units[h.target];
      if (t && !ev.ranged && t.defending && survives(h) && !braced.has(t.id)) braced.set(t.id, this.brace(t));
    }
    let swing: Promise<void> = Promise.resolve();
    if (!ev.splash) {
      this.sfx(`${ac.sound}${ev.ranged ? "SHOT" : "ATTK"}`);
      const frames = asp.frames.get(group)?.length ?? 0;
      swing = asp.play(group);
      if (ev.ranged) {
        // A shot flies on the creature's climax frame (CRANIM.TXT), from its weapon; the shooter holds that frame
        // until the missile lands (VCMI's RangedAttackAnimation playUntil), then finishes its shot.
        const origin = a.pos >= 0 && a.machine !== "tower" ? await shotOrigin(a.creature) : undefined;
        const climax = origin?.climax ? pace.shotFrame(origin.climax, frames) : pace.meleeHitFrame(frames);
        asp.holdOn(climax);
        await asp.untilFrame(climax);
        await this.projectile(a, d, origin && (group === Anim.ShootUp ? origin.upper : group === Anim.ShootDown ? origin.lower : origin.ahead));
        asp.release();
      } else {
        // The blow lands once half the swing has played (VCMI's MeleeAttackAnimation), whatever the creature.
        await asp.untilFrame(pace.meleeHitFrame(frames));
      }
    }
    // The shooter's arrows left, floating over it as it fires (the owner: so you see when you are running out).
    if (!ev.splash && ev.ranged && !a.machine && ac.shots > 0) void this.floatShots(a, ac.shots, final.units[ev.unit]?.shots ?? a.shots);
    // Where the shot lands: Magogs' fireball, Liches' cloud (with the flinches, as VCMI's HIT stage).
    const landed = !ev.splash && ev.ranged && SHOT_HITS[ac.key];
    const boom = landed ? this.v.fx.shotHit(landed, hexCenter(d.pos).x, hexCenter(d.pos).y) : undefined;
    logLine();
    if (splash.length) {
      // The original's log has a line for each stack the blow hurt.
      const more = splash.map((h) => {
        const t = s.units[h.target];
        const tn = h.killed === 1 ? stats(s, t).name : stats(s, t).plural;
        const line = this.v.texts.line(a.count === 1 ? 376 : 377, an, h.damage);
        return h.killed ? `${line} ${h.killed === 1 ? this.v.texts.line(378, tn) : this.v.texts.line(379, h.killed, tn)}` : line;
      });
      const total = splash.reduce((n, h) => n + h.damage, ev.damage);
      const killed = splash.reduce((n, h) => n + h.killed, ev.killed);
      this.v.say(said([this.v.hint, ...more].join("\n")), { from: stats(s, a), damage: total, killed });
    }
    // The hit (HIT): everyone the blow hits takes it at once, each with its own sound and numbers.
    const struck = hits.map((h) => {
      const t = s.units[h.target];
      if (!t) return undefined;
      if (h.fireShield) void this.effect("c05spf0.def", t);
      const brace = braced.get(t.id);
      return brace ? (this.tally(t, h.damage, h.killed), brace) : this.react(t, h.damage, h.killed);
    });
    await Promise.all([swing, boom, ...struck]);
    if (!ev.splash) void asp.play(Anim.Stand, true);
  }

  /** A spell: the hero's or a creature's cast, its effect on each stack, summoned stacks arriving, the console's line. */
  private async animateSpell(s: BattleState, ev: Extract<BattleEvent, { e: "spell" }>, final: BattleState) {
    const art = SPELL_ART[ev.spell];
    const sp = s.spells?.[ev.spell];
    const caster = s.sides[ev.side].hero?.name ?? tr("The hero");
    if (ev.note) this.v.say(this.v.texts.logLine(ev.note));
    else if (ev.by !== undefined && s.units[ev.by]) {
      // GENRLTXT 565 / 566: "The %s casts %s" / "The %s cast %s".
      const by = s.units[ev.by];
      const one = by.count === 1;
      const who = one ? stats(s, by).name : stats(s, by).plural;
      const what = ev.spell === 39 && ev.summoned ? tr("Raise Demons") : (sp?.name ?? tr("a spell"));
      this.v.say(this.v.texts.line(one ? 565 : 566, who, what).trim());
    }
    else if (ev.ability) this.v.say(fmt`${said(ABILITY_NAMES[ev.spell]) ?? sp?.name ?? tr("A creature ability")}!`);
    else {
      // "%s casts '%s' on the %s." for one target, "%s casts '%s'." otherwise.
      // (Only a spell aimed at one stack names it: an area that caught one stack is still "casts '%s'.", as the rules log it.)
      const one = ev.units.length === 1 && COMBAT_SPELLS[ev.spell]?.shape === "single" ? s.units[ev.units[0]] : undefined;
      const cast = one ? this.v.texts.line(195, caster, sp?.name ?? "", stats(s, one).plural) : this.v.texts.line(196, caster, sp?.name ?? "");
      // "The %s %s the spell!" (resist / resists) for each stack that shrugs it off.
      const resisted = ev.resisted
        .map((id) => s.units[id])
        .filter((x): x is Unit => !!x)
        .map((x) => {
          const one = x.count === 1;
          const who = one ? stats(s, x).name : stats(s, x).plural;
          const verb = this.v.texts.gen[one ? 144 : 143]?.trim() || (one ? "resists" : "resist");
          return this.v.texts.line(189, who, verb).trim();
        });
      this.v.say(said([`${cast}${ev.reflected ? tr(" (reflected!)") : ""}`.trim(), ...resisted].join("\n")));
    }
    // As VCMI's BattleInterface::spellCast, one routine for every spell, its looks as data (anim/looks.ts):
    // the caster's cast (a hero to the frame the spell leaves on, a creature its cast to half), the missile with
    // the sound, then the hit stage all at once: the spot's "hit" (the whole field without one), each stack's
    // "affect", the resisting stacks' shrug, and the stacks it hurts reacting.
    const targets = ev.units.map((id) => s.units[id]).filter((x): x is Unit => !!x);
    const byHero = ev.by === undefined && !ev.ability;
    const by = ev.by !== undefined ? s.units[ev.by] : undefined;
    // A mine going off under a stack (the rules' trigger): the blast and its bang, not the laying's.
    const blast = ev.spell === SPELL.LAND_MINE && !!ev.ability;
    const look = lookOf(blast ? "landMineGoesOff" : (ev.look ?? art?.key));
    const sound = look?.sound ?? art?.sound;
    const spotHex = ev.hex >= 0 ? ev.hex : targets[0]?.pos;
    const whole = COMBAT_SPELLS[ev.spell]?.shape === "all" || spotHex === undefined || spotHex < 0;
    let casting: Promise<void> = Promise.resolve();
    if (byHero) await this.v.heroes.heroCasts(ev.side);
    else if (by && !ev.ability && by.pos >= 0) casting = (await this.creatureCasts(by, spotHex)).rest;
    if (by) void this.playLook(look?.cast, { unit: by });
    // The sound starts as the spell leaves the hand, so a missile's whoosh (MAGICBLT, ICERAY) goes with its flight.
    if (sound) this.sfx(sound);
    if (look?.projectile?.length && spotHex !== undefined && spotHex >= 0) {
      const to = hexCenter(spotHex);
      const from = byHero ? { x: ev.side === 0 ? 62 : SCREEN_W - 62, y: 60 } : by ? { x: hexCenter(by.pos).x, y: hexCenter(by.pos).y - 40 } : null;
      if (from) await this.v.fx.spellMissile(look.projectile, from, { x: to.x, y: to.y - 30 });
    }
    // Chain Lightning: the bolt hops from stack to stack, not all at once.
    const chain = art?.key === "chainLightning" && targets.length > 1;
    const shows: Promise<void>[] = [this.playLook(look?.hit, whole ? { field: true } : { hex: spotHex }, true)];
    if (ev.resisted.length) this.sfx("MAGICRES");
    // An area's picture at its spot (Meteor Shower's falling rocks, Fireball's blast): everyone it hurts flinches together
    // as it lands, halfway through, not before the first rock falls (a 2026-11-02 note: "all units should do the hurt
    // animation during the meteor strike").
    const spotDef = !whole && spotHex !== undefined && spotHex >= 0 ? look?.hit?.find((p) => p.def)?.def : undefined;
    const impact = spotDef ? (((await loadDef(spotDef).catch(() => null))?.get(0)?.length ?? 0) * 500) / pace.EFFECT_FPS : 0;
    const hurt = async (d: (typeof ev.damage)[number]) => {
      if (!s.units[d.unit]) return;
      if (impact) await this.delay(impact);
      await this.react(s.units[d.unit], d.damage, d.killed);
    };
    targets.forEach((t, i) => {
      const parts = i > 0 && look?.affectSecondary ? look.affectSecondary : look?.affect;
      const d = ev.damage.find((x) => x.unit === t.id);
      const resisted = ev.resisted.includes(t.id);
      shows.push(
        (async () => {
          if (chain) await this.delay(pace.CHAIN_HOP_MS * i);
          await Promise.all([resisted ? this.effect("sp09_.def", t) : this.playLook(parts, { unit: t }), d ? hurt(d) : undefined]);
        })(),
      );
    });
    // Resisting stacks the spell didn't list among its targets, and stacks hurt that weren't (a Fireball's area).
    for (const id of ev.resisted) if (s.units[id] && !targets.some((t) => t.id === id)) shows.push(this.effect("sp09_.def", s.units[id]));
    shows.push(...ev.damage.filter((d) => !targets.some((t) => t.id === d.unit)).map(hurt));
    await Promise.all(shows);
    // Teleport: the stack fades out where it stood and in where it lands (VCMI's teleportFadeOut / In; TELPTIN).
    if (ev.spell === SPELL.TELEPORT) {
      for (const t of targets) {
        const now = final.units[t.id];
        const tsp = this.v.sprites.get(t.id);
        if (!now || !tsp || now.pos === t.pos) continue;
        tsp.countBox.visible = false;
        await this.mux(t, "teleportFadeOut");
        tsp.alpha = 0;
        t.pos = now.pos;
        const p = this.v.anchorFor(t);
        tsp.position.set(p.x, p.y);
        tsp.zIndex = depthOf(t.pos);
        this.sfx("TELPTIN");
        await this.mux(t, "teleportFadeIn");
        tsp.alpha = 1;
        this.v.placeCount(s, t, tsp);
      }
    }
    await casting;
    if (byHero) this.v.heroes.heroCastDone(ev.side);
    // Clones and elementals fade in where they appear (VCMI's summonFadeIn muxer; neither spell has a
    // picture of its own), a clone already in its shades of blue (its look).
    const arrivals = (ev.summoned ?? []).filter((id) => !s.units[id] && final.units[id]);
    if (arrivals.length) {
      for (const id of arrivals) s.units[id] = structuredClone(final.units[id]);
      await this.v.syncSprites();
      for (const id of arrivals) {
        const x = this.v.sprites.get(id);
        if (x) (x.alpha = 0), (x.countBox.visible = false);
      }
      await Promise.all(arrivals.map((id) => this.mux(s.units[id], "summonFadeIn")));
      for (const id of arrivals) {
        const x = this.v.sprites.get(id);
        if (x) this.v.placeCount(s, s.units[id], x);
      }
    }
    // Pit Lords: the corpses get up as Demons.
    for (const id of ev.summoned ?? []) {
      const now = final.units[id];
      if (!now || !s.units[id] || s.units[id].creature === now.creature) continue;
      Object.assign(s.units[id], structuredClone(now));
      this.v.sprites.get(id)?.destroy();
      this.v.sprites.delete(id);
      await this.v.syncSprites();
      this.floatOver(s.units[id], 0, 0, 0, now.count);
    }
    // Whoever the spell raised (Resurrection, Animate Dead, Sacrifice, the Archangels', the Mechanics' Repair):
    // how many rose, as every other rising (drain, rebirth, Fangarms) shows it.
    for (const id of new Set(ev.units)) {
      const was = s.units[id];
      const now = final.units[id];
      if (!was || !now || was.creature !== now.creature || now.count <= was.count || ev.damage.some((d) => d.unit === id)) continue;
      const raised = now.count - was.count;
      was.count = now.count;
      this.v.sprites.get(id)?.setCount(now.count);
      this.floatOver(was, 0, 0, 0, raised);
    }
    if (ev.damage.length) {
      const total = ev.damage.reduce((a, d) => a + d.damage, 0);
      const killed = ev.damage.reduce((a, d) => a + d.killed, 0);
      const what = ev.look === "detonate" ? "blast" : (sp?.name ?? (ev.spell === 77 ? "thunderbolt" : ev.spell === 80 ? "acid" : "spell"));
      const one = ev.damage.length === 1 ? s.units[ev.damage[0].unit] : undefined;
      // GENRLTXT 376 "The %s does %d damage.", then 378 / 379 "One %s perishes." / "%d %s perish."
      // (with the stack's name when one stack lost creatures, "creatures" when several did).
      const lead = this.v.texts.line(376, what, total).trim();
      const fallen = ev.damage.filter((d) => d.killed);
      const victim = fallen.length === 1 ? s.units[fallen[0].unit] : undefined;
      const names = victim ? stats(s, victim) : { name: tr("creature"), plural: tr("creatures") };
      const kills = !killed ? "" : killed === 1 ? this.v.texts.line(378, names.name) : this.v.texts.line(379, killed, names.plural);
      this.v.say(kills ? fmt`${lead} ${kills.trim()}` : lead, { lead: sp?.name ?? tr(`The %1`, what), to: one && stats(s, one), damage: total, killed });
    }
  }

  /**
   * An effect DEF on a stack, placed by its class (fx.ts EffectPlace): centred over the stack's hexes (a wide
   * stack's two), drawn at the stack's depth unless it is a "hit" (over everything).
   */
  private async effect(def: string, u: Unit, place: EffectPlace = {}) {
    if (!this.v.state) return;
    const hexes = unitHexes(this.v.state, u);
    const a = hexCenter(hexes[0]);
    const b = hexCenter(hexes[hexes.length - 1]);
    await this.v.fx.effectAt(def, (a.x + b.x) / 2, (a.y + b.y) / 2, { depth: depthOf(u.pos), ...place });
  }

  /** A sound of the battle's (none while the battle hurries: fast mode, or an action played out at once). */
  private sfx(name: string) {
    if (!this.v.clock.hurrying) void playSound(name);
  }

  /** The stack's count and the floating numbers once a blow or a spell has landed. */
  private tally(t: Unit, damage: number, killed: number, healed = 0) {
    t.count = Math.max(0, t.count - killed);
    this.v.sprites.get(t.id)?.setCount(t.count);
    this.floatOver(t, damage, killed, healed);
  }

  /**
   * How a stack takes a blow, a shot or a spell, the same for all of them (VCMI's HittedAnimation /
   * DeathAnimation): its wince or its death with that sound, its count and numbers, then it stands (or lies).
   */
  private async react(t: Unit, damage: number, killed: number) {
    const sp = this.v.sprites.get(t.id);
    if (!sp) return;
    const dies = t.count - killed <= 0;
    this.sfx(`${stats(this.v.state!, t).sound}${dies ? "KILL" : "WNCE"}`);
    this.tally(t, damage, killed);
    await sp.play(dies ? Anim.Death : Anim.Hit);
    if (dies) sp.holdLast(Anim.Death);
    else void sp.play(Anim.Stand, true);
  }

  /** A defending stack braces as the swing comes (VCMI's DefenceAnimation, with its sound). */
  private async brace(t: Unit) {
    const sp = this.v.sprites.get(t.id);
    if (!sp) return;
    this.sfx(`${stats(this.v.state!, t).sound}DFND`);
    await sp.play(Anim.Defend);
    void sp.play(Anim.Stand, true);
  }

  /**
   * Plays a spell's queue (anim/looks.ts) on a stack, at a hex or over the whole field: its pictures by their
   * placement class, its colours, its pauses, all at once (VCMI's displaySpellAnimationQueue), over every stack.
   */
  private async playLook(parts: LookPart[] | undefined, where: { unit?: Unit; hex?: number; field?: boolean }, hit = false) {
    if (!parts?.length || !this.v.state) return;
    await Promise.all(
      parts.map(async (p) => {
        if (p.pause) return this.delay((p.pause * 1000) / pace.EFFECT_FPS);
        if (p.colour) return where.unit ? this.mux(where.unit, p.colour) : undefined;
        if (!p.def) return;
        // Over every stack, the "affect" on a stack as well as the spot's "hit" (2026-10-27 18:28 / 18:31:
        // drawn at the stack's depth, a stack in front covered it, and a Thunderbird's bolt went behind the rows below).
        const place: EffectPlace = { anchor: p.bottom ? "bottom" : "top", alpha: p.alpha, field: where.field, depth: undefined };
        if (where.unit) return this.effect(p.def, where.unit, place);
        const at = hexCenter(where.hex ?? 0);
        return this.v.fx.effectAt(p.def, at.x, at.y, place);
      }),
    );
  }

  /**
   * A colour muxer on a stack (VCMI's ColorTransformAnimation, config/battleEffects.json): Bloodlust's red,
   * petrification's grey, a summon's or a teleport's fade; its time points are in fades (anim/pace.ts FADE_MS).
   */
  private async mux(u: Unit, name: string) {
    const sp = this.v.sprites.get(u.id);
    const len = muxLength(name);
    if (!sp || !len) return;
    await this.tween(len * pace.FADE_MS, (k) => {
      const m = muxAt(name, k * len);
      sp.mixColour(m.k, m.color ?? [1, 1, 1]);
      sp.alpha = m.alpha;
    });
    // What lasts (stone, a clone's blue) is the stack's look (placeCount), not the muxer's last step.
    sp.mixColour(0, [1, 1, 1]);
  }

  /**
   * A creature casts (Faerie Dragons, Archangels, Pit Lords, enchanters...): it faces the spot and plays its cast
   * (VCMI's CastAnimation: CAST, else SPECIAL, SHOOT or ATTACK, up, ahead or down as the spot lies); the spell
   * leaves at half of it. Resolves then, with the rest of the cast still to play out.
   */
  private async creatureCasts(u: Unit, hex: number | undefined): Promise<{ rest: Promise<void> }> {
    const sp = this.v.sprites.get(u.id);
    const none = { rest: Promise.resolve() };
    if (!sp || u.machine) return none;
    const to = hex !== undefined && hex >= 0 ? hexCenter(hex) : null;
    const from = hexCenter(u.pos);
    if (to && to.x !== from.x && !effectOf(u, SPELL.STONE_GAZE)) {
      const left = to.x < from.x;
      if (sp.facingLeft !== left) {
        sp.setFacing(left);
        const p = this.v.anchorFor(u, u.pos, left !== (u.side === 1));
        sp.position.set(p.x, p.y);
      }
    }
    // A cast aims up or down past 0.2 radians, as a shot does.
    const steep = to ? Math.atan2(to.y - from.y, Math.abs(to.x - from.x)) : 0;
    const way = steep < -0.2 ? 0 : steep > 0.2 ? 2 : 1;
    const groups = [
      [Anim.CastUp, Anim.SpecialUp, Anim.Special, Anim.ShootUp, Anim.AttackUp],
      [Anim.Cast, Anim.Special, Anim.Shoot, Anim.Attack],
      [Anim.CastDown, Anim.SpecialDown, Anim.Special, Anim.ShootDown, Anim.AttackDown],
    ][way];
    const group = groups.find((g) => sp.has(g));
    if (group === undefined) return none;
    const rest = sp.play(group).then(() => void sp.play(Anim.Stand, true));
    await sp.untilFrame(Math.floor((sp.frames.get(group)?.length ?? 0) / 2));
    return { rest };
  }

  /**
   * A small addition to the original: what a blow did, floating up over the stack and fading
   * (damage, a skull with the creatures killed, a green plus for life given back).
   */
  /** The damage numbers still floating up. */
  private floats: Container[] = [];

  /**
   * Where something `w` wide floating over the field starts, kept whole on the part of the field shown (upright the
   * field's sides are cut off: a kill's numbers over a stack at the edge spilled off the screen, the owner 2026-10-27).
   */
  private onField(x: number, w: number): number {
    const [lo, hi] = screenSize.portrait ? [CROP_X, CROP_X + CROP_W] : [0, SCREEN_W];
    return Math.round(Math.max(lo + 2, Math.min(hi - 2 - w, x)));
  }

  /** Touch: "5/12" with an arrow floats over a shooter as it fires, red on the last arrow. */
  private async floatShots(u: Unit, max: number, shotsNow: number) {
    if (!extra("battleCues") || !this.v.state || quick) return;
    const left = Math.max(0, shotsNow);
    const hexes = unitHexes(this.v.state, u);
    const a = hexCenter(hexes[0]);
    const b = hexCenter(hexes[hexes.length - 1]);
    const k = phoneSized() || screenSize.touch ? 1.5 : 1;
    const plate = await loadImage(CMNUMWIN.file).catch(() => null);
    if (!this.v.state || this.v.root.destroyed) return;
    const box = new Container();
    const l = label(fmt`${left}/${max}`, "medfont", left <= 1 ? [255, 110, 100] : [255, 230, 150]);
    l.scale.set(k);
    const arrow = new Graphics().poly([0, 6, 11, 6, 11, 3, 17, 7, 11, 11, 11, 8, 0, 8]).fill(left <= 1 ? 0xff6e64 : 0xffe696);
    arrow.scale.set(k);
    arrow.position.set(0, 1 * k);
    l.x = 20 * k;
    const w = l.x + l.width;
    // On the count box's plate (CMNUMWIN), as the blows' numbers.
    if (plate) box.addChild(Object.assign(plateStrip(plate, w + 8, 18 * k + 4), { x: -4, y: -2 }));
    box.addChild(arrow, l);
    const x0 = this.onField((a.x + b.x) / 2 - w / 2, w);
    const y0 = Math.min(a.y, b.y) - 56;
    box.position.set(x0, y0);
    this.v.queueLayer.addChild(box);
    void this.tween(pace.FLOAT_MS, (t) => {
      box.y = y0 - 22 * t;
      box.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }).then(() => box.destroy({ children: true }));
  }

  /**
   * What a blow did, floating over the stack: on the count box's own plate (CMNUMWIN, stretched), the damage
   * dealt in red, the healing in green, and the troops lost as the creature's own small portrait and a minus.
   */
  private async floatOver(u: Unit, damage: number, killed: number, healed = 0, raised = 0) {
    if (!extra("floatNumbers")) return;
    if (!this.v.state || quick || (!damage && !killed && !healed && !raised)) return;
    const hexes = unitHexes(this.v.state, u);
    const a = hexCenter(hexes[0]);
    const b = hexCenter(hexes[hexes.length - 1]);
    const [plate, icon] = await Promise.all([loadImage(CMNUMWIN.file), killed || raised ? creaturePortrait(stats(this.v.state, u), "small") : null]);
    const k = phoneSized() ? 1.5 : 1;
    const box = new Container();
    let x = 0;
    const h = 18 * k;
    const add = (t: Text, color: readonly [number, number, number], tint: number, pic?: Texture | null) => {
      const l = label(t, "medfont", color);
      l.scale.set(k);
      const pw = pic ? Math.round(h) + 2 : 0;
      const w = Math.ceil(l.width) + 10 * k + pw;
      box.addChild(Object.assign(plateStrip(plate, w, h, tint), { x }));
      if (pic) {
        const ps = new Sprite(pic);
        ps.scale.set((h - 2) / Math.max(pic.width, pic.height));
        ps.position.set(x + 2, 1);
        box.addChild(ps);
      }
      l.x = x + pw + 5 * k;
      l.y = Math.round((h - l.height) / 2);
      box.addChild(l);
      x += w + 3 * k;
    };
    if (healed) add(fmt`+${healed}`, [255, 255, 255], 0x33ff33);
    if (damage) add(fmt`-${damage}`, [255, 255, 255], 0xff3333);
    if (killed) add(fmt`-${killed}`, [255, 255, 255], 0x9933ff, icon);
    // How many rose again (a vampire's drain, a phoenix's rebirth): the creature beside the count.
    if (raised) add(fmt`+${raised}`, [255, 255, 255], 0x33ff33, icon);
    x -= 3 * k;
    const x0 = this.onField((a.x + b.x) / 2 - x / 2, x);
    let y0 = Math.min(a.y, b.y) - 70;
    // Stacks hit by the same blow side by side: each one's numbers stacked above the other's.
    const live = this.floats.filter((f) => !f.destroyed);
    for (let moved = true; moved; ) {
      moved = false;
      for (const f of live) {
        if (x0 < f.x + f.width && f.x < x0 + x && y0 < f.y + h && f.y < y0 + h) {
          y0 = f.y - h - 2;
          moved = true;
        }
      }
    }
    box.position.set(x0, y0);
    this.v.queueLayer.addChild(box);
    this.floats = [...live, box];
    void this.tween(pace.FLOAT_MS, (t) => {
      box.y = y0 - 28 * t;
      box.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }).then(() => box.destroy({ children: true }));
  }

  /**
   * The missile from `a` to `d`. With the creature's offset (CRANIM.TXT) it leaves from where VCMI's
   * RangedAttackAnimation puts it, canvas (222 - 25, 265) plus the offset, mirrored facing left, and
   * lands at canvas (225, 225) of the target.
   */
  private async projectile(a: Unit, d: Unit, offset?: [number, number]) {
    const s = this.v.state!;
    const asp = this.v.sprites.get(a.id);
    const dsp = this.v.sprites.get(d.id);
    let from: { x: number; y: number };
    let to: { x: number; y: number };
    if (offset && (offset[0] || offset[1]) && asp && dsp) {
      const m = asp.facingLeft ? -1 : 1;
      from = { x: asp.x + m * (222 - 25 + offset[0] - CREATURE_ANCHOR.x), y: asp.y + 265 + offset[1] - CREATURE_ANCHOR.y };
      to = { x: dsp.x + (dsp.facingLeft ? -1 : 1) * (225 - CREATURE_ANCHOR.x), y: dsp.y + 225 - CREATURE_ANCHOR.y };
    } else {
      from = a.pos < 0 ? { ...this.v.anchorFor(a) } : hexCenter(a.pos);
      to = hexCenter(d.pos);
      from.y -= 40;
      to.y -= 30;
    }
    const beam = stats(s, a).ray;
    if (beam) return this.v.fx.ray(from, to, beam);
    await this.v.fx.missile(a.machine === "tower" && this.v.towerArt ? this.v.towerArt.missile : stats(s, a).missile, from, to);
  }

  private tween(ms: number, fn: (t: number) => void) {
    return this.v.fx.tween(ms, fn);
  }

  private delay(ms: number) {
    return this.v.fx.delay(ms);
  }

  // ---- overlays ----------------------------------------------------------

}

const ABILITY_NAMES: Record<number, string> = {
  11: "Land Mine", 13: "Fire Wall", 42: "Curse", 45: "Weakness", 62: "Blind", 70: "Stone Gaze", 71: "Poison", 72: "Bind", 73: "Disease", 74: "Paralyze", 75: "Age",
  76: "Death Cloud", 77: "Thunderbolt", 78: "Dispel Helpful Spells", 80: "Acid Breath",
};
