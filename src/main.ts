import games from '../data/games.json';
import { onTargetPct, rng } from './analysis/aim';
import { cm360FromGame } from './analysis/sens';
import { DRILLS, flick } from './drills';
import { runDrill, type Drill, type DrillLog, type DrillName } from './drills/stage';
import { candidates, schedule, type Candidate } from './session';

type GameId = keyof typeof games;
type Trial = Candidate & { drill: DrillName; log?: DrillLog };

// ponytail: fixed CS2 hip FOV (106.26° at 16:9); per-game FOV matching lands in Phase 2
const FOV_H = 106.26;
const ROUNDS = 2;

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
  $('aiming-row').hidden = f.game.value !== 'tarkov';
  return cm;
};
form.addEventListener('input', baseline);
baseline();

const show = (pane: 'form' | 'brief' | 'result' | 'stage', label = '') => {
  for (const id of ['form', 'brief', 'result'] as const) $(id).hidden = id !== pane;
  $('file').hidden = pane === 'stage';
  $('stage').hidden = $('crosshair').hidden = pane !== 'stage';
  if (label) $('stage-name').textContent = label;
};

/** Show a briefing card; resolves on the Start click (the user gesture pointer lock needs). */
const brief = (kicker: string, title: string, text: string) =>
  new Promise<void>((resolve) => {
    $('brief-kicker').textContent = kicker;
    $('brief-title').textContent = title;
    $('brief-text').textContent = text;
    show('brief');
    $('go').onclick = () => resolve();
  });

/** Brief, run, and re-run on Esc until a clean log comes back. */
async function play(kicker: string, title: string, text: string, cm360: number, make: () => Drill, seed: number) {
  for (;;) {
    await brief(kicker, title, text);
    show('stage');
    const log = await runDrill($('stage'), { cm360, dpi: +f.dpi.value, seed, fovH: FOV_H }, make());
    if (!log.aborted) return log;
    text = 'Aborted. This trial restarts from the beginning with the same targets.';
  }
}

let last: object | undefined;

async function session(quick: boolean) {
  const cm = baseline();
  if (!Number.isFinite(cm) || !form.reportValidity()) return;
  const seed = +f.seed.value;
  const rand = rng(seed);
  const intake = {
    dpi: +f.dpi.value, game: f.game.value, sens: +f.sens.value,
    aimingSens: f.game.value === 'tarkov' && f.aiming.value ? +f.aiming.value : null,
    padCm: f.pad.value ? +f.pad.value : null, seed, baselineCm360: cm,
  };
  const cands = quick ? [{ code: 'BASELINE', cm360: cm }] : candidates(cm, rand);
  const plan: Trial[] = quick
    ? [{ ...cands[0], drill: 'flick' }]
    : schedule(cands, ROUNDS, rand).flatMap((c) => (Object.keys(DRILLS) as DrillName[]).map((drill) => ({ ...c, drill })));

  try {
    show('brief', quick ? 'Quick test' : 'Field trials');
    const warmup = quick ? null : await play('Warm-up · not scored', 'Flick at your current sensitivity',
      '75 s to get your hands going. Nothing here counts.', cm, () => flick(75_000), seed);
    for (const [i, t] of plan.entries()) {
      const d = DRILLS[t.drill];
      t.log = await play(`Trial ${i + 1} of ${plan.length}`, `Candidate ${t.code} · ${d.label}`, d.brief, t.cm360, d.make, seed + i + 1);
    }
    last = { app: 'sensint', version: 1, createdAt: new Date().toISOString(), intake, candidates: cands, warmup, trials: plan };
    report(cands, plan);
  } catch (e) {
    show('form', 'Intake form');
    $('warn').hidden = false;
    $('warn').textContent = `Could not start the trial: ${(e as Error).message}`;
  }
}

function report(cands: Candidate[], plan: Trial[]) {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b) / xs.length : NaN);
  const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  const hits = (l: DrillLog) => l.shots.filter((s) => s.hit).length;
  const rows = [...cands].sort((a, b) => a.cm360 - b.cm360).map((c) => {
    const logs = (d: DrillName) => plan.filter((t) => t.code === c.code && t.drill === d).map((t) => t.log!);
    return `<tr><td>${c.code}</td><td>${fmt(c.cm360)}</td><td>${fmt(mean(logs('flick').map(hits)))}</td>`
      + `<td>${fmt(mean(logs('track').map(onTargetPct)))}</td><td>${fmt(mean(logs('micro').map(hits)))}</td></tr>`;
  });
  const flagged = plan.some((t) => !t.log!.rawInput);
  const dts = plan.flatMap((t) => t.log!.moves.slice(1).map((m, i) => m.t - t.log!.moves[i].t)).sort((a, b) => a - b);
  const hz = 1000 / dts[dts.length >> 1];
  $('summary').innerHTML = `<table><thead><tr><th>Code</th><th>cm/360</th><th>Flick hits</th><th>Track % on</th><th>Micro hits</th></tr></thead>`
    + `<tbody>${rows.join('')}</tbody></table>`
    + `<p class="hint">Mouse report rate recorded: ~${fmt(hz, 0)} Hz via ${plan[0].log!.input.event}</p>`
    + (flagged ? '<p class="warn">Raw input was not available for some trials; those measurements include OS acceleration.</p>' : '');
  show('result', 'Field report');
}

form.addEventListener('submit', (e) => { e.preventDefault(); session(false); });
$('quick').addEventListener('click', () => session(true));
$('again').addEventListener('click', () => show('form', 'Intake form'));
$('export').addEventListener('click', () => {
  if (!last) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last)], { type: 'application/json' }));
  a.download = `sensint-session-${f.seed.value}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
