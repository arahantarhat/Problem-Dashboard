ALTER TABLE solves ADD COLUMN origin text NOT NULL DEFAULT 'legacy'
  CHECK (origin IN ('manual', 'imported', 'legacy'));

CREATE TABLE social_usernames (
  profile text PRIMARY KEY REFERENCES profiles ON DELETE CASCADE CHECK (profile <> 'demo'),
  username text NOT NULL CHECK (username COLLATE "C" ~ '^[A-Za-z0-9_]{3,24}$')
);
CREATE UNIQUE INDEX social_usernames_folded ON social_usernames (lower(username COLLATE "C"));

CREATE TABLE social_friendships (
  first_profile text REFERENCES social_usernames ON DELETE CASCADE,
  second_profile text REFERENCES social_usernames ON DELETE CASCADE,
  requested_by text NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (first_profile, second_profile),
  CHECK (first_profile < second_profile),
  CHECK (requested_by IN (first_profile, second_profile))
);
CREATE INDEX social_friendships_second ON social_friendships (second_profile);

CREATE TABLE social_groups (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  zone text NOT NULL,
  owner text NOT NULL REFERENCES social_usernames,
  invite_code text NOT NULL UNIQUE
);
CREATE TABLE social_members (
  group_id uuid REFERENCES social_groups ON DELETE CASCADE,
  profile text REFERENCES social_usernames ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  totals_only boolean NOT NULL DEFAULT false,
  PRIMARY KEY (group_id, profile)
);
CREATE INDEX social_members_profile ON social_members (profile);
CREATE TABLE social_queue (
  group_id uuid,
  profile text,
  week date,
  problem text,
  appeared_at timestamptz NOT NULL,
  PRIMARY KEY (group_id, profile, week, problem),
  FOREIGN KEY (group_id, profile) REFERENCES social_members ON DELETE CASCADE
);
CREATE INDEX social_accepted_submissions ON submissions (profile, judge, problem, stamp)
  WHERE verdict IN ('AC', 'OK');
