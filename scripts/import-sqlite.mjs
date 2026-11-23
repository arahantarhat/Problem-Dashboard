import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/config.mjs';
import { insertRows, listFor, one, openDatabase, putProblems, rows, saveSettings, transaction } from '../server/db.mjs';
import { normalizeLink } from '../server/domain.mjs';
import { accountIdPattern } from '../server/auth.mjs';

const tables = {
  catalog: ['key','judge','data'],
  submissions: ['judge','id','problem','stamp','verdict','participation','in_round'],
  solves: ['problem','day'],
  lists: ['id','data'],
  sync: ['judge','data'],
  atcoder_claims: ['handle','problem'],
  account_verifications: ['judge','handle','challenge','started_at','expires_at','code','contest','task','verified_at'],
  guide_progress: ['modules'],
  in_progress: ['problem'],
  codeforces_virtual_rounds: ['contest','signature','result'],
  atcoder_virtual: ['handle','attempts']
};
const jsonColumns = new Set(['data','modules','result','attempts']);
const ordered = new Set(['lists','atcoder_claims','in_progress']);
const consumedTable = 'codeforces_verification_submissions';

function readSource(path) {
  const db = new DatabaseSync(path, {readOnly:true});
  try {
    db.exec('BEGIN');
    if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('Unsupported Unified Training SQLite schema version.');
    const {settings} = db.prepare("SELECT settings FROM profiles WHERE id='local'").get() ?? {};
    if (!settings) throw new Error('The SQLite file has no local training profile.');
    const present = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    const records = Object.fromEntries(Object.entries(tables).map(([table, columns]) => {
      const selected = present.has(table) ? db.prepare(
        "SELECT " + columns.join(',') + " FROM " + table + " WHERE profile='local'" + (ordered.has(table) ? ' ORDER BY rowid' : '')
      ).all() : [];
      return [table, selected.map(row => columns.map(column => {
        if (jsonColumns.has(column)) JSON.parse(row[column]);
        return column === 'in_round' ? Boolean(row[column]) : row[column];
      }))];
    }));
    const consumed = present.has(consumedTable) ? db.prepare('SELECT id FROM ' + consumedTable).all().map(row => row.id) : [];
    return {settings:JSON.parse(settings), records, consumed};
  } finally {
    db.close();
  }
}

async function normalizeLegacy(db, profile, settings) {
  const aliases = new Map();
  const legacy = await rows(db, "SELECT key,data FROM catalog WHERE profile=$1 AND judge='Other'", [profile]);
  for (const {key,data:previous} of legacy) {
    if (!/^url:.*(?:usaco\.org|acm\.timus\.ru|timus\.online)\//.test(key)) continue;
    const canonical = normalizeLink(previous.url);
    if (!['USACO','Timus'].includes(canonical?.judge)) continue;
    const url = new URL(previous.url);
    const defaultTitle = url.hostname + url.pathname.replace(/\/$/, '');
    await putProblems(db,profile,[{...canonical,title:previous.title === defaultTitle ? canonical.title : previous.title}],true);
    await db.query(`INSERT INTO solves (profile,problem,day)
      SELECT profile,$3,day FROM solves WHERE profile=$1 AND problem=$2
      ON CONFLICT (profile,problem) DO UPDATE SET day=COALESCE(solves.day,excluded.day)`, [profile,key,canonical.key]);
    await db.query('DELETE FROM solves WHERE profile=$1 AND problem=$2', [profile,key]);
    await db.query('DELETE FROM catalog WHERE profile=$1 AND key=$2', [profile,key]);
    await db.query('UPDATE in_progress SET problem=$3 WHERE profile=$1 AND problem=$2 AND NOT EXISTS (SELECT 1 FROM in_progress WHERE profile=$1 AND problem=$3)', [profile,key,canonical.key]);
    await db.query('DELETE FROM in_progress WHERE profile=$1 AND problem=$2', [profile,key]);
    aliases.set(key,canonical.key);
  }
  const lists = await listFor(db,profile);
  for (const list of lists) {
    if (!list.keys?.some(key => aliases.has(key))) continue;
    list.keys = [...new Set(list.keys.map(key => aliases.get(key) ?? key))];
    await db.query('UPDATE lists SET data=$3 WHERE profile=$1 AND id=$2', [profile,list.id,list]);
  }
  if (!Object.hasOwn(settings.shares,'guide')) {
    const guide = lists.some(list => list.guide && list.enabled);
    settings.shares.guide = guide ? settings.shares.manual : 0;
    if (guide && !lists.some(list => !list.guide)) settings.shares.manual = 0;
  }
  await saveSettings(db,profile,settings);
}

export async function importSqlite(pool, path, owner) {
  if (!accountIdPattern.test(owner ?? '')) throw new Error('Pass the confirmed account UUID with --owner.');
  owner = owner.toLowerCase();
  const source = readSource(path);
  return transaction(pool, async db => {
    const profile = await one(db, 'SELECT legacy_imported, settings=initial_settings AS pristine FROM profiles WHERE id=$1', [owner]);
    if (!profile?.pristine || profile.legacy_imported) throw new Error('Sign in once with the confirmed account and use a profile with no saved training data or earlier import.');
    for (const table of Object.keys(tables)) {
      if (await one(db, 'SELECT 1 FROM ' + table + ' WHERE profile=$1 LIMIT 1', [owner])) throw new Error('The destination account already contains training data.');
    }
    const counts = {};
    for (const [table, columns] of Object.entries(tables)) {
      const values = source.records[table];
      await insertRows(db, table, ['profile',...columns], values.map(row => [owner,...row]));
      const {total} = await one(db, 'SELECT count(*) AS total FROM ' + table + ' WHERE profile=$1', [owner]);
      if (total !== values.length) throw new Error('Imported row count does not match SQLite for ' + table + '.');
      counts[table] = total;
    }
    await insertRows(db, consumedTable, ['id'], source.consumed.map(id => [id]), 'ON CONFLICT (id) DO NOTHING');
    const {total} = await one(db, 'SELECT count(*) AS total FROM ' + consumedTable + ' WHERE id=ANY($1::text[])', [source.consumed]);
    if (total !== source.consumed.length) throw new Error('Imported Codeforces verification IDs do not match SQLite.');
    counts[consumedTable] = total;
    await normalizeLegacy(db,owner,source.settings);
    await db.query('UPDATE profiles SET legacy_imported=true WHERE id=$1', [owner]);
    return counts;
  }, {profile:owner});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options:{source:{type:'string'},owner:{type:'string'}}});
  loadConfig();
  const db = openDatabase();
  try {
    const counts = await importSqlite(db, values.source ?? fileURLToPath(new URL('../data/training.sqlite',import.meta.url)), values.owner);
    console.log('Imported SQLite records before legacy normalization:', counts);
  } finally {
    await db.end();
  }
}
