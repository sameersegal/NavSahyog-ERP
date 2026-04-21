// Insights + streaks shapes. Live here so both apps share them.
//
// Insights power the home-screen KPI strip and the cards that sit
// above the drill-down table. Streaks power the coordinator's "Day
// N" chip in the header and the post-save comparison toast.
//
// Everything derives from existing tables (attendance_session,
// attendance_mark, student, achievement) — no new columns. Keeping
// this computed rather than persisted means the source of truth
// stays in one place (the operational data) and there's nothing to
// backfill or keep in sync.

export type InsightKpi = {
  label: string;
  value: number;
  // Raw percentage points for attendance; count for children /
  // achievements. Null when there's no comparable previous period.
  delta: number | null;
  // 'up' is good, 'down' is bad (even for at-risk counts — there we
  // invert the sense server-side so the client can render uniformly).
  trend: 'up' | 'down' | 'flat' | null;
  // Optional tooltip text; e.g. "vs last week".
  hint: string | null;
};

export type VillageActivity = {
  village_id: number;
  village_name: string;
  cluster_name: string;
  // Name of the VC assigned to this village, if any. Null when no
  // VC is assigned (valid state during onboarding or between rotations).
  coordinator_name: string | null;
  children_count: number;
  // Sessions run in the last 7 days (today inclusive).
  sessions_this_week: number;
  // Whole-number percentage, 0–100. Null when nothing was marked in
  // the last 7 days.
  attendance_pct_week: number | null;
  // Days since the last attendance session. Null if the village has
  // never run a session.
  days_since_last_session: number | null;
  // True when days_since_last_session >= AT_RISK_THRESHOLD_DAYS.
  at_risk: boolean;
};

// A Star of the Month row rolled up for the home / dashboard card.
// Current + previous month lists are computed separately so the card
// can render "Last month" even when the current month has none yet.
export type StarOfTheMonth = {
  achievement_id: number;
  student_id: number;
  student_name: string;
  village_id: number;
  village_name: string;
  date: string;                    // IST 'YYYY-MM-DD'
  description: string;
};

// One day on the rolling 90-day attendance sparkline. `pct` is null
// when the day had zero marks in the user's scope (so the sparkline
// can render gaps instead of pretending zero).
export type AttendanceSparkPoint = {
  date: string;                    // IST 'YYYY-MM-DD'
  pct: number | null;
};

// Drives the "at-risk" chip and the insight card. 4 days means "no
// activity since the Monday session" when today is Friday — tight
// enough to catch real gaps, loose enough to not flag weekends.
export const AT_RISK_THRESHOLD_DAYS = 4;

export type InsightsResponse = {
  // "India", "Bidar Cluster 1", etc. Drives the KPI strip heading.
  scope_label: string;
  // Scope-filtered counts: children, villages in scope, attendance %
  // this week, images uploaded this month, videos uploaded this month,
  // achievements this month, at-risk count. Empty list for users with
  // no villages in scope (shouldn't happen outside test fixtures).
  kpis: InsightKpi[];
  // Up to 5 villages with the best attendance % this week. Empty
  // when the user's scope has no villages or no sessions.
  top_villages: VillageActivity[];
  // Every village in scope with days_since_last_session >= threshold,
  // ordered most-lapsed first. May be empty.
  at_risk_villages: VillageActivity[];
  // Every village in scope, ordered alphabetically. Powers the home
  // village grid (replaces the old /api/villages call there).
  all_villages: VillageActivity[];
  // Rolling 90-day attendance sparkline for the whole scope. Ordered
  // oldest → newest, always exactly 90 entries (missing days return
  // `{ date, pct: null }`).
  attendance_90d: AttendanceSparkPoint[];
  // True when at least one Star of the Month has been declared in
  // the current IST calendar month across the user's scope. Drives
  // the yes/no KPI tile on the home dashboard.
  som_declared_this_month: boolean;
  // Stars of the Month — current and previous calendar months.
  // Empty arrays when the month has no SoMs yet.
  stars_current_month: StarOfTheMonth[];
  stars_prev_month: StarOfTheMonth[];
};

export type StreakResponse = {
  // Consecutive IST days, ending yesterday or today, in which the
  // current user (VC) or someone in their scope logged at least one
  // attendance session. 0 when the streak has broken.
  current_streak_days: number;
  // All-time best for the same user (or scope).
  best_streak_days: number;
  // IST 'YYYY-MM-DD' of the most recent session the user's scope
  // has. Null when the user has never logged a session.
  last_session_date: string | null;
  // Sessions the user's scope ran in the last 7 days.
  sessions_this_week: number;
  // Same window, a week earlier. Null when there's no comparable
  // prior data (e.g. the user joined recently).
  sessions_prev_week: number | null;
};
