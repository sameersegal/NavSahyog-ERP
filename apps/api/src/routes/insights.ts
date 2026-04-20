// Insights route — powers the home KPI strip and the at-risk /
// top-village cards that sit above the drill-down table. Everything
// is derived from existing tables; no new columns. Scope rules are
// the same as the rest of the app — villageIdsInScope decides what
// the user is allowed to see.
//
// Design choice: this route is computed rather than precomputed /
// persisted. Back-of-envelope: 3 villages × 20 sessions × 7 kids =
// 420 marks in the fixture seed; the WHERE date >= '…' predicate
// with the existing attendance_session / attendance_mark indexes
// keeps the scan sub-linear. At real-world scale (say 500 villages,
// 50 kids, one session/day/village) the largest scan is 500 × 7 ×
// 50 = 175 000 rows for the weekly KPI — well inside D1's budget.
// If this ever becomes hot we can KV-cache on a 5-minute TTL.

import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { todayIstDate } from '../lib/time';
import {
  AT_RISK_THRESHOLD_DAYS,
  type InsightKpi,
  type InsightsResponse,
  type VillageActivity,
} from '@navsahyog/shared';
import type { Bindings, SessionUser, Variables } from '../types';

const insights = new Hono<{ Bindings: Bindings; Variables: Variables }>();

insights.use('*', requireAuth);

// IST-date arithmetic — string-in, string-out. Matches the way the
// rest of the code treats calendar dates (TEXT 'YYYY-MM-DD').
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Whole-day difference between two IST calendar dates. `from` and
// `to` are 'YYYY-MM-DD'. Returns an integer, positive when `to` is
// later than `from`.
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const fMs = Date.UTC(fy, fm - 1, fd);
  const tMs = Date.UTC(ty, tm - 1, td);
  return Math.round((tMs - fMs) / 86_400_000);
}

async function scopeLabelFor(
  db: D1Database,
  user: SessionUser,
): Promise<string> {
  if (user.scope_level === 'global' || user.scope_id === null) return 'India';
  const table = user.scope_level;
  const row = await db
    .prepare(`SELECT name FROM ${table} WHERE id = ?`)
    .bind(user.scope_id)
    .first<{ name: string }>();
  return row?.name ?? 'India';
}

type VillageCore = {
  id: number;
  name: string;
  cluster_name: string;
  children_count: number;
};

async function villageCores(
  db: D1Database,
  ids: number[],
): Promise<VillageCore[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rs = await db
    .prepare(
      `SELECT v.id, v.name, c.name AS cluster_name,
              COALESCE(kids.cnt, 0) AS children_count
         FROM village v
         JOIN cluster c ON c.id = v.cluster_id
         LEFT JOIN (
           SELECT village_id, COUNT(*) AS cnt FROM student
            WHERE graduated_at IS NULL
            GROUP BY village_id
         ) kids ON kids.village_id = v.id
        WHERE v.id IN (${placeholders})
        ORDER BY v.name`,
    )
    .bind(...ids)
    .all<VillageCore>();
  return rs.results;
}

type VillageWeekly = {
  village_id: number;
  sessions_this_week: number;
  marks_total: number;
  marks_present: number;
  last_session_date: string | null;
};

async function villageWeekly(
  db: D1Database,
  ids: number[],
  weekFrom: string,
  weekTo: string,
): Promise<Map<number, VillageWeekly>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  // One pass: weekly counts + all-time last-session date per village.
  // We can't COUNT(DISTINCT) across a filter in a single aggregate
  // cleanly, so we fan out the joins instead — attendance volume
  // per village is tiny (hundreds, not millions) so this is fine.
  const rs = await db
    .prepare(
      `SELECT s.village_id AS village_id,
              COUNT(DISTINCT CASE WHEN s.date BETWEEN ? AND ? THEN s.id END) AS sessions_this_week,
              SUM(CASE WHEN s.date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS marks_total,
              SUM(CASE WHEN s.date BETWEEN ? AND ? AND m.present = 1 THEN 1 ELSE 0 END) AS marks_present,
              MAX(s.date) AS last_session_date
         FROM attendance_session s
         LEFT JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
        GROUP BY s.village_id`,
    )
    .bind(weekFrom, weekTo, weekFrom, weekTo, weekFrom, weekTo, ...ids)
    .all<VillageWeekly>();
  const out = new Map<number, VillageWeekly>();
  for (const row of rs.results) out.set(row.village_id, row);
  return out;
}

function buildActivity(
  today: string,
  core: VillageCore,
  weekly: VillageWeekly | undefined,
): VillageActivity {
  const sessions = weekly?.sessions_this_week ?? 0;
  const marksTotal = weekly?.marks_total ?? 0;
  const marksPresent = weekly?.marks_present ?? 0;
  const attendancePct =
    marksTotal > 0 ? Math.round((marksPresent / marksTotal) * 100) : null;
  const days =
    weekly?.last_session_date != null
      ? daysBetween(weekly.last_session_date, today)
      : null;
  return {
    village_id: core.id,
    village_name: core.name,
    cluster_name: core.cluster_name,
    children_count: core.children_count,
    sessions_this_week: sessions,
    attendance_pct_week: attendancePct,
    days_since_last_session: days,
    at_risk:
      days === null ? true : days >= AT_RISK_THRESHOLD_DAYS,
  };
}

