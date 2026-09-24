import * as THREE from 'three';
import { degPerCount } from '../analysis/sens';
import { lockPointer, onMove, type Move } from '../input/pointer';

const RAD = Math.PI / 180;
const DIST = 10; // target distance, world units; only angles matter
export const TARGET_RADIUS_DEG = 0.9; // roughly a head at mid range

export type Aim = { yaw: number; pitch: number }; // degrees, yaw + = right, pitch + = up
export type Spawn = { t: number } & Aim;
export type Shot = { t: number; hit: boolean } & Aim;
export type FlickLog = {
  drill: 'flick'; seed: number; cm360: number; dpi: number; rawInput: boolean;
  fovH: number; targetRadiusDeg: number; durationMs: number;
  moves: Move[]; spawns: Spawn[]; shots: Shot[];
};

/** mulberry32: tiny seeded PRNG so a seed replays the identical layout. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dir = ({ yaw, pitch }: Aim) => new THREE.Vector3(
  Math.sin(yaw * RAD) * Math.cos(pitch * RAD),
  Math.sin(pitch * RAD),
  -Math.cos(yaw * RAD) * Math.cos(pitch * RAD),
);

export const angleBetween = (a: Aim, b: Aim) => dir(a).angleTo(dir(b)) / RAD;

/** Next target 20–120° away horizontally, small vertical offset. */
export function nextTarget(aim: Aim, rand: () => number): Aim {
  const side = rand() < 0.5 ? -1 : 1;
  return { yaw: aim.yaw + side * (20 + rand() * 100), pitch: -15 + rand() * 30 };
}

export async function runFlick(
  canvas: HTMLCanvasElement,
  opts: { cm360: number; dpi: number; seed: number; fovH: number; durationMs: number },
): Promise<FlickLog> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  const aspect = innerWidth / innerHeight;
  const fovV = 2 * Math.atan(Math.tan((opts.fovH * RAD) / 2) / aspect) / RAD;
  const camera = new THREE.PerspectiveCamera(fovV, aspect, 0.1, 200);
  camera.rotation.order = 'YXZ';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d1a);
  const grid = new THREE.GridHelper(200, 100, 0x4a4f44, 0x2d302a);
  grid.position.y = -3;
  scene.add(grid);
  const target = new THREE.Mesh(
    new THREE.SphereGeometry(DIST * Math.tan(TARGET_RADIUS_DEG * RAD), 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xd8442f }),
  );
  scene.add(target);

  const rand = rng(opts.seed);
  const k = degPerCount(opts.cm360, opts.dpi);
  const aim: Aim = { yaw: 0, pitch: 0 };
  const log: FlickLog = {
    drill: 'flick', seed: opts.seed, cm360: opts.cm360, dpi: opts.dpi, rawInput: false,
    fovH: opts.fovH, targetRadiusDeg: TARGET_RADIUS_DEG, durationMs: opts.durationMs,
    moves: [], spawns: [], shots: [],
  };

  let t0 = 0;
  let current: Aim = aim;
  const spawn = (t: number) => {
    current = nextTarget(aim, rand);
    target.position.copy(dir(current).multiplyScalar(DIST));
    log.spawns.push({ t: t - t0, ...current });
  };

  log.rawInput = await lockPointer(canvas);
  t0 = performance.now();
  spawn(t0);

  const stopMove = onMove((m) => {
    log.moves.push({ ...m, t: m.t - t0 });
    aim.yaw += m.dx * k;
    aim.pitch = Math.max(-89, Math.min(89, aim.pitch - m.dy * k));
  });
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || !document.pointerLockElement) return;
    const hit = angleBetween(aim, current) <= TARGET_RADIUS_DEG;
    log.shots.push({ t: e.timeStamp - t0, ...aim, hit });
    if (hit) spawn(e.timeStamp);
  };
  addEventListener('mousedown', onClick);

  await new Promise<void>((done) => {
    const frame = () => {
      camera.rotation.set(aim.pitch * RAD, -aim.yaw * RAD, 0);
      renderer.render(scene, camera);
      // ponytail: Esc/unlock just ends the run early; add pause/resume if players ask
      if (performance.now() - t0 >= opts.durationMs || !document.pointerLockElement) done();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  stopMove();
  removeEventListener('mousedown', onClick);
  document.exitPointerLock();
  renderer.dispose();
  return log;
}
