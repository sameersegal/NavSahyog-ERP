// Time helpers. India-only (§2.2), so day boundaries are IST.
// Epoch math is in seconds throughout the API.

const IST_OFFSET_SECONDS = 5 * 3600 + 30 * 60;
const SECONDS_PER_DAY = 86400;

export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Start of the IST day that contains `epochSeconds`, expressed in
// epoch seconds. Returns the UTC instant that corresponds to
// 00:00:00 IST of that day.
export function istDayStart(epochSeconds: number): number {
  const ist = epochSeconds + IST_OFFSET_SECONDS;
  const dayStartIst = Math.floor(ist / SECONDS_PER_DAY) * SECONDS_PER_DAY;
  return dayStartIst - IST_OFFSET_SECONDS;
}

export function todayIst(): number {
  return istDayStart(nowEpochSeconds());
}
