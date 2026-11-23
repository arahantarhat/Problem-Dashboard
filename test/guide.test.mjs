import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultSettings, normalizeLink } from '../server/domain.mjs';
import { putProblems, putSubmissions, snapshot } from '../server/db.mjs';
import { importSqlite } from '../scripts/import-sqlite.mjs';
import { databaseTest, testDatabase, testServer, owner } from './database-fixture.mjs';
import { parseGuideCriteria, previewGuideProgress } from '../server/guide.mjs';
import { resolve } from '../server/resolve.mjs';
import { guideMatches } from '../shared/guide.js';
import guide from '../server/guide-catalog.json' with {type:'json'};

const fixtureCriteria = {divisions:['Bronze'],difficulties:['Easy'],topics:['Complete Search'],judges:['USACO']};
const exportFixture = {
  userProgressOnProblems:{
    'usaco-615':'Solved', 'usaco-639':'Reviewing', 'usaco-1060':'Solving',
    'cf-1209H':'Solved', 'removed-problem':'Solved'
  },
  userProgressOnProblemsActivity:[
    {problemID:'usaco-615',problemProgress:'Solved',timestamp:Date.parse('2025-02-02T03:00:00Z')},
    {problemID:'usaco-615',problemProgress:'Solved',timestamp:Date.parse('2025-02-05T03:00:00Z')},
    {problemID:'usaco-639',problemProgress:'Reviewing',timestamp:Date.parse('2025-02-03T03:00:00Z')},
    {problemID:'cf-1209H',problemProgress:'Solved',timestamp:Date.parse('2025-02-02T03:00:00Z')},
  ],
  userProgressOnModules:{'intro-complete':'Complete','removed-module':'Complete'}
};

test('bundled Guide catalog has checklists in Guide order and official monthly problems',()=>{
  const complete = guide.modules.find(module=>module.id==='intro-complete');
  const recursive = guide.modules.find(module=>module.id==='complete-rec');
  assert.ok(guide.modules.indexOf(complete)<guide.modules.indexOf(recursive));
  assert.equal(complete.listings[0].id,'cfgym-102951A');
  assert.ok(guide.modules.find(module=>module.id==='usaco-monthlies').listings.some(row=>row.id==='usaco-664'));
  assert.ok(guideMatches(guide,fixtureCriteria).some(row=>row.problem.key==='usaco:615'));
});

test('filters match one listing before deduplicating and Guide rules follow catalog updates',()=>{
  const a=normalizeLink('https://usaco.org/?page=viewproblem&cpid=12');
  const b=normalizeLink('https://www.usaco.org/index.php?cpid=13&page=viewproblem2');
  const row=(id,difficulty,tags=[])=>({id,difficulty,tags});
  const catalog={problems:{a,b,alias:a},modules:[
    {id:'bronze-module',title:'Search',section:'Bronze',topic:'Complete Search',listings:[row('a','Easy'),row('alias','Easy'),row('b','Hard')]},
    {id:'silver-module',title:'Trees',section:'Silver',topic:'Graphs',listings:[row('b','Easy',['Complete Search'])]}
  ]};
  assert.deepEqual(guideMatches(catalog,fixtureCriteria).map(r=>r.problem.key),['usaco:12']);
  assert.deepEqual(guideMatches(catalog,{...fixtureCriteria,divisions:['Bronze','Silver']}).map(r=>r.problem.key),['usaco:12','usaco:13']);
  const settings=defaultSettings();
  settings.shares.guide=10;
  const lists=[{id:'guide-set',name:'Bronze Easy',enabled:true,cap:1,keys:[],guide:parseGuideCriteria(fixtureCriteria)}];
  const saved={lists,settings,problems:[a],manual:[{problem:a.key,day:null}],submissions:[],sync:{}};
  let state=resolve(saved,new Date(),catalog);
  assert.equal(state.guideRules[0].total,1);
  assert.equal(state.guideRules[0].done,1);
  assert.deepEqual(state.queue,[]);
  catalog.modules[0].listings.push(row('b','Easy'));
  state=resolve(saved,new Date(),catalog);
  assert.equal(state.guideRules[0].total,2);
  assert.equal(state.guideRules[0].done,1);
  assert.deepEqual(state.queue.map(problem=>problem.key),['usaco:13']);
});

