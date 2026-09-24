// Dossier-style debrief ("subject file"). The card (header, verdict, settings, chart) renders from a
// Summary alone, so a share link shows the same card; the full debrief adds evidence and findings.
import games from '../../data/games.json';
import { analyze, fitQuadratic, median, type MetricKey } from '../analysis/score';
import { aimingForRedDot, gameSensFromCm360 } from '../analysis/sens';
import type { DrillLog } from '../drills/stage';
import type { Session } from '../session';
import type { Summary } from '../share';

type GameId = keyof typeof games;

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (x: number | undefined, d = 1) => (x !== undefined && Number.isFinite(x) ? x.toFixed(d) : '—');
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Renders the full subject file into el; returns its shareable summary. */
export function renderDebrief(s: Session, el: HTMLElement): Summary {
  const game = (s.intake.game in games ? s.intake.game : 'tarkov') as GameId;
  const logs = s.trials.map((t) => t.log).filter((l): l is DrillLog => !!l);
  const { byCode, rec } = analyze(s.trials.filter((t) => t.log).map((t) => ({ ...t, log: t.log! })), games[game].weights);
  const codes = Object.entries(byCode).sort((a, b) => a[1].cm360 - b[1].cm360);

  // Current sensitivity inside the band = the data can't show a change would help, so keep it.
  const ads = s.intake.kind === 'ads';
  const cur = ads ? s.intake.redDotCm360! : s.intake.baselineCm360;
  const keep = !!rec && cur >= rec.lo && cur <= rec.hi;
  const final = rec && (keep ? cur : rec.cm360);
  const sum: Summary = {
    ...(ads && final ? { ads: { hip: s.intake.sens, aiming: aimingForRedDot(final, s.intake.baselineCm360, s.intake.sens, games.tarkov.adsFactor) } } : {}),
    v: 1, name: s.intake.codeName ?? '', game, dpi: s.intake.dpi, date: s.createdAt.slice(0, 10), cur: r1(cur),
    aim: !ads && s.intake.game === 'tarkov' && s.intake.aimingSens && s.intake.sens ? s.intake.aimingSens / s.intake.sens : null,
    rec: rec && { final: r1(final!), peak: r1(rec.cm360), lo: r1(rec.lo), hi: r1(rec.hi), conf: rec.confidence, edge: rec.edge },
    c: codes.map(([code, c]) => [code, r1(c.cm360), Math.round(c.score)]),
  };

  const hz = 1000 / median(logs.flatMap((l) => l.moves.slice(1).map((m, i) => m.t - l.moves[i].t)));
  const raw = logs.every((l) => l.rawInput);
  el.innerHTML = renderCard(sum) + (ads ? '' : padCheck(s.intake.padCm, sum.rec?.final)) + `
    <table><thead><tr><th>Code</th><th>cm/360</th><th>Score</th><th>Flick hits</th><th>Flick time</th><th>Overshoot</th><th>Track on</th><th>Micro fix</th></tr></thead><tbody>
    ${codes.map(([code, c]) => `<tr${sum.rec && r1(c.cm360) === sum.rec.final ? ' class="best"' : ''}><td>${esc(code)}</td><td>${fmt(c.cm360)}</td><td>${fmt(c.score, 0)}</td>
      <td>${fmt(c.m.flickHits)}</td><td>${fmt(c.m.flickTTT, 0)} ms</td><td>${fmt(c.m.flickOvershoot)}%</td>
      <td>${fmt(c.m.trackOn)}%</td><td>${fmt(c.m.microCorr, 0)} ms</td></tr>`).join('')}
    </tbody></table>
    <h3>Findings</h3>
    <ul>${findings(codes).map((f) => `<li>${f}</li>`).join('')}</ul>
    <p class="hint">Data quality: ${raw ? 'raw input on every trial' : '<span class="warn">some trials without raw input</span>'} ·
      ~${fmt(hz, 0)} Hz mouse reports · ${logs.length} trials. Score 50 = your session average.</p>`;
  return sum;
}

/** Header, verdict, settings and score chart: everything a share link carries. */
export function renderCard(s: Summary): string {
  const g = games[s.game as GameId];
  const r = s.rec;
  const keep = !!r && r.final === s.cur;
  const unit = s.ads ? 'red-dot cm/360' : 'cm/360';
  const verdict = r
    ? `<p class="big">${keep ? 'Keep ' : ''}${fmt(r.final)} <small>${unit}</small></p>
       <p>Best range ${fmt(r.lo)}–${fmt(r.hi)} ${unit} · <strong>${esc(r.conf)} confidence</strong> · fitted peak ${fmt(r.peak)} ·
         weighted for ${esc(g.name)}</p>
       <p>${keep
         ? `Current ${fmt(s.cur)} ${unit} is inside the best range: changing would not measurably help.`
         : `Current ${fmt(s.cur)} ${unit} is outside the best range; move to ${fmt(r.final)}.`}</p>
       ${r.edge ? `<p class="warn">The best result was the ${r.edge === 'fast' ? 'fastest' : 'slowest'} candidate tested, so the true optimum
         may lie ${r.edge === 'fast' ? 'faster' : 'slower'} still. A follow-up session centred here would find it.</p>` : ''}
       ${r.conf === 'low' ? '<p class="hint">Low confidence: several sensitivities scored within noise of each other. Another session narrows the range.</p>' : ''}`
    : '<p>Quick test: one candidate only, so there is no recommendation. Run a full session for a verdict.</p>';
  return `
    <div class="dossier-head">
      <p class="kicker">Subject file · ${esc(s.date)} · ${esc(g.name)}${s.ads ? ' · red-dot aiming' : ''}</p>
      <h2>${esc(s.name || 'SUBJECT')}</h2>
    </div>
    <h3>Verdict</h3>${verdict}
    ${s.ads ? adsTable(s.ads) : r ? settingsTable(s.dpi, r.final, s.aim) : ''}
    <h3>Evidence</h3>
    ${chart(s)}`;
}

