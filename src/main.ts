import games from '../data/games.json';
import { rng } from './analysis/aim';
import { adsFovH, aimingForRedDot, cm360FromGame, gameSensFromCm360, redDotCm360 } from './analysis/sens';
import { DRILLS, flick } from './drills';
import { runDrill, type Drill, type DrillName } from './drills/stage';
import { candidates, schedule, type Intake, type Session, type Trial } from './session';
import { decode, encode, type Summary } from './share';
import { saveToHistory } from './history';
import { renderCard, renderDebrief, renderHistory } from './ui/debrief';

type GameId = keyof typeof games;

// ponytail: fixed CS2 hip FOV (106.26° at 16:9); per-game FOV matching lands in Phase 2
const FOV_H = 106.26;
const K = games.tarkov.adsFactor;
const COUNTDOWN_MS = 2000; // between back-to-back trials
const WARMUP_S = 30;

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
  const red = redDot(cm);
  $('reddot-row').hidden = f.kind.value !== 'ads';
  f.reddot.value = Number.isFinite(red) ? red.toFixed(1) : '— (needs Tarkov + aiming sensitivity)';
  // warm-up + per round 5 candidates × (the preset's drills + the countdown before each),
  // + ~10 s for each drill type's first card
  const drills = preset();
  const perCandidate = drills.reduce((s, d) => s + DRILLS[d].seconds + COUNTDOWN_MS / 1000, 0);
  const secs = WARMUP_S + drills.length * 10 + +f.rounds.value * 5 * perCandidate;
  $('begin').textContent = `Begin session (~${Math.round(secs / 60)} min)`;
  $('preset').textContent = drills.map((d) => DRILLS[d].label).join(' · ');
  return cm;
};
/** Drills the chosen game and session type run (games.json presets). */
function preset(): DrillName[] {
  const p: Record<string, string[] | undefined> = games[f.game.value as GameId].presets;
  return (p[f.kind.value] ?? p.hip!) as DrillName[];
}

/** Current Tarkov red-dot cm/360 from the intake, or NaN if it can't be known. */
function redDot(hipCm: number) {
  return f.game.value === 'tarkov' && +f.aiming.value > 0 ? redDotCm360(hipCm, +f.sens.value, +f.aiming.value, K) : NaN;
}
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


/** "Next: …" overlay while still locked. Resolves false if the player pressed Esc during it. */
const countdown = (label: string) =>
  new Promise<boolean>((resolve) => {
    const el = $('next');
    const end = performance.now() + COUNTDOWN_MS;
    el.hidden = false;
    const tick = () => {
      if (!document.pointerLockElement) { el.hidden = true; return resolve(false); }
      const left = Math.ceil((end - performance.now()) / 1000);
      if (left <= 0) { el.hidden = true; return resolve(true); }
      el.textContent = `Next: ${label} · ${left}`;
      requestAnimationFrame(tick);
    };
    tick();
  });

/**
 * Run one trial and re-run it on Esc until a clean log comes back. While the pointer stays locked,
 * trials run back to back after a short countdown; a card (and a click) only appears the first time
 * a drill type shows up, or after Esc.
 */
async function play(kicker: string, title: string, text: string, cm360: number, make: () => Drill, seed: number, fovH: number, needBrief: boolean) {
  for (;;) {
    if (needBrief && document.pointerLockElement) {
      // Exiting is asynchronous; wait for it so the card (not the countdown) shows.
      await new Promise((r) => { document.addEventListener('pointerlockchange', r, { once: true }); document.exitPointerLock(); });
    }
    if (!document.pointerLockElement) { await brief(kicker, title, text); show('stage'); }
    else if (!(await countdown(title))) { text = 'Paused. Click Start to carry on; this trial restarts from the beginning.'; needBrief = true; continue; }
    const log = await runDrill($('stage'), { cm360, dpi: +f.dpi.value, seed, fovH }, make());
    if (!log.aborted) return log;
    text = 'Paused. Click Start to carry on; this trial restarts from the beginning with the same targets.';
    needBrief = true;
  }
}

let last: Session | undefined;

