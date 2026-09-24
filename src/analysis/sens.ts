// All sensitivity math works in cm/360: cm of mouse travel for one full turn.
const CM_PER_INCH = 2.54;

export const cm360FromGame = (dpi: number, sens: number, yaw: number) =>
  (360 * CM_PER_INCH) / (dpi * sens * yaw);

export const gameSensFromCm360 = (cm360: number, dpi: number, yaw: number) =>
  (360 * CM_PER_INCH) / (dpi * cm360 * yaw);

/** Degrees the camera turns per raw mouse count at a given cm/360. */
export const degPerCount = (cm360: number, dpi: number) =>
  360 / ((cm360 / CM_PER_INCH) * dpi);

// Tarkov aiming (measured 2026-09-24): red-dot cm/360 = hip cm/360 × (hip sens ÷ aiming sens) × k,
// where k (games.json tarkov.adsFactor, ~1.29) is Tarkov's own slowdown when aiming.
export const redDotCm360 = (hipCm: number, sens: number, aiming: number, k: number) => hipCm * (sens / aiming) * k;
export const aimingForRedDot = (redCm: number, hipCm: number, sens: number, k: number) => (sens * hipCm * k) / redCm;

/**
 * Horizontal FOV while aiming, assuming k is the ADS zoom (turning slowed to match the view).
 * ponytail: assumption, not measured; if k turns out to be ergonomics, use the hip FOV here instead.
 */
export const adsFovH = (hipFovH: number, k: number) =>
  (2 * Math.atan(Math.tan((hipFovH * Math.PI) / 360) / k) * 180) / Math.PI;
