import { test } from 'node:test';
import assert from 'node:assert/strict';
import { putProblems, putSubmissions, saveSettings, snapshot } from '../server/db.mjs';
import { defaultSettings, normalizeLink, validateSettings } from '../server/domain.mjs';
import { resolve } from '../server/resolve.mjs';
import { parseTimusCatalog, parseTimusProfile, parseTimusStatus, timusHistory } from '../server/timus.mjs';
import { databaseTest, testDatabase, owner } from './database-fixture.mjs';
import { checkVerification, startVerification } from '../server/verification.mjs';

const author = '153405';
const authorURL = 'https://acm.timus.ru/author.aspx?id='+author;
const mottoProfile = motto => '<h2 class="author_name">Ada &amp; Co.</h2><table class="author_motto"><tr><td>'+motto+
  '</td></tr></table><div class="author_links"><a href="status.aspx?author='+author+'">Recent submissions</a></div>';
const status = (id, next, verdict='verdict_ac') =>
  '<p class="status_filter">Author: <a href="author.aspx?id='+author+'">Ada</a></p><th class="id">ID</th>'+
  (id ? '<tr class="even"><td class="id"><a href="getsubmit.aspx/'+id+'.cpp">'+id+'</a></td>'+
    '<td class="date"><nobr>04:30:00</nobr><br><nobr>21 Nov 2026</nobr></td>'+
    '<td class="coder"><a href="author.aspx?id='+author+'">Ada</a></td>'+
    '<td class="problem"><a href="problem.aspx?space=1&amp;num=1000">1000<span>. A+B Problem</span></a></td>'+
    '<td class="'+verdict+'">'+(verdict==='verdict_ac'?'Accepted':'<a href="getce.aspx">Compilation error</a>')+'</td></tr>' : '')+
  '<td class="status_footer">'+(next ? '<a href="status.aspx?author='+author+'&amp;from='+next+'">Next&nbsp;10</a>' : '')+'</td>';

test('Timus decodes public profiles, requires the right author, and checks exact Motto proof',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const settings=validateSettings({...defaultSettings(),handles:{Timus:authorURL+'&locale=en'}});
  assert.equal(settings.handles.Timus,author);
  assert.throws(()=>validateSettings({...settings,handles:{Timus:'153405AB'}}),/public Timus author ID/);
  assert.throws(()=>parseTimusProfile(mottoProfile('UT-123'),'12'),/expected public author/);
  assert.deepEqual(parseTimusProfile(mottoProfile('Welcome'),author),{name:'Ada & Co.',motto:'Welcome'});
  await saveSettings(db,owner,settings);
  const challenge=await startVerification(db,owner,'Timus',author);
  const check=motto=>checkVerification(db,owner,'Timus',challenge.challengeId,async(judge,id,record)=>({
    matched:parseTimusProfile(mottoProfile(motto),id).motto===record.code,message:'No match',
  }));
  assert.equal((await check(challenge.code+'x')).verification.status,'pending');
  assert.equal((await check(challenge.code)).verification.status,'verified');
});

test('Timus stores Yekaterinburg times as UTC and advances a saved history cursor with a refreshed overlap',async()=>{
  const empty=parseTimusStatus(status(null,null),author);
  assert.deepEqual(empty.submissions,[]);
  const first=parseTimusStatus(status(31,30),author);
  assert.deepEqual(first.submissions,[{id:31,problem:'timus:1000',stamp:Date.parse('2026-11-20T23:30:00Z')/1000,verdict:'AC'}]);
  assert.equal(first.cursor,30);
  assert.throws(()=>parseTimusStatus(status(31,31),author),/cursor/);

  const calls=[];
  const history=await timusHistory(author,{},async target=>{
    const cursor=new URL(target).searchParams.get('from');
    calls.push(cursor);
    const id=Number(cursor??30);
    return status(id,id-1);
  });
  assert.equal(history.info.backfill,4);
  assert.equal(history.submissions.length,26);
  assert.equal(calls[0],null);

  calls.length=0;
  const continued=await timusHistory(author,history.info,async target=>{
    const cursor=new URL(target).searchParams.get('from');
    calls.push(cursor);
    const id=Number(cursor??31);
    return status(id,id>1?id-1:null,id===30?'verdict_rj':'verdict_ac');
  });
  assert.deepEqual(calls,[null,'30','29','4','3','2','1']);
  assert.equal(continued.info.backfill,null);
  assert.equal(continued.submissions.find(row=>row.id===30).verdict,'Compilation error');
});

test('Timus topic rules use any selected category, inclusive scores, attempt history, and stable problem keys',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const base='https://acm.timus.ru/problem.aspx?num=';
  const html='<tr class="content"><td></td><td>1000</td><td class="name"><a href="problem.aspx?space=1&amp;num=1000">A+B &amp; C</a></td><td></td><td>123</td><td>200</td></tr>';
  const [sample]=parseTimusCatalog(html);
  assert.equal(sample.title,'A+B & C');
  assert.equal(normalizeLink('https://timus.online/problem.aspx?space=1&num=01000&locale=en').key,sample.key);
  assert.equal(normalizeLink(base+'1000&space=42').key,'timus:42:1000');

  const problems=[
    {...sample,categories:['dynprog','graphs']},
    {...normalizeLink(base+'1001'),difficulty:400,categories:['graphs']},
    {...normalizeLink(base+'1002'),difficulty:250,categories:['geometry']},
    {...normalizeLink(base+'1003'),difficulty:400,categories:['dynprog']},
  ];
  const settings=defaultSettings();
  settings.handles.Timus=author;
  settings.queueMode='custom';
  settings.shares.timus=10;
  const rule={id:'dp-graphs',name:'DP and graphs',enabled:true,categories:['dynprog','graphs'],min:200,max:400,progress:'attempted',order:'hardest',cap:1};
  settings.timusRules=[rule];
  await saveSettings(db,owner,validateSettings(settings));
  await putProblems(db,owner,problems);
  await putSubmissions(db,owner,'Timus',[
    {id:1,problem:'timus:1000',stamp:1795276537,verdict:'Wrong answer'},
    {id:2,problem:'timus:1001',stamp:1795276537,verdict:'Wrong answer'},
    {id:3,problem:'timus:1003',stamp:1795276537,verdict:'AC'},
  ]);
  const model=await snapshot(db,owner);
  const result=resolve(model,new Date('2026-11-22'));
  assert.deepEqual(result.queue.map(p=>p.key),['timus:1001']);
  assert.equal(result.ruleOptions.find(row=>row.id==='timus:dp-graphs').count,2);
  assert.equal(result.stats.timeline[0].judge,'Timus');
  model.settings.timusRules[0]={...rule,progress:'unattempted',categories:[]};
  assert.equal(resolve(model).queue.length,0);
  model.sync.Timus={historyAt:1,backfill:null};
  assert.deepEqual(resolve(model).queue.map(p=>p.key),['timus:1002']);
});
