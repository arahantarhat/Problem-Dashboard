import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLink } from '../server/domain.mjs';
import { ensureProfile, one, putProblems, putSubmissions, rows, saveSettings, settingsFor } from '../server/db.mjs';
import { recordQueue } from '../server/social.mjs';
import { databaseTest, owner, other, testDatabase, testServer } from './database-fixture.mjs';

const cf = (index,finished=true) => ({
  ...normalizeLink('https://codeforces.com/contest/2400/problem/'+index),
  date:'2025-01-01',finished,title:'Problem '+index
});
const cses = normalizeLink('https://cses.fi/problemset/task/1068');
const groupAction = (action, body={}) => ({action,...body});

test('Social protects private groups and friends, rotates invites, and respects sharing defaults',databaseTest,async t=>{
  const {db,url}=await testDatabase(t);
  const api=await testServer(t,url);
  const call=async (path,body,token='owner',status=200,mode='personal')=>{
    const response=await api('social/'+path,body,{token,mode});
    const result=await response.json();
    assert.equal(response.status,status,JSON.stringify(result));
    return result;
  };

  assert.deepEqual(await call('identity'),{user:null});
  await call('username',{username:'Owner'},'unconfirmed',401);
  await call('username',{username:'Owner'},'owner',403,'demo');
  await call('home',{},'owner',409);
  const claim=await Promise.all([
    api('social/username',{username:'Maya'}),
    api('social/username',{username:'mAYa'},{token:'other'})
  ]);
  assert.deepEqual(claim.map(response=>response.status).sort(),[200,409]);
  const loser=claim[0].ok?'other':'owner';
  await call('username',{username:'Leo'},loser);
  const me=(await call('identity')).user;
  const them=(await call('identity',undefined,'other')).user;
  assert.deepEqual(await call('username',{username:'ignored'}),{user:me});
  assert.equal((await call('lookup',{username:'@'+them.username.toUpperCase()})).id,other);

  const {id,inviteCode}=await call('group-action',groupAction('create',{name:'Practice group'}));
  assert.equal(inviteCode.length,32);
  await call('group',{id},'other',404);
  await call('activity',{id,filter:'group'},'other',404);
  await call('friend-profile',{id:owner},'other',404);
  assert.equal((await call('invite',{code:inviteCode},'other')).name,'Practice group');
  const rotated=await call('group-action',groupAction('rotate',{id}));
  await call('invite',{code:inviteCode},'other',404);
  await Promise.all([call('group-action',groupAction('join',{code:rotated.inviteCode}),'other'),
    call('group-action',groupAction('join',{code:rotated.inviteCode}),'other')]);
  assert.equal((await call('group',{id})).members.length,2);
  assert.equal((await call('group',{id})).inviteCode,rotated.inviteCode);
  assert.equal((await call('group',{id},'other')).inviteCode,undefined);
  await call('group-action',groupAction('rotate',{id}),'other',403);
  await call('group-action',groupAction('leave',{id}),'owner',409);

  const live=cf('A',false);
  const unknown={...cf('B'),date:undefined};
  await putProblems(db,other,[cses,live,unknown]);
  await db.query(`INSERT INTO solves (profile,problem,day,origin)
    SELECT $1,p,'2025-01-01','manual' FROM unnest($2::text[]) p`,[other,[cses.key,live.key,unknown.key]]);
  const list=async (filter='all')=>(await call('activity',{filter,id})).activity;
  assert.deepEqual((await list()).map(item=>[item.problem.key,item.source]),[[cses.key,'manual']]);
  await call('group-action',groupAction('share',{id,totalsOnly:true}),'other');
  assert.deepEqual(await list(),[]);

  const friend=(action,target=other,token='owner')=>call('friend',{action,target},token);
  assert.equal((await friend('request')).relationship,'outgoing');
  assert.equal((await friend('accept')).relationship,'outgoing');
  assert.equal((await friend('decline',owner,'other')).relationship,'none');
  await friend('request');
  assert.equal((await friend('cancel')).relationship,'none');
  await friend('request');
  assert.equal((await friend('request',owner,'other')).relationship,'incoming');
  assert.equal((await friend('accept',owner,'other')).relationship,'friend');
  assert.equal((await call('friend-profile',{id:other})).activity.length,1);
  assert.equal((await list('friends')).length,1);
  assert.equal((await list()).length,1);
  assert.deepEqual(await list('group'),[]);
  await call('group-action',groupAction('share',{id,totalsOnly:false}),'other');
  assert.equal((await list()).length,1);
  await friend('remove');
  await call('friend-profile',{id:other},'owner',404);

  await call('group-action',groupAction('transfer',{id,target:other}));
  await call('group-action',groupAction('remove',{id,target:owner}),'other');
  await call('group',{id},'owner',404);
  assert.deepEqual(await list(),[]);
  await call('group-action',groupAction('join',{code:rotated.inviteCode}));
  await call('group-action',groupAction('leave',{id}));
  await call('group-action',groupAction('leave',{id}),'other');
  await call('invite',{code:rotated.inviteCode},'other',404);
});

