// Dossier-style debrief ("subject file") rendered from a finished or loaded session.
import games from '../../data/games.json';
import { analyze, median, type MetricKey, type Point, type Recommendation } from '../analysis/score';
import { gameSensFromCm360 } from '../analysis/sens';
import type { DrillLog } from '../drills/stage';
import type { Session } from '../session';

type GameId = keyof typeof games;

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (x: number | undefined, d = 1) => (x !== undefined && Number.isFinite(x) ? x.toFixed(d) : '—');

/** Renders the subject file into el; returns the recommendation (null for single-candidate runs). */
export function renderDebrief(s: Session, el: HTMLElement): Recommendation | null {
  const game = (s.intake.game in games ? s.intake.game : 'tarkov') as GameId;
  const logs = s.trials.map((t) => t.log).filter((l): l is DrillLog => !!l);
  const { points, byCode, rec } = analyze(
    s.trials.filter((t) => t.log).map((t) => ({ ...t, log: t.log! })),
    games[game].weights,
  );
  const codes = Object.entries(byCode).sort((a, b) => a[1].cm360 - b[1].cm360);

  // Current sensitivity inside the band = the data can't show a change would help, so keep it.
  const cur = s.intake.baselineCm360;
  const keep = !!rec && cur >= rec.lo && cur <= rec.hi;
  const final = keep ? cur : rec?.cm360;
  const verdict = rec
    ? `<p class="big">${keep ? 'Keep ' : ''}${fmt(final)} <small>cm/360</small></p>
       <p>Best range ${fmt(rec.lo)}–${fmt(rec.hi)} cm/360 · <strong>${rec.confidence} confidence</strong> · fitted peak ${fmt(rec.cm360)} ·
         weighted for ${esc(games[game].name)}</p>
       <p>${keep
         ? `Your current ${fmt(cur)} cm/360 is inside the best range: changing would not measurably help.`
         : `Your current ${fmt(cur)} cm/360 is outside the best range; move to ${fmt(final)}.`}</p>
       ${rec.edge ? `<p class="warn">Your best result was the ${rec.edge === 'fast' ? 'fastest' : 'slowest'} candidate tested, so the true optimum
         may lie ${rec.edge === 'fast' ? 'faster' : 'slower'} still. Run a follow-up session centred here to find it.</p>` : ''}
       ${rec.confidence === 'low' ? '<p class="hint">Low confidence: several sensitivities scored within noise of each other. Another session narrows the range.</p>' : ''}`
    : '<p>Quick test: one candidate only, so there is no recommendation. Run a full session for a verdict.</p>';

  const settings = final !== undefined ? settingsTable(s, final) : '';

  const hz = 1000 / median(logs.flatMap((l) => l.moves.slice(1).map((m, i) => m.t - l.moves[i].t)));
  const raw = logs.every((l) => l.rawInput);

  el.innerHTML = `
    <div class="dossier-head">
      <p class="kicker">Subject file · Case ${esc(s.intake.seed)} · ${esc(new Date(s.createdAt).toLocaleDateString())}</p>
      <h2>${esc(s.intake.codeName || 'SUBJECT')}</h2>
    </div>
    <h3>Verdict</h3>${verdict}
    ${settings}
    <h3>Evidence</h3>
    ${chart(points, rec)}
    <table><thead><tr><th>Code</th><th>cm/360</th><th>Score</th><th>Flick hits</th><th>Flick time</th><th>Overshoot</th><th>Track on</th><th>Micro fix</th></tr></thead><tbody>
    ${codes.map(([code, c]) => `<tr${rec && Math.abs(c.cm360 - rec.cm360) < 0.05 ? ' class="best"' : ''}><td>${esc(code)}</td><td>${fmt(c.cm360)}</td><td>${fmt(c.score, 0)}</td>
      <td>${fmt(c.m.flickHits)}</td><td>${fmt(c.m.flickTTT, 0)} ms</td><td>${fmt(c.m.flickOvershoot)}%</td>
      <td>${fmt(c.m.trackOn)}%</td><td>${fmt(c.m.microCorr, 0)} ms</td></tr>`).join('')}
    </tbody></table>
    <h3>Findings</h3>
    <ul>${findings(codes).map((f) => `<li>${f}</li>`).join('')}</ul>
    <p class="hint">Data quality: ${raw ? 'raw input on every trial' : '<span class="warn">some trials without raw input</span>'} ·
      ~${fmt(hz, 0)} Hz mouse reports · ${logs.length} trials. Score 50 = your session average.</p>`;
  return rec;
}

