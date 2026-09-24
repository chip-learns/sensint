import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import games from '../data/games.json';
import { angleBetween, applyMove, nextTarget, rng } from './analysis/aim';
import { analyze, doorStats, fitQuadratic, flicks, recommend, trackStats } from './analysis/score';
import { adsFovH, aimingForRedDot, cm360FromGame, degPerCount, gameSensFromCm360, redDotCm360 } from './analysis/sens';
import { doorways, DRILLS, nudge, strafe } from './drills';
import type { DrillLog } from './drills/stage';
import { candidates, schedule, type Session } from './session';
import { decode, encode, type Summary } from './share';

test('CS2 800 DPI @ 1.2 is ~43.3 cm/360 and round-trips', () => {
  const cm = cm360FromGame(800, 1.2, 0.022);
  expect(cm).toBeCloseTo(43.3, 1);
  expect(gameSensFromCm360(cm, 800, 0.022)).toBeCloseTo(1.2, 9);
});

test('Tarkov red-dot conversion reproduces the in-game measurement and round-trips', () => {
  const k = games.tarkov.adsFactor;
  // Measured 2026-09-24 at 0.528 / 0.394: hip 24.0 cm, red dot 41.6 cm.
  expect(redDotCm360(24.0, 0.528, 0.394, k)).toBeCloseTo(41.6, 0);
  const hip = cm360FromGame(600, 0.528, games.tarkov.yaw);
  const red = redDotCm360(hip, 0.528, 0.394, k);
  expect(aimingForRedDot(red, hip, 0.528, k)).toBeCloseTo(0.394, 9);
  // ADS view zoom: tan of half-FOV shrinks by k.
  const rad = Math.PI / 360;
  expect(Math.tan(106.26 * rad) / Math.tan(adsFovH(106.26, k) * rad)).toBeCloseTo(k, 9);
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
    expect(Math.abs(a(t + 0.001) - a(t))).toBeLessThan(0.036); // ≤ 35°/s
  }
});

test('Phase 2 drills: doorways, scope walker, large turns, presets', () => {
  for (let s = 0; s < 50; s++) {
    const [a, b] = doorways(rng(s));
    expect(Math.sign(a.yaw)).toBe(-Math.sign(b.yaw)); // opposite sides
    for (const d of [a, b]) expect(Math.abs(d.yaw)).toBeGreaterThanOrEqual(4);
    const walk = strafe(rng(s), 20, 4, [0.8, 1.7], [0.8, 2]);
    for (let t = 0; t < 20; t += 0.05) {
      expect(Math.abs(walk(t))).toBeLessThanOrEqual(4 + 1e-9);
      expect(Math.abs(walk(t + 0.01) - walk(t))).toBeLessThanOrEqual(0.0171); // ≤ 1.7°/s
    }
    const tg = nextTarget({ yaw: 0, pitch: 0 }, rng(s), 90, 180);
    expect(Math.abs(tg.yaw)).toBeGreaterThanOrEqual(90);
    expect(Math.abs(tg.yaw)).toBeLessThanOrEqual(180);
  }
  for (const g of Object.values(games)) for (const list of Object.values(g.presets)) {
    for (const d of list) expect(Object.keys(DRILLS)).toContain(d);
  }
});

test('door watch: reaction, hit rate, early shots count as misses, drift while holding', () => {
  const doors = [{ yaw: 10, pitch: 0 }, { yaw: -12, pitch: 0 }];
  const l = log({
    drill: 'door', durationMs: 5000, props: doors,
    moves: [{ t: 50, dx: 100, dy: 0 }], // 1 count = 0.1°: aim to 10° at t=50, then hold door 1
    spawns: [{ t: 1000, ...doors[0], until: 1500 }, { t: 3000, ...doors[1], until: 3400 }],
    shots: [
      { t: 800, yaw: 10, pitch: 0, hit: false }, // early: nothing showing
      { t: 1300, yaw: 10, pitch: 0, hit: true }, // 300 ms after the peek
    ],
  });
  const d = doorStats(l);
  expect(d.react).toBe(300);
  expect(d.hit).toBe(50); // 1 of 2 peeks
  expect(d.acc).toBe(50); // 1 of 2 shots
  expect(d.drift).toBeCloseTo(0, 4); // aim sat exactly on a doorway the whole time
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
  for (const rounds of [2, 3, 4]) for (let s = 0; s < 50; s++) {
    const plan = schedule(cands, rounds, rng(s));
    expect(plan).toHaveLength(5 * rounds);
    for (const c of cands) expect(plan.filter((p) => p === c)).toHaveLength(rounds);
    for (let i = 1; i < plan.length; i++) expect(plan[i]).not.toBe(plan[i - 1]);
  }
});

