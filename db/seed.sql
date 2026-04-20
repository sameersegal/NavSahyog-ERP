-- L1 seed. One geo path, one cluster with 3 villages, ~20 students.
-- Dummy data only. Plain-text passwords (L5 replaces with Argon2id).
--
-- Date columns use IST 'YYYY-MM-DD' (see schema.sql header).

-- Delete order matches FK topology: children before parents. The
-- L2.4 `media` table is a child of village/event/user and a parent
-- of student (photo_media_id) + attendance_session (voice_note_media_id),
-- so students and sessions drop before media, and media drops before
-- its own parents.
DELETE FROM achievement;
DELETE FROM attendance_mark;
DELETE FROM attendance_session;
DELETE FROM student;
DELETE FROM media;
DELETE FROM event;
DELETE FROM school;
DELETE FROM session;
DELETE FROM user;
DELETE FROM village;
DELETE FROM cluster;
DELETE FROM district;
DELETE FROM region;
DELETE FROM state;
DELETE FROM zone;

INSERT INTO zone (id, name, code) VALUES (1, 'South Zone', 'SZ');
INSERT INTO state (id, zone_id, name, code) VALUES (1, 1, 'Karnataka', 'KA');
INSERT INTO region (id, state_id, name, code) VALUES (1, 1, 'South Karnataka', 'SK');
INSERT INTO district (id, region_id, name, code) VALUES (1, 1, 'Bidar', 'BID');
INSERT INTO cluster (id, district_id, name, code) VALUES (1, 1, 'Bidar Cluster 1', 'BID01');

INSERT INTO village (id, cluster_id, name, code) VALUES
  (1, 1, 'Anandpur',    'BID01-V1'),
  (2, 1, 'Belur',       'BID01-V2'),
  (3, 1, 'Chandragiri', 'BID01-V3');

INSERT INTO school (id, village_id, name) VALUES
  (1, 1, 'Anandpur Government School'),
  (2, 2, 'Belur Anganwadi'),
  (3, 3, 'Chandragiri Primary School');

-- Users. Passwords are plain-text per L1 (see mvp/level-1.md).
-- Convention: <role>-<scope>, password "password".
--
-- IDs 1–6 are the L1 write-tier accounts (kept stable so
-- student.created_by = 6 foreign keys from the L1 seed still
-- resolve). IDs 7–10 are the L2 read-only geo-admin tiers. Each
-- anchors to the one seeded row at its scope level (Bidar district /
-- South Karnataka region / Karnataka state / South Zone).
INSERT INTO user (id, user_id, full_name, password, role, scope_level, scope_id, created_at) VALUES
  (1, 'vc-anandpur',    'Sunita Patil',       'password', 'vc',             'village',  1,    unixepoch()),
  (2, 'vc-belur',       'Ramesh Kulkarni',    'password', 'vc',             'village',  2,    unixepoch()),
  (3, 'vc-chandragiri', 'Kavita Gowda',       'password', 'vc',             'village',  3,    unixepoch()),
  (4, 'af-bid01',       'Anil Rao',           'password', 'af',             'cluster',  1,    unixepoch()),
  (5, 'cluster-bid01',  'Priya Deshpande',    'password', 'cluster_admin',  'cluster',  1,    unixepoch()),
  (6, 'super',          'Super Admin',        'password', 'super_admin',    'global',   NULL, unixepoch()),
  (7, 'district-bid',   'Meera Joshi',        'password', 'district_admin', 'district', 1,    unixepoch()),
  (8, 'region-sk',      'Rohan Hegde',        'password', 'region_admin',   'region',   1,    unixepoch()),
  (9, 'state-ka',       'Lata Iyer',          'password', 'state_admin',    'state',    1,    unixepoch()),
  (10,'zone-sz',        'Nikhil Shetty',      'password', 'zone_admin',     'zone',     1,    unixepoch());

-- ~20 students spread across the 3 villages. Ages 6-12 as of 2026.
-- DOB and joined_at are IST calendar dates ('YYYY-MM-DD').
-- created_at stays a UTC epoch (audit timestamp, not a calendar date).
INSERT INTO student (village_id, school_id, first_name, last_name, gender, dob, joined_at, created_at, created_by) VALUES
  (1, 1, 'Aarav',  'Patil',    'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Aditi',  'Rao',      'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Arjun',  'Deshpande','m', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Bhavya', 'Kulkarni', 'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Chirag', 'Naik',     'm', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Diya',   'Shetty',   'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Eshan',  'Pai',      'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Farhan', 'Ali',      'm', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Gauri',  'Hegde',    'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Hitesh', 'Bhat',     'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Ishaan', 'Gowda',    'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Jaya',   'Kamath',   'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Kiran',  'Murthy',   'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Lakshmi','Iyer',     'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Manav',  'Joshi',    'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Nidhi',  'Kalburgi', 'f', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Om',     'Mallya',   'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Priya',  'Nambiar',  'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Rahul',  'Prabhu',   'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Sneha',  'Rao',      'f', '2017-01-01', '2024-06-01', unixepoch(), 6);

