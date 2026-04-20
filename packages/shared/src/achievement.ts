// Achievement wire shape — the JSON body returned by
// /api/achievements. Mirrors spec §4.3.6.
//
// Three types. `som` ("Star of the Month") carries description only
// and is capped at one per (student, month) — a second SoM replaces
// the first (§3.5). `gold` / `silver` each carry one medal count.
// Both count fields are nullable because only the row's own type
// populates its count; a DB-level CHECK constraint mirrors this.

export type AchievementType = 'som' | 'gold' | 'silver';

export type Achievement = {
  id: number;
  student_id: number;
  description: string;
  date: string;                 // IST 'YYYY-MM-DD'
  type: AchievementType;
  gold_count: number | null;
  silver_count: number | null;
};

// Enriched shape returned by GET list / drill-down village-leaf view.
// Carries the student name and village so the UI doesn't need a
// second round-trip per row.
export type AchievementWithStudent = Achievement & {
  student_first_name: string;
  student_last_name: string;
  village_id: number;
  village_name: string;
};
