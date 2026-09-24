// "My file": current settings from your latest verdicts, warm-up progress, and all saved sessions.
import games from '../../data/games.json';
import { aimingForRedDot, cm360FromGame, gameSensFromCm360 } from '../analysis/sens';
import { loadHistory, loadWarmups } from '../history';
import { renderHistory, type HistoryEntry } from './debrief';
import { renderWarmup } from './warmup';

type GameId = keyof typeof games;
const K = games.tarkov.adsFactor;
const fmt = (x: number, d: number) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export type Settings = {
  hip?: { cm: number; sens: number; entry?: HistoryEntry }; // entry absent = your current setting, no verdict yet
  ads?: { cm: number; aiming: number; entry: HistoryEntry };
};

/**
 * In-game settings from your latest verdicts for a game, at `dpi`. Hip comes from the latest hip
 * verdict (or `currentSens` if there is none); Tarkov aiming is set so the red dot moves at the
 * latest red-dot verdict for that hip setting. Null when there's no verdict of either kind.
 */
export function latestSettings(game: string, dpi: number, currentSens: number, entries = loadHistory()): Settings | null {
  const yaw = games[game as GameId]?.yaw;
  if (!yaw || !(dpi > 0)) return null;
  const mine = entries.filter((e) => e.game === game && e.rec);
  const hipE = mine.filter((e) => e.kind === 'hip').at(-1);
  const adsE = game === 'tarkov' ? mine.filter((e) => e.kind === 'ads').at(-1) : undefined;
  if (!hipE && !adsE) return null;
  const hip = hipE
    ? { cm: hipE.rec!.final, sens: gameSensFromCm360(hipE.rec!.final, dpi, yaw), entry: hipE }
    : currentSens > 0 ? { cm: cm360FromGame(dpi, currentSens, yaw), sens: currentSens } : undefined;
  const ads = adsE && hip ? { cm: adsE.rec!.final, aiming: aimingForRedDot(adsE.rec!.final, hip.cm, hip.sens, K), entry: adsE } : undefined;
  return { hip, ads };
}

/** One line for the intake form, or '' when there is nothing to say. */
export function summaryLine(game: string, dpi: number, currentSens: number) {
  const s = latestSettings(game, dpi, currentSens);
  if (!s || (!s.hip?.entry && !s.ads)) return '';
  const parts = [s.hip?.entry && `sensitivity ${fmt(s.hip.sens, 3)}`, s.ads && `aiming ${fmt(s.ads.aiming, 3)}`].filter(Boolean);
  return `Your settings (latest verdicts, ${dpi} DPI): ${games[game as GameId].name} ${parts.join(' · ')}`;
}

const source = (e: HistoryEntry | undefined, unit: string) => e?.rec
  ? `${fmt(e.rec.final, 1)} ${unit} · range ${fmt(e.rec.lo, 1)}–${fmt(e.rec.hi, 1)} · ${e.rec.conf} confidence · ${e.date}`
  : 'your current setting (no verdict yet)';

export function renderFile(dpi: number, currentSens: number) {
  const entries = loadHistory();
  const rows: string[] = [];
  for (const id of Object.keys(games) as GameId[]) {
    const s = latestSettings(id, dpi, id === 'tarkov' ? currentSens : 0, entries);
    if (!s) continue;
    const name = games[id].name;
    if (s.hip?.entry) rows.push(`<tr><td>${name}</td><td>${id === 'tarkov' ? 'Mouse sensitivity' : 'Sensitivity'}</td><td><strong>${fmt(s.hip.sens, 3)}</strong></td><td>${source(s.hip.entry, 'cm/360')}</td></tr>`);
    if (s.ads) rows.push(
      `<tr><td>${name}</td><td>Mouse sensitivity (aiming)</td><td><strong>${fmt(s.ads.aiming, 3)}</strong></td><td>${source(s.ads.entry, 'red-dot cm/360')}${s.hip?.entry ? '' : ` · at your current hip ${fmt(s.hip!.sens, 3)}`}</td></tr>`,
      `<tr><td>${name}</td><td>Scope zoom adjustment sensitivity</td><td><strong>1.00</strong></td><td>scopes then scale with magnification</td></tr>`,
    );
  }
  // Same feel in CS2 as your Tarkov hip verdict, if CS2 has no verdict of its own.
  const tk = latestSettings('tarkov', dpi, 0, entries);
  if (tk?.hip?.entry && !latestSettings('cs2', dpi, 0, entries)) rows.push(
    `<tr><td>CS2</td><td>Sensitivity</td><td><strong>${fmt(gameSensFromCm360(tk.hip.cm, dpi, games.cs2.yaw), 2)}</strong></td><td>same ${fmt(tk.hip.cm, 1)} cm/360 as your Tarkov hip verdict</td></tr>`);

  const warmups = loadWarmups();
  const latest = warmups.at(-1);
  return `<div class="dossier-head"><p class="kicker">Subject file · all sessions saved in this browser</p><h2>My file</h2></div>
    <h3>Current settings</h3>
    ${rows.length ? `<table><tbody>${rows.join('')}</tbody></table>
      <p class="hint">At ${dpi} DPI, from your latest verdict of each kind. Open a session below for its evidence.</p>`
      : '<p class="hint">No verdicts yet. Run a hip or red-dot session, or open saved sessions, and your settings will appear here.</p>'}
    <h3>Warm-up progress</h3>
    ${latest ? renderWarmup(latest, warmups, true) : '<p class="hint">No warm-ups yet. Pick "Warm-up at my settings" as the session type.</p>'}
    ${renderHistory(entries, '')}`;
}
