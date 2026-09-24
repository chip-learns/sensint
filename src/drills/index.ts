import { angleBetween, nextTarget, type Aim } from '../analysis/aim';
import type { Drill, DrillName } from './stage';

/** Flick: one small target at a time, 5–35° away, always on-screen. */
export const flick = (durationMs = 10_000): Drill => ({
  name: 'flick', durationMs, radiusDeg: 0.9,
  start: (c, t) => c.place(t, nextTarget(c.aim, c.rand)),
  click: (c, t, hit) => { if (hit) c.place(t, nextTarget(c.aim, c.rand)); },
});

/**
 * Seeded strafe path (Scope's walker): constant-speed segments that change direction every so often
 * and stay within ±halfWidth° of center. Time-based, so identical at any frame rate.
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

/**
 * Seeded panning path (Track). The target eases up to speed, cruises across for a while, then eases
 * to a stop: at the edge it turns back (sometimes after a short pause); mid-pan it either stalls,
 * then continues or turns back, or eases straight into a reversal. Speed changes only through
 * `ramp`-second linear ramps, so there are no sudden jerks. Stays within ±halfWidth°.
 * Time-based, so identical at any frame rate. Replaced a jittery strafe after playtest feedback.
 */
export function pan(
  rand: () => number, durationS: number,
  { halfWidth = 35, speed = [15, 28], ramp = 0.4, cruise = [1, 3] } = {},
) {
  const segs: { t: number; yaw: number; v: number; a: number }[] = [];
  let t = 0, yaw = 0, v = 0, dir = rand() < 0.5 ? -1 : 1;
  const push = (dur: number, a: number) => {
    segs.push({ t, yaw, v, a });
    yaw += v * dur + 0.5 * a * dur * dur;
    v += a * dur;
    t += dur;
  };
  const easeTo = (target: number) => push(ramp, (target - v) / ramp);
  const room = () => halfWidth - dir * yaw; // distance to the edge ahead
  while (t < durationS) {
    let s = speed[0] + rand() * (speed[1] - speed[0]);
    if (room() < s * ramp) dir = -dir; // not enough room to speed up and stop again
    s = Math.min(s, room() / ramp); // speeding up + stopping covers s × ramp degrees
    easeTo(dir * s);
    const maxCruise = Math.max(0, (room() - (s * ramp) / 2) / s);
    const want = cruise[0] + rand() * (cruise[1] - cruise[0]);
    const atEdge = want >= maxCruise;
    push(Math.min(want, maxCruise), 0);
    easeTo(0);
    const r = rand();
    if (atEdge) { if (r < 0.4) push(0.2 + rand() * 0.4, 0); dir = -dir; } // bounce, sometimes pausing
    else if (r < 0.5) { push(0.3 + rand() * 0.5, 0); if (rand() < 0.6) dir = -dir; } // stall, then either way
    else dir = -dir; // ease straight into a reversal
  }
  return (at: number) => {
    let i = segs.length - 1;
    while (i > 0 && segs[i].t > at) i--;
    const s = segs[i], dt = at - s.t;
    return s.yaw + s.v * dt + 0.5 * s.a * dt * dt;
  };
}

/** Track: follow a panning target; it turns green while you're on it. No clicking. */
export const track = (durationMs = 12_000): Drill => {
  let yawAt = (_: number) => 0;
  return {
    name: 'track', durationMs, radiusDeg: 2, highlight: true,
    start: (c, t) => { yawAt = pan(c.rand, durationMs / 1000); c.place(t, { yaw: 0, pitch: 0 }); },
    frame: (c, t) => c.place(t, { yaw: yawAt(t / 1000), pitch: 0 }, 'path'),
  };
};

/** Shift a target 1–3° in a random direction. */
export function nudge(a: Aim, rand: () => number): Aim {
  const d = 1 + rand() * 2, th = rand() * 2 * Math.PI;
  return { yaw: a.yaw + d * Math.cos(th), pitch: a.pitch + d * Math.sin(th) };
}

/** Micro-correct: short flick (10–40°); the target jumps 1–3° as you arrive. */
export const micro = (durationMs = 10_000): Drill => {
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

/**
 * One doorway 5–15° off centre (the frame is 3° wide, 6° tall) and the four spots a head can peek
 * from: either edge, at standing head height (2° above centre) or crouched (0.5° below).
 */
export function doorway(rand: () => number): { center: Aim; spots: Aim[] } {
  const center = { yaw: (rand() < 0.5 ? -1 : 1) * (5 + rand() * 10), pitch: -1 + rand() * 2 };
  const spots = [-1.2, 1.2].flatMap((dx) => [2, -0.5].map((dy) => ({ yaw: center.yaw + dx, pitch: center.pitch + dy })));
  return { center, spots };
}

/**
 * Door watch: a head peeks from one of four spots in a doorway (left or right edge, standing or
 * crouched) for 250–600 ms, every 1–3 s. Shooting while nothing is showing is a miss.
 */
export const door = (durationMs = 12_000): Drill => {
  let spots: Aim[] = [], next = 0, hideAt = -1;
  const wait = (c: { rand: () => number }, t: number) => { hideAt = -1; next = t + 1000 + c.rand() * 2000; };
  return {
    name: 'door', durationMs, radiusDeg: 0.9,
    start: (c, t) => { const d = doorway(c.rand); spots = d.spots; c.prop(d.center); c.show(false); wait(c, t); },
    frame: (c, t) => {
      if (hideAt >= 0 && t >= hideAt) { c.show(false); wait(c, t); }
      else if (hideAt < 0 && t >= next) {
        const until = t + 250 + c.rand() * 350;
        c.place(t, spots[Math.floor(c.rand() * 4)], undefined, until);
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
 * Its walker keeps the original strafe motion: it felt right in playtest.
 */
export const scope = (durationMs = 10_000): Drill => {
  let yawAt = (_: number) => 0;
  return {
    name: 'scope', durationMs, radiusDeg: 0.3, highlight: true, zoom: 4, mask: true,
    start: (c, t) => { yawAt = strafe(c.rand, durationMs / 1000, 4, [0.8, 1.7], [0.8, 2]); c.place(t, { yaw: 0, pitch: 0 }); },
    frame: (c, t) => c.place(t, { yaw: yawAt(t / 1000), pitch: 0 }, 'path'),
  };
};

/** Large turn: targets 90–180° away; an arrow at the screen edge shows which way until it's near. */
export const turn = (durationMs = 12_000): Drill => {
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
  flick: { make: () => flick(), seconds: 10, label: 'Flick', brief: '10 s. One target at a time. Snap to it and click.' },
  track: { make: () => track(), seconds: 12, label: 'Track', brief: '12 s. Keep the crosshair on the target as it pans. No clicking; it turns green while you are on it.' },
  micro: { make: () => micro(), seconds: 10, label: 'Micro-correct', brief: '10 s. Short flicks; the target shifts slightly as you arrive. Correct, then click.' },
  door: { make: () => door(), seconds: 12, label: 'Door watch', brief: '12 s. Hold the doorway. A head peeks briefly from either edge, standing or crouched: hit it. Shooting while nothing is showing is a miss.' },
  scope: { make: () => scope(), seconds: 10, label: 'Long-range scope', brief: '10 s. Through a 4× scope, keep the dot on a distant walking target. No clicking; it turns green while you are on it.' },
  turn: { make: () => turn(), seconds: 12, label: 'Large turn', brief: '12 s. Targets appear behind you; the arrow at the screen edge shows which way to turn. Turn, then click.' },
};