-- Events & activities (§3.4.2, §4.3.4). Event master is single-tenant
-- and stable — same list surfaces in Attendance (L2.2) and Capture
-- (L2.4). IDs are stable so outbox/idempotency-key work later can
-- reference them from fixtures.
INSERT INTO event (id, name, kind, description, created_at, created_by) VALUES
  (1, 'Annual Competition',          'event',    'AC — annual village-level competition',        unixepoch(), 6),
  (2, 'Special Event',               'event',    'Festivals, visits, and one-off programs',      unixepoch(), 6),
  (3, 'Board Games',                 'activity', NULL,                                           unixepoch(), 6),
  (4, 'Running Race',                'activity', NULL,                                           unixepoch(), 6),
  (5, 'Kho-Kho',                     'activity', NULL,                                           unixepoch(), 6),
  (6, 'Kabaddi',                     'activity', NULL,                                           unixepoch(), 6),
  (7, 'Prakriti Prem',               'activity', NULL,                                           unixepoch(), 6),
  (8, 'Dhan Kaushal',                'activity', NULL,                                           unixepoch(), 6),
  (9, 'Jal Vriddhi',                 'activity', NULL,                                           unixepoch(), 6),
  (10,'No Activity — Raining',       'activity', 'Session cancelled due to rain',                unixepoch(), 6),
  (11,'No Activity — Training',      'activity', 'VC away at training',                          unixepoch(), 6);

-- Sample achievements for the dashboard tile (§3.5). Three months of
-- Stars of the Month (one per village per month for the last three
-- months), plus assorted gold / silver medals. The three-month span
-- lights up the "current vs previous" comparison on the home card
-- and gives the dashboard trend a non-trivial denominator.
--
-- SoM uniqueness is per-student-month (§3.5), so we rotate students
-- across months: each village's SoM goes to a different child each
-- month. Dates are synthesized with `date('now', '-N months')` and
-- then clamped to the 5th-15th of the resulting month so they sit
-- comfortably inside their month (avoids end-of-month rollover
-- surprises when 'now' is late in a 31-day month).
INSERT INTO achievement (student_id, description, date, type, gold_count, silver_count, created_at, created_by) VALUES
  -- Current month SoM — one per village.
  (1,  'Perfect attendance & peer mentoring',     strftime('%Y-%m', 'now') || '-05', 'som',    NULL, NULL, unixepoch(), 6),
  (8,  'Led the story-circle every Thursday',     strftime('%Y-%m', 'now') || '-06', 'som',    NULL, NULL, unixepoch(), 6),
  (14, 'Helped set up the reading corner',        strftime('%Y-%m', 'now') || '-07', 'som',    NULL, NULL, unixepoch(), 6),
  -- Previous month SoM — rotated students.
  (2,  'Helped juniors with maths',               strftime('%Y-%m', date('now','-1 month')) || '-10', 'som', NULL, NULL, unixepoch(), 6),
  (9,  'Organised the reading circle',            strftime('%Y-%m', date('now','-1 month')) || '-12', 'som', NULL, NULL, unixepoch(), 6),
  (15, 'Led the cleanliness drive',               strftime('%Y-%m', date('now','-1 month')) || '-08', 'som', NULL, NULL, unixepoch(), 6),
  -- Prev-prev month SoM — further rotated.
  (4,  'Coached younger students on Kho-Kho',     strftime('%Y-%m', date('now','-2 months')) || '-07', 'som', NULL, NULL, unixepoch(), 6),
  (11, 'Maintained session notebook all month',   strftime('%Y-%m', date('now','-2 months')) || '-11', 'som', NULL, NULL, unixepoch(), 6),
  (18, 'Mentored a new joiner',                   strftime('%Y-%m', date('now','-2 months')) || '-14', 'som', NULL, NULL, unixepoch(), 6),
  -- Gold + silver medals, spread across the three months too.
  (2,  'Annual Competition — chess',              strftime('%Y-%m', 'now') || '-10', 'gold',   1,    NULL, unixepoch(), 6),
  (3,  'Running race — under-10',                 strftime('%Y-%m', 'now') || '-12', 'silver', NULL, 1,    unixepoch(), 6),
  (9,  'Kho-Kho inter-village championship',      strftime('%Y-%m', 'now') || '-15', 'gold',   2,    NULL, unixepoch(), 6),
  (15, 'Board games — puzzle solving',            strftime('%Y-%m', 'now') || '-08', 'silver', NULL, 1,    unixepoch(), 6),
  (10, 'District inter-school running',           strftime('%Y-%m', date('now','-1 month')) || '-20', 'gold', 1, NULL, unixepoch(), 6),
  (16, 'Story-writing competition',               strftime('%Y-%m', date('now','-2 months')) || '-22', 'silver', NULL, 1, unixepoch(), 6);

