// Streaks route — computes the current user's logging streak (in
// IST days) plus this-week / prev-week session counts for the
// post-save comparison toast.
//
// "Logging streak" is the count of consecutive IST dates, ending on
// today or yesterday, on which the user's scope ran at least one
// attendance session. The streak may end on yesterday rather than
// today so that a VC checking in at 10 AM before logging the day's
// session doesn't see "streak: 0" — they see their previous run
// and the app doesn't punish them for not having logged *yet*.

import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { todayIstDate } from '../lib/time';
import type { StreakResponse } from '@navsahyog/shared';
import type { Bindings, Variables } from '../types';

const streaks = new Hono<{ Bindings: Bindings; Variables: Variables }>();

streaks.use('*', requireAuth);

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function datesWithSessions(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
): Promise<Set<string>> {
  if (villageIds.length === 0) return new Set();
  const placeholders = villageIds.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT DISTINCT date FROM attendance_session
        WHERE village_id IN (${placeholders})
          AND date BETWEEN ? AND ?`,
    )
    .bind(...villageIds, from, to)
    .all<{ date: string }>();
  return new Set(rs.results.map((r) => r.date));
}

async function countSessions(
  db: D1Database,
  villageIds: number[],
  from: string,
  to: string,
): Promise<number> {
  if (villageIds.length === 0) return 0;
  const placeholders = villageIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM attendance_session
        WHERE village_id IN (${placeholders})
          AND date BETWEEN ? AND ?`,
    )
    .bind(...villageIds, from, to)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Walk a year of history at most. Anything longer than that is
// indistinguishable from "has always been on it" and avoids an
// unbounded scan on perverse test data.
const MAX_STREAK_LOOKBACK_DAYS = 365;

streaks.get('/me', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const ids = await villageIdsInScope(c.env.DB, user);
  const today = todayIstDate();

  // Most recent session date in scope — bounds the streak walk and
  // drives `last_session_date`.
  let lastSessionDate: string | null = null;
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const row = await c.env.DB.prepare(
      `SELECT MAX(date) AS d FROM attendance_session
        WHERE village_id IN (${placeholders})`,
    )
      .bind(...ids)
      .first<{ d: string | null }>();
    lastSessionDate = row?.d ?? null;
  }

  const weekFrom = addDays(today, -6);
  const prevWeekFrom = addDays(today, -13);
  const prevWeekTo = addDays(today, -7);
  const [sessionsThisWeek, sessionsPrevWeek] = await Promise.all([
    countSessions(c.env.DB, ids, weekFrom, today),
    countSessions(c.env.DB, ids, prevWeekFrom, prevWeekTo),
  ]);

  let currentStreak = 0;
  let bestStreak = 0;
  if (lastSessionDate !== null) {
    // Collect the dates present in the last year; then walk.
    const yearStart = addDays(today, -MAX_STREAK_LOOKBACK_DAYS);
    const dates = await datesWithSessions(c.env.DB, ids, yearStart, today);

    // Current streak: start from today; if today has no session,
    // anchor at yesterday. If yesterday also has nothing, the
    // streak is 0 and we surface the broken state.
    let anchor = dates.has(today) ? today : dates.has(addDays(today, -1)) ? addDays(today, -1) : null;
    while (anchor !== null && dates.has(anchor)) {
      currentStreak += 1;
      anchor = addDays(anchor, -1);
    }

    // Best streak: single pass over sorted dates.
    const sorted = Array.from(dates).sort();
    let run = 0;
    let prev: string | null = null;
    for (const d of sorted) {
      if (prev !== null && addDays(prev, 1) === d) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > bestStreak) bestStreak = run;
      prev = d;
    }
  }

  const body: StreakResponse = {
    current_streak_days: currentStreak,
    best_streak_days: Math.max(bestStreak, currentStreak),
    last_session_date: lastSessionDate,
    sessions_this_week: sessionsThisWeek,
    sessions_prev_week:
      sessionsPrevWeek === 0 && sessionsThisWeek === 0 ? null : sessionsPrevWeek,
  };
  return c.json(body);
});

export default streaks;