// 1 count = 0.1° at this cm/360 and DPI, so moves read directly in tenths of a degree.
const cm01 = 360 / (0.1 * 600) * 2.54;
const log = (over: Partial<DrillLog>) =>
  ({ cm360: cm01, dpi: 600, targetRadiusDeg: 1, moves: [], spawns: [], shots: [], path: [], ...over }) as DrillLog;

test('trackStats replays raw moves against the target path', () => {
  const l = log({
    targetRadiusDeg: 1.5,
    moves: [{ t: 6, dx: 0, dy: 0 }],
    path: [0, 1, 2, 3, 4].map((t) => ({ t, yaw: 0, pitch: 0 })).concat([5, 6, 7, 8, 9].map((t) => ({ t, yaw: 90, pitch: 0 }))),
  });
  expect(trackStats(l).on).toBe(50);
  const aim = { yaw: 0, pitch: 0 };
  applyMove(aim, { dx: 100, dy: 0 }, degPerCount(cm01, 600));
  expect(aim.yaw).toBeCloseTo(10, 9);
});

test('flick metrics: overshoot, undershoot, settle', () => {
  // Target at 20°. Flick 1 goes to 24° (20% overshoot) then back. Flick 2 stops at 15°, pauses, corrects.
  const moves = [
    ...Array.from({ length: 24 }, (_, i) => ({ t: 10 + i, dx: 10, dy: 0 })), // 0 → 24°
    ...Array.from({ length: 4 }, (_, i) => ({ t: 40 + i, dx: -10, dy: 0 })), // back to 20°
    ...Array.from({ length: 15 }, (_, i) => ({ t: 110 + i, dx: 10, dy: 0 })), // 20 → 35° (short of 40)
    ...Array.from({ length: 5 }, (_, i) => ({ t: 200 + i, dx: 10, dy: 0 })), // 35 → 40° after a pause
  ];
  const f = flicks(log({
    moves,
    spawns: [{ t: 0, yaw: 20, pitch: 0 }, { t: 100, yaw: 40, pitch: 0 }],
    shots: [{ t: 50, yaw: 20, pitch: 0, hit: true }, { t: 210, yaw: 40, pitch: 0, hit: true }],
  }));
  expect(f[0].overshoot).toBeCloseTo(0.2, 6);
  expect(f[0].undershoot).toBe(false);
  expect(f[0].settle).toBe(50 - 28); // entered the 1° hitbox at 19°, the move at t = 28
  expect(f[1].overshoot).toBe(0);
  expect(f[1].undershoot).toBe(true);
});

test('quadratic fit recovers a known curve; recommend finds the peak or flags the edge', () => {
  const xs = [1, 2, 3, 4, 5];
  const [a, b, c] = fitQuadratic(xs, xs.map((x) => -2 * x * x + 12 * x + 5));
  expect(a).toBeCloseTo(-2, 9);
  expect(b).toBeCloseTo(12, 9);
  expect(c).toBeCloseTo(5, 9);

  const pts = (f: (lc: number) => number) =>
    [16, 20, 28, 36, 45].map((cm, i) => ({ code: 'ABCDE'[i], cm360: cm, score: f(Math.log(cm)) }));
  const peak = recommend(pts((x) => 80 - 40 * (x - Math.log(26)) ** 2))!;
  expect(peak.cm360).toBeCloseTo(26, 6);
  expect(peak.edge).toBeNull();
  expect(peak.confidence).toBe('high'); // noiseless: every resample agrees
  expect(peak.hi / peak.lo).toBeCloseTo(1, 6);
  // Noisy rounds: two per candidate that disagree → wider band containing the peak.
  const noisy = pts((x) => 80 - 40 * (x - Math.log(26)) ** 2).flatMap((p, i) =>
    [{ ...p, score: p.score + (i % 2 ? 12 : -12) }, { ...p, score: p.score - (i % 2 ? 12 : -12) }]);
  const nr = recommend(noisy)!;
  expect(nr.lo).toBeLessThanOrEqual(nr.cm360);
  expect(nr.hi).toBeGreaterThanOrEqual(nr.cm360);
  expect(nr.hi / nr.lo).toBeGreaterThan(1.05);
  const fast = recommend(pts((x) => 100 - 20 * x))!; // monotonic: faster is always better
  expect(fast.edge).toBe('fast');
  expect(fast.cm360).toBeCloseTo(16, 9);
  expect(recommend(pts(() => 50).slice(0, 2))).toBeNull();
});