-- Attendance sessions. Three months (90 days) of synthetic fixture
-- data so the home "3-month trend" and drill-down "last month" /
-- "this month" views both have meaningful denominators. Profiles:
--   * Anandpur (v1):     NONE. Kept deliberately clean so the
--                        attendance route tests can insert a single
--                        session and assert its ratio without the
--                        seed skewing the drilldown window.
--   * Belur (v2):        every day for the last 89 days (unbroken
--                        streak, ~82% attendance). Star village —
--                        tops the "this week" insight card and
--                        drives the 3-month attendance trend.
--   * Chandragiri (v3):  every 2 days for 90 days, but silent for
--                        the last 5 days (at-risk). Lower attendance
--                        overall, so the trend shows divergence.
-- Events cycle across activities 3..8 so the session list isn't
-- monotone. Recursive CTE upper bound is raised to 89 (= 90 days).
INSERT INTO attendance_session (village_id, event_id, date, start_time, end_time, created_at, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT 2, 3 + (n % 6), date('now', '-' || n || ' days'), '10:30', '11:30', unixepoch(), 2
FROM days WHERE n BETWEEN 0 AND 89;

INSERT INTO attendance_session (village_id, event_id, date, start_time, end_time, created_at, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT 3, 3 + (n % 6), date('now', '-' || n || ' days'), '10:00', '11:00', unixepoch(), 3
FROM days WHERE n >= 5 AND n % 2 = 1 AND n <= 89;

-- Attendance marks — one row per (session, child-in-village). Present
-- flag uses deterministic modular arithmetic so each seeded village
-- gets a distinguishable attendance %:
--   v2: ~82% present (star village)
--   v3: ~58% (worst, matching its lapsed status)
INSERT INTO attendance_mark (session_id, student_id, present)
SELECT s.id, c.id,
  CASE s.village_id
    WHEN 2 THEN CASE WHEN ((s.id * 11 + c.id * 5) % 6) = 0 THEN 0 ELSE 1 END
    ELSE       CASE WHEN ((s.id * 17 + c.id * 3) % 5) <= 1 THEN 0 ELSE 1 END
  END
FROM attendance_session s
JOIN student c ON c.village_id = s.village_id
WHERE c.graduated_at IS NULL;

-- Media fixture — 3 months of photos + videos across the two active
-- villages. Rows only carry metadata; there are no R2 objects behind
-- them (the insights KPIs count rows, not bytes, and the home / list
-- UIs that render `url` aren't exercised from the seed). Same skip
-- rule as attendance: Anandpur (v1) stays empty so media route tests
-- don't see stale seed rows when they assert empty state.
--
-- Distribution is deliberately varied month-over-month so deltas on
-- the home KPI strip don't all read "flat":
--   * Belur images:  ~6 / 8 / 11 (latest highest → +delta)
--   * Belur videos:  ~2 / 3 / 4  (slow growth)
--   * Chandragiri:   ~4 / 3 / 1  (decline mirrors the at-risk status)
-- R2 keys are synthetic but shaped like production: kind/yyyy/mm/dd/
-- village_id/uuid.ext (§7.1).
INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-b-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/2/seed-b-img-' || n || '.jpg',
  'image/jpeg',
  240000 + (n * 1300),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  17.914, 77.5187,
  2, 2
FROM days
WHERE n <= 89 AND ((n BETWEEN 0 AND 89 AND n % 3 = 0));

INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-b-vid-' || n,
  'video',
  'video/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/2/seed-b-vid-' || n || '.mp4',
  'video/mp4',
  4200000 + (n * 12000),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  17.914, 77.5187,
  2, 2
FROM days
WHERE n IN (2, 9, 16, 23, 34, 47, 58, 72, 85);

INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-c-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/3/seed-c-img-' || n || '.jpg',
  'image/jpeg',
  215000 + (n * 900),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  17.9245, 77.521,
  3, 3
FROM days
WHERE n IN (7, 15, 21, 33, 44, 49, 63, 70);

INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-c-vid-' || n,
  'video',
  'video/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/3/seed-c-vid-' || n || '.mp4',
  'video/mp4',
  3900000 + (n * 11000),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  17.9245, 77.521,
  3, 3
FROM days
WHERE n IN (12, 38, 65);
