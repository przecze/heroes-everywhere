// Which animation a creature picture plays next (ui/creaturePic.ts), apart so tests can run it.

// The DEF's groups (as battle/unitSprite.ts Anim).
const MOVING = 0;
const HOLDING = 2;
const HITTED = 3;
const DEFENCE = 4;
const SHOOT_UP = 14;
const SHOOT_FRONT = 15;
const SHOOT_DOWN = 16;
const ATTACK_FRONT = 12;
const CAST_FRONT = 18;
const MOVE_START = 20;
const MOVE_END = 21;

/**
 * What plays after an animation ends, as VCMI's CCreatureAnim::loopPreview: half the time one of the
 * preview groups the DEF has (standing, getting hit, defending, attacking, casting; a war machine
 * stands, moves or shoots), the other half the creature walks in place for about a second (its move
 * group repeated, entered through its start-moving group and left through its stop-moving one).
 * Returns the groups to queue; `current` is the group playing now, `random` a number in [0, 1).
 */
export function nextPreview(has: (group: number) => number, warMachine: boolean, current: number, random: number): number[] {
  const list = warMachine ? [HOLDING, MOVING, SHOOT_UP, SHOOT_FRONT, SHOOT_DOWN] : [HOLDING, HITTED, DEFENCE, ATTACK_FRONT, CAST_FRONT];
  const available = list.filter((g) => has(g) > 0);
  const rnd = Math.floor(random * available.length * 2);
  const queue: number[] = [];
  let last = current;
  const add = (g: number) => {
    if (last !== MOVING && g === MOVING) queue.push(MOVE_START);
    else if (last === MOVING && g !== MOVING) queue.push(MOVE_END);
    queue.push(g);
    last = g;
  };
  if (rnd < available.length) add(available[rnd]);
  else {
    const walk = has(MOVING) ? MOVING : HOLDING;
    for (let i = 0; i < Math.floor(12 / Math.max(1, has(walk))) + 1; i++) add(walk);
  }
  return queue;
}

