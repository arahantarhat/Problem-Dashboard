import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultSettings, normalizeLink } from '../server/domain.mjs';
import { atcoderVirtualAttempts, codeforcesVirtualCache, ensureProfile, guideModulesFor, migrateDatabase, one, rows, saveSettings, settingsFor, snapshot, transaction } from '../server/db.mjs';
import { importSqlite } from '../scripts/import-sqlite.mjs';
import { databaseTest, testDatabase, testServer, owner, other } from './database-fixture.mjs';

test('schema migrations repeat and profile transactions serialize independent clients',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  await Promise.all([migrateDatabase(db),migrateDatabase(db)]);
  assert.deepEqual(await rows(db,'SELECT name FROM schema_migrations ORDER BY name'),[
    {name:'001_training.sql'},{name:'002_social.sql'}
  ]);
  const writes=Array.from({length:12},()=>transaction(db,async db=>{
    const settings=await settingsFor(db,owner);
    settings.upsolveCap++;
    await saveSettings(db,owner,settings);
  },{profile:owner}));
  await Promise.all(writes);
  assert.equal((await settingsFor(db,owner)).upsolveCap,defaultSettings().upsolveCap+12);
});

async function sourceFixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'ut-sqlite-source-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'old.sqlite');
  const sqlite=new DatabaseSync(file);
  try {
    sqlite.exec(`PRAGMA user_version=1;
      CREATE TABLE profiles (id,settings);
      CREATE TABLE catalog (profile,key,judge,data);
      CREATE TABLE submissions (profile,judge,id,problem,stamp,verdict,participation,in_round);
      CREATE TABLE solves (profile,problem,day);
      CREATE TABLE lists (profile,id,data);
      CREATE TABLE sync (profile,judge,data);
      CREATE TABLE atcoder_claims (profile,handle,problem);
      CREATE TABLE account_verifications (profile,judge,handle,challenge,started_at,expires_at,code,contest,task,verified_at);
      CREATE TABLE codeforces_verification_submissions (id);
      CREATE TABLE guide_progress (profile,modules);
      CREATE TABLE in_progress (profile,problem);
      CREATE TABLE codeforces_virtual_rounds (profile,contest,signature,result);
      CREATE TABLE atcoder_virtual (profile,handle,attempts);
      INSERT INTO submissions VALUES ('local','Codeforces','41','cf:4:A',1600000000,'OK','CONTESTANT',1),('local','Codeforces','42','cf:4:A',1600000001,'COMPILATION_ERROR','PRACTICE',0);
      INSERT INTO solves VALUES ('local','cses:1068','2025-05-01'),('local','cses:1083',NULL);
      INSERT INTO lists VALUES ('local','z','{"id":"z","keys":["cses:1068"]}'),('local','a','{"id":"a","keys":[]}');
      INSERT INTO sync VALUES ('local','Codeforces','{"rating":1420}');
      INSERT INTO atcoder_claims VALUES ('local','tester','ac:second'),('local','tester','ac:first');
      INSERT INTO account_verifications VALUES ('local','Codeforces','tester','challenge',1600000000000,1600000900000,NULL,NULL,NULL,1600000000242);
      INSERT INTO codeforces_verification_submissions VALUES ('42');
      INSERT INTO guide_progress VALUES ('local','{"intro-complete":"Complete"}');
      INSERT INTO in_progress VALUES ('local','cses:1083'),('local','cses:1068');
      INSERT INTO codeforces_virtual_rounds VALUES ('local',4,'signature','{"contestId":4}');
      INSERT INTO atcoder_virtual VALUES ('local','another_handle','[{"id":"virtual-attempt"}]');
    `);
    const settings=defaultSettings();
    settings.handles.AtCoder='Tester';
    settings.handles.Codeforces='Tester';
    settings.zone='Asia/Tokyo';
    sqlite.prepare('INSERT INTO profiles VALUES (?,?)').run('local',JSON.stringify(settings));
    sqlite.prepare('INSERT INTO profiles VALUES (?,?)').run('demo',JSON.stringify(settings));
    const problem=normalizeLink('https://cses.fi/problemset/task/1068');
    sqlite.prepare('INSERT INTO catalog VALUES (?,?,?,?)').run('local',problem.key,problem.judge,JSON.stringify(problem));
  } finally {sqlite.close();}
  return file;
}

