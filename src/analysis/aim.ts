// Pure aim math shared by the drills (live) and analysis (replay). No DOM, no Three.js.
import type { DrillLog } from '../drills/stage';
import { degPerCount } from './sens';

const RAD = Math.PI / 180;

export type Aim = { yaw: number; pitch: number }; // degrees, yaw + = right, pitch + = up

/** mulberry32: tiny seeded PRNG so a seed replays the identical layout. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit view vector; Three.js convention (-Z forward, +X right). */
export const dir = ({ yaw, pitch }: Aim): [number, number, number] => [
  Math.sin(yaw * RAD) * Math.cos(pitch * RAD),
  Math.sin(pitch * RAD),
  -Math.cos(yaw * RAD) * Math.cos(pitch * RAD),
];

export function angleBetween(a: Aim, b: Aim) {
  const [x1, y1, z1] = dir(a), [x2, y2, z2] = dir(b);
  return Math.acos(Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2))) / RAD;
}

/** One raw mouse report → aim. Used live and in replay so both agree exactly. */
export function applyMove(aim: Aim, m: { dx: number; dy: number }, k: number) {
  aim.yaw += m.dx * k;
  aim.pitch = Math.max(-89, Math.min(89, aim.pitch - m.dy * k));
}

/** Next target min–max° away horizontally, small vertical offset. */
export function nextTarget(aim: Aim, rand: () => number, min = 20, max = 120): Aim {
  const side = rand() < 0.5 ? -1 : 1;
  return { yaw: aim.yaw + side * (min + rand() * (max - min)), pitch: -15 + rand() * 30 };
}

/** Track drill: % of rendered frames with the crosshair on the target, replayed from raw moves. */
export function onTargetPct(log: DrillLog) {
  // ponytail: per-frame, not per-ms; frames are near-uniform. Weight by frame dt if refresh rates vary mid-run.
  const k = degPerCount(log.cm360, log.dpi);
  const aim: Aim = { yaw: 0, pitch: 0 };
  let i = 0, on = 0;
  for (const p of log.path) {
    while (i < log.moves.length && log.moves[i].t <= p.t) applyMove(aim, log.moves[i++], k);
    if (angleBetween(aim, p) <= log.targetRadiusDeg) on++;
  }
  return log.path.length ? (100 * on) / log.path.length : 0;
}
