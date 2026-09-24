// Share links: the debrief summary, deflated and base64url-encoded into the URL fragment
// (after #), which browsers never send to a server. Only summary numbers; never raw mouse logs.
import games from '../data/games.json';

export type Summary = {
  v: 1; name: string; game: string; dpi: number; date: string;
  cur: number; aim: number | null; // current cm/360; Tarkov aiming ÷ hip ratio
  rec: { final: number; peak: number; lo: number; hi: number; conf: 'high' | 'medium' | 'low'; edge: 'fast' | 'slow' | null } | null;
  c: [code: string, cm360: number, score: number][];
  ads?: { hip: number; aiming: number }; // red-dot session: Tarkov settings at the verdict
  n?: number; // sessions of the same candidates combined into this verdict; absent = this session alone
};

const pipe = (bytes: BlobPart, t: CompressionStream | DecompressionStream) =>
  new Response(new Blob([bytes]).stream().pipeThrough(t));

export async function encode(s: Summary): Promise<string> {
  const buf = new Uint8Array(await pipe(JSON.stringify(s), new CompressionStream('deflate-raw')).arrayBuffer());
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode and validate a link's payload. Links come from anyone, so every field is checked. */
export async function decode(code: string): Promise<Summary> {
  if (code.length > 2000 || !/^[\w-]+$/.test(code)) throw new Error('malformed link');
  const bytes = Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return validate(JSON.parse(await pipe(bytes, new DecompressionStream('deflate-raw')).text()));
}

function validate(o: any): Summary {
  const bad = (what: string): never => { throw new Error(`bad ${what}`); };
  const num = (x: unknown, lo: number, hi: number, what: string) =>
    typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : bad(what);
  const cm = (x: unknown) => num(x, 1, 500, 'cm/360');
  if (o?.v !== 1) bad('version');
  if (!(typeof o.game === 'string' && Object.hasOwn(games, o.game))) bad('game');
  if (!(typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date))) bad('date');
  if (!Array.isArray(o.c) || o.c.length > 12) bad('candidates');
  const r = o.rec;
  const sens = (x: unknown) => num(x, 0.001, 10, 'sensitivity');
  return {
    ...(o.ads === undefined ? {} : { ads: { hip: sens(o.ads?.hip), aiming: sens(o.ads.aiming) } }),
    ...(o.n === undefined ? {} : { n: num(o.n, 2, 200, 'session count') }),
    v: 1,
    name: typeof o.name === 'string' ? o.name.slice(0, 24) : '',
    game: o.game, date: o.date, dpi: num(o.dpi, 50, 64000, 'dpi'), cur: cm(o.cur),
    aim: o.aim === null ? null : num(o.aim, 0, 10, 'aiming ratio'),
    rec: r === null ? null : {
      final: cm(r?.final), peak: cm(r.peak), lo: cm(r.lo), hi: cm(r.hi),
      conf: ['high', 'medium', 'low'].includes(r.conf) ? r.conf : bad('confidence'),
      edge: [null, 'fast', 'slow'].includes(r.edge) ? r.edge : bad('edge'),
    },
    c: o.c.map((x: unknown) => Array.isArray(x) && typeof x[0] === 'string' && /^[A-Z]{1,12}$/.test(x[0])
      ? [x[0], cm(x[1]), num(x[2], 0, 100, 'score')] as [string, number, number]
      : bad('candidate')),
  };
}
