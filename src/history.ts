// Your own session history, kept in this browser only (never shared or uploaded):
// - a small summary list in localStorage, for the "Your sessions" table
// - every full session in IndexedDB, so any past debrief can be reopened without its JSON file
// A backup file (all full sessions, gzipped) moves the history to another browser or PC.
import type { Session } from './session';
import type { HistoryEntry } from './ui/debrief';
import type { WarmupEntry } from './ui/warmup';

const KEY = 'sensint.history';
const MAX = 200;

export const sessionId = (s: Session) => `${s.createdAt}#${s.intake.seed}`; // sorts by time

export function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

/** Add or replace this session (same id = same session reopened), oldest first. Returns the list. */
export function saveToHistory(e: HistoryEntry): HistoryEntry[] {
  const list = [...loadHistory().filter((x) => x.id !== e.id), e].sort((a, b) => a.id.localeCompare(b.id)).slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window or storage full: history just isn't kept */ }
  return list;
}

// IndexedDB: one object store of full sessions keyed by sessionId.
const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('sensint', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('sessions');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function store<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = op(db.transaction('sessions', mode).objectStore('sessions'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const putSession = (s: Session) => store('readwrite', (st) => st.put(s, sessionId(s)));
export const getSession = (id: string) => store<Session | undefined>('readonly', (st) => st.get(id));
export const allSessions = () => store<Session[]>('readonly', (st) => st.getAll());

// Warm-ups: small result summaries only (no raw logs), kept apart from sensitivity sessions.
const WKEY = 'sensint.warmups';
export function loadWarmups(): WarmupEntry[] {
  try { return JSON.parse(localStorage.getItem(WKEY) ?? '[]'); } catch { return []; }
}
/** Merge warm-ups in (same id = same warm-up), oldest first. Returns the full list. */
export function saveWarmups(add: WarmupEntry[]): WarmupEntry[] {
  const ids = new Set(add.map((w) => w.id));
  const list = [...loadWarmups().filter((w) => !ids.has(w.id)), ...add].sort((a, b) => a.id.localeCompare(b.id)).slice(-MAX * 5);
  try { localStorage.setItem(WKEY, JSON.stringify(list)); } catch { /* not kept */ }
  return list;
}

export type Backup = { app: 'sensint-backup'; version: 1; createdAt: string; sessions: Session[]; warmups?: WarmupEntry[] };

/** Every stored session and warm-up in one gzipped JSON file. */
export async function backupBlob(sessions: Session[], warmups: WarmupEntry[] = []): Promise<Blob> {
  const b: Backup = { app: 'sensint-backup', version: 1, createdAt: new Date().toISOString(), sessions, warmups };
  return new Response(new Blob([JSON.stringify(b)]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** A session file (.json) or a backup (.json.gz, or .json); returns the sessions and warm-ups it holds. */
export async function readBackup(file: Blob & { name: string }): Promise<{ sessions: Session[]; warmups: WarmupEntry[] }> {
  const stream = file.name.endsWith('.gz') ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream();
  const o = JSON.parse(await new Response(stream).text());
  const backup = o?.app === 'sensint-backup';
  const list: unknown[] = backup && Array.isArray(o.sessions) ? o.sessions : [o];
  const sessions = list.filter((s): s is Session => (s as Session)?.app === 'sensint' && Array.isArray((s as Session).trials));
  const warmups: WarmupEntry[] = backup && Array.isArray(o.warmups)
    ? o.warmups.filter((w: WarmupEntry) => typeof w?.id === 'string' && w.results && typeof w.results === 'object')
    : [];
  if (!sessions.length && !warmups.length) throw new Error('not a SENSINT session or backup file');
  return { sessions, warmups };
}