test('Guide chapters are weighted after filtering and skip problems supplied by other chapters or groups',()=>{
  const problems=Object.fromEntries(Array.from({length:9},(_,i)=>[String(i+1),{key:'usaco:'+(i+1)}]));
  const listings=(ids)=>ids.map(id=>({id,difficulty:id==='9'?'Hard':'Easy',tags:[]}));
  const catalog={problems,modules:[
    {id:'search',section:'Bronze',topic:'Complete Search',listings:listings(['1','2','3','4','5','9'])},
    {id:'sorting',section:'Bronze',topic:'Sorting & Sets',listings:listings(['2','6','7','8'])}
  ]};
  const guideRule={id:'weighted',name:'Bronze mix',enabled:true,cap:6,guide:{divisions:['Bronze'],difficulties:['Easy']},
    sectionWeights:{'Bronze/Complete Search':2}};
  const settings=defaultSettings();
  settings.queueMode='custom';
  settings.shares.guide=10;
  settings.shares.manual=20;
  const saved={lists:[guideRule,{id:'manual',name:'Manual',enabled:true,cap:1,keys:['usaco:1']}],settings,
    problems:[problems['1']],manual:[],submissions:[],sync:{}};
  let state=resolve(saved,new Date(),catalog);
  assert.deepEqual(state.queue.map(row=>row.key),['1','2','3','6','4','5','7'].map(id=>'usaco:'+id));
  assert.equal(state.actual['guide:weighted'],6);
  assert.equal(state.guideRules[0].total,8);
  assert.deepEqual(state.ruleRows['guide:weighted'].slice(0,3).map(row=>row.key),['usaco:1','usaco:2','usaco:6']);
  guideRule.sectionWeights['Bronze/Sorting & Sets']=0;
  state=resolve(saved,new Date(),catalog);
  assert.equal(state.guideRules[0].total,5);
  assert.deepEqual(state.queue.map(row=>row.key),['1','2','3','4','5'].map(id=>'usaco:'+id));
});

test('USACO queue rows pair the official division with the Guide listing that supplied the row',()=>{
  const p=normalizeLink('https://usaco.org/index.php?page=viewproblem2&cpid=567');
  const module=(id,difficulty)=>({
    id,title:id,section:'Silver',topic:id,listings:[{id:'fence',difficulty,tags:[]}]
  });
  const catalog={problems:{fence:p},modules:[module('Sorting','Easy'),module('Sweep Line','Hard'),module('Archive','N/A')]};
  const settings=defaultSettings();
  const lists=[
    {id:'weighted',name:'Guide mix',enabled:true,cap:1,guide:parseGuideCriteria({}),sectionWeights:{'Silver/Sweep Line':3}},
    {id:'manual',name:'Manual',enabled:true,cap:1,keys:[p.key]}
  ];
  const source={lists,settings,problems:[{...p,usacoDivision:'Bronze'}],manual:[],submissions:[],sync:{}};
  const result=resolve(source,new Date(),catalog);
  for (const row of [result.queue[0],result.ruleRows['guide:weighted'][0]]) {
    assert.equal(row.usacoDivision,'Bronze');
    assert.deepEqual(row.guideEntries.map(entry=>entry.difficulty),['Hard']);
  }
  assert.deepEqual(result.ruleRows['list:manual'][0].guideEntries.map(entry=>entry.difficulty),['Easy','Hard']);
});

test('Guide preview keeps dated solves, counts Reviewing, and reports unmatched IDs',()=>{
  const previous=new Map([['cf:1209:H',{day:'2024-01-01',source:'synced'}]]);
  const preview=previewGuideProgress(guide,exportFixture,previous,'America/Santo_Domingo');
  assert.deepEqual(preview.solves.map(row=>[row.problem.key,row.day,row.previous,row.confirmed]),[
    ['usaco:615','2025-02-01',false,false], ['usaco:639',null,false,false], ['cf:1209:H','2024-01-01',true,true]
  ]);
  assert.deepEqual(preview.unmatched,['removed-problem']);
  assert.deepEqual(preview.modules,{'intro-complete':'Complete'});
  assert.throws(()=>previewGuideProgress(guide,{userProgressOnProblems:[]},previous,'UTC'),/Export User Data/);
});

