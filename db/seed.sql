-- Lab seed. Expanded from the L1 single-cluster sample to cover
-- NavSahyog's real footprint — Karnataka, Tamil Nadu and Nagaland —
-- so dashboard drill-downs light up at every level and a reviewer
-- can walk india → zone → state → region → district → cluster →
-- village without running into dead scopes.
--
-- Dummy data only. Plain-text passwords (L5 replaces with Argon2id).
-- Date columns use IST 'YYYY-MM-DD' (see schema.sql header).
--
-- ID stability: every existing ID from the L1 seed (village 1-3,
-- student 1-20, user 1-10, cluster 1, district 1, region 1, state 1,
-- zone 1) is preserved so fixtures in apps/api/test continue to
-- resolve. New rows extend after those IDs.

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
-- Jal Vriddhi (§3.10, §4.3.10): pond_agreement_version → pond →
-- farmer. All hang off user + village, so they drop before either.
DELETE FROM pond_agreement_version;
DELETE FROM pond;
DELETE FROM farmer;
DELETE FROM event;
DELETE FROM school;
DELETE FROM session;
DELETE FROM qualification;
DELETE FROM user;
DELETE FROM village;
DELETE FROM cluster;
DELETE FROM district;
DELETE FROM region;
DELETE FROM state;
DELETE FROM zone;

-- Zones: South Zone covers KA + TN; Northeast Zone covers NL.
INSERT INTO zone (id, name, code) VALUES
  (1, 'South Zone',     'SZ'),
  (2, 'Northeast Zone', 'NE');

-- States: three real-world operating states. Karnataka is zone SZ,
-- Tamil Nadu is zone SZ, Nagaland is zone NE.
INSERT INTO state (id, zone_id, name, code) VALUES
  (1, 1, 'Karnataka',  'KA'),
  (2, 1, 'Tamil Nadu', 'TN'),
  (3, 2, 'Nagaland',   'NL');

-- Regions: two per state, which gives the region drill-down a
-- non-trivial row set at every state scope.
INSERT INTO region (id, state_id, name, code) VALUES
  (1, 1, 'South Karnataka',  'SK'),
  (2, 1, 'North Karnataka',  'NK'),
  (3, 2, 'North Tamil Nadu', 'NTN'),
  (4, 2, 'South Tamil Nadu', 'STN'),
  (5, 3, 'Central Nagaland', 'CNL'),
  (6, 3, 'Eastern Nagaland', 'ENL');

-- Districts: 1-2 per region. District 1 (Bidar) preserved from L1.
INSERT INTO district (id, region_id, name, code) VALUES
  (1, 1, 'Bidar',         'BID'),
  (2, 1, 'Mysuru',        'MYS'),
  (3, 2, 'Kalaburagi',    'KLB'),
  (4, 3, 'Chennai Rural', 'CHN'),
  (5, 3, 'Vellore',       'VLR'),
  (6, 4, 'Madurai',       'MDU'),
  (7, 5, 'Kohima',        'KHM'),
  (8, 6, 'Mokokchung',    'MKC');

-- Clusters: one per district except Vellore (2), so the cluster
-- drill-down at district=5 shows genuine differentiation.
INSERT INTO cluster (id, district_id, name, code) VALUES
  (1, 1, 'Bidar Cluster 1',         'BID01'),
  (2, 2, 'Mysuru Cluster 1',        'MYS01'),
  (3, 3, 'Kalaburagi Cluster 1',    'KLB01'),
  (4, 4, 'Chennai Rural Cluster 1', 'CHN01'),
  (5, 5, 'Vellore Cluster 1',       'VLR01'),
  (6, 5, 'Vellore Cluster 2',       'VLR02'),
  (7, 6, 'Madurai Cluster 1',       'MDU01'),
  (8, 7, 'Kohima Cluster 1',        'KHM01'),
  (9, 8, 'Mokokchung Cluster 1',    'MKC01');

-- Villages: 3 per cluster in Bidar (L1 seed), 2 per new cluster.
-- 19 total. Names chosen to match the district's cultural region
-- (Kannada names in KA, Tamil in TN, Naga in NL).
INSERT INTO village (id, cluster_id, name, code) VALUES
  (1,  1, 'Anandpur',      'BID01-V1'),
  (2,  1, 'Belur',         'BID01-V2'),
  (3,  1, 'Chandragiri',   'BID01-V3'),
  (4,  2, 'Hallare',       'MYS01-V1'),
  (5,  2, 'Srirangapatna', 'MYS01-V2'),
  (6,  3, 'Aland',         'KLB01-V1'),
  (7,  3, 'Afzalpur',      'KLB01-V2'),
  (8,  4, 'Tiruvallur',    'CHN01-V1'),
  (9,  4, 'Poonamallee',   'CHN01-V2'),
  (10, 5, 'Gudiyatham',    'VLR01-V1'),
  (11, 5, 'Arcot',         'VLR01-V2'),
  (12, 6, 'Ambur',         'VLR02-V1'),
  (13, 6, 'Vaniyambadi',   'VLR02-V2'),
  (14, 7, 'Melur',         'MDU01-V1'),
  (15, 7, 'Usilampatti',   'MDU01-V2'),
  (16, 8, 'Sechu',         'KHM01-V1'),
  (17, 8, 'Jakhama',       'KHM01-V2'),
  (18, 9, 'Ungma',         'MKC01-V1'),
  (19, 9, 'Longsa',        'MKC01-V2');