async function session(quick: boolean) {
  const cm = baseline();
  if (!Number.isFinite(cm) || !form.reportValidity()) return;
  // Red-dot session: candidates are red-dot turn speeds, played zoomed with a red-dot reticle.
  const ads = !quick && f.kind.value === 'ads';
  const red = redDot(cm);
  if (ads && !Number.isFinite(red)) {
    $('warn').hidden = false;
    $('warn').textContent = 'A red-dot session needs Escape from Tarkov with your aiming sensitivity filled in.';
    return;
  }
  const base = ads ? red : cm;
  const fovH = ads ? adsFovH(FOV_H, K) : FOV_H;
  $('crosshair').classList.toggle('reddot', ads);
  const seed = +f.seed.value;
  const rand = rng(seed);
  const intake: Intake = {
    ...(ads ? { kind: 'ads' as const, redDotCm360: red } : {}),
    dpi: +f.dpi.value, game: f.game.value, sens: +f.sens.value,
    aimingSens: f.game.value === 'tarkov' && f.aiming.value ? +f.aiming.value : null,
    padCm: f.pad.value ? +f.pad.value : null, seed, baselineCm360: cm,
    codeName: f.codename.value.trim().slice(0, 24) || undefined,
    rounds: quick ? 1 : +f.rounds.value,
  };
  const cands = quick ? [{ code: 'BASELINE', cm360: cm }] : candidates(base, rand);
  const plan: Trial[] = quick
    ? [{ ...cands[0], drill: 'flick' }]
    : schedule(cands, intake.rounds!, rand).flatMap((c) => preset().map((drill) => ({ ...c, drill })));

  try {
    show('brief', quick ? 'Quick test' : ads ? 'Red-dot trials' : 'Field trials');
    const warmup = quick ? null : await play('Warm-up · not scored', `Flick at your current ${ads ? 'red-dot ' : ''}sensitivity`,
      `${WARMUP_S} s to get your hands going. Nothing here counts. After this, trials run back to back with a short countdown; `
        + `each new drill type gets its own card first. Press Esc any time to pause.${ads ? ' You are aiming down a red dot for the whole session.' : ''}`,
      base, () => flick(WARMUP_S * 1000), seed, fovH, true);
    const seen = new Set<DrillName>();
    for (const [i, t] of plan.entries()) {
      const d = DRILLS[t.drill];
      t.log = await play(`Trial ${i + 1} of ${plan.length}`, `Candidate ${t.code} · ${d.label}${ads ? ' · red dot' : ''}`, d.brief,
        t.cm360, d.make, seed + i + 1, fovH, !seen.has(t.drill));
      seen.add(t.drill);
    }
    document.exitPointerLock();
    debrief({ app: 'sensint', version: 1, createdAt: new Date().toISOString(), intake, candidates: cands, warmup, trials: plan });
  } catch (e) {
    document.exitPointerLock();
    show('form', 'Intake form');
    $('warn').hidden = false;
    $('warn').textContent = `Could not start the trial: ${(e as Error).message}`;
  }
}

let summary: Summary | undefined;

/** Own session: full debrief with export, follow-up and share. */
function debrief(s: Session) {
  last = s;
  const { sum, stats } = renderDebrief(s, $('debrief'));
  summary = sum;
  // id sorts by time: createdAt first, seed to separate same-second sessions
  const id = `${s.createdAt}#${s.intake.seed}`;
  const history = saveToHistory({ id, date: sum.date, game: sum.game, kind: s.intake.kind ?? 'hip', rec: sum.rec, cur: sum.cur, stats });
  $('debrief').insertAdjacentHTML('beforeend', renderHistory(history.slice(-10), id));
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
  f.kind.value = s.intake.kind ?? 'hip';
  if (s.intake.kind === 'ads') {
    // Red-dot follow-up: hip stays; aiming moves so the red dot sits at the peak.
    f.sens.value = String(s.intake.sens);
    f.aiming.value = aimingForRedDot(followUp, s.intake.baselineCm360, s.intake.sens, K).toFixed(3);
  } else {
    const sens = gameSensFromCm360(followUp, s.intake.dpi, g.yaw);
    f.sens.value = sens.toFixed(3);
    // Aiming keeps its ratio to hip so the debrief can still convert it.
    f.aiming.value = s.intake.aimingSens && s.intake.sens ? ((sens * s.intake.aimingSens) / s.intake.sens).toFixed(3) : '';
  }
  f.pad.value = s.intake.padCm ? String(s.intake.padCm) : '';
  f.codename.value = s.intake.codeName ?? '';
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
