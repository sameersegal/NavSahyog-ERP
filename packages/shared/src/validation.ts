// Field validators shared by server and client. The server is
// authoritative; the client calls these to surface errors locally
// before a round-trip.

// §9.2: Indian mobile format. 10 digits starting 6–9, optional +91.
// Whitespace is a field-level concern (trim in the caller).
const PHONE_RE = /^(?:\+91)?[6-9]\d{9}$/;

export function isIndianPhone(raw: string): boolean {
  return PHONE_RE.test(raw);
}

// `'YYYY-MM-DD'` — the IST-calendar format used for dob,
// joined_at, graduated_at, attendance_session.date. Duplicates the
// server's `isIsoDate` so the web client can pre-validate without
// pulling in the server module.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(raw: string): boolean {
  if (!ISO_DATE_RE.test(raw)) return false;
  // Reject impossible dates like '2026-02-30' — `new Date` accepts
  // them but reports the parsed-calendar value, not the input.
  const [y, m, d] = raw.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// `'HH:MM'` — 24h clock time. Used for attendance_session.start_time
// and end_time. Same reasoning as isIsoDate: a clock reading on an
// IST calendar date, stored as TEXT so no hidden timezone offset.
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClockTime(raw: string): boolean {
  return CLOCK_RE.test(raw);
}