-- One school per village.
INSERT INTO school (id, village_id, name) VALUES
  (1,  1,  'Anandpur Government School'),
  (2,  2,  'Belur Anganwadi'),
  (3,  3,  'Chandragiri Primary School'),
  (4,  4,  'Hallare Government School'),
  (5,  5,  'Srirangapatna Primary School'),
  (6,  6,  'Aland Government Higher Primary School'),
  (7,  7,  'Afzalpur Anganwadi'),
  (8,  8,  'Tiruvallur Panchayat School'),
  (9,  9,  'Poonamallee Primary School'),
  (10, 10, 'Gudiyatham Government School'),
  (11, 11, 'Arcot Anganwadi'),
  (12, 12, 'Ambur Primary School'),
  (13, 13, 'Vaniyambadi Government School'),
  (14, 14, 'Melur Panchayat School'),
  (15, 15, 'Usilampatti Government Primary School'),
  (16, 16, 'Sechu Government School'),
  (17, 17, 'Jakhama Primary School'),
  (18, 18, 'Ungma Government School'),
  (19, 19, 'Longsa Anganwadi');

-- Users. Passwords are plain-text per L1 (see mvp/level-1.md).
-- Convention: <role>-<scope>, password "password".
--
-- IDs 1–10 are the L1/L2 founding accounts and stay stable — the
-- test suite binds to them by user_id, and student.created_by = 6
-- foreign keys from L1 still resolve. Every new row lives at id ≥ 11.
-- Role pyramid is one VC per village, one AF + one cluster admin per
-- cluster, and one admin at every scope above (district / region /
-- state / zone). A reviewer logging in as any of these sees exactly
-- the sub-tree they should.
INSERT INTO user (id, user_id, full_name, password, role, scope_level, scope_id, created_at) VALUES
  -- L1 write-tier (unchanged).
  (1,  'vc-anandpur',    'Sunita Patil',       'password', 'vc',             'village',  1,    unixepoch()),
  (2,  'vc-belur',       'Ramesh Kulkarni',    'password', 'vc',             'village',  2,    unixepoch()),
  (3,  'vc-chandragiri', 'Kavita Gowda',       'password', 'vc',             'village',  3,    unixepoch()),
  (4,  'af-bid01',       'Anil Rao',           'password', 'af',             'cluster',  1,    unixepoch()),
  (5,  'cluster-bid01',  'Priya Deshpande',    'password', 'cluster_admin',  'cluster',  1,    unixepoch()),
  (6,  'super',          'Super Admin',        'password', 'super_admin',    'global',   NULL, unixepoch()),
  -- L2 read-only geo-admin tiers anchored on the L1 scopes (unchanged).
  (7,  'district-bid',   'Meera Joshi',        'password', 'district_admin', 'district', 1,    unixepoch()),
  (8,  'region-sk',      'Rohan Hegde',        'password', 'region_admin',   'region',   1,    unixepoch()),
  (9,  'state-ka',       'Lata Iyer',          'password', 'state_admin',    'state',    1,    unixepoch()),
  (10, 'zone-sz',        'Nikhil Shetty',      'password', 'zone_admin',     'zone',     1,    unixepoch()),
  -- VCs for the 16 new villages (v4..v19).
  (11, 'vc-hallare',       'Shivamma Gowda',    'password', 'vc', 'village', 4,  unixepoch()),
  (12, 'vc-srirangapatna', 'Nagaraj Urs',       'password', 'vc', 'village', 5,  unixepoch()),
  (13, 'vc-aland',         'Basavaraj Patil',   'password', 'vc', 'village', 6,  unixepoch()),
  (14, 'vc-afzalpur',      'Mehrunnisa Begum',  'password', 'vc', 'village', 7,  unixepoch()),
  (15, 'vc-tiruvallur',    'Saravanan Murugan', 'password', 'vc', 'village', 8,  unixepoch()),
  (16, 'vc-poonamallee',   'Lakshmi Subramani', 'password', 'vc', 'village', 9,  unixepoch()),
  (17, 'vc-gudiyatham',    'Rajeshwari Pillai', 'password', 'vc', 'village', 10, unixepoch()),
  (18, 'vc-arcot',         'Arumugam Devar',    'password', 'vc', 'village', 11, unixepoch()),
  (19, 'vc-ambur',         'Fatima Khatoon',    'password', 'vc', 'village', 12, unixepoch()),
  (20, 'vc-vaniyambadi',   'Kumaresan Raja',    'password', 'vc', 'village', 13, unixepoch()),
  (21, 'vc-melur',         'Chitra Pandian',    'password', 'vc', 'village', 14, unixepoch()),
  (22, 'vc-usilampatti',   'Velu Thevar',       'password', 'vc', 'village', 15, unixepoch()),
  (23, 'vc-sechu',         'Imlikumba Ao',      'password', 'vc', 'village', 16, unixepoch()),
  (24, 'vc-jakhama',       'Neizo Angami',      'password', 'vc', 'village', 17, unixepoch()),
  (25, 'vc-ungma',         'Tsukjem Jamir',     'password', 'vc', 'village', 18, unixepoch()),
  (26, 'vc-longsa',        'Chubala Longchar',  'password', 'vc', 'village', 19, unixepoch()),
  -- AFs: one per new cluster (c2..c9).
  (27, 'af-mys01', 'Deepa Krishnappa',  'password', 'af', 'cluster', 2, unixepoch()),
  (28, 'af-klb01', 'Vinod Koulgi',      'password', 'af', 'cluster', 3, unixepoch()),
  (29, 'af-chn01', 'Senthil Vel',       'password', 'af', 'cluster', 4, unixepoch()),
  (30, 'af-vlr01', 'Gowri Sundaram',    'password', 'af', 'cluster', 5, unixepoch()),
  (31, 'af-vlr02', 'Karthik Rangaraj',  'password', 'af', 'cluster', 6, unixepoch()),
  (32, 'af-mdu01', 'Pandiyan Ramasamy', 'password', 'af', 'cluster', 7, unixepoch()),
  (33, 'af-khm01', 'Thejano Kire',      'password', 'af', 'cluster', 8, unixepoch()),
  (34, 'af-mkc01', 'Alemla Pongen',     'password', 'af', 'cluster', 9, unixepoch()),
  -- Cluster admins: one per new cluster (c2..c9).
  (35, 'cluster-mys01', 'Suma Narasimhan',   'password', 'cluster_admin', 'cluster', 2, unixepoch()),
  (36, 'cluster-klb01', 'Prashant Jamadar',  'password', 'cluster_admin', 'cluster', 3, unixepoch()),
  (37, 'cluster-chn01', 'Vimala Sundaram',   'password', 'cluster_admin', 'cluster', 4, unixepoch()),
  (38, 'cluster-vlr01', 'Mani Perumal',      'password', 'cluster_admin', 'cluster', 5, unixepoch()),
  (39, 'cluster-vlr02', 'Hema Chandrasekar', 'password', 'cluster_admin', 'cluster', 6, unixepoch()),
  (40, 'cluster-mdu01', 'Muthuraj Ganesan',  'password', 'cluster_admin', 'cluster', 7, unixepoch()),
  (41, 'cluster-khm01', 'Kevichuzo Sakhrie', 'password', 'cluster_admin', 'cluster', 8, unixepoch()),
  (42, 'cluster-mkc01', 'Merenyanger Imchen','password', 'cluster_admin', 'cluster', 9, unixepoch()),
  -- District admins for the new districts (d2..d8).
  (43, 'district-mys', 'Girish Bhat',        'password', 'district_admin', 'district', 2, unixepoch()),
  (44, 'district-klb', 'Savitri Doddamani',  'password', 'district_admin', 'district', 3, unixepoch()),
  (45, 'district-chn', 'Ravindran Iyer',     'password', 'district_admin', 'district', 4, unixepoch()),
  (46, 'district-vlr', 'Bhuvaneshwari Arul', 'password', 'district_admin', 'district', 5, unixepoch()),
  (47, 'district-mdu', 'Palani Shanmugam',   'password', 'district_admin', 'district', 6, unixepoch()),
  (48, 'district-khm', 'Visakuo Rio',        'password', 'district_admin', 'district', 7, unixepoch()),
  (49, 'district-mkc', 'Watisunep Ao',       'password', 'district_admin', 'district', 8, unixepoch()),
  -- Region admins for the new regions (r2..r6).
  (50, 'region-nk',  'Suresh Kulkarni',   'password', 'region_admin', 'region', 2, unixepoch()),
  (51, 'region-ntn', 'Kasthuri Rajan',    'password', 'region_admin', 'region', 3, unixepoch()),
  (52, 'region-stn', 'Manikandan Velu',   'password', 'region_admin', 'region', 4, unixepoch()),
  (53, 'region-cnl', 'Kezhokhoto Khieya', 'password', 'region_admin', 'region', 5, unixepoch()),
  (54, 'region-enl', 'Bendang Jamir',     'password', 'region_admin', 'region', 6, unixepoch()),
  -- State admins for the new states (s2, s3).
  (55, 'state-tn', 'Anbarasi Thangavel', 'password', 'state_admin', 'state', 2, unixepoch()),
  (56, 'state-nl', 'Lhousietuo Nagi',    'password', 'state_admin', 'state', 3, unixepoch()),
  -- Second zone admin (z2 Northeast Zone).
  (57, 'zone-ne', 'Temsula Longkumer', 'password', 'zone_admin', 'zone', 2, unixepoch());

