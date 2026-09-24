// All sensitivity math works in cm/360: cm of mouse travel for one full turn.
const CM_PER_INCH = 2.54;

export const cm360FromGame = (dpi: number, sens: number, yaw: number) =>
  (360 * CM_PER_INCH) / (dpi * sens * yaw);

export const gameSensFromCm360 = (cm360: number, dpi: number, yaw: number) =>
  (360 * CM_PER_INCH) / (dpi * cm360 * yaw);

/** Degrees the camera turns per raw mouse count at a given cm/360. */
export const degPerCount = (cm360: number, dpi: number) =>
  360 / ((cm360 / CM_PER_INCH) * dpi);
