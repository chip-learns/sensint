import games from '../data/games.json';
import { cm360FromGame } from './analysis/sens';
import { runFlick, type FlickLog } from './drills/flick';

type GameId = keyof typeof games;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const f = form.elements as unknown as Record<string, HTMLInputElement & HTMLOutputElement & HTMLSelectElement>;

for (const [id, g] of Object.entries(games)) {
  f.game.add(new Option(g.yaw ? g.name : `${g.name} (needs calibration)`, id, false, id === 'tarkov'));
  if (!g.yaw) f.game.options[f.game.length - 1].disabled = true;
}
f.seed.value = String(Math.floor(Math.random() * 1e6));

const baseline = () => {
  const g = games[f.game.value as GameId];
  const cm = g.yaw ? cm360FromGame(+f.dpi.value, +f.sens.value, g.yaw) : NaN;
  f.cm360.value = Number.isFinite(cm) ? cm.toFixed(1) : '—';
  $('warn').hidden = g.verified;
  $('warn').textContent = `${g.name} conversion constant is unverified; treat cm/360 as approximate.`;
  return cm;
};
form.addEventListener('input', baseline);
baseline();

let last: FlickLog | undefined;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cm360 = baseline();
  if (!Number.isFinite(cm360)) return;
  const canvas = $<HTMLCanvasElement>('stage');
  $('intake').hidden = true;
  canvas.hidden = $('crosshair').hidden = false;
  try {
    // ponytail: fixed CS2 hip FOV (106.26° at 16:9); per-game FOV matching lands in Phase 2
    last = await runFlick(canvas, { cm360, dpi: +f.dpi.value, seed: +f.seed.value, fovH: 106.26, durationMs: 30_000 });
    report(last);
  } finally {
    canvas.hidden = $('crosshair').hidden = true;
    $('intake').hidden = false;
  }
});

function report(log: FlickLog) {
  const hits = log.shots.filter((s) => s.hit);
  const ttt = hits.map((h, i) => h.t - log.spawns[i].t);
  const avg = ttt.length ? ttt.reduce((a, b) => a + b) / ttt.length : NaN;
  $('summary').textContent = [
    `cm/360      ${log.cm360.toFixed(1)}`,
    `raw input   ${log.rawInput ? 'yes' : 'NO — session flagged'}`,
    `targets hit ${hits.length}`,
    `shots       ${log.shots.length} (${log.shots.length ? Math.round((100 * hits.length) / log.shots.length) : 0}% accuracy)`,
    `avg TTT     ${Number.isFinite(avg) ? Math.round(avg) + ' ms' : '—'}`,
    `mouse events ${log.moves.length}`,
  ].join('\n');
  $('result').hidden = false;
}

$('export').addEventListener('click', () => {
  if (!last) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last)], { type: 'application/json' }));
  a.download = `sensint-flick-${last.seed}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
