-- L1 seed. One geo path, one cluster with 3 villages, ~20 students.
-- Dummy data only. Plain-text passwords (L5 replaces with Argon2id).
--
-- Date columns use IST 'YYYY-MM-DD' (see schema.sql header).

DELETE FROM attendance_mark;
DELETE FROM attendance_session;
DELETE FROM student;
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
-- Convention: <role>-<village-or-cluster>, password "password".
INSERT INTO user (id, user_id, full_name, password, role, scope_level, scope_id, created_at) VALUES
  (1, 'vc-anandpur',    'VC Anandpur',    'password', 'vc',            'village', 1, unixepoch()),
  (2, 'vc-belur',       'VC Belur',       'password', 'vc',            'village', 2, unixepoch()),
  (3, 'vc-chandragiri', 'VC Chandragiri', 'password', 'vc',            'village', 3, unixepoch()),
  (4, 'af-bid01',       'AF Bidar 01',    'password', 'af',            'cluster', 1, unixepoch()),
  (5, 'cluster-bid01',  'Cluster Admin',  'password', 'cluster_admin', 'cluster', 1, unixepoch()),
  (6, 'super',          'Super Admin',    'password', 'super_admin',   'global',  NULL, unixepoch());

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
