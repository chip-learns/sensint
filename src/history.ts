// Your own session history, kept in this browser only (per-viewer; never shared or uploaded).
import type { HistoryEntry } from './ui/debrief';

const KEY = 'sensint.history';
const MAX = 50;

export function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

/** Add or replace this session (same id = same session reopened), oldest first. Returns the list. */
export function saveToHistory(e: HistoryEntry): HistoryEntry[] {
  const list = [...loadHistory().filter((x) => x.id !== e.id), e].sort((a, b) => a.id.localeCompare(b.id)).slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private window or storage full: history just isn't kept */ }
  return list;
}
