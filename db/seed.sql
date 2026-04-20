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
  (1, 'vc-anandpur',    'VC Anandpur',     'password', 'vc',             'village',  1,    unixepoch()),
  (2, 'vc-belur',       'VC Belur',        'password', 'vc',             'village',  2,    unixepoch()),
  (3, 'vc-chandragiri', 'VC Chandragiri',  'password', 'vc',             'village',  3,    unixepoch()),
  (4, 'af-bid01',       'AF Bidar 01',     'password', 'af',             'cluster',  1,    unixepoch()),
  (5, 'cluster-bid01',  'Cluster Admin',   'password', 'cluster_admin',  'cluster',  1,    unixepoch()),
  (6, 'super',          'Super Admin',     'password', 'super_admin',    'global',   NULL, unixepoch()),
  (7, 'district-bid',   'District Admin',  'password', 'district_admin', 'district', 1,    unixepoch()),
  (8, 'region-sk',      'Region Admin',    'password', 'region_admin',   'region',   1,    unixepoch()),
  (9, 'state-ka',       'State Admin',     'password', 'state_admin',    'state',    1,    unixepoch()),
  (10,'zone-sz',        'Zone Admin',      'password', 'zone_admin',     'zone',     1,    unixepoch());

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

-- Sample achievements for the dashboard tile (§3.5). One SoM in the
-- current month per village (uniqueness is per student-month, not
-- village-month, so multiple villages may each have their own SoM).
-- Gold/Silver medal rows show the medal-count fields. Dates land in
-- the current month so the drill-down's default "this month" window
-- (§3.5 acceptance) always has data to show.
-- Dates anchor on the start of the current month (IST is close
-- enough to UTC for seed data; `now` in SQLite is UTC, but a one-
-- day drift on a lab seed is fine). `substr(strftime('%Y-%m','now'))
-- || '-DD'` yields 'YYYY-MM-DD' text matching the TEXT date
-- convention from 0001_init.sql.
INSERT INTO achievement (student_id, description, date, type, gold_count, silver_count, created_at, created_by) VALUES
  (1,  'Perfect attendance & peer mentoring',     strftime('%Y-%m', 'now') || '-05', 'som',    NULL, NULL, unixepoch(), 6),
  (8,  'Led the story-circle every Thursday',     strftime('%Y-%m', 'now') || '-06', 'som',    NULL, NULL, unixepoch(), 6),
  (14, 'Helped set up the reading corner',        strftime('%Y-%m', 'now') || '-07', 'som',    NULL, NULL, unixepoch(), 6),
  (2,  'Annual Competition — chess',              strftime('%Y-%m', 'now') || '-10', 'gold',   1,    NULL, unixepoch(), 6),
  (3,  'Running race — under-10',                 strftime('%Y-%m', 'now') || '-12', 'silver', NULL, 1,    unixepoch(), 6),
  (9,  'Kho-Kho inter-village championship',      strftime('%Y-%m', 'now') || '-15', 'gold',   2,    NULL, unixepoch(), 6),
  (15, 'Board games — puzzle solving',            strftime('%Y-%m', 'now') || '-08', 'silver', NULL, 1,    unixepoch(), 6);

-- Attendance sessions. Synthetic fixture data to light up the insights
-- panel, streak chip, and drill-down dashboards. Profiles by village:
--   * Anandpur (v1):     NONE. Kept deliberately clean so the
--                        attendance route tests can insert a single
--                        session and assert its ratio without the
--                        seed skewing the drilldown window.
--   * Belur (v2):        every day for the last 21 days (unbroken
--                        streak, ~82% attendance). Star village —
--                        tops the "this week" insight card.
--   * Chandragiri (v3):  ran every 2 days up to 5 days ago, then
--                        silence (surfaces as the "at-risk village"
--                        insight card).
-- Events cycle across activities 3..8 so the session list isn't
-- monotone.
INSERT INTO attendance_session (village_id, event_id, date, start_time, end_time, created_at, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 27)
SELECT 2, 3 + (n % 6), date('now', '-' || n || ' days'), '10:30', '11:30', unixepoch(), 2
FROM days WHERE n BETWEEN 0 AND 20;

INSERT INTO attendance_session (village_id, event_id, date, start_time, end_time, created_at, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 27)
SELECT 3, 3 + (n % 6), date('now', '-' || n || ' days'), '10:00', '11:00', unixepoch(), 3
FROM days WHERE n >= 5 AND n % 2 = 1 AND n <= 25;

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
