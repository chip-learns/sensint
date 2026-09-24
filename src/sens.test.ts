import { expect, test } from 'vitest';
import { angleBetween, applyMove, nextTarget, onTargetPct, rng } from './analysis/aim';
import { cm360FromGame, degPerCount, gameSensFromCm360 } from './analysis/sens';
import { nudge, strafe } from './drills';
import type { DrillLog } from './drills/stage';
import { candidates, schedule } from './session';

test('CS2 800 DPI @ 1.2 is ~43.3 cm/360 and round-trips', () => {
  const cm = cm360FromGame(800, 1.2, 0.022);
  expect(cm).toBeCloseTo(43.3, 1);
  expect(gameSensFromCm360(cm, 800, 0.022)).toBeCloseTo(1.2, 9);
});

test('moving cm/360 worth of counts turns exactly 360°', () => {
  const counts = (40 / 2.54) * 600;
  expect(counts * degPerCount(40, 600)).toBeCloseTo(360, 9);
});

test('angles and seeded spawns', () => {
  expect(angleBetween({ yaw: 0, pitch: 0 }, { yaw: 90, pitch: 0 })).toBeCloseTo(90, 6);
  expect(angleBetween({ yaw: 10, pitch: 5 }, { yaw: 370, pitch: 5 })).toBeCloseTo(0, 4);
  const t1 = nextTarget({ yaw: 0, pitch: 0 }, rng(42));
  expect(nextTarget({ yaw: 0, pitch: 0 }, rng(42))).toEqual(t1);
  expect(Math.abs(t1.yaw)).toBeGreaterThanOrEqual(5);
  expect(Math.abs(t1.yaw)).toBeLessThanOrEqual(35);
});

test('strafe path is seeded, bounded and continuous', () => {
  const a = strafe(rng(7), 15), b = strafe(rng(7), 15);
  for (let t = 0; t < 15; t += 0.01) {
    expect(a(t)).toBe(b(t));
    expect(Math.abs(a(t))).toBeLessThanOrEqual(35 + 1e-9);
    expect(Math.abs(a(t + 0.001) - a(t))).toBeLessThan(0.06); // ≤ 50°/s
  }
});

test('nudge moves the target 1–3°', () => {
  const r = rng(3);
  for (let i = 0; i < 200; i++) {
    const d = angleBetween({ yaw: 0, pitch: 0 }, nudge({ yaw: 0, pitch: 0 }, r));
    expect(d).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(d).toBeLessThanOrEqual(3 + 1e-6);
  }
});

test('schedule: every candidate once per round, shuffled codes, no back-to-back', () => {
  const r = rng(11);
  const cands = candidates(30, r);
  expect(cands.map((c) => c.code)).toEqual(['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO']);
  expect(cands.map((c) => c.cm360).sort((x, y) => x - y)).toEqual([18, 23.1, 30, 38.1, 48]);
  for (let s = 0; s < 50; s++) {
    const plan = schedule(cands, 2, rng(s));
    expect(plan).toHaveLength(10);
    for (const c of cands) expect(plan.filter((p) => p === c)).toHaveLength(2);
    for (let i = 1; i < plan.length; i++) expect(plan[i]).not.toBe(plan[i - 1]);
  }
});

test('onTargetPct replays raw moves against the target path', () => {
  const k = degPerCount(30, 600);
  // one count right per ms tick; target sits at 0° for t<5, then far away
  const log = {
    cm360: 30, dpi: 600, targetRadiusDeg: 1.5,
    moves: [{ t: 6, dx: 0, dy: 0 }],
    path: [0, 1, 2, 3, 4].map((t) => ({ t, yaw: 0, pitch: 0 })).concat([5, 6, 7, 8, 9].map((t) => ({ t, yaw: 90, pitch: 0 }))),
  } as unknown as DrillLog;
  expect(onTargetPct(log)).toBe(50);
  const aim = { yaw: 0, pitch: 0 };
  applyMove(aim, { dx: 100, dy: 0 }, k);
  expect(aim.yaw).toBeCloseTo(100 * k, 9);
});
