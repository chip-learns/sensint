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

/** Stream every mouse move while locked. pointerrawupdate fires at polling rate in Chromium. */
export function onMove(cb: (m: Move) => void): () => void {
  const type = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'mousemove';
  const h = (e: Event) => {
    const { movementX, movementY, timeStamp } = e as MouseEvent;
    if (document.pointerLockElement && (movementX || movementY))
      cb({ t: timeStamp, dx: movementX, dy: movementY });
  };
  window.addEventListener(type, h);
  return () => window.removeEventListener(type, h);
}
