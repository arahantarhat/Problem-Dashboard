import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { defaultSettings, withRatingDefaults } from './domain.mjs';
import { selectCodeforcesHistory } from './codeforces-virtual.mjs';
import { atcoderVirtualHistory } from './atcoder-virtual.mjs';

export function openDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Set DATABASE_URL in .env.local or the environment.');
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    onConnect: client => client.query('SET search_path TO unified_training, pg_catalog'),
    types: {
      getTypeParser(oid, format) {
        if (format !== 'binary' && oid === pg.types.builtins.INT8) return Number;
        return pg.types.getTypeParser(oid, format);
      }
    }
  });
  pool.on('error', error => console.error('PostgreSQL connection interrupted:', error.code ?? error.name));
  return pool;
}

export async function transaction(pool, fn, {profile, readOnly = false} = {}) {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    if (profile !== undefined) await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profile]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const migrationDir = new URL('./migrations/', import.meta.url);
export async function migrateDatabase(pool) {
  const files = (await readdir(migrationDir)).filter(file => /^\d+_.*\.sql$/.test(file)).sort();
  return transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(2069111301)');
    await db.query('CREATE SCHEMA IF NOT EXISTS unified_training');
    await db.query('REVOKE ALL ON SCHEMA unified_training FROM PUBLIC');
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await rows(db, 'SELECT name FROM schema_migrations')).map(row => row.name));
    if ([...applied].some(file => !files.includes(file))) throw new Error('The database was migrated by a newer version of Unified Training.');
    for (const file of files) {
      if (applied.has(file)) continue;
      await db.query(await readFile(new URL(file, migrationDir), 'utf8'));
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    }
  });
}

export async function rows(db, query, params) { return (await db.query(query, params)).rows; }
export async function one(db, query, params) { return (await rows(db, query, params))[0]; }

export async function ensureProfile(db, profile, zone) {
  const settings = defaultSettings();
  if (typeof zone === 'string' && zone.length <= 100) {
    try { new Intl.DateTimeFormat('en-US', {timeZone:zone}); settings.zone = zone; }
    catch { /* Keep the default for invalid timezones. */ }
  }
  await db.query('INSERT INTO profiles (id,settings,initial_settings) VALUES ($1,$2,$2) ON CONFLICT (id) DO NOTHING', [profile, settings]);
}

export const settingsFor = async (db, profile) => withRatingDefaults((await one(db, 'SELECT settings FROM profiles WHERE id=$1', [profile])).settings);
export const saveSettings = (db, profile, value) => db.query('UPDATE profiles SET settings=$2 WHERE id=$1', [profile, value]);
export const syncFor = async (db, profile) => Object.fromEntries((await rows(db, 'SELECT judge,data FROM sync WHERE profile=$1', [profile])).map(row => [row.judge, row.data]));
export const saveSync = (db, profile, judge, data) => db.query(
  'INSERT INTO sync (profile,judge,data) VALUES ($1,$2,$3) ON CONFLICT (profile,judge) DO UPDATE SET data=excluded.data',
  [profile, judge, data]
);
export function codeforcesVirtualCache(db, profile) {
  return {
    read: contest => one(db, 'SELECT signature,result FROM codeforces_virtual_rounds WHERE profile=$1 AND contest=$2', [profile,contest]),
    write: (contest, signature, result) => db.query(`INSERT INTO codeforces_virtual_rounds (profile,contest,signature,result) VALUES ($1,$2,$3,$4)
      ON CONFLICT (profile,contest) DO UPDATE SET signature=excluded.signature,result=excluded.result`, [profile,contest,signature,result])
  };
}
export async function atcoderVirtualAttempts(db, profile, handle) {
  return (await one(db, 'SELECT attempts FROM atcoder_virtual WHERE profile=$1 AND handle=$2', [profile,handle]))?.attempts ?? [];
}
export function saveAtCoderVirtualAttempts(db, profile, handle, attempts) {
  return db.query(`INSERT INTO atcoder_virtual (profile,handle,attempts) VALUES ($1,$2,$3)
    ON CONFLICT (profile,handle) DO UPDATE SET attempts=excluded.attempts`, [profile,handle,JSON.stringify(attempts)]);
}
export const listFor = async (db, profile) => (await rows(db, 'SELECT data FROM lists WHERE profile=$1 ORDER BY position', [profile])).map(row => row.data);
export const guideModulesFor = async (db, profile) => (await one(db, 'SELECT modules FROM guide_progress WHERE profile=$1', [profile]))?.modules ?? {};
export const saveGuideModules = (db, profile, modules) => db.query(`INSERT INTO guide_progress (profile,modules) VALUES ($1,$2)
  ON CONFLICT (profile) DO UPDATE SET modules=excluded.modules`, [profile,modules]);

