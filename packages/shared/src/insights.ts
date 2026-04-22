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

import type { GeoLevel } from './dashboard';

// One step on the breadcrumb trail from India down to a drill
// position. `id` is null at the india root. Shared so the dashboard
// drill-down and the home drill-down both speak the same shape.
export type BreadcrumbCrumb = {
  level: GeoLevel;
  id: number | null;
  name: string;
};

// A hierarchy child below the current drill position — the payload
// behind each child tile on Home. At cluster → village the shape
// carries coordinator_name so the tile reads as a village card;
// higher up coordinator_name is null and the tile summarises a
// subtree.
//
// Each child carries the same KPI set the scope strip shows, so
// Home's child grid doubles as a side-by-side comparison surface
// (L2.5.4 — merge compare + drill-down). Monthly counters
// (`images_this_month`, `videos_this_month`, `achievements_this_month`)
// cover the IST calendar month `today` falls in. Soft-deleted
// media rows are excluded, same rule as the scope-level KPIs.
export type HierarchyChild = {
  level: GeoLevel;
  id: number;
  name: string;
  // Non-graduated students across the subtree under this node.
  children_count: number;
  // Total attendance sessions the subtree ran in the last 7 days.
  sessions_this_week: number;
  // Whole-number attendance % over the last 7 days across the
  // subtree. Null when no marks were recorded.
  attendance_pct_week: number | null;
  // Days since the most recent attendance session anywhere under
  // this subtree. Null when the subtree has never logged one.
  days_since_last_session: number | null;
  at_risk: boolean;
  // Village-leaf only; null otherwise. Lets the tile show the VC's
  // name so ops knows who to ping without drilling further.
  coordinator_name: string | null;
  // Villages under this subtree. Always 1 at the village leaf;
  // larger at higher levels — handy context on zone / state tiles.
  villages_count: number;
  // Images uploaded for this subtree in the current IST calendar
  // month. Soft-deleted media excluded.
  images_this_month: number;
  // Videos uploaded for this subtree in the current IST calendar
  // month. Soft-deleted media excluded.
  videos_this_month: number;
  // Achievements (any type: SoM / gold / silver) recorded for
  // students in this subtree in the current IST calendar month.
  achievements_this_month: number;
};

// Weekly-bucket sparkline carried inline on each KPI tile. 12
// entries, oldest first, newest = the bucket ending today. Nulls
// render as gaps — a week with no sessions shouldn't read as 0%.
export const KPI_SPARK_POINTS = 12;

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
  // 12 weekly points (oldest → newest). Null entries render as gaps.
  // `null` (the whole field) means this KPI has no sensible time
  // series (e.g. today's children headcount, today's at-risk rollup)
  // and the client skips the inline sparkline.
  spark: Array<number | null> | null;
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

// Drives the "at-risk" chip and the insight card. 4 days means "no
// activity since the Monday session" when today is Friday — tight
// enough to catch real gaps, loose enough to not flag weekends.
export const AT_RISK_THRESHOLD_DAYS = 4;

export type InsightsResponse = {
  // "India", "Bidar Cluster 1", etc. Drives the KPI strip heading.
  scope_label: string;
  // Current drill position. At the user's scope floor this matches
  // their role's scope_level / scope_id. `id` is null only at the
  // india root (available to global users).
  level: GeoLevel;
  id: number | null;
  // Breadcrumb trail from india → current, oldest-first. Clients
  // render clickable crumbs so an operator can walk back up.
  crumbs: BreadcrumbCrumb[];
  // Next-level nodes to render as drill-down tiles. Ordered by
  // name. `child_level` is null at the village leaf — clicking a
  // leaf tile deep-links to /village/:id rather than drilling inside
  // insights.
  child_level: GeoLevel | null;
  children: HierarchyChild[];
  // KPIs scoped to the current drill position: children, attendance
  // % this week, images uploaded this month, videos uploaded this
  // month, achievements this month, at-risk count.
  kpis: InsightKpi[];
  // Up to 5 villages with the best attendance % this week within
  // the current drill subtree. Always villages (not clusters /
  // zones) — surfacing individual villages is what ops acts on.
  top_villages: VillageActivity[];
  // Every village under the current drill position with
  // days_since_last_session >= threshold, most-lapsed first.
  at_risk_villages: VillageActivity[];
  // Share of in-scope villages that have declared at least one
  // Star of the Month in the current IST calendar month, expressed
  // as a whole-number percentage (0–100). 0 when the scope has no
  // villages. Drives the SoM KPI tile on the home dashboard — ops
  // wants to see "how close to 100% declared are we?" at a glance.
  som_declared_pct: number;
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
