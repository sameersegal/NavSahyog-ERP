// Time helpers. India-only (§2.2).
//
// Two storage conventions live in the DB; this module supports
// both and is the single boundary between them:
//
//   * Calendar dates  → TEXT 'YYYY-MM-DD' in IST
//     (student.dob, attendance_session.date, …)
//   * Instants        → INTEGER UTC epoch seconds
//     (created_at, expires_at, …)
//
// The previous istDayStart() helper is gone: when "date" columns
// are stored as actual dates, the only conversion needed is "what
// IST calendar date is it right now?" — done once, at request entry.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Today's date in IST as 'YYYY-MM-DD'. The trick: Date.now() is UTC
// ms; shift by +5:30 and `toISOString` gives the IST wall-clock,
// from which we slice the date portion.
export function todayIstDate(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Type-guard for inputs claiming to be a calendar date. Doesn't
// validate calendar correctness (Feb 30 passes the regex); SQLite
// will store whatever we hand it, and downstream consumers expect
// the format only.
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}