// Overall attendance % across a date range for the given villages.
async function overallAttendancePct(
  db: D1Database,
  ids: number[],
  from: string,
  to: string,
): Promise<number | null> {
  if (ids.length === 0) return null;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT SUM(CASE WHEN m.present = 1 THEN 1 ELSE 0 END) AS present,
              COUNT(*) AS total
         FROM attendance_session s
         JOIN attendance_mark m ON m.session_id = s.id
        WHERE s.village_id IN (${placeholders})
          AND s.date BETWEEN ? AND ?`,
    )
    .bind(...ids, from, to)
    .first<{ present: number | null; total: number | null }>();
  const total = row?.total ?? 0;
  if (total === 0) return null;
  const present = row?.present ?? 0;
  return Math.round((present / total) * 100);
}

async function achievementsInMonth(
  db: D1Database,
  ids: number[],
  monthPrefix: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM achievement a
        JOIN student st ON st.id = a.student_id
       WHERE st.village_id IN (${placeholders})
         AND a.date LIKE ? || '%'`,
    )
    .bind(...ids, monthPrefix)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function deltaTrend(current: number, prev: number | null): {
  delta: number | null;
  trend: 'up' | 'down' | 'flat' | null;
} {
  if (prev === null) return { delta: null, trend: null };
  const d = current - prev;
  if (d === 0) return { delta: 0, trend: 'flat' };
  return { delta: d, trend: d > 0 ? 'up' : 'down' };
}

insights.get('/', requireCap('dashboard.read'), async (c) => {
  const user = c.get('user');
  const ids = await villageIdsInScope(c.env.DB, user);
  const today = todayIstDate();
  const weekStart = addDays(today, -6); // 7-day window inclusive
  const prevWeekStart = addDays(today, -13);
  const prevWeekEnd = addDays(today, -7);
  const monthPrefix = today.slice(0, 7);
  const prevMonthPrefix = addDays(monthPrefix + '-01', -1).slice(0, 7);

  const [scopeLabel, cores, weekly] = await Promise.all([
    scopeLabelFor(c.env.DB, user),
    villageCores(c.env.DB, ids),
    villageWeekly(c.env.DB, ids, prevWeekStart, today),
  ]);

  const allVillages = cores.map((v) => buildActivity(today, v, weekly.get(v.id)));

  // KPI strip.
  const totalChildren = cores.reduce((a, v) => a + v.children_count, 0);
  const attThisWeek = await overallAttendancePct(c.env.DB, ids, weekStart, today);
  const attPrevWeek = await overallAttendancePct(c.env.DB, ids, prevWeekStart, prevWeekEnd);
  const achThisMonth = await achievementsInMonth(c.env.DB, ids, monthPrefix);
  const achPrevMonth = await achievementsInMonth(c.env.DB, ids, prevMonthPrefix);
  const atRiskCount = allVillages.filter((v) => v.at_risk).length;

  const attDelta = deltaTrend(attThisWeek ?? 0, attPrevWeek);
  const achDelta = deltaTrend(achThisMonth, achPrevMonth);

  const kpis: InsightKpi[] = [
    {
      label: 'children',
      value: totalChildren,
      delta: null,
      trend: null,
      hint: null,
    },
    {
      label: 'villages',
      value: allVillages.length,
      delta: null,
      trend: null,
      hint: null,
    },
    {
      label: 'attendance_week',
      value: attThisWeek ?? 0,
      delta: attDelta.delta,
      trend: attDelta.trend,
      hint: attPrevWeek === null ? null : 'vs_prev_week',
    },
    {
      label: 'achievements_month',
      value: achThisMonth,
      delta: achDelta.delta,
      trend: achDelta.trend,
      hint: achPrevMonth === null ? null : 'vs_prev_month',
    },
    {
      label: 'at_risk',
      value: atRiskCount,
      delta: null,
      // Higher at-risk is bad — we invert the sense so "trend: up"
      // always reads green on the client.
      trend: atRiskCount === 0 ? 'up' : atRiskCount > allVillages.length / 3 ? 'down' : 'flat',
      hint: null,
    },
  ];

  const topVillages = [...allVillages]
    .filter((v) => v.attendance_pct_week !== null)
    .sort((a, b) => (b.attendance_pct_week ?? 0) - (a.attendance_pct_week ?? 0))
    .slice(0, 5);

  const atRiskVillages = allVillages
    .filter((v) => v.at_risk)
    .sort((a, b) => {
      // Most-lapsed first; villages that never ran a session sort
      // above anything else.
      const ad = a.days_since_last_session;
      const bd = b.days_since_last_session;
      if (ad === null && bd === null) return 0;
      if (ad === null) return -1;
      if (bd === null) return 1;
      return bd - ad;
    });

  const body: InsightsResponse = {
    scope_label: scopeLabel,
    kpis,
    top_villages: topVillages,
    at_risk_villages: atRiskVillages,
    all_villages: allVillages,
  };
  return c.json(body);
});

export default insights;
