import * as THREE from 'three';
import { angleBetween, applyMove, dir, rng, type Aim } from '../analysis/aim';
import { degPerCount } from '../analysis/sens';
import { lockPointer, onMove, type Move } from '../input/pointer';

const RAD = Math.PI / 180;
const DIST = 10; // target distance, world units; only angles matter

export type DrillName = 'flick' | 'track' | 'micro';
export type Mark = { t: number } & Aim;
export type Spawn = Mark & { nudge?: true };
export type Shot = Mark & { hit: boolean };
export type DrillLog = {
  drill: DrillName; seed: number; cm360: number; dpi: number; rawInput: boolean;
  fovH: number; targetRadiusDeg: number; durationMs: number; aborted: boolean;
  moves: Move[]; spawns: Spawn[]; shots: Shot[]; path: Mark[];
};

/** What a drill sees. Times are ms since the drill started. */
export type Ctx = {
  aim: Readonly<Aim>;
  target: Readonly<Aim>;
  rand: () => number;
  place(t: number, a: Aim, kind?: 'nudge' | 'path'): void;
};
export type Drill = {
  name: DrillName; durationMs: number; radiusDeg: number; highlight?: boolean;
  start(c: Ctx, t: number): void;
  frame?(c: Ctx, t: number): void;
  click?(c: Ctx, t: number, hit: boolean): void;
};

/** Runs one drill full-screen under pointer lock. Esc ends it early with aborted = true. */
export async function runDrill(
  canvas: HTMLCanvasElement,
  opts: { cm360: number; dpi: number; seed: number; fovH: number },
  drill: Drill,
): Promise<DrillLog> {
  const rawInput = await lockPointer(canvas); // first, so a refused lock leaks no WebGL context
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
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8442f });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(DIST * Math.tan(drill.radiusDeg * RAD), 24, 16), mat);
  scene.add(mesh);

  const aim: Aim = { yaw: 0, pitch: 0 };
  const target: Aim = { yaw: 0, pitch: 0 };
  const log: DrillLog = {
    drill: drill.name, seed: opts.seed, cm360: opts.cm360, dpi: opts.dpi, rawInput,
    fovH: opts.fovH, targetRadiusDeg: drill.radiusDeg, durationMs: drill.durationMs, aborted: false,
    moves: [], spawns: [], shots: [], path: [],
  };
  const ctx: Ctx = {
    aim, target, rand: rng(opts.seed),
    place(t, a, kind) {
      Object.assign(target, a);
      const m = { t, ...a };
      if (kind === 'path') log.path.push(m);
      else log.spawns.push(kind === 'nudge' ? { ...m, nudge: true } : m);
    },
  };

  const k = degPerCount(opts.cm360, opts.dpi);
  const t0 = performance.now();
  drill.start(ctx, 0);

  const stopMove = onMove((m) => {
    const mv = { ...m, t: m.t - t0 };
    log.moves.push(mv);
    applyMove(aim, mv, k);
  });
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || !document.pointerLockElement) return;
    const t = e.timeStamp - t0;
    const hit = angleBetween(aim, target) <= drill.radiusDeg;
    log.shots.push({ t, ...aim, hit });
    drill.click?.(ctx, t, hit);
  };
  addEventListener('mousedown', onClick);

  await new Promise<void>((done) => {
    const frame = (now: number) => {
      const t = Math.max(0, now - t0);
      drill.frame?.(ctx, t);
      const [x, y, z] = dir(target);
      mesh.position.set(x * DIST, y * DIST, z * DIST);
      if (drill.highlight) mat.color.setHex(angleBetween(aim, target) <= drill.radiusDeg ? 0x4fbf3a : 0xd8442f);
      camera.rotation.set(aim.pitch * RAD, -aim.yaw * RAD, 0);
      renderer.render(scene, camera);
      if (t >= drill.durationMs) done();
      else if (!document.pointerLockElement) { log.aborted = true; done(); }
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