test('Leaderboard uses verified first acceptances and historical queue appearances in the group timezone',databaseTest,async t=>{
  const {db,url}=await testDatabase(t);
  const api=await testServer(t,url);
  const call=async (path,body,token='owner')=>{
    const response=await api('social/'+path,body,{token});
    const result=await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    return result;
  };
  await ensureProfile(db,other);
  const settings=await settingsFor(db,owner);
  settings.zone='Pacific/Honolulu';
  settings.handles.Codeforces='LocalHandle';
  settings.handles.AtCoder='Unverified';
  await saveSettings(db,owner,settings);
  const [a,b,c,d,e,f,g]=['A','B','C','D','E','F','G'].map(index=>cf(index));
  const unverified={...normalizeLink('https://atcoder.jp/contests/abc300/tasks/abc300_a'),finished:true,date:'2025-01-01'};
  await putProblems(db,owner,[a,b,c,d,e,f,g,unverified,cses]);
  await db.query("INSERT INTO lists (profile,id,data) VALUES ($1,'social',$2)",
    [owner,{id:'social',name:'Mine',enabled:true,cap:100,keys:[a.key,b.key]}]);
  await call('username',{username:'Maya'});
  await call('username',{username:'Leo'},'other');
  const {id,inviteCode}=await call('group-action',groupAction('create',{name:'Pacific week'}));
  await call('group-action',groupAction('join',{code:inviteCode}),'other');
  assert.deepEqual((await rows(db,'SELECT problem FROM social_queue WHERE group_id=$1 ORDER BY problem',[id])).map(row=>row.problem),[a.key,b.key]);
  await db.query("UPDATE lists SET data=jsonb_set(data,'{keys}',$2::jsonb) WHERE profile=$1",[owner,JSON.stringify([c.key])]);
  await call('queue',{keys:[d.key]});
  assert.deepEqual((await rows(db,'SELECT problem FROM social_queue WHERE group_id=$1 ORDER BY problem',[id])).map(row=>row.problem),[a.key,b.key,c.key]);

  const {start}=await one(db,`SELECT ((date_trunc('week',now() AT TIME ZONE $1)-interval '7 days') AT TIME ZONE $1) AS start`,[settings.zone]);
  const epoch=Math.floor(start.getTime()/1000);
  const at=offset=>new Date((epoch+offset)*1000);
  await db.query('UPDATE social_members SET joined_at=$2 WHERE group_id=$1',[id,at(10)]);
  await db.query(`INSERT INTO account_verifications (profile,judge,handle,challenge,started_at,expires_at,verified_at)
    VALUES ($1,'Codeforces','localhosthandle','fixture',0,1,1)`,[owner]);
  const fixture=(id,problem,offset)=>({id,problem:problem.key,stamp:epoch+offset,verdict:'OK'});
  await recordQueue(db,owner,[a.key,b.key,e.key],at(11),id);
  await recordQueue(db,owner,[a.key,d.key],at(100),id);
  await putSubmissions(db,owner,'Codeforces',[
    fixture('a-first',a,60),fixture('a-repeat',a,75),fixture('b-old',b,-1),fixture('b-repeat',b,80),
    fixture('c-before-join',c,5),fixture('d-before-appearance',d,85),fixture('e-next-day',e,86401),
    fixture('f-same-day',f,86410),fixture('g-verification',g,86421)
  ]);
  await db.query("INSERT INTO codeforces_verification_submissions (id) VALUES ('g-verification')");
  await db.query("INSERT INTO solves (profile,problem,day) VALUES ($1,$2,'2025-01-01')",[owner,cses.key]);
  await putSubmissions(db,owner,'AtCoder',[fixture('no-verification',unverified,86430)]);

  const scores=async week=>(await call('group',{id,week})).standings.find(row=>row.id===owner);
  assert.deepEqual(await scores('last'),{id:owner,username:'Maya',solved:0,grind:0,activeDays:0});
  await db.query("UPDATE account_verifications SET handle='localhandle' WHERE profile=$1",[owner]);
  assert.deepEqual(await scores('last'),{id:owner,username:'Maya',solved:4,grind:2,activeDays:2});
  assert.deepEqual(await scores('current'),{id:owner,username:'Maya',solved:0,grind:0,activeDays:0});
  await db.query('UPDATE account_verifications SET verified_at=NULL WHERE profile=$1',[owner]);
  assert.equal((await scores('last')).solved,0);
});