// The mouse itself takes up pad width: travel room is the pad minus the mouse's footprint.
// ponytail: fixed 6 cm (G Pro Wireless is 6.4 cm wide); make it an intake field if players' mice vary a lot
const MOUSE_WIDTH_CM = 6;

/** Physical check: can a 180° turn fit in one swipe across the pad? */
export function padCheck(padCm: number | null | undefined, cm360: number | undefined) {
  if (!padCm || !cm360) return '';
  const half = cm360 / 2, room = padCm - MOUSE_WIDTH_CM;
  const ok = half <= room;
  return `<h3>Physical check</h3><p${ok ? '' : ' class="warn"'}>A 180° turn needs ${fmt(half)} cm of mouse travel;
    your ${fmt(padCm, 0)} cm pad leaves about ${fmt(room, 0)} cm of room.
    ${ok ? 'It fits in one swipe.' : 'It does not fit in one swipe; you would have to lift the mouse mid-turn.'}</p>`;
}

/** Red-dot session output: only the aiming setting changes; Tarkov scales scopes from it. */
function adsTable(a: { hip: number; aiming: number }) {
  return `<h3>Escape from Tarkov settings</h3><table><tbody>
    <tr><td>Mouse sensitivity</td><td><strong>${fmt(a.hip, 3)}</strong> (unchanged)</td></tr>
    <tr><td>Mouse sensitivity (aiming)</td><td><strong>${fmt(a.aiming, 3)}</strong></td></tr>
    <tr><td>Scope zoom adjustment sensitivity</td><td><strong>1.00</strong> (scopes then scale with magnification)</td></tr>
    </tbody></table>`;
}

function settingsTable(dpi: number, cm: number, aim: number | null) {
  const hip = gameSensFromCm360(cm, dpi, games.tarkov.yaw);
  const rows: [string, string, string][] = [
    ['CS2', 'Sensitivity', fmt(gameSensFromCm360(cm, dpi, games.cs2.yaw), 2)],
    ['Escape from Tarkov', 'Mouse sensitivity', fmt(hip, 3)],
  ];
  // ponytail: keeps the player's current aiming/hip ratio; proper ADS/scope matching is Phase 2
  if (aim !== null) rows.push(['Escape from Tarkov', 'Mouse sensitivity (aiming)', fmt(hip * aim, 3)]);
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

/**
 * Candidate scores vs cm/360 (log axis), the fitted curve, best range and peak. The curve is re-fitted
 * from candidate means, which gives the same quadratic as fitting every round when rounds are equal.
 */
function chart(s: Summary) {
  if (!s.c.length) return '';
  const W = 560, H = 220, L = 36, R = 12, T = 12, B = 34;
  const lx = s.c.map(([, cm]) => Math.log(cm));
  const x0 = Math.min(...lx) - 0.12, x1 = Math.max(...lx) + 0.12;
  const X = (lc: number) => L + ((lc - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / 100) * (H - T - B);
  let curve = '';
  if (s.rec && s.c.length >= 3) {
    const [a, b, c] = fitQuadratic(lx, s.c.map(([, , sc]) => sc));
    const pts = Array.from({ length: 41 }, (_, i) => {
      const lc = x0 + ((x1 - x0) * i) / 40;
      return `${X(lc).toFixed(1)},${Y(Math.max(0, Math.min(100, a * lc * lc + b * lc + c))).toFixed(1)}`;
    });
    const bx0 = X(Math.log(s.rec.lo)), bx1 = X(Math.log(s.rec.hi)), px = X(Math.log(s.rec.peak));
    curve = `<rect x="${bx0}" y="${T}" width="${Math.max(1, bx1 - bx0)}" height="${H - T - B}" class="band"/>
      <polyline points="${pts.join(' ')}" class="fit"/>
      <line x1="${px}" x2="${px}" y1="${T}" y2="${H - B}" class="verdict"/>`;
  }
  const ticks = s.c.map(([code, cm]) =>
    `<text x="${X(Math.log(cm))}" y="${H - B + 14}" text-anchor="middle">${fmt(cm)}</text>
     <text x="${X(Math.log(cm))}" y="${H - B + 27}" text-anchor="middle" class="code">${esc(code)}</text>`).join('');
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/>
    <text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const dots = s.c.map(([, cm, sc]) => `<circle cx="${X(Math.log(cm))}" cy="${Y(sc)}" r="4"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score by sensitivity">${grid}${curve}${dots}${ticks}</svg>
    <p class="hint">Score by cm/360 (log scale), 50 = the subject's session average. Dots are candidates, the line is the fitted curve,
      the shaded area is the best range, the dashed line is the fitted peak.</p>`;
}
