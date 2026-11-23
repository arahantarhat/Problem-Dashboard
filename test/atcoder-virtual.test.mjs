import test from 'node:test';
import assert from 'node:assert/strict';
import { atcoderVirtualHistory, importAtCoderVirtualBackup, reviewAtCoderVirtual } from '../server/atcoder-virtual.mjs';

const start = 1700000000;
const attempt = {
  id:'virtual-1',start,end:start+6000,status:'scheduled',source:'timed',
  contest:{id:'abc324',title:'ABC 324',upper:1999,penalty:300,tasks:[{id:'abc324_a',index:'A',title:'A',points:100}]},
};
const all = {mode:'all',ids:[]};

test('AtCoder Problems Local import counts only selected virtuals and is idempotent',()=>{
  const result = {performance:1200,method:'standings estimate',points:100};
  const backup = {version:1,user:'handle',realHistory:[{Performance:5000}],attempts:[
    {...attempt,status:'completed',rated:true,result},
    {...attempt,id:'opt-out',status:'completed',rated:false,result},
    {...attempt,id:'discarded',status:'discarded',rated:true,result},
  ]};
  assert.equal(atcoderVirtualHistory([],all,[]).rating,0);
  const imported = importAtCoderVirtualBackup(backup,'Handle',[],start+10000);
  assert.equal(imported.length,1);
  assert.equal(atcoderVirtualHistory(imported,all,[]).rating,147);
  assert.equal(atcoderVirtualHistory(imported,{mode:'selected',ids:[]},[]).rating,0);
  assert.equal(atcoderVirtualHistory(imported,{mode:'selected',ids:[attempt.id]},[]).entries[0].counts,true);
  assert.deepEqual(importAtCoderVirtualBackup(backup,'Handle',imported,start+10000),[]);
  assert.throws(()=>importAtCoderVirtualBackup(backup,'other',[],start+10000),/connected handle/);
});

test('AtCoder preserves published ratings and replays selected virtuals between official contests',()=>{
  const official = [
    {contestId:'abc300',stamp:start-86400,performance:1200,rating:160},
    {contestId:'abc325',stamp:start+86400,performance:1300,rating:261},
  ];
  const virtual = {...attempt,status:'completed',result:{performance:1800}};
  const duplicate = {...virtual,id:'official-replay',contest:{id:'abc300',title:'ABC 300'}};
  assert.equal(atcoderVirtualHistory([virtual],all,undefined,261).rating,261);
  assert.equal(atcoderVirtualHistory([],all,official).rating,261);
  assert.equal(atcoderVirtualHistory([virtual],{mode:'selected',ids:[]},official).rating,261);
  const combined = atcoderVirtualHistory([virtual,duplicate],all,official);
  assert.deepEqual(combined.points.map(point=>point.kind),['official','virtual','official']);
  assert.equal(combined.points[0].training,160);
  assert.equal(combined.entries.find(entry=>entry.id===attempt.id).delta,combined.points[1].training-160);
  assert.equal(combined.points[2].rating,261);
  assert.ok(combined.rating>261);
  assert.equal(combined.entries.find(entry=>entry.id===duplicate.id).alreadyRated,true);
});

test('a timed AtCoder result shares exact submission boundaries and requires a fresh score confirmation',async context=>{
  const row = (id,epoch_second,result) => ({id,epoch_second,result,problem_id:'abc324_a'});
  let outside = false;
  context.mock.method(globalThis,'fetch', async url => {
    if(url.includes('/user/submissions?')) return Response.json([
      row(1,start-1,'AC'),row(2,start,'WA'),row(3,start+700,'AC'),row(4,attempt.end,'AC'),
      ...(outside ? [row(5,start+300,'AC')] : []),
    ]);
    if(url.endsWith('/standings/json')) return Response.json({Fixed:true,StandingsData:[
      {UserScreenName:'better',TotalResult:{Score:20000,Elapsed:100e9}},
      {UserScreenName:'worse',TotalResult:{Score:0,Elapsed:0}},
    ]});
    if(url.endsWith('/results/json')) return Response.json([
      {UserScreenName:'better',IsRated:true,Performance:1600},
      {UserScreenName:'worse',IsRated:true,Performance:800},
    ]);
    throw new Error('Unexpected request '+url);
  });
  const reviewed = await reviewAtCoderVirtual(attempt,'handle');
  assert.equal(reviewed.result.points,100);
  assert.equal(reviewed.result.penalties,1);
  assert.equal(reviewed.result.totalTime,1000);
  assert.equal(reviewed.status,'scheduled');
  outside=true;
  const changed = await reviewAtCoderVirtual(attempt,'handle',reviewed.scoreKey);
  assert.notEqual(changed.scoreKey,reviewed.scoreKey);
  assert.equal(changed.status,'scheduled');
  const confirmed = await reviewAtCoderVirtual(attempt,'handle',changed.scoreKey);
  assert.equal(confirmed.status,'completed');
  assert.equal(confirmed.result.performance,1200);
});
