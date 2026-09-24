import { expect, test } from 'vitest';
import { cm360FromGame, degPerCount, gameSensFromCm360 } from './analysis/sens';
import { angleBetween, nextTarget, rng } from './drills/flick';

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
  const a = rng(42), b = rng(42);
  const t1 = nextTarget({ yaw: 0, pitch: 0 }, a);
  expect(nextTarget({ yaw: 0, pitch: 0 }, b)).toEqual(t1);
  expect(Math.abs(t1.yaw)).toBeGreaterThanOrEqual(20);
  expect(Math.abs(t1.yaw)).toBeLessThanOrEqual(120);
});
