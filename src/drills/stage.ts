import * as THREE from 'three';
import { angleBetween, applyMove, dir, rng, type Aim } from '../analysis/aim';
import { degPerCount } from '../analysis/sens';
import { lockPointer, MOVE_EVENT, onMove, type Move } from '../input/pointer';

const RAD = Math.PI / 180;
const DIST = 10; // target distance, world units; only angles matter

export type DrillName = 'flick' | 'track' | 'micro' | 'door' | 'scope' | 'turn';
export type Mark = { t: number } & Aim;
export type Spawn = Mark & { nudge?: true; until?: number }; // until: door peek hides at this time
export type Shot = Mark & { hit: boolean };
export type DrillLog = {
  drill: DrillName; seed: number; cm360: number; dpi: number; rawInput: boolean;
  input: { event: string; userAgent: string };
  fovH: number; targetRadiusDeg: number; durationMs: number; aborted: boolean;
  zoom?: number; // cm360 and fovH above are already the zoomed values
  props?: Aim[]; // door watch: doorway positions
  moves: Move[]; spawns: Spawn[]; shots: Shot[]; path: Mark[];
};

/** What a drill sees. Times are ms since the drill started. */
export type Ctx = {
  aim: Readonly<Aim>;
  target: Readonly<Aim>;
  rand: () => number;
  place(t: number, a: Aim, kind?: 'nudge' | 'path', until?: number): void;
  show(visible: boolean): void; // hidden targets can't be hit; shots at them are misses
  prop(a: Aim): void; // a doorway frame behind this point
  cue(side: -1 | 0 | 1): void; // edge arrow: turn left / none / right
};
export type Drill = {
  name: DrillName; durationMs: number; radiusDeg: number; highlight?: boolean;
  zoom?: number; // optic magnification: turns zoom× slower, view zoom× narrower (Tarkov scope model)
  mask?: boolean; // circular scope mask over the screen
  start(c: Ctx, t: number): void;
  frame?(c: Ctx, t: number): void;
  click?(c: Ctx, t: number, hit: boolean): void;
};

let lastRaw = false;

/**
 * Runs one drill full-screen under pointer lock. Esc ends it early with aborted = true.
 * The lock is kept afterwards so trials can run back to back; the caller releases it.
 */
export async function runDrill(
  canvas: HTMLCanvasElement,
  opts: { cm360: number; dpi: number; seed: number; fovH: number },
  drill: Drill,
): Promise<DrillLog> {
  // Lock first, so a refused lock leaks no WebGL context. Already locked = same raw-input result.
  const rawInput = document.pointerLockElement === canvas ? lastRaw : (lastRaw = await lockPointer(canvas));
  const zoom = drill.zoom ?? 1;
  const cm360 = opts.cm360 * zoom;
  const fovH = 2 * Math.atan(Math.tan((opts.fovH * RAD) / 2) / zoom) / RAD;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(devicePixelRatio);
  const aspect = innerWidth / innerHeight;
  const fovV = 2 * Math.atan(Math.tan((fovH * RAD) / 2) / aspect) / RAD;
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
    drill: drill.name, seed: opts.seed, cm360, dpi: opts.dpi, rawInput,
    input: { event: MOVE_EVENT, userAgent: navigator.userAgent },
    fovH, targetRadiusDeg: drill.radiusDeg, durationMs: drill.durationMs, aborted: false,
    ...(zoom !== 1 ? { zoom } : {}),
    moves: [], spawns: [], shots: [], path: [],
  };
  // Overlays (scope mask, edge arrow) are page elements styled off these data attributes.
  const body = document.body.dataset;
  body.mask = drill.mask ? 'on' : '';
  body.cue = '';
  const ctx: Ctx = {
    aim, target, rand: rng(opts.seed),
    place(t, a, kind, until) {
      Object.assign(target, a);
      const m = { t, ...a };
      if (kind === 'path') log.path.push(m);
      else log.spawns.push(kind === 'nudge' ? { ...m, nudge: true } : until !== undefined ? { ...m, until } : m);
    },
    show(v) { mesh.visible = v; },
    prop(a) {
      (log.props ??= []).push(a);
      // Dark doorway 3° wide, 6° tall, just behind the target point, facing the viewer.
      const d = DIST + 0.5;
      const frame = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * d * Math.tan(1.5 * RAD), 2 * d * Math.tan(3 * RAD)),
        new THREE.MeshBasicMaterial({ color: 0x0c0d0b }),
      );
      const [x, y, z] = dir(a);
      frame.position.set(x * d, y * d, z * d);
      frame.lookAt(0, 0, 0);
      scene.add(frame);
    },
    cue(side) { body.cue = side < 0 ? 'left' : side > 0 ? 'right' : ''; },
  };

  const k = degPerCount(cm360, opts.dpi);
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
    const hit = mesh.visible && angleBetween(aim, target) <= drill.radiusDeg;
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
  body.mask = body.cue = '';
  renderer.dispose();
  return log;
}