test('SQLite import preserves legacy Guide aliases, list membership, titles and solve dates',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const dir=await mkdtemp(join(tmpdir(),'ut-guide-migration-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'training.sqlite');
  const sqlite=new DatabaseSync(file);
  try {
    sqlite.exec(`PRAGMA user_version=1;
      CREATE TABLE profiles (id TEXT PRIMARY KEY, settings TEXT NOT NULL);
      CREATE TABLE catalog (profile TEXT, key TEXT, judge TEXT, data TEXT);
      CREATE TABLE solves (profile TEXT, problem TEXT, day TEXT);
      CREATE TABLE lists (profile TEXT, id TEXT, data TEXT);
    `);
    const legacy={key:'url:http://www.usaco.org/index.php?page=viewproblem&cpid=615',judge:'Other',url:'http://www.usaco.org/index.php?page=viewproblem&cpid=615',title:'Pails practice'};
    assert.equal(normalizeLink(legacy.url).key,normalizeLink('https://usaco.org/index.php?x=1&cpid=0615&page=viewproblem2').key);
    sqlite.prepare('INSERT INTO catalog VALUES (?,?,?,?)').run('local',legacy.key,legacy.judge,JSON.stringify(legacy));
    sqlite.prepare('INSERT INTO solves VALUES (?,?,?)').run('local',legacy.key,'2025-01-01');
    sqlite.prepare('INSERT INTO lists VALUES (?,?,?)').run('local','legacy',JSON.stringify({id:'legacy',keys:[legacy.key,'usaco:615']}));
    const oldGuide={id:'old-guide',name:'Milk practice',cap:10,enabled:true,guide:fixtureCriteria,keys:[]};
    const settings=defaultSettings();
    delete settings.shares.guide;
    settings.shares.manual=15;
    sqlite.prepare('INSERT INTO profiles VALUES (?,?)').run('local',JSON.stringify(settings));
    sqlite.prepare('INSERT INTO lists VALUES (?,?,?)').run('local',oldGuide.id,JSON.stringify(oldGuide));
  } finally { sqlite.close(); }
  await importSqlite(db,file,owner);
  const saved=await snapshot(db,owner);
  assert.deepEqual(saved.lists.map(list=>list.id),['legacy','old-guide']);
  assert.deepEqual(saved.lists[0].keys,['usaco:615']);
  assert.deepEqual(saved.manual,[{problem:'usaco:615',day:'2025-01-01'}]);
  assert.equal(saved.problems[0].title,'Pails practice');
  assert.ok(saved.settings.colors.USACO);
  assert.equal(saved.settings.shares.guide,15);
  assert.equal(saved.settings.shares.manual,15);
  const migrated=resolve(saved,new Date(),guide).guideRules[0];
  assert.deepEqual({id:migrated.id,criteria:migrated.criteria,weights:migrated.sectionWeights,cap:migrated.cap,done:migrated.done},
    {id:'old-guide',criteria:fixtureCriteria,weights:null,cap:10,done:1});
});

test('Guide API previews without writing and imports into the personal practice queue once',databaseTest,async t=>{
  const {db,url}=await testDatabase(t);
  await putProblems(db,owner,[guide.problems['cf-1209H']]);
  await putSubmissions(db,owner,'Codeforces',[{id:'30',problem:'cf:1209:H',stamp:1704153600,verdict:'OK'}]);
  const request=await testServer(t,url);
  const call=async(path,payload,mode='personal')=>{
    const response=await request(path,payload,{mode});
    const value=await response.json();
    assert.equal(response.status,200,JSON.stringify(value));
    return value;
  };
  const draft={name:'Bronze Easy Search',enabled:true,cap:10,criteria:fixtureCriteria,sectionWeights:{'Bronze/Complete Search':2}};
  const preview=await call('guide/rules/preview',draft);
  assert.ok(preview.queued>0);
  assert.ok(preview.count>=preview.preview.length);
  assert.equal((await call('state')).guideRules.length,0);
  const created=await call('guide/rules',draft);
  const id=created.guideRules[0].id;
  assert.equal(created.settings.shares.guide,0);
  assert.equal(created.settings.shares.manual,0);
  assert.ok(created.queue.some(problem=>problem.key==='usaco:615'));
  await call('guide/preview',exportFixture);
  assert.equal((await call('state')).guideRules[0].done,0);
  const imported=await call('guide/import',exportFixture);
  assert.equal(imported.guideRules[0].done,2);
  assert.ok(!imported.queue.some(problem=>problem.key==='usaco:615'));
  assert.equal(imported.stats.timeline.find(row=>row.key==='cf:1209:H').source,'synced');
  assert.equal((await call('guide')).moduleProgress['intro-complete'],'Complete');
  const repeated=await call('guide/import',exportFixture);
  assert.deepEqual(repeated.stats.timeline,imported.stats.timeline);
  assert.deepEqual((await call('guide',undefined,'demo')).moduleProgress,{});
  const edited=await call('guide/rules',{...draft,id,name:'Milk practice',enabled:false,cap:1});
  assert.equal(edited.guideRules[0].enabled,false);
  assert.equal((await call('guide/rules/delete',{id})).guideRules.length,0);
});
