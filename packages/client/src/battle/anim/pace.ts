// How fast every battle animation runs, in one place: VCMI's AnimationControls (client/battle/CreatureAnimation.cpp),
// which measured the original. VCMI writes each pace as a function of one speed factor (1 slow, 2 normal, 3 fast);
// here every value is the NORMAL one, and the battle clock (clock.ts) runs those times faster or slower by the
// speed set (settings' battleSpeed(), times normal). What does not follow the speed setting says so (`real`):
// the creatures standing and fidgeting, obstacles, the heroes, a ray's linger.

/** VCMI's speed factor at normal speed: its "H3 speed: a / b / c" comments give b. */
const NORMAL = 2;

/** A creature's swing, flinch, defence, death, turn, start and end of a move: 10 frames a second times the factor. */
export const ACTION_FPS = 10 * NORMAL;

/**
 * Shots, casts and the special attacks: the action rate divided by the creature's attack animation time
 * (CRANIM.TXT; HotA's mod changes it for its shooters and a few casters). Melee swings ignore it, so every
 * creature's blow lasts as long (VCMI: "necessary because length of these animations must be same").
 */
export const shootFps = (attackTime = 1) => ACTION_FPS / (attackTime || 1);

/** Walking legs: the action rate divided by the creature's walk animation time. */
export const walkFps = (walkTime = 1) => ACTION_FPS / (walkTime || 1);

/** Standing (H3's slow breathing loop) and the pointer coming over a creature: not by the speed setting. */
export const IDLE_FPS = 5;
export const MOUSE_OVER_FPS = 10;

/** Walking: 2 hexes a second times the factor, divided by the walk time. */
export const walkMsPerHex = (walkTime = 1) => 1000 / ((2 * NORMAL) / (walkTime || 1));

/** Flying: 250 pixels a second times the factor, divided by the walk time ("for whatever reason, H3 uses Walk Animation Time"). */
export const flightMs = (pixels: number, walkTime = 1) => (1000 * pixels) / ((250 * NORMAL) / (walkTime || 1));

/** A shooter's (or a spell's) missile: 1250 pixels a second times the factor. */
export const missileMs = (pixels: number) => (1000 * Math.max(1, pixels)) / (1250 * NORMAL);

/** A beam (Arch Mages', Beholders' and Evil Eyes' rays): drawn out at 4000 pixels a second times the factor, then held 0.1 s. */
export const rayMs = (pixels: number) => (1000 * Math.max(1, pixels)) / (4000 * NORMAL);
export const RAY_LINGER_MS = 100;

/** A catapult's or a Cyclops' stone: 200 pixels a second times the factor, in an arc. */
export const catapultMs = (pixels: number) => (1000 * Math.max(1, pixels)) / (200 * NORMAL);

/** Spell effects, the animated missiles' and stones' spin: 10 frames a second times the factor. */
export const EFFECT_FPS = 10 * NORMAL;

/** Obstacles and the spells lying on the field: 20 frames a second whatever the speed. */
export const OBSTACLE_FPS = 20;

/** Stacks fading in or out (summoned, cloned, teleported): half a second over the factor. */
export const FADE_MS = 500 / NORMAL;

/** Heroes: 10 frames a second whatever the speed (VCMI's BattleHero); the spell leaves the hand on frame 4. */
export const HERO_FPS = 10;
export const HERO_CAST_FRAME = 4;

/** The drawbridge's half-open picture while it moves (VCMI's GateAnimation: 200 ms). */
export const GATE_MS = 200;

/**
 * The frame (from 0) of a melee swing on which the blow lands and the target reacts: once half of
 * its frames have played (VCMI's MeleeAttackAnimation: `currentFrame * 2 >= totalFrames`).
 */
export const meleeHitFrame = (frames: number) => Math.ceil(Math.max(0, frames) / 2);

/** The frame (from 0) a shot flies on: CRANIM.TXT's climax frame (H3 counts from 1), inside the group. */
export const shotFrame = (climax: number, frames: number) => Math.min(Math.max(1, climax), Math.max(1, frames)) - 1;

/** Chain Lightning: how long after one stack the next in the chain is struck. */
export const CHAIN_HOP_MS = 250;

/** The floating numbers over a stack (an addition): how long they rise and fade. */
export const FLOAT_MS = 1100;
