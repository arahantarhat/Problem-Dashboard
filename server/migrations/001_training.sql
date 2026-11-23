CREATE TABLE profiles (
  id text PRIMARY KEY,
  settings jsonb NOT NULL,
  initial_settings jsonb NOT NULL,
  legacy_imported boolean NOT NULL DEFAULT false
);
CREATE TABLE catalog (
  profile text NOT NULL REFERENCES profiles,
  key text NOT NULL,
  judge text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (profile, key)
);
CREATE INDEX catalog_profile_judge ON catalog (profile, judge);
CREATE TABLE submissions (
  profile text NOT NULL REFERENCES profiles,
  judge text NOT NULL,
  id text NOT NULL,
  problem text NOT NULL,
  stamp bigint NOT NULL,
  verdict text NOT NULL,
  participation text NOT NULL,
  in_round boolean NOT NULL,
  PRIMARY KEY (profile, judge, id)
);
CREATE INDEX submissions_profile_problem ON submissions (profile, problem, stamp);
CREATE TABLE solves (
  profile text NOT NULL REFERENCES profiles,
  problem text NOT NULL,
  day text,
  PRIMARY KEY (profile, problem)
);
CREATE TABLE lists (
  profile text NOT NULL REFERENCES profiles,
  id text NOT NULL,
  data jsonb NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (profile, id)
);
CREATE TABLE sync (
  profile text NOT NULL REFERENCES profiles,
  judge text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (profile, judge)
);
CREATE TABLE atcoder_claims (
  profile text NOT NULL REFERENCES profiles,
  handle text NOT NULL,
  problem text NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (profile, handle, problem)
);
CREATE TABLE account_verifications (
  profile text NOT NULL REFERENCES profiles,
  judge text NOT NULL,
  handle text NOT NULL,
  challenge text NOT NULL,
  started_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  code text,
  contest integer,
  task text,
  verified_at bigint,
  PRIMARY KEY (profile, judge)
);
CREATE TABLE codeforces_verification_submissions (id text PRIMARY KEY);
CREATE TABLE guide_progress (
  profile text PRIMARY KEY REFERENCES profiles,
  modules jsonb NOT NULL
);
CREATE TABLE in_progress (
  profile text NOT NULL REFERENCES profiles,
  problem text NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (profile, problem)
);
CREATE TABLE codeforces_virtual_rounds (
  profile text NOT NULL REFERENCES profiles,
  contest integer NOT NULL,
  signature text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (profile, contest)
);
CREATE TABLE atcoder_virtual (
  profile text NOT NULL REFERENCES profiles,
  handle text NOT NULL,
  attempts jsonb NOT NULL,
  PRIMARY KEY (profile, handle)
);
