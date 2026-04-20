-- 0007_media_live_index — partial composite index for the hot-path
-- list query.
--
-- `GET /api/media?village_id=…[&kind=…]` filters `village_id IN (…)
-- AND deleted_at IS NULL` and orders by `captured_at DESC`. The
-- indexes in 0006 (`(village_id, captured_at)` and
-- `(kind, deleted_at)`) let SQLite satisfy the filter OR the sort,
-- not both — on villages with any appreciable media count the
-- planner falls back to a scan.
--
-- A partial index on live rows (`WHERE deleted_at IS NULL`) carries
-- only the rows the list ever touches, keeping the index small even
-- on a long-lived bucket, and covers both the predicate and the
-- ORDER BY with no sort step. DESC is preserved by the index.
--
-- Why partial: soft-deleted rows are only read by admin / audit
-- paths (L5), never by the list endpoint or the child/attendance
-- attach validators. Indexing them would waste space and write
-- amplification for zero query benefit.

CREATE INDEX idx_media_village_live_captured
  ON media(village_id, captured_at DESC)
  WHERE deleted_at IS NULL;