-- Students. 96 total across 19 villages.
--   v1 Anandpur     (BID01): 7   ids 1..7    (L1 seed)
--   v2 Belur        (BID01): 6   ids 8..13   (L1 seed)
--   v3 Chandragiri  (BID01): 7   ids 14..20  (L1 seed)
--   v4..v19                 : 76  ids 21..96 (this seed)
-- IDs 1-20 are preserved for the existing test fixtures. New rows
-- get autoincremented ids 21..96 in insertion order.
--
-- Names are drawn from the district's cultural namespace: Kannada in
-- KA, Tamil in TN, Naga in NL. A reviewer walking the village picker
-- should feel the three states, not a homogenised fixture.
--
-- DOB and joined_at are IST calendar dates ('YYYY-MM-DD').
-- created_at stays a UTC epoch (audit timestamp, not a calendar date).
-- created_by points at the village's own VC for v4..v19, and at user
-- 6 (super) for v1..v3 so the L1 fixtures don't shift.
INSERT INTO student (village_id, school_id, first_name, last_name, gender, dob, joined_at, created_at, created_by) VALUES
  -- v1 Anandpur (ids 1..7).
  (1, 1, 'Aarav',  'Patil',    'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Aditi',  'Rao',      'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Arjun',  'Deshpande','m', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Bhavya', 'Kulkarni', 'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Chirag', 'Naik',     'm', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Diya',   'Shetty',   'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (1, 1, 'Eshan',  'Pai',      'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  -- v2 Belur (ids 8..13).
  (2, 2, 'Farhan', 'Ali',      'm', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Gauri',  'Hegde',    'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Hitesh', 'Bhat',     'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Ishaan', 'Gowda',    'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Jaya',   'Kamath',   'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (2, 2, 'Kiran',  'Murthy',   'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  -- v3 Chandragiri (ids 14..20).
  (3, 3, 'Lakshmi','Iyer',     'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Manav',  'Joshi',    'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Nidhi',  'Kalburgi', 'f', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Om',     'Mallya',   'm', '2017-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Priya',  'Nambiar',  'f', '2015-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Rahul',  'Prabhu',   'm', '2019-01-01', '2024-06-01', unixepoch(), 6),
  (3, 3, 'Sneha',  'Rao',      'f', '2017-01-01', '2024-06-01', unixepoch(), 6),
  -- v4 Hallare / MYS01 (ids 21..25). Kannada names.
  (4,  4,  'Aarush',   'Shenoy',     'm', '2017-01-01', '2024-07-01', unixepoch(), 11),
  (4,  4,  'Ananya',   'Pai',        'f', '2016-01-01', '2024-07-01', unixepoch(), 11),
  (4,  4,  'Bhuvan',   'Hegde',      'm', '2018-01-01', '2024-07-01', unixepoch(), 11),
  (4,  4,  'Charita',  'Kamath',     'f', '2019-01-01', '2024-07-01', unixepoch(), 11),
  (4,  4,  'Darshan',  'Bhat',       'm', '2015-01-01', '2024-07-01', unixepoch(), 11),
  -- v5 Srirangapatna / MYS01 (ids 26..30).
  (5,  5,  'Esha',     'Rao',        'f', '2017-01-01', '2024-07-01', unixepoch(), 12),
  (5,  5,  'Girish',   'Naik',       'm', '2015-01-01', '2024-07-01', unixepoch(), 12),
  (5,  5,  'Harika',   'Iyengar',    'f', '2019-01-01', '2024-07-01', unixepoch(), 12),
  (5,  5,  'Ishan',    'Prabhu',     'm', '2018-01-01', '2024-07-01', unixepoch(), 12),
  (5,  5,  'Janaki',   'Acharya',    'f', '2016-01-01', '2024-07-01', unixepoch(), 12),
  -- v6 Aland / KLB01 (ids 31..35).
  (6,  6,  'Kavya',    'Kulkarni',   'f', '2017-01-01', '2024-08-01', unixepoch(), 13),
  (6,  6,  'Lohith',   'Desai',      'm', '2015-01-01', '2024-08-01', unixepoch(), 13),
  (6,  6,  'Meghana',  'Jamadar',    'f', '2019-01-01', '2024-08-01', unixepoch(), 13),
  (6,  6,  'Nihar',    'Patil',      'm', '2018-01-01', '2024-08-01', unixepoch(), 13),
  (6,  6,  'Pranav',   'Kamble',     'm', '2016-01-01', '2024-08-01', unixepoch(), 13),
  -- v7 Afzalpur / KLB01 (ids 36..39).
  (7,  7,  'Qasim',    'Shaikh',     'm', '2017-01-01', '2024-08-01', unixepoch(), 14),
  (7,  7,  'Rameez',   'Inamdar',    'm', '2015-01-01', '2024-08-01', unixepoch(), 14),
  (7,  7,  'Saniya',   'Begum',      'f', '2019-01-01', '2024-08-01', unixepoch(), 14),
  (7,  7,  'Tariq',    'Mulla',      'm', '2018-01-01', '2024-08-01', unixepoch(), 14),
  -- v8 Tiruvallur / CHN01 (ids 40..44). Tamil names.
  (8,  8,  'Aadhi',    'Murugan',    'm', '2017-01-01', '2024-07-15', unixepoch(), 15),
  (8,  8,  'Bhavana',  'Selvi',      'f', '2015-01-01', '2024-07-15', unixepoch(), 15),
  (8,  8,  'Chandran', 'Raja',       'm', '2019-01-01', '2024-07-15', unixepoch(), 15),
  (8,  8,  'Deepika',  'Senthil',    'f', '2018-01-01', '2024-07-15', unixepoch(), 15),
  (8,  8,  'Eeshwar',  'Velu',       'm', '2016-01-01', '2024-07-15', unixepoch(), 15),
  -- v9 Poonamallee / CHN01 (ids 45..49).
  (9,  9,  'Fathima',  'Banu',       'f', '2017-01-01', '2024-07-15', unixepoch(), 16),
  (9,  9,  'Gokul',    'Subramani',  'm', '2015-01-01', '2024-07-15', unixepoch(), 16),
  (9,  9,  'Harini',   'Selva',      'f', '2019-01-01', '2024-07-15', unixepoch(), 16),
  (9,  9,  'Indrajit', 'Perumal',    'm', '2018-01-01', '2024-07-15', unixepoch(), 16),
  (9,  9,  'Jeeva',    'Karthick',   'm', '2016-01-01', '2024-07-15', unixepoch(), 16),
  -- v10 Gudiyatham / VLR01 (ids 50..53).
  (10, 10, 'Kalaimani','Raja',       'f', '2017-01-01', '2024-08-01', unixepoch(), 17),
  (10, 10, 'Lingesh',  'Pandian',    'm', '2015-01-01', '2024-08-01', unixepoch(), 17),
  (10, 10, 'Malar',    'Vetri',      'f', '2019-01-01', '2024-08-01', unixepoch(), 17),
  (10, 10, 'Navneeth', 'Raman',      'm', '2018-01-01', '2024-08-01', unixepoch(), 17),
  -- v11 Arcot / VLR01 (ids 54..57).
  (11, 11, 'Ozhili',   'Arul',       'f', '2017-01-01', '2024-08-01', unixepoch(), 18),
  (11, 11, 'Prakash',  'Devar',      'm', '2015-01-01', '2024-08-01', unixepoch(), 18),
  (11, 11, 'Rekha',    'Thangam',    'f', '2019-01-01', '2024-08-01', unixepoch(), 18),
  (11, 11, 'Santhosh', 'Balu',       'm', '2018-01-01', '2024-08-01', unixepoch(), 18),
  -- v12 Ambur / VLR02 (ids 58..62).
  (12, 12, 'Thahira',  'Nazeer',     'f', '2017-01-01', '2024-08-01', unixepoch(), 19),
  (12, 12, 'Udhay',    'Kumar',      'm', '2015-01-01', '2024-08-01', unixepoch(), 19),
  (12, 12, 'Vidya',    'Lakshmi',    'f', '2019-01-01', '2024-08-01', unixepoch(), 19),
  (12, 12, 'Waseem',   'Hussain',    'm', '2018-01-01', '2024-08-01', unixepoch(), 19),
  (12, 12, 'Yamini',   'Sundari',    'f', '2016-01-01', '2024-08-01', unixepoch(), 19),
  -- v13 Vaniyambadi / VLR02 (ids 63..67).
  (13, 13, 'Zakir',    'Hussain',    'm', '2017-01-01', '2024-08-01', unixepoch(), 20),
  (13, 13, 'Aarthi',   'Mohan',      'f', '2015-01-01', '2024-08-01', unixepoch(), 20),
  (13, 13, 'Balaji',   'Ramesh',     'm', '2019-01-01', '2024-08-01', unixepoch(), 20),
  (13, 13, 'Chitra',   'Pandian',    'f', '2018-01-01', '2024-08-01', unixepoch(), 20),
  (13, 13, 'Dinesh',   'Kumar',      'm', '2016-01-01', '2024-08-01', unixepoch(), 20),
  -- v14 Melur / MDU01 (ids 68..72).
  (14, 14, 'Elango',   'Pandi',      'm', '2017-01-01', '2024-09-01', unixepoch(), 21),
  (14, 14, 'Fathima',  'Jamal',      'f', '2015-01-01', '2024-09-01', unixepoch(), 21),
  (14, 14, 'Gayathri', 'Pandiyan',   'f', '2019-01-01', '2024-09-01', unixepoch(), 21),
  (14, 14, 'Hariharan','Kumar',      'm', '2018-01-01', '2024-09-01', unixepoch(), 21),
  (14, 14, 'Ilavarasi','Raja',       'f', '2016-01-01', '2024-09-01', unixepoch(), 21),
  -- v15 Usilampatti / MDU01 (ids 73..77).
  (15, 15, 'Jayanthi', 'Velu',       'f', '2017-01-01', '2024-09-01', unixepoch(), 22),
  (15, 15, 'Kavin',    'Pandi',      'm', '2015-01-01', '2024-09-01', unixepoch(), 22),
  (15, 15, 'Lalitha',  'Muthu',      'f', '2019-01-01', '2024-09-01', unixepoch(), 22),
  (15, 15, 'Madhavan', 'Raja',       'm', '2018-01-01', '2024-09-01', unixepoch(), 22),
  (15, 15, 'Nithya',   'Selvam',     'f', '2016-01-01', '2024-09-01', unixepoch(), 22),
  -- v16 Sechu / KHM01 (ids 78..82). Naga names.
  (16, 16, 'Asenla',     'Lemtur',   'f', '2017-01-01', '2024-09-15', unixepoch(), 23),
  (16, 16, 'Bendang',    'Imchen',   'm', '2015-01-01', '2024-09-15', unixepoch(), 23),
  (16, 16, 'Chubayanger','Ao',       'm', '2019-01-01', '2024-09-15', unixepoch(), 23),
  (16, 16, 'Diyano',     'Angami',   'f', '2018-01-01', '2024-09-15', unixepoch(), 23),
  (16, 16, 'Entoli',     'Kikon',    'm', '2016-01-01', '2024-09-15', unixepoch(), 23),
  -- v17 Jakhama / KHM01 (ids 83..87).
  (17, 17, 'Fabi',       'Dolie',    'f', '2017-01-01', '2024-09-15', unixepoch(), 24),
  (17, 17, 'Gwayhunlo',  'Angami',   'm', '2015-01-01', '2024-09-15', unixepoch(), 24),
  (17, 17, 'Hekani',     'Kehie',    'f', '2019-01-01', '2024-09-15', unixepoch(), 24),
  (17, 17, 'Imchanba',   'Jamir',    'm', '2018-01-01', '2024-09-15', unixepoch(), 24),
  (17, 17, 'Juno',       'Kiho',     'f', '2016-01-01', '2024-09-15', unixepoch(), 24),
  -- v18 Ungma / MKC01 (ids 88..91).
  (18, 18, 'Keduovinuo', 'Pienyu',   'f', '2017-01-01', '2024-10-01', unixepoch(), 25),
  (18, 18, 'Lanu',       'Jamir',    'm', '2015-01-01', '2024-10-01', unixepoch(), 25),
  (18, 18, 'Mhalo',      'Sumi',     'f', '2019-01-01', '2024-10-01', unixepoch(), 25),
  (18, 18, 'Nokcha',     'Walling',  'm', '2018-01-01', '2024-10-01', unixepoch(), 25),
  -- v19 Longsa / MKC01 (ids 92..96).
  (19, 19, 'Obi',        'Ao',       'm', '2017-01-01', '2024-10-01', unixepoch(), 26),
  (19, 19, 'Pangerlemla','Pongen',   'f', '2015-01-01', '2024-10-01', unixepoch(), 26),
  (19, 19, 'Renben',     'Kikon',    'm', '2019-01-01', '2024-10-01', unixepoch(), 26),
  (19, 19, 'Sashiben',   'Longchar', 'f', '2018-01-01', '2024-10-01', unixepoch(), 26),
  (19, 19, 'Tialemla',   'Imchen',   'f', '2016-01-01', '2024-10-01', unixepoch(), 26);

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

-- Additional achievements for the 16 new villages (v4..v19). The
-- cluster=1 seed above stays at exactly 7 current-month rows (3 SoM
-- + 2 gold + 2 silver, preserved for the test fixture). Rows below
-- all reference students 21..96, so the cluster=1 tally doesn't
-- move. Distribution maps to each village's narrative:
--   * Star villages (v4 Hallare, v8 Tiruvallur, v19 Longsa) carry
--     2 SoM + a medal or two in the current month — they dominate
--     the "best this month" lists.
--   * Mid villages get 1 current-month SoM and a trailing one.
--   * At-risk villages (v7, v10, v14, v18) have nothing in the
--     current month — only a faded prev / prev-prev entry — so the
--     "no recent achievements" chip lights up in drill-downs.
INSERT INTO achievement (student_id, description, date, type, gold_count, silver_count, created_at, created_by) VALUES
  -- Current-month SoM (one row per SoM; unique on (student, month)).
  (21, 'Led the Hallare reading circle',            strftime('%Y-%m', 'now') || '-06', 'som', NULL, NULL, unixepoch(), 11),
  (22, 'Best attendance in Hallare',                strftime('%Y-%m', 'now') || '-08', 'som', NULL, NULL, unixepoch(), 11),
  (26, 'Helped juniors with Kannada reading',       strftime('%Y-%m', 'now') || '-09', 'som', NULL, NULL, unixepoch(), 12),
  (31, 'Cleanliness drive lead — Aland',            strftime('%Y-%m', 'now') || '-07', 'som', NULL, NULL, unixepoch(), 13),
  (40, 'Star of the month — Tiruvallur',            strftime('%Y-%m', 'now') || '-05', 'som', NULL, NULL, unixepoch(), 15),
  (41, 'Peer mentoring — Tamil reading',            strftime('%Y-%m', 'now') || '-11', 'som', NULL, NULL, unixepoch(), 15),
  (45, 'Perfect attendance — Poonamallee',          strftime('%Y-%m', 'now') || '-10', 'som', NULL, NULL, unixepoch(), 16),
  (54, 'Led the Arcot drawing competition',         strftime('%Y-%m', 'now') || '-12', 'som', NULL, NULL, unixepoch(), 18),
  (58, 'Helped set up the Ambur reading corner',    strftime('%Y-%m', 'now') || '-13', 'som', NULL, NULL, unixepoch(), 19),
  (59, 'Peer mentoring — Ambur',                    strftime('%Y-%m', 'now') || '-14', 'som', NULL, NULL, unixepoch(), 19),
  (63, 'Organised the Vaniyambadi story-circle',    strftime('%Y-%m', 'now') || '-08', 'som', NULL, NULL, unixepoch(), 20),
  (73, 'Attendance streak — Usilampatti',           strftime('%Y-%m', 'now') || '-15', 'som', NULL, NULL, unixepoch(), 22),
  (78, 'Led the Sechu community song',              strftime('%Y-%m', 'now') || '-06', 'som', NULL, NULL, unixepoch(), 23),
  (83, 'Star of the month — Jakhama',               strftime('%Y-%m', 'now') || '-09', 'som', NULL, NULL, unixepoch(), 24),
  (92, 'Led the Longsa handicraft workshop',        strftime('%Y-%m', 'now') || '-10', 'som', NULL, NULL, unixepoch(), 26),
  (93, 'Perfect attendance — Longsa',               strftime('%Y-%m', 'now') || '-11', 'som', NULL, NULL, unixepoch(), 26),
  -- Current-month Gold / Silver medals.
  (23, 'District chess championship',               strftime('%Y-%m', 'now') || '-14', 'gold',   1, NULL, unixepoch(), 11),
  (27, 'Inter-village drawing contest',             strftime('%Y-%m', 'now') || '-16', 'silver', NULL, 1, unixepoch(), 12),
  (32, 'Kabaddi — district under-12',               strftime('%Y-%m', 'now') || '-17', 'gold',   1, NULL, unixepoch(), 13),
  (42, 'Running race — state under-10',             strftime('%Y-%m', 'now') || '-18', 'gold',   2, NULL, unixepoch(), 15),
  (43, 'Board games — state finals',                strftime('%Y-%m', 'now') || '-19', 'silver', NULL, 1, unixepoch(), 15),
  (55, 'Storytelling — district second place',      strftime('%Y-%m', 'now') || '-20', 'gold',   1, NULL, unixepoch(), 18),
  (74, 'Kho-Kho — district winner',                 strftime('%Y-%m', 'now') || '-21', 'silver', NULL, 1, unixepoch(), 22),
  (79, 'Athletics — state meet',                    strftime('%Y-%m', 'now') || '-13', 'gold',   1, NULL, unixepoch(), 23),
  (94, 'Naga folk dance competition',               strftime('%Y-%m', 'now') || '-16', 'gold',   2, NULL, unixepoch(), 26),
  -- Previous-month SoM.
  (24, 'Led the Hallare drawing class',             strftime('%Y-%m', date('now','-1 month')) || '-12', 'som', NULL, NULL, unixepoch(), 11),
  (28, 'Helped organise parent meeting',            strftime('%Y-%m', date('now','-1 month')) || '-14', 'som', NULL, NULL, unixepoch(), 12),
  (36, 'Mentored junior — Afzalpur',                strftime('%Y-%m', date('now','-1 month')) || '-09', 'som', NULL, NULL, unixepoch(), 14),
  (46, 'Attendance streak — Poonamallee',           strftime('%Y-%m', date('now','-1 month')) || '-15', 'som', NULL, NULL, unixepoch(), 16),
  (60, 'Led Ambur cleanliness drive',               strftime('%Y-%m', date('now','-1 month')) || '-11', 'som', NULL, NULL, unixepoch(), 19),
  (64, 'Peer teaching — Vaniyambadi',               strftime('%Y-%m', date('now','-1 month')) || '-13', 'som', NULL, NULL, unixepoch(), 20),
  (80, 'Organised the Sechu sports day',            strftime('%Y-%m', date('now','-1 month')) || '-10', 'som', NULL, NULL, unixepoch(), 23),
  (95, 'Star of the month — Longsa',                strftime('%Y-%m', date('now','-1 month')) || '-12', 'som', NULL, NULL, unixepoch(), 26),
  -- Previous-month Gold / Silver.
  (25, 'Inter-school quiz — prev month',            strftime('%Y-%m', date('now','-1 month')) || '-17', 'silver', NULL, 1, unixepoch(), 11),
  (61, 'District chess — prev month',               strftime('%Y-%m', date('now','-1 month')) || '-18', 'gold',   1, NULL, unixepoch(), 19),
  (84, 'Drawing competition — prev month',          strftime('%Y-%m', date('now','-1 month')) || '-19', 'silver', NULL, 1, unixepoch(), 24),
  -- Prev-prev-month SoM (keeps the 3-month trend non-empty).
  (33, 'Aland Jal Vriddhi leader',                  strftime('%Y-%m', date('now','-2 months')) || '-08', 'som', NULL, NULL, unixepoch(), 13),
  (44, 'Tiruvallur story-writing',                  strftime('%Y-%m', date('now','-2 months')) || '-10', 'som', NULL, NULL, unixepoch(), 15),
  (50, 'Gudiyatham — held together through monsoon',strftime('%Y-%m', date('now','-2 months')) || '-14', 'som', NULL, NULL, unixepoch(), 17),
  (68, 'Melur — prev-prev attendance',              strftime('%Y-%m', date('now','-2 months')) || '-09', 'som', NULL, NULL, unixepoch(), 21),
  (88, 'Ungma handicraft class',                    strftime('%Y-%m', date('now','-2 months')) || '-11', 'som', NULL, NULL, unixepoch(), 25),
  (96, 'Longsa folk-music recital',                 strftime('%Y-%m', date('now','-2 months')) || '-13', 'silver', NULL, 1, unixepoch(), 26);

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

-- Sessions for the 16 new villages (v4..v19). A `prof` table drives
-- a cross-join with the 90-day `days` CTE: a row lands whenever
-- `n % density = d_off` AND `n >= silent`. The pattern gives every
-- village a distinguishable session cadence without 16 separate
-- INSERTs. `silent` simulates an at-risk village that went quiet in
-- the most recent `silent` days — useful for insights' "recently
-- silent" and attendance-trend-decline widgets.
--
-- Profile legend (density=1 daily, 2 alt-day, 3 every-third-day,
--                 4 every-fourth-day):
--   4  Hallare        daily,       star           (VC 11)
--   5  Srirangapatna  alt-day                     (VC 12)
--   6  Aland          every 3d                    (VC 13)
--   7  Afzalpur       every 4d + 7-day silence    (VC 14)   ← at-risk
--   8  Tiruvallur     daily,       star           (VC 15)
--   9  Poonamallee    alt-day                     (VC 16)
--   10 Gudiyatham     every 3d + 10-day silence   (VC 17)   ← at-risk
--   11 Arcot          daily + 3-day silence       (VC 18)
--   12 Ambur          daily                       (VC 19)
--   13 Vaniyambadi    alt-day                     (VC 20)
--   14 Melur          alt-day + 12-day silence    (VC 21)   ← at-risk
--   15 Usilampatti    daily                       (VC 22)
--   16 Sechu          alt-day (even)              (VC 23)
--   17 Jakhama        alt-day (odd)               (VC 24)
--   18 Ungma          every 3d + 9-day silence    (VC 25)   ← at-risk
--   19 Longsa         daily,       star           (VC 26)
INSERT INTO attendance_session (village_id, event_id, date, start_time, end_time, created_at, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89),
prof(village_id, vc_id, density, d_off, silent) AS (VALUES
  (4,  11, 1, 0, 0),
  (5,  12, 2, 1, 0),
  (6,  13, 3, 0, 0),
  (7,  14, 4, 1, 7),
  (8,  15, 1, 0, 0),
  (9,  16, 2, 1, 0),
  (10, 17, 3, 0, 10),
  (11, 18, 1, 0, 3),
  (12, 19, 1, 0, 0),
  (13, 20, 2, 1, 0),
  (14, 21, 2, 1, 12),
  (15, 22, 1, 0, 0),
  (16, 23, 2, 0, 0),
  (17, 24, 2, 1, 0),
  (18, 25, 3, 0, 9),
  (19, 26, 1, 0, 0)
)
SELECT prof.village_id,
       3 + (n % 6),
       date('now', '-' || n || ' days'),
       '10:00', '11:00',
       unixepoch(),
       prof.vc_id
FROM days
JOIN prof ON n >= prof.silent AND (n % prof.density) = prof.d_off
WHERE n <= 89;

-- Attendance marks — one row per (session, child-in-village). Present
-- flag uses deterministic modular arithmetic so each village gets a
-- distinguishable attendance %. Approximate rates (1 - 1/modulus):
--   v2  Belur        ~83% present   (existing star)
--   v3  Chandragiri  ~60% present   (existing at-risk)
--   v4  Hallare      ~83% (star)
--   v5  Srirangapatna~80%
--   v6  Aland        ~75%
--   v7  Afzalpur     ~67% (at-risk)
--   v8  Tiruvallur   ~86% (star)
--   v9  Poonamallee  ~80%
--   v10 Gudiyatham   ~67% (at-risk)
--   v11 Arcot        ~80%
--   v12 Ambur        ~75%
--   v13 Vaniyambadi  ~80%
--   v14 Melur        ~67% (at-risk)
--   v15 Usilampatti  ~83%
--   v16 Sechu        ~80%
--   v17 Jakhama      ~75%
--   v18 Ungma        ~67% (at-risk)
--   v19 Longsa       ~86% (star)
INSERT INTO attendance_mark (session_id, student_id, present)
SELECT s.id, c.id,
  CASE s.village_id
    WHEN 2  THEN CASE WHEN ((s.id * 11 + c.id * 5)  % 6) = 0 THEN 0 ELSE 1 END
    WHEN 3  THEN CASE WHEN ((s.id * 17 + c.id * 3)  % 5) <= 1 THEN 0 ELSE 1 END
    WHEN 4  THEN CASE WHEN ((s.id * 11 + c.id * 5)  % 6) = 0 THEN 0 ELSE 1 END
    WHEN 5  THEN CASE WHEN ((s.id * 13 + c.id * 7)  % 5) = 0 THEN 0 ELSE 1 END
    WHEN 6  THEN CASE WHEN ((s.id * 11 + c.id * 3)  % 4) = 0 THEN 0 ELSE 1 END
    WHEN 7  THEN CASE WHEN ((s.id * 7  + c.id * 5)  % 3) = 0 THEN 0 ELSE 1 END
    WHEN 8  THEN CASE WHEN ((s.id * 13 + c.id * 9)  % 7) = 0 THEN 0 ELSE 1 END
    WHEN 9  THEN CASE WHEN ((s.id * 11 + c.id * 5)  % 5) = 0 THEN 0 ELSE 1 END
    WHEN 10 THEN CASE WHEN ((s.id * 7  + c.id * 3)  % 3) = 0 THEN 0 ELSE 1 END
    WHEN 11 THEN CASE WHEN ((s.id * 13 + c.id * 11) % 5) = 0 THEN 0 ELSE 1 END
    WHEN 12 THEN CASE WHEN ((s.id * 11 + c.id * 7)  % 4) = 0 THEN 0 ELSE 1 END
    WHEN 13 THEN CASE WHEN ((s.id * 7  + c.id * 9)  % 5) = 0 THEN 0 ELSE 1 END
    WHEN 14 THEN CASE WHEN ((s.id * 13 + c.id * 5)  % 3) = 0 THEN 0 ELSE 1 END
    WHEN 15 THEN CASE WHEN ((s.id * 11 + c.id * 3)  % 6) = 0 THEN 0 ELSE 1 END
    WHEN 16 THEN CASE WHEN ((s.id * 7  + c.id * 11) % 5) = 0 THEN 0 ELSE 1 END
    WHEN 17 THEN CASE WHEN ((s.id * 13 + c.id * 7)  % 4) = 0 THEN 0 ELSE 1 END
    WHEN 18 THEN CASE WHEN ((s.id * 11 + c.id * 5)  % 3) = 0 THEN 0 ELSE 1 END
    WHEN 19 THEN CASE WHEN ((s.id * 13 + c.id * 9)  % 7) = 0 THEN 0 ELSE 1 END
    ELSE                                                         1
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

-- Media for five representative new villages. tag_event_id is set to
-- the same event the village's attendance session carries that day
-- (3 + (n % 6), matching the session profile above), so the
-- consolidated image_pct / video_pct KPIs on the drill-down see the
-- join at (village_id, event_id, IST-day) and register a non-zero
-- percentage. Five villages is enough variety for the home dashboard
-- to light up different KPI colours at zone / state / cluster scopes
-- without the seed turning into a mirror of every village.
--
-- Coverage map:
--   v4  Hallare      many tagged photos + some videos   (star, high image%)
--   v5  Srirangapatna periodic photos                   (mid)
--   v8  Tiruvallur   many tagged photos + videos        (star)
--   v12 Ambur        periodic photos                    (mid)
--   v19 Longsa       many tagged photos + videos        (star, Northeast)

-- v4 Hallare — photos every 2 days, videos sparse.
INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-hal-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/4/seed-hal-img-' || n || '.jpg',
  'image/jpeg',
  230000 + (n * 900),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  12.087, 76.653,
  4, 3 + (n % 6), 11
FROM days WHERE n % 2 = 0 AND n <= 89;

INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-hal-vid-' || n,
  'video',
  'video/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/4/seed-hal-vid-' || n || '.mp4',
  'video/mp4',
  4100000 + (n * 10000),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  12.087, 76.653,
  4, 3 + (n % 6), 11
FROM days WHERE n IN (4, 18, 31, 46, 59, 74);

-- v5 Srirangapatna — photos every 6 days.
INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-sri-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/5/seed-sri-img-' || n || '.jpg',
  'image/jpeg',
  210000 + (n * 800),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  12.414, 76.705,
  5, 3 + (n % 6), 12
FROM days WHERE n % 6 = 1 AND n <= 89;

-- v8 Tiruvallur — photos every 2 days, videos on 8 days.
INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-tir-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/8/seed-tir-img-' || n || '.jpg',
  'image/jpeg',
  245000 + (n * 1100),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  13.143, 79.907,
  8, 3 + (n % 6), 15
FROM days WHERE n % 2 = 1 AND n <= 89;

INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-tir-vid-' || n,
  'video',
  'video/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/8/seed-tir-vid-' || n || '.mp4',
  'video/mp4',
  4350000 + (n * 11500),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  13.143, 79.907,
  8, 3 + (n % 6), 15
FROM days WHERE n IN (3, 11, 21, 35, 48, 62, 75, 86);

-- v12 Ambur — photos every 5 days.
INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-amb-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/12/seed-amb-img-' || n || '.jpg',
  'image/jpeg',
  225000 + (n * 950),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  12.792, 78.711,
  12, 3 + (n % 6), 19
FROM days WHERE n % 5 = 0 AND n <= 89;

-- v19 Longsa — photos every 3 days, videos every ~15 days.
INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-lon-img-' || n,
  'image',
  'image/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/19/seed-lon-img-' || n || '.jpg',
  'image/jpeg',
  260000 + (n * 1000),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  26.331, 94.509,
  19, 3 + (n % 6), 26
FROM days WHERE n % 3 = 0 AND n <= 89;

INSERT INTO media (uuid, kind, r2_key, mime, bytes, captured_at, received_at, latitude, longitude, village_id, tag_event_id, created_by)
WITH RECURSIVE days(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM days WHERE n < 89)
SELECT
  'seed-lon-vid-' || n,
  'video',
  'video/' || strftime('%Y/%m/%d', date('now', '-' || n || ' days')) || '/19/seed-lon-vid-' || n || '.mp4',
  'video/mp4',
  4500000 + (n * 13000),
  unixepoch('now', '-' || n || ' days'),
  unixepoch('now', '-' || n || ' days'),
  26.331, 94.509,
  19, 3 + (n % 6), 26
FROM days WHERE n IN (6, 21, 37, 52, 69, 83);
