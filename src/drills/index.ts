import { angleBetween, nextTarget, type Aim } from '../analysis/aim';
import type { Drill, DrillName } from './stage';

/** Flick: one small target at a time, 5–35° away, always on-screen. */
export const flick = (durationMs = 20_000): Drill => ({
  name: 'flick', durationMs, radiusDeg: 0.9,
  start: (c, t) => c.place(t, nextTarget(c.aim, c.rand)),
  click: (c, t, hit) => { if (hit) c.place(t, nextTarget(c.aim, c.rand)); },
});

/**
 * Seeded strafe path: constant-speed segments that change direction every few hundred ms and stay
 * within ±halfWidth° of center. Time-based, so identical at any frame rate.
 * Track defaults (15–35°/s, turns every 0.5–1.5 s) were eased after the first playtest felt twitchy.
 */
export function strafe(rand: () => number, durationS: number, halfWidth = 35, speed = [15, 35], turn = [0.5, 1.5]) {
  const segs: { t: number; yaw: number; vel: number }[] = [];
  const minRoom = Math.min(10, halfWidth / 3);
  let t = 0, yaw = 0;
  while (t < durationS) {
    const v = speed[0] + rand() * (speed[1] - speed[0]);
    let side = rand() < 0.5 ? -1 : 1;
    if ((side > 0 ? halfWidth - yaw : yaw + halfWidth) < minRoom) side = -side;
    const room = side > 0 ? halfWidth - yaw : yaw + halfWidth;
    const dur = Math.min(turn[0] + rand() * (turn[1] - turn[0]), room / v);
    segs.push({ t, yaw, vel: side * v });
    yaw += side * v * dur;
    t += dur;
  }
  return (at: number) => {
    let i = segs.length - 1;
    while (i > 0 && segs[i].t > at) i--;
    return segs[i].yaw + segs[i].vel * (at - segs[i].t);
  };
}

/** Track: follow a strafing target; it turns green while you're on it. No clicking. */
export const track = (durationMs = 15_000): Drill => {
  let yawAt = (_: number) => 0;
  return {
    name: 'track', durationMs, radiusDeg: 2, highlight: true,
    start: (c, t) => { yawAt = strafe(c.rand, durationMs / 1000); c.place(t, { yaw: 0, pitch: 0 }); },
    frame: (c, t) => c.place(t, { yaw: yawAt(t / 1000), pitch: 0 }, 'path'),
  };
};

/** Shift a target 1–3° in a random direction. */
export function nudge(a: Aim, rand: () => number): Aim {
  const d = 1 + rand() * 2, th = rand() * 2 * Math.PI;
  return { yaw: a.yaw + d * Math.cos(th), pitch: a.pitch + d * Math.sin(th) };
}

/** Micro-correct: short flick (10–40°); the target jumps 1–3° as you arrive. */
export const micro = (durationMs = 20_000): Drill => {
  let nudged = false;
  const spawn: Drill['start'] = (c, t) => { nudged = false; c.place(t, nextTarget(c.aim, c.rand, 10, 40)); };
  return {
    name: 'micro', durationMs, radiusDeg: 0.9,
    start: spawn,
    // ponytail: nudges when the crosshair comes within 4°, a proxy for "just before you click"; tune after playtest
    frame: (c, t) => {
      if (!nudged && angleBetween(c.aim, c.target) < 4) { nudged = true; c.place(t, nudge(c.target, c.rand), 'nudge'); }
    },
    click: (c, t, hit) => { if (hit) spawn(c, t); },
  };
};

/** Two doorways on opposite sides, 4–16° off centre: hold one, flick to the other when needed. */
export function doorways(rand: () => number): [Aim, Aim] {
  const side = rand() < 0.5 ? -1 : 1;
  return [
    { yaw: side * (4 + rand() * 8), pitch: -2 + rand() * 4 },
    { yaw: -side * (6 + rand() * 10), pitch: -2 + rand() * 4 },
  ];
}

/**
 * Door watch: a head peeks from one of two doorways for 250–600 ms, every 1–3 s.
 * Shooting while nothing is showing is a miss.
 */
export const door = (durationMs = 25_000): Drill => {
  let doors: Aim[] = [], next = 0, hideAt = -1;
  const wait = (c: { rand: () => number }, t: number) => { hideAt = -1; next = t + 1000 + c.rand() * 2000; };
  return {
    name: 'door', durationMs, radiusDeg: 0.9,
    start: (c, t) => { doors = doorways(c.rand); doors.forEach((d) => c.prop(d)); c.show(false); wait(c, t); },
    frame: (c, t) => {
      if (hideAt >= 0 && t >= hideAt) { c.show(false); wait(c, t); }
      else if (hideAt < 0 && t >= next) {
        const until = t + 250 + c.rand() * 350;
        c.place(t, doors[c.rand() < 0.5 ? 0 : 1], undefined, until);
        c.show(true);
        hideAt = until;
      }
    },
    click: (c, t, hit) => { if (hit) { c.show(false); wait(c, t); } },
  };
};

/**
 * Long-range scope: 4× optic (turns 4× slower, view 4× narrower, as measured in Tarkov), a small
 * distant target walking 0.8–1.7°/s within ±4°. Stay on it; it turns green while you are.
 */
export const scope = (durationMs = 20_000): Drill => {
  let yawAt = (_: number) => 0;
  return {
    name: 'scope', durationMs, radiusDeg: 0.3, highlight: true, zoom: 4, mask: true,
    start: (c, t) => { yawAt = strafe(c.rand, durationMs / 1000, 4, [0.8, 1.7], [0.8, 2]); c.place(t, { yaw: 0, pitch: 0 }); },
    frame: (c, t) => c.place(t, { yaw: yawAt(t / 1000), pitch: 0 }, 'path'),
  };
};

/** Large turn: targets 90–180° away; an arrow at the screen edge shows which way until it's near. */
export const turn = (durationMs = 20_000): Drill => {
  const spawn: Drill['start'] = (c, t) => {
    const tg = nextTarget(c.aim, c.rand, 90, 180);
    c.place(t, tg);
    c.cue(tg.yaw > c.aim.yaw ? 1 : -1);
  };
  return {
    name: 'turn', durationMs, radiusDeg: 1.2,
    start: spawn,
    frame: (c) => { if (angleBetween(c.aim, c.target) < 40) c.cue(0); },
    click: (c, t, hit) => { if (hit) spawn(c, t); },
  };
};

export const DRILLS: Record<DrillName, { make: () => Drill; label: string; brief: string; seconds: number }> = {
  flick: { make: () => flick(), seconds: 20, label: 'Flick', brief: '20 s. One target at a time. Snap to it and click.' },
  track: { make: () => track(), seconds: 15, label: 'Track', brief: '15 s. Keep the crosshair on the strafing target. No clicking; it turns green while you are on it.' },
  micro: { make: () => micro(), seconds: 20, label: 'Micro-correct', brief: '20 s. Short flicks; the target shifts slightly as you arrive. Correct, then click.' },
  door: { make: () => door(), seconds: 25, label: 'Door watch', brief: '25 s. Hold an angle on the two doorways. A head peeks out briefly from either one: hit it. Shooting at an empty doorway is a miss.' },
  scope: { make: () => scope(), seconds: 20, label: 'Long-range scope', brief: '20 s. Through a 4× scope, keep the dot on a distant walking target. No clicking; it turns green while you are on it.' },
  turn: { make: () => turn(), seconds: 20, label: 'Large turn', brief: '20 s. Targets appear behind you; the arrow at the screen edge shows which way to turn. Turn, then click.' },
};
