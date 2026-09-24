import games from '../data/games.json';
import { rng } from './analysis/aim';
import { cm360FromGame, gameSensFromCm360 } from './analysis/sens';
import { DRILLS, flick } from './drills';
import { runDrill, type Drill, type DrillName } from './drills/stage';
import { candidates, schedule, type Intake, type Session, type Trial } from './session';
import { decode, encode, type Summary } from './share';
import { renderCard, renderDebrief } from './ui/debrief';

type GameId = keyof typeof games;

// ponytail: fixed CS2 hip FOV (106.26° at 16:9); per-game FOV matching lands in Phase 2
const FOV_H = 106.26;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const f = form.elements as unknown as Record<string, HTMLInputElement & HTMLOutputElement & HTMLSelectElement>;

for (const [id, g] of Object.entries(games)) {
  f.game.add(new Option(g.yaw ? g.name : `${g.name} (needs calibration)`, id, false, id === 'tarkov'));
  if (!g.yaw) f.game.options[f.game.length - 1].disabled = true;
}
const newSeed = () => (f.seed.value = String(Math.floor(Math.random() * 1e6)));
newSeed();

const baseline = () => {
  const g = games[f.game.value as GameId];
  const cm = g.yaw ? cm360FromGame(+f.dpi.value, +f.sens.value, g.yaw) : NaN;
  f.cm360.value = Number.isFinite(cm) ? cm.toFixed(1) : '—';
  $('warn').hidden = g.verified;
  $('warn').textContent = `${g.name} conversion constant is unverified; treat cm/360 as approximate.`;
  $('aiming-row').hidden = f.game.value !== 'tarkov';
  // 75 s warm-up + per round 5 candidates × (75 s of drills + ~10 s of briefings)
  $('begin').textContent = `Begin session (~${Math.round((75 + +f.rounds.value * 5 * 85) / 60)} min)`;
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

let last: Session | undefined;

async function session(quick: boolean) {
  const cm = baseline();
  if (!Number.isFinite(cm) || !form.reportValidity()) return;
  const seed = +f.seed.value;
  const rand = rng(seed);
  const intake: Intake = {
    dpi: +f.dpi.value, game: f.game.value, sens: +f.sens.value,
    aimingSens: f.game.value === 'tarkov' && f.aiming.value ? +f.aiming.value : null,
    padCm: f.pad.value ? +f.pad.value : null, seed, baselineCm360: cm,
    codeName: f.codename.value.trim().slice(0, 24) || undefined,
    rounds: quick ? 1 : +f.rounds.value,
  };
  const cands = quick ? [{ code: 'BASELINE', cm360: cm }] : candidates(cm, rand);
  const plan: Trial[] = quick
    ? [{ ...cands[0], drill: 'flick' }]
    : schedule(cands, intake.rounds!, rand).flatMap((c) => (Object.keys(DRILLS) as DrillName[]).map((drill) => ({ ...c, drill })));

  try {
    show('brief', quick ? 'Quick test' : 'Field trials');
    const warmup = quick ? null : await play('Warm-up · not scored', 'Flick at your current sensitivity',
      '75 s to get your hands going. Nothing here counts.', cm, () => flick(75_000), seed);
    for (const [i, t] of plan.entries()) {
      const d = DRILLS[t.drill];
      t.log = await play(`Trial ${i + 1} of ${plan.length}`, `Candidate ${t.code} · ${d.label}`, d.brief, t.cm360, d.make, seed + i + 1);
    }
    debrief({ app: 'sensint', version: 1, createdAt: new Date().toISOString(), intake, candidates: cands, warmup, trials: plan });
  } catch (e) {
    show('form', 'Intake form');
    $('warn').hidden = false;
    $('warn').textContent = `Could not start the trial: ${(e as Error).message}`;
  }
}

let summary: Summary | undefined;

/** Own session: full debrief with export, follow-up and share. */
function debrief(s: Session) {
  last = s;
  summary = renderDebrief(s, $('debrief'));
  $('follow').hidden = !summary.rec;
  for (const id of ['export', 'share']) $(id).hidden = false;
  $('share-out').hidden = true;
  $('again').textContent = 'New session';
  show('result', 'Debrief');
}

/** Someone's share link: the card only. */
async function openLink() {
  const code = location.hash.match(/^#c=(.+)$/)?.[1];
  if (!code) return;
  try {
    $('debrief').innerHTML = renderCard(await decode(code));
    for (const id of ['export', 'follow', 'share', 'share-out']) $(id).hidden = true;
    $('again').textContent = 'Run your own session';
    show('result', 'Shared subject file');
  } catch (e) {
    $('warn').hidden = false;
    $('warn').textContent = `Could not read that share link (${(e as Error).message}).`;
  }
}
addEventListener('hashchange', openLink);
openLink();

form.addEventListener('submit', (e) => { e.preventDefault(); session(false); });
$('quick').addEventListener('click', () => session(true));
$('again').addEventListener('click', () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  newSeed();
  show('form', 'Intake form');
});

$('share').addEventListener('click', async () => {
  if (!summary) return;
  const url = `${location.origin}${location.pathname}#c=${await encode(summary)}`;
  const out = $<HTMLInputElement>('share-out');
  out.value = url;
  out.hidden = false;
  out.select();
  try { await navigator.clipboard.writeText(url); $('share').textContent = 'Link copied'; }
  catch { $('share').textContent = 'Copy the link below'; }
  setTimeout(() => ($('share').textContent = 'Copy share link'), 2500);
});

// Centre a new session on the verdict: set the in-game sensitivity that equals it.
$('follow').addEventListener('click', () => {
  const s = last!, g = games[s.intake.game as GameId];
  const followUp = summary?.rec?.peak ?? null;
  if (followUp === null || !g?.yaw) return;
  f.dpi.value = String(s.intake.dpi);
  f.game.value = s.intake.game;
  f.sens.value = gameSensFromCm360(followUp, s.intake.dpi, g.yaw).toFixed(3);
  newSeed();
  baseline();
  show('form', 'Intake form');
});

$('export').addEventListener('click', () => {
  if (!last) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last)], { type: 'application/json' }));
  a.download = `sensint-session-${last.intake.seed}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$<HTMLInputElement>('open').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    const s = JSON.parse(await file.text()) as Session;
    if (s?.app !== 'sensint' || !Array.isArray(s.trials)) throw new Error('not a SENSINT session file');
    debrief(s);
  } catch (err) {
    $('warn').hidden = false;
    $('warn').textContent = `Could not open that file: ${(err as Error).message}`;
  }
});