test('share link round-trips, stays short, and rejects tampering', async () => {
  const s: Summary = {
    v: 1, name: 'Ghost <b>', game: 'tarkov', dpi: 600, date: '2026-09-24', cur: 28, aim: 0.747,
    rec: { final: 28, peak: 17.6, lo: 16.8, hi: 28, conf: 'low', edge: null },
    c: [['ALPHA', 16.8, 62], ['ECHO', 21.6, 57], ['BRAVO', 28, 62], ['CHARLIE', 35.6, 36], ['DELTA', 44.8, 33]],
  };
  const code = await encode(s);
  expect(code).toMatch(/^[\w-]+$/);
  expect(code.length).toBeLessThan(400);
  expect(await decode(code)).toEqual(s);
  await expect(decode(await encode({ ...s, game: 'valorant' }))).rejects.toThrow('game');
  await expect(decode(await encode({ ...s, c: [['<img>', 20, 50]] }))).rejects.toThrow('candidate');
  await expect(decode(await encode({ ...s, cur: 1e9 }))).rejects.toThrow('cm/360');
  await expect(decode('not!base64')).rejects.toThrow('malformed');
  const ads = { ...s, aim: null, ads: { hip: 0.528, aiming: 0.412 } };
  expect(await decode(await encode(ads))).toEqual(ads);
  await expect(decode(await encode({ ...ads, ads: { hip: 0.528, aiming: 99 } }))).rejects.toThrow('sensitivity');
});

test('pad check: 180° travel against pad width minus the mouse', async () => {
  const { padCheck } = await import('./ui/debrief');
  expect(padCheck(null, 28)).toBe('');
  expect(padCheck(45, 28)).toContain('It fits'); // 14 cm needed, 39 cm room
  expect(padCheck(18, 28)).toContain('does not fit'); // 14 cm needed, 12 cm room
});

test('recorded session (Chip, 2026-09-24) analyses end to end', () => {
  const s = JSON.parse(gunzipSync(readFileSync('tests/fixtures/session-625932.json.gz')).toString()) as Session;
  const { points, byCode, rec } = analyze(s.trials.map((t) => ({ ...t, log: t.log! })), games.tarkov.weights);
  expect(points).toHaveLength(10);
  expect(Object.keys(byCode)).toHaveLength(5);
  for (const p of points) expect(p.score).toBeGreaterThanOrEqual(0);
  // DELTA (44.8 cm) was worst on every drill in this session; its score should reflect that.
  expect(byCode.DELTA.score).toBe(Math.min(...Object.values(byCode).map((c) => c.score)));
  expect(rec).not.toBeNull();
  expect(rec!.cm360).toBeGreaterThanOrEqual(16.8 - 1e-9);
  expect(rec!.cm360).toBeLessThanOrEqual(44.9);
  // A plateau from 16.8 to 28 cm shouldn't produce a confident single number.
  expect(rec!.confidence).not.toBe('high');
  // ALPHA (16.8) and BRAVO (28.0, current) tied; the band must cover both, so the verdict is "keep".
  expect(rec!.lo).toBeLessThanOrEqual(byCode.ALPHA.cm360 + 1e-9);
  expect(rec!.hi).toBeGreaterThanOrEqual(s.intake.baselineCm360 - 1e-9);
});
