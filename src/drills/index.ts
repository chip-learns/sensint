import { angleBetween, nextTarget, type Aim } from '../analysis/aim';
import type { Drill, DrillName } from './stage';

/** Flick: one small target at a time, 5–35° away, always on-screen. */
export const flick = (durationMs = 30_000): Drill => ({
  name: 'flick', durationMs, radiusDeg: 0.9,
  start: (c, t) => c.place(t, nextTarget(c.aim, c.rand)),
  click: (c, t, hit) => { if (hit) c.place(t, nextTarget(c.aim, c.rand)); },
});

/**
 * Seeded strafe path: constant-speed segments (15–35°/s) that change direction every
 * 0.5–1.5 s and stay within ±halfWidth° of center. Time-based, so identical at any frame rate.
 * Eased from 25–50°/s every 0.25–1 s after the first playtest felt twitchy.
 */
export function strafe(rand: () => number, durationS: number, halfWidth = 35) {
  const segs: { t: number; yaw: number; vel: number }[] = [];
  let t = 0, yaw = 0;
  while (t < durationS) {
    const speed = 15 + rand() * 20;
    let side = rand() < 0.5 ? -1 : 1;
    if ((side > 0 ? halfWidth - yaw : yaw + halfWidth) < 10) side = -side;
    const room = side > 0 ? halfWidth - yaw : yaw + halfWidth;
    const dur = Math.min(0.5 + rand(), room / speed);
    segs.push({ t, yaw, vel: side * speed });
    yaw += side * speed * dur;
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
export const micro = (durationMs = 30_000): Drill => {
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

export const DRILLS: Record<DrillName, { make: () => Drill; label: string; brief: string }> = {
  flick: { make: () => flick(), label: 'Flick', brief: '30 s. One target at a time. Snap to it and click.' },
  track: { make: () => track(), label: 'Track', brief: '15 s. Keep the crosshair on the strafing target. No clicking; it turns green while you are on it.' },
  micro: { make: () => micro(), label: 'Micro-correct', brief: '30 s. Short flicks; the target shifts slightly as you arrive. Correct, then click.' },
};
