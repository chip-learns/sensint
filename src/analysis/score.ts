// Phase 1c analysis: raw logs → per-trial metrics → per-candidate scores → fitted recommendation.
// Pure functions; everything is derived from the raw log, so new metrics need no re-testing.
import type { DrillLog, DrillName } from '../drills/stage';
import { angleBetween, applyMove, type Aim } from './aim';
import { degPerCount } from './sens';

export type Pt = { t: number } & Aim;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

/** Aim after every raw move, starting at 0,0 (as the drill does). */
export function trace(log: DrillLog): Pt[] {
  const k = degPerCount(log.cm360, log.dpi);
  const aim: Aim = { yaw: 0, pitch: 0 };
  const out: Pt[] = [{ t: -Infinity, ...aim }];
  for (const m of log.moves) { applyMove(aim, m, k); out.push({ t: m.t, ...aim }); }
  return out;
}

/** Index of the last trace point at or before t. */
function idx(tr: Pt[], t: number) {
  let lo = 0, hi = tr.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tr[mid].t <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Targets in spawn order; a nudge belongs to the target spawned before it. */
function targets(log: DrillLog) {
  const out: { spawn: Pt; nudge?: Pt }[] = [];
  for (const s of log.spawns) {
    if (s.nudge && out.length) out[out.length - 1].nudge = s;
    else out.push({ spawn: s });
  }
  return out;
}

export type Flick = { dist: number; ttt: number; overshoot: number; undershoot: boolean; settle: number };

/**
 * Per hit target: overshoot = distance past the target centre along the flick line ÷ flick distance;
 * undershoot = the first movement stopped (no forward progress for 50 ms) short of the hitbox;
 * settle = first entering the hitbox → the click.
 */
export function flicks(log: DrillLog, tr = trace(log)): Flick[] {
  // ponytail: planar yaw/pitch approximation; fine for |pitch| ≤ ~20°. Use great-circle geometry if pitch range grows.
  const r = log.targetRadiusDeg;
  const tg = targets(log);
  return log.shots.filter((s) => s.hit).map((h, i) => {
    const s = tg[i].spawn;
    const i0 = idx(tr, s.t), i1 = idx(tr, h.t);
    const from = tr[i0];
    const dx = s.yaw - from.yaw, dy = s.pitch - from.pitch, D = Math.hypot(dx, dy) || 1e-9;
    let maxP = 0, firstIn = NaN, bestP = -Infinity, bestT = s.t, primary = NaN;
    for (let j = i0 + 1; j <= i1; j++) {
      const p = tr[j];
      const prog = ((p.yaw - from.yaw) * dx + (p.pitch - from.pitch) * dy) / D;
      maxP = Math.max(maxP, prog);
      if (Number.isNaN(firstIn) && angleBetween(p, s) <= r) firstIn = p.t;
      if (Number.isNaN(primary)) {
        // A 50 ms stall ends the primary movement, even if the next move continues forward.
        if (bestP > 0.2 * D && p.t - bestT >= 50) primary = bestP;
        else if (prog > bestP) { bestP = prog; bestT = p.t; }
      }
    }
    if (Number.isNaN(primary)) primary = bestP;
    return {
      dist: D, ttt: h.t - s.t, overshoot: Math.max(0, maxP - D) / D,
      undershoot: primary < D - r, settle: h.t - (Number.isNaN(firstIn) ? h.t : firstIn),
    };
  });
}

/** Micro-correct: per hit, time from the nudge to the click (NaN if the target was never nudged). */
export function micros(log: DrillLog) {
  const tg = targets(log);
  return log.shots.filter((s) => s.hit).map((h, i) => ({
    ttt: h.t - tg[i].spawn.t,
    corr: tg[i].nudge ? h.t - tg[i].nudge!.t : NaN,
  }));
}

/** Track: % of frames on target and mean angular error, replayed from raw moves. */
export function trackStats(log: DrillLog, tr = trace(log)) {
  // ponytail: per-frame, not per-ms; frames are near-uniform. Weight by frame dt if refresh rates vary mid-run.
  let on = 0, err = 0;
  for (const p of log.path) {
    const e = angleBetween(tr[idx(tr, p.t)], p);
    err += e;
    if (e <= log.targetRadiusDeg) on++;
  }
  const n = log.path.length;
  return { on: n ? (100 * on) / n : 0, err: n ? err / n : NaN };
}

/** Metric → +1 if higher is better, -1 if lower is better. Weights live in games.json. */
export const METRICS = {
  flickHits: 1, flickTTT: -1, flickOvershoot: -1, flickUndershoot: -1,
  trackOn: 1, trackErr: -1, microHits: 1, microCorr: -1,
} as const;
export type MetricKey = keyof typeof METRICS;
export type Metrics = Partial<Record<MetricKey, number>>;

export function metrics(log: DrillLog): Metrics {
  if (log.drill === 'flick') {
    const f = flicks(log);
    return {
      flickHits: f.length, flickTTT: median(f.map((x) => x.ttt)),
      flickOvershoot: 100 * mean(f.map((x) => x.overshoot)),
      flickUndershoot: 100 * mean(f.map((x) => +x.undershoot)),
    };
  }
  if (log.drill === 'track') { const t = trackStats(log); return { trackOn: t.on, trackErr: t.err }; }
  const m = micros(log);
  return { microHits: m.length, microCorr: median(m.map((x) => x.corr).filter(Number.isFinite)) };
}

/** Least-squares y = a·x² + b·x + c. */
export function fitQuadratic(xs: number[], ys: number[]): [number, number, number] {
  const S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  xs.forEach((x, i) => {
    for (let p = 0; p < 5; p++) S[p] += x ** p;
    for (let p = 0; p < 3; p++) T[p] += ys[i] * x ** p;
  });
  // Normal equations, unknowns [c, b, a]; Gaussian elimination on a 3×3.
  const M = [[S[0], S[1], S[2], T[0]], [S[1], S[2], S[3], T[1]], [S[2], S[3], S[4], T[2]]];
  for (let c = 0; c < 3; c++) {
    const p = M.slice(c).reduce((best, row, i) => (Math.abs(row[c]) > Math.abs(M[best][c]) ? c + i : best), c);
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const [c, b, a] = M.map((row, i) => row[3] / row[i]);
  return [a, b, c];
}

export type Point = { code: string; cm360: number; score: number };
export type Recommendation = { cm360: number; edge: 'fast' | 'slow' | null; coef: [number, number, number] };

/**
 * Peak of a quadratic in log(cm/360). If the curve has no peak inside the tested range,
 * return the better end and flag it: the true optimum lies beyond what was tested.
 */
export function recommend(points: Point[]): Recommendation | null {
  if (new Set(points.map((p) => p.code)).size < 3) return null;
  const xs = points.map((p) => Math.log(p.cm360));
  const coef = fitQuadratic(xs, points.map((p) => p.score));
  const [a, b, c] = coef;
  const f = (x: number) => a * x * x + b * x + c;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const x = a < 0 ? -b / (2 * a) : NaN;
  if (x >= lo && x <= hi) return { cm360: Math.exp(x), edge: null, coef };
  const fast = f(lo) >= f(hi);
  return { cm360: Math.exp(fast ? lo : hi), edge: fast ? 'fast' : 'slow', coef };
}

export type TrialIn = { code: string; cm360: number; drill: DrillName; log: DrillLog };

/**
 * Normalize each metric against the player's own session (z-score across trials),
 * combine with game weights per candidate repeat, map to 0–100 (50 = session average).
 */
export function analyze(trials: TrialIn[], weights: Partial<Record<MetricKey, number>>) {
  const rows = trials.map((t) => ({ ...t, m: metrics(t.log) }));
  const stat = {} as Record<MetricKey, { mu: number; sd: number }>;
  for (const k of Object.keys(METRICS) as MetricKey[]) {
    const v = rows.map((r) => r.m[k]).filter((x): x is number => Number.isFinite(x));
    const mu = mean(v);
    stat[k] = { mu, sd: Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) };
  }
  const reps = new Map<string, { code: string; cm360: number; sum: number; w: number }>();
  const seen: Record<string, number> = {};
  for (const r of rows) {
    const rep = (seen[r.code + r.drill] = (seen[r.code + r.drill] ?? -1) + 1);
    const e = reps.get(`${r.code}#${rep}`) ?? { code: r.code, cm360: r.cm360, sum: 0, w: 0 };
    reps.set(`${r.code}#${rep}`, e);
    for (const [k, v] of Object.entries(r.m) as [MetricKey, number][]) {
      const w = weights[k] ?? 0;
      if (!w || !Number.isFinite(v)) continue;
      e.sum += w * (stat[k].sd ? (METRICS[k] * (v - stat[k].mu)) / stat[k].sd : 0);
      e.w += w;
    }
  }
  const points: Point[] = [...reps.values()].map((e) => ({
    code: e.code, cm360: e.cm360, score: Math.max(0, Math.min(100, 50 + 25 * (e.w ? e.sum / e.w : 0))),
  }));
  // Per-candidate means, for the evidence table and plain-language findings.
  const byCode: Record<string, { cm360: number; score: number; m: Metrics }> = {};
  for (const code of new Set(rows.map((r) => r.code))) {
    const mine = rows.filter((r) => r.code === code);
    const m: Metrics = {};
    for (const k of Object.keys(METRICS) as MetricKey[]) {
      const v = mine.map((r) => r.m[k]).filter((x): x is number => Number.isFinite(x));
      if (v.length) m[k] = mean(v);
    }
    byCode[code] = { cm360: mine[0].cm360, score: mean(points.filter((p) => p.code === code).map((p) => p.score)), m };
  }
  return { points, byCode, rec: recommend(points) };
}
