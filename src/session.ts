// Blind candidate scheduling: sensitivities get code names and a shuffled, repeated order.
export const CODE_NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];
// Roughly geometric spread around the baseline, per the design doc (0.6× to 1.6×).
export const MULTIPLIERS = [0.6, 0.77, 1, 1.27, 1.6];

import type { DrillLog, DrillName } from './drills/stage';

export type Candidate = { code: string; cm360: number };
export type Trial = Candidate & { drill: DrillName; log?: DrillLog };
export type Intake = {
  dpi: number; game: string; sens: number; aimingSens: number | null;
  padCm: number | null; seed: number; baselineCm360: number; codeName?: string;
  rounds?: number; // absent in sessions recorded before it was configurable (they used 2)
  kind?: 'ads'; // red-dot aiming session (Tarkov); absent = hip sensitivity
  redDotCm360?: number; // ads only: current red-dot cm/360, the candidates' baseline
};
export type Session = {
  app: 'sensint'; version: 1; createdAt: string; intake: Intake;
  candidates: Candidate[]; warmup: DrillLog | null; trials: Trial[];
};

export function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Code names are assigned after shuffling, so ALPHA isn't always the slowest. */
export const candidates = (baseline: number, rand: () => number): Candidate[] =>
  shuffle(MULTIPLIERS, rand).map((m, i) => ({ code: CODE_NAMES[i], cm360: baseline * m }));

/** Each candidate once per round, rounds shuffled independently, never the same one twice in a row. */
export function schedule(cands: Candidate[], rounds: number, rand: () => number): Candidate[] {
  const out: Candidate[] = [];
  for (let r = 0; r < rounds; r++) {
    let round = shuffle(cands, rand);
    if (out.length && round[0] === out[out.length - 1]) round = [...round.slice(1), round[0]];
    out.push(...round);
  }
  return out;
}