function settingsTable(s: Session, cm: number) {
  const dpi = s.intake.dpi;
  const rows: [string, string, string][] = [
    ['CS2', 'Sensitivity', fmt(gameSensFromCm360(cm, dpi, games.cs2.yaw), 2)],
    ['Escape from Tarkov', 'Mouse sensitivity', fmt(gameSensFromCm360(cm, dpi, games.tarkov.yaw), 3)],
  ];
  if (s.intake.game === 'tarkov' && s.intake.aimingSens && s.intake.sens) {
    // ponytail: keeps the player's current aiming/hip ratio; proper ADS/scope matching is Phase 2
    const hip = gameSensFromCm360(cm, dpi, games.tarkov.yaw);
    rows.push(['Escape from Tarkov', 'Mouse sensitivity (aiming)', fmt((hip * s.intake.aimingSens) / s.intake.sens, 3)]);
  }
  rows.push(['Wardogs', 'Sensitivity', 'needs calibration (Phase 2)']);
  return `<h3>Settings at ${esc(dpi)} DPI</h3><table><tbody>${rows
    .map(([g, k, v]) => `<tr><td>${g}</td><td>${k}</td><td><strong>${v}</strong></td></tr>`).join('')}</tbody></table>`;
}

/** Plain-language findings, each tied to a metric, comparing best and worst candidates. */
function findings(codes: [string, { cm360: number; m: Partial<Record<MetricKey, number>> }][]) {
  if (codes.length < 2) return ['Only one candidate was tested.'];
  const out: string[] = [];
  const line = (k: MetricKey, label: string, higherBetter: boolean, unit: string, d: number) => {
    const has = codes.filter(([, c]) => Number.isFinite(c.m[k]));
    if (has.length < 2) return;
    const sorted = [...has].sort((a, b) => (a[1].m[k]! - b[1].m[k]!) * (higherBetter ? -1 : 1));
    const [bc, b] = sorted[0], [wc, w] = sorted[sorted.length - 1];
    out.push(`${label}: best at ${esc(bc)} (${fmt(b.cm360)} cm) with ${fmt(b.m[k], d)}${unit}, worst at ${esc(wc)} (${fmt(w.cm360)} cm) with ${fmt(w.m[k], d)}${unit}.`);
  };
  line('flickTTT', 'Flick speed', false, ' ms median', 0);
  line('flickOvershoot', 'Overshoot', false, '% past the target', 1);
  line('trackOn', 'Tracking', true, '% on target', 0);
  line('microCorr', 'Micro-corrections', false, ' ms to fix a nudge', 0);
  return out;
}

/** Score vs cm/360 (log axis): each candidate repeat as a dot, the fitted curve, the verdict line. */
function chart(points: Point[], rec: Recommendation | null) {
  if (!points.length) return '';
  const W = 560, H = 220, L = 36, R = 12, T = 12, B = 34;
  const lx = points.map((p) => Math.log(p.cm360));
  const x0 = Math.min(...lx) - 0.12, x1 = Math.max(...lx) + 0.12;
  const X = (lc: number) => L + ((lc - x0) / (x1 - x0)) * (W - L - R);
  const Y = (s: number) => T + (1 - s / 100) * (H - T - B);
  let curve = '';
  if (rec) {
    const [a, b, c] = rec.coef;
    const pts = Array.from({ length: 41 }, (_, i) => {
      const lc = x0 + ((x1 - x0) * i) / 40;
      return `${X(lc).toFixed(1)},${Y(Math.max(0, Math.min(100, a * lc * lc + b * lc + c))).toFixed(1)}`;
    });
    const bx0 = X(Math.log(rec.lo)), bx1 = X(Math.log(rec.hi));
    curve = `<rect x="${bx0}" y="${T}" width="${Math.max(1, bx1 - bx0)}" height="${H - T - B}" class="band"/>
      <polyline points="${pts.join(' ')}" class="fit"/>
      <line x1="${X(Math.log(rec.cm360))}" x2="${X(Math.log(rec.cm360))}" y1="${T}" y2="${H - B}" class="verdict"/>`;
  }
  const ticks = [...new Map(points.map((p) => [p.code, p])).values()].map((p) =>
    `<text x="${X(Math.log(p.cm360))}" y="${H - B + 14}" text-anchor="middle">${fmt(p.cm360)}</text>
     <text x="${X(Math.log(p.cm360))}" y="${H - B + 27}" text-anchor="middle" class="code">${esc(p.code)}</text>`).join('');
  const grid = [0, 50, 100].map((s) => `<line x1="${L}" x2="${W - R}" y1="${Y(s)}" y2="${Y(s)}" class="grid"/>
    <text x="${L - 6}" y="${Y(s) + 4}" text-anchor="end">${s}</text>`).join('');
  const dots = points.map((p) => `<circle cx="${X(Math.log(p.cm360))}" cy="${Y(p.score)}" r="4"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score by sensitivity">${grid}${curve}${dots}${ticks}</svg>
    <p class="hint">Score by cm/360 (log scale). Dots are single rounds, the line is the fitted curve, the shaded area is the best range, the dashed line is the fitted peak.</p>`;
}
