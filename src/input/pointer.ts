export type Move = { t: number; dx: number; dy: number };

/**
 * Lock the pointer, asking for raw counts (no OS acceleration).
 * Returns whether raw input was granted; sessions without it get flagged.
 */
export async function lockPointer(el: HTMLElement): Promise<boolean> {
  try {
    await el.requestPointerLock({ unadjustedMovement: true });
    return true;
  } catch {
    await el.requestPointerLock();
    return false;
  }
}

/** Which event stream onMove listens to; recorded in each log for diagnosis. */
export const MOVE_EVENT = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';

/**
 * Stream every mouse report while locked. Browsers batch reports per frame (~60 Hz);
 * getCoalescedEvents() recovers the individual polls. If the pieces don't sum to the
 * batched delta (seen in some browsers under pointer lock), trust the batch instead.
 */
export function onMove(cb: (m: Move) => void): () => void {
  const h = (e: Event) => {
    if (!document.pointerLockElement) return;
    const pe = e as PointerEvent;
    const parts = pe.getCoalescedEvents?.() ?? [];
    let sx = 0, sy = 0;
    for (const p of parts) { sx += p.movementX; sy += p.movementY; }
    const src = parts.length && sx === pe.movementX && sy === pe.movementY ? parts : [pe];
    for (const p of src) if (p.movementX || p.movementY) cb({ t: p.timeStamp, dx: p.movementX, dy: p.movementY });
  };
  window.addEventListener(MOVE_EVENT, h);
  return () => window.removeEventListener(MOVE_EVENT, h);
}