const batchSize = 500;
export async function insertRows(db, table, columns, values, conflict = '') {
  for (let start = 0; start < values.length; start += batchSize) {
    const batch = values.slice(start, start + batchSize);
    const params = batch.flat();
    const placeholders = batch.map((row, index) => '(' + row.map((_, field) => '$' + (index * columns.length + field + 1)).join(',') + ')');
    await db.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders.join(',')} ${conflict}`, params);
  }
}
export function putProblems(db, profile, problems, merge = false) {
  const byKey = new Map();
  for (const p of problems) if (!merge || !byKey.has(p.key)) byKey.set(p.key, p);
  const values = [...byKey.values()].map(p => [profile, p.key, p.judge, p]);
  return insertRows(db, 'catalog', ['profile','key','judge','data'], values, merge
    ? 'ON CONFLICT (profile,key) DO NOTHING'
    : 'ON CONFLICT (profile,key) DO UPDATE SET judge=excluded.judge,data=excluded.data');
}
export function putSubmissions(db, profile, judge, submissions) {
  const byId = new Map(submissions.map(s => [String(s.id), s]));
  const values = [...byId].map(([id,s]) => [profile,judge,id,s.problem,s.stamp,s.verdict,s.participation ?? '',Boolean(s.inRound)]);
  return insertRows(db, 'submissions', ['profile','judge','id','problem','stamp','verdict','participation','in_round'], values,
    'ON CONFLICT (profile,judge,id) DO UPDATE SET problem=excluded.problem,stamp=excluded.stamp,verdict=excluded.verdict,participation=excluded.participation,in_round=excluded.in_round');
}

export async function snapshot(db, profile, settings) {
  settings ??= await settingsFor(db, profile);
  const sync = await syncFor(db, profile);
  if (sync.Codeforces?.virtual) {
    const selection = settings.virtualSelection.Codeforces;
    const cache = selection.mode === 'selected' ? await rows(db,
      'SELECT contest,result FROM codeforces_virtual_rounds WHERE profile=$1 AND contest::text=ANY($2::text[])',
      [profile,selection.ids]) : [];
    const byContest = new Map(cache.map(row => [row.contest,row]));
    sync.Codeforces.virtual = selectCodeforcesHistory(sync.Codeforces.virtual, selection, contest => byContest.get(contest));
  }
  const handle = settings.handles.AtCoder.toLowerCase();
  return {
    settings, sync,
    atcoderVirtual: handle && profile !== 'demo' ? atcoderVirtualHistory(await atcoderVirtualAttempts(db,profile,handle),
      settings.virtualSelection.AtCoder,sync.AtCoder?.ratingHistory,sync.AtCoder?.rating) : null,
    problems: (await rows(db, 'SELECT data FROM catalog WHERE profile=$1 ORDER BY key COLLATE "C"', [profile])).map(row => row.data),
    submissions: await rows(db, `SELECT problem,stamp,verdict,participation,in_round FROM submissions AS s
      WHERE profile=$1 AND (judge<>'Codeforces' OR NOT EXISTS (
        SELECT 1 FROM codeforces_verification_submissions WHERE id=s.id
      )) ORDER BY stamp,judge,id`, [profile]),
    manual: await rows(db, 'SELECT problem,day FROM solves WHERE profile=$1 ORDER BY problem COLLATE "C"', [profile]),
    atcoderClaims: (await rows(db, 'SELECT problem FROM atcoder_claims WHERE profile=$1 AND handle=$2 ORDER BY position', [profile,handle])).map(row => row.problem),
    inProgress: (await rows(db, 'SELECT problem FROM in_progress WHERE profile=$1 ORDER BY position DESC', [profile])).map(row => row.problem),
    lists: await listFor(db, profile),
  };
}
