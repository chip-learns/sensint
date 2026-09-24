// Warm-up mode: a fixed routine at your own settings, with results compared to your earlier warm-ups.
import games from '../../data/games.json';
import type { MetricKey } from '../analysis/score';
import { DRILLS } from '../drills';
import type { DrillName } from '../drills/stage';

type GameId = keyof typeof games;

export type Step = { key: string; drill: DrillName; cm360: number; fovH: number; reddot: boolean; label: string };

export type WarmupEntry = {
  id: string; date: string; game: string; minutes: number;
  hipCm: number; redCm: number | null; // the settings it ran at, cm/360
  results: Record<string, number>; // step key → that drill's headline metric
};

/**
 * Hip fire block, then (Tarkov with an aiming sensitivity) red dot and 4× scope, each at the
 * turn speed it has in game. The scope drill applies its own 4× on top of the red-dot speed.
 */
export function routine(game: string, hipCm: number, redCm: number | null, fovHip: number, fovAds: number): Step[] {
  const steps: Step[] = (['flick', 'micro', 'track', 'turn'] as const).map((d) => (
    { key: `hip:${d}`, drill: d, cm360: hipCm, fovH: fovHip, reddot: false, label: `Hip · ${DRILLS[d].label}` }));
  if (game === 'tarkov' && redCm) steps.push(
    { key: 'ads:door', drill: 'door', cm360: redCm, fovH: fovAds, reddot: true, label: 'Red dot · Door watch' },
    { key: 'ads:flick', drill: 'flick', cm360: redCm, fovH: fovAds, reddot: true, label: 'Red dot · Flick' },
    { key: 'scope:scope', drill: 'scope', cm360: redCm, fovH: fovAds, reddot: false, label: '4× scope · Long-range scope' },
  );
  return steps;
}

/** Seconds per drill so the routine fills `minutes`, after ~15 s for the start card and a countdown per drill. */
export const stepSeconds = (minutes: number, steps: number, countdownS: number) =>
  Math.max(10, Math.round((minutes * 60 - 15 - steps * countdownS) / steps));

/** The one number per drill that warm-ups are compared on; sign +1 = higher is better. */
export const HEADLINE: Record<DrillName, [MetricKey, string, string, number, 1 | -1]> = {
  flick: ['flickTTT', 'time to hit', ' ms', 0, -1],
  micro: ['microCorr', 'nudge fix', ' ms', 0, -1],
  track: ['trackOn', 'on target', '%', 0, 1],
  turn: ['turnTTT', 'time to hit', ' ms', 0, -1],
  door: ['doorHit', 'peeks caught', '%', 0, 1],
  scope: ['scopeOn', 'on target', '%', 0, 1],
};

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (x: number | undefined, d = 0) => (x !== undefined && Number.isFinite(x) ? x.toFixed(d) : '—');

/** Same game and the same turn speeds (within 0.3 cm/360): results are directly comparable. */
export const sameSettings = (a: WarmupEntry, b: WarmupEntry) =>
  a.game === b.game && Math.abs(a.hipCm - b.hipCm) < 0.3
  && (a.redCm === null ? b.redCm === null : b.redCm !== null && Math.abs(a.redCm - b.redCm) < 0.3);

export function renderWarmup(entry: WarmupEntry, all: WarmupEntry[]) {
  const prev = all.filter((e) => e.id !== entry.id && sameSettings(e, entry) && e.id < entry.id);
  const rows = Object.entries(entry.results).map(([key, today]) => {
    const drill = key.split(':')[1] as DrillName;
    const [, what, unit, d, sign] = HEADLINE[drill];
    const label = { hip: 'Hip', ads: 'Red dot', scope: '4× scope' }[key.split(':')[0]] ?? '';
    const last5 = prev.slice(-5).map((e) => e.results[key]).filter(Number.isFinite);
    const avg = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : NaN;
    const delta = today - avg;
    const verdict = !Number.isFinite(delta) ? '' : Math.abs(delta) < 0.02 * Math.abs(avg) ? 'same' : sign * delta > 0 ? 'better' : 'worse';
    const trend = [...prev.slice(-19).map((e) => e.results[key]), today].filter(Number.isFinite);
    return `<tr><td>${label} · ${DRILLS[drill].label}</td><td>${what}</td><td><strong>${fmt(today, d)}${unit}</strong></td>
      <td>${Number.isFinite(avg) ? `${fmt(avg, d)}${unit}` : '—'}</td><td class="${verdict}">${verdict}</td><td>${spark(trend, sign)}</td></tr>`;
  });
  const g = games[entry.game as GameId]?.name ?? entry.game;
  return `<div class="dossier-head"><p class="kicker">Warm-up · ${esc(entry.date)} · ${esc(g)} · ${entry.minutes} min</p>
      <h2>Pre-raid warm-up</h2></div>
    <p>Hip ${fmt(entry.hipCm, 1)} cm/360${entry.redCm ? ` · red dot ${fmt(entry.redCm, 1)} cm/360` : ''}</p>
    <table><thead><tr><th>Drill</th><th>Measure</th><th>Today</th><th>Last 5</th><th></th><th>Trend</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>
    <p class="hint">${prev.length ? `Compared with your ${Math.min(prev.length, 5)} previous warm-ups at these settings.` : 'Your first warm-up at these settings; later ones will be compared here.'}
      Trend lines rise when you improve. Warm-ups never change your sensitivity verdicts.</p>`;
}

/** Tiny line of the last values; flipped for lower-is-better metrics so up always means better. */
function spark(vals: number[], sign: 1 | -1) {
  if (vals.length < 2) return '';
  const w = 120, h = 28, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [2 + (i / (vals.length - 1)) * (w - 4), 2 + (1 - (sign > 0 ? v - lo : hi - v) / span) * (h - 4)]);
  const [lx, ly] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="trend">
    <polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/></svg>`;
}