test('SQLite import transfers personal data once and rolls back all inserts on failure',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const file=await sourceFixture(t);
  const source=await readFile(file);
  await assert.rejects(importSqlite(db,file,other),/Sign in once/);
  await ensureProfile(db,other);
  await db.query("ALTER TABLE guide_progress ADD CONSTRAINT simulated_failure CHECK (modules = '{}'::jsonb)");
  await assert.rejects(importSqlite(db,file,owner),/simulated_failure/);
  assert.equal((await snapshot(db,owner)).problems.length,0);
  assert.equal((await rows(db,'SELECT id FROM codeforces_verification_submissions')).length,0);
  await db.query('ALTER TABLE guide_progress DROP CONSTRAINT simulated_failure');
  const counts=await importSqlite(db,file,owner);
  assert.deepEqual(counts,{catalog:1,submissions:2,solves:2,lists:2,sync:1,atcoder_claims:2,account_verifications:1,
    guide_progress:1,in_progress:2,codeforces_virtual_rounds:1,atcoder_virtual:1,codeforces_verification_submissions:1});
  const loaded=await snapshot(db,owner);
  assert.equal(loaded.settings.zone,'Asia/Tokyo');
  assert.equal(loaded.sync.Codeforces.rating,1420);
  assert.deepEqual(loaded.manual,[{problem:'cses:1068',day:'2025-05-01'},{problem:'cses:1083',day:null}]);
  assert.deepEqual(loaded.lists.map(list=>list.id),['z','a']);
  assert.deepEqual(loaded.inProgress,['cses:1068','cses:1083']);
  assert.deepEqual(loaded.atcoderClaims,['ac:second','ac:first']);
  assert.deepEqual(loaded.submissions,[{problem:'cf:4:A',stamp:1600000000,verdict:'OK',participation:'CONTESTANT',in_round:true}]);
  assert.equal((await one(db,'SELECT verified_at FROM account_verifications WHERE profile=$1',[owner])).verified_at,1600000000242);
  assert.deepEqual(await guideModulesFor(db,owner),{'intro-complete':'Complete'});
  assert.deepEqual(await atcoderVirtualAttempts(db,owner,'another_handle'),[{id:'virtual-attempt'}]);
  assert.equal((await codeforcesVirtualCache(db,owner).read(4)).signature,'signature');
  assert.equal((await snapshot(db,other)).problems.length,0);
  assert.equal((await settingsFor(db,'demo')).handles.Codeforces,'');
  await assert.rejects(importSqlite(db,file,owner),/earlier import/);
  await saveSettings(db,other,{...defaultSettings(),zone:'Asia/Tokyo'});
  await assert.rejects(importSqlite(db,file,other),/no saved training data/);
  assert.deepEqual(await readFile(file),source);
});

test('training API requires confirmed identity, ignores spoofing, and keeps demo read-only',databaseTest,async t=>{
  const {db,url}=await testDatabase(t);
  const request=await testServer(t,url);
  for(const token of [null,'invalid','unconfirmed']) {
    assert.equal((await request('state',undefined,{token})).status,401);
    assert.equal((await request('state',undefined,{token,mode:'demo'})).status,401);
  }
  assert.equal((await request('state',undefined,{mode:other})).status,400);
  assert.equal((await request('state',undefined,{mode:'demo'})).status,200);
  assert.equal((await request('cses/import',{}, {mode:'demo'})).status,403);
  assert.equal((await request('settings',{}, {mode:'demo'})).status,403);
  const payload={source:'cses',version:1,profile:other,solves:[{id:'1068',day:'2025-01-01'}]};
  const imported=await request('cses/import',payload);
  assert.equal(imported.status,200,JSON.stringify(await imported.json()));
  const result=await request('state',undefined,{token:'other'});
  assert.equal(result.status,200);
  assert.equal((await result.json()).stats.timeline.length,0);
  assert.equal((await snapshot(db,owner)).manual[0].problem,'cses:1068');
  const settings=await settingsFor(db,owner);
  settings.handles.Codeforces='tester';
  await saveSettings(db,owner,settings);
  assert.equal((await request('virtual/codeforces',{})).status,202);
  assert.equal((await (await request('virtual/codeforces')).json()).running,true);
  assert.deepEqual(await (await request('virtual/codeforces',undefined,{token:'other'})).json(),{running:false});
  assert.equal((await request('virtual/codeforces',{}, {mode:'demo'})).status,403);
  const end=Date.now()+6000;
  let job;
  do {
    await delay(100);
    job=await (await request('virtual/codeforces')).json();
  } while(job.running && Date.now()<end);
  assert.deepEqual(job,{running:false,completed:0,total:0});
  assert.ok((await snapshot(db,owner)).sync.Codeforces.virtual);
  assert.equal((await snapshot(db,other)).sync.Codeforces,undefined);
});
