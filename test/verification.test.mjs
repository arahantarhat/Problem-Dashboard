import assert from 'node:assert/strict';
import test from 'node:test';
import { putSubmissions, saveSettings, settingsFor, snapshot } from '../server/db.mjs';
import { databaseTest, testDatabase, owner } from './database-fixture.mjs';
import { accountVerifications, atcoderAffiliation, checkVerification, clearVerification, matchingCodeforcesSubmissions, startVerification } from '../server/verification.mjs';

const profileHtml=(affiliation,elsewhere='')=>`<title>Contestant - AtCoder</title>${elsewhere}
  <table><tr><th class="no-break">Affiliation</th><td> ${affiliation} </td></tr></table>`;

test('AtCoder reads the exact affiliation on the requested profile',()=>{
  assert.equal(atcoderAffiliation(profileHtml('UT-code'),'contestant'),'UT-code');
  assert.equal(atcoderAffiliation(profileHtml('School','<p>UT-code</p>'),'Contestant'),'School');
  assert.equal(atcoderAffiliation(profileHtml('UT-code extra'),'Contestant'),'UT-code extra');
  assert.equal(atcoderAffiliation('<title>Contestant - AtCoder</title><!-- <tr><th>Affiliation</th><td>UT-code</td></tr> -->','Contestant'),null);
  assert.throws(()=>atcoderAffiliation('<title>Sign In - AtCoder</title>','Contestant'),/expected public profile/);
  assert.throws(()=>atcoderAffiliation(profileHtml('UT-code'),'SomeoneElse'),/expected public profile/);
});

test('Codeforces proof requires a new solo practice CE for the assigned task and handle',()=>{
  const record={handle:'contestant',contest:4,task:'A',started_at:1000,expires_at:3000};
  const author={participantType:'PRACTICE',members:[{handle:'Contestant'}],ghost:false};
  const valid={id:10,contestId:4,problem:{index:'A'},verdict:'COMPILATION_ERROR',creationTimeSeconds:2,author};
  const rejected=[
    {...valid,author:{...author,members:[{handle:'Other'}]}},
    {...valid,author:{...author,members:[{handle:'Contestant'},{handle:'Other'}]}},
    {...valid,author:{...author,teamId:7}},
    {...valid,author:{...author,participantType:'VIRTUAL'}},
    {...valid,contestId:71},
    {...valid,problem:{index:'B'}},
    {...valid,verdict:'TESTING'},
    {...valid,verdict:'OK'},
    {...valid,creationTimeSeconds:0},
    {...valid,creationTimeSeconds:3},
  ];
  assert.deepEqual(matchingCodeforcesSubmissions([valid,...rejected],record),['10']);
});

test('verification persists, expires, isolates profiles, and rejects stale challenges',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const settings=await settingsFor(db,owner);
  settings.handles={AtCoder:'Contestant',Codeforces:'Contestant'};
  await saveSettings(db,owner,settings);
  const verify=async()=>({matched:true});
  const first=await startVerification(db,owner,'AtCoder','Contestant');
  assert.deepEqual((await accountVerifications(db,owner,settings.handles)).AtCoder,first);
  assert.equal((await accountVerifications(db,'demo',settings.handles)).AtCoder.status,'unverified');
  await assert.rejects(startVerification(db,'demo','AtCoder','Contestant'),/personal profile/);
  await assert.rejects(startVerification(db,owner,'AtCoder','Different'),/handle changed/);
  const replaced=await startVerification(db,owner,'AtCoder','Contestant');
  assert.notEqual(replaced.code,first.code);
  await assert.rejects(checkVerification(db,owner,'AtCoder',first.challengeId,verify),/no longer active/);
  const unavailable=await checkVerification(db,owner,'AtCoder',replaced.challengeId,async()=>{throw new Error('Could not reach AtCoder.');});
  assert.deepEqual(unavailable.verification,replaced);
  assert.match(unavailable.message,/Try again/);
  await db.query('UPDATE account_verifications SET expires_at=0 WHERE profile=$1 AND judge=$2',[owner,'AtCoder']);
  assert.equal((await checkVerification(db,owner,'AtCoder',replaced.challengeId,verify)).verification.status,'expired');

  const current=await startVerification(db,owner,'AtCoder','Contestant');
  const checking=checkVerification(db,owner,'AtCoder',current.challengeId,async()=>{
    settings.handles.AtCoder='Different';
    await saveSettings(db,owner,settings);
    await clearVerification(db,owner,'AtCoder');
    return verify();
  });
  await assert.rejects(checking,/no longer active/);
  assert.equal((await accountVerifications(db,owner,settings.handles)).AtCoder.status,'unverified');
});

test('successful Codeforces verification consumes the submission across handle relinking',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const settings=await settingsFor(db,owner);
  settings.handles.Codeforces='Contestant';
  await saveSettings(db,owner,settings);
  const verify=async()=>({matched:true,submissions:['42']});
  const first=await startVerification(db,owner,'Codeforces','Contestant');
  await putSubmissions(db,owner,'Codeforces',[{id:42,problem:'cf:4:A',stamp:1,verdict:'COMPILATION_ERROR'}]);
  const result=await checkVerification(db,owner,'Codeforces',first.challengeId,verify);
  assert.equal(result.verification.status,'verified');
  assert.equal(typeof result.verification.verifiedAt,'number');
  assert.deepEqual(await checkVerification(db,owner,'Codeforces',first.challengeId,verify),result);
  assert.equal((await snapshot(db,owner)).submissions.length,0);

  settings.handles.Codeforces='CONTESTANT';
  await saveSettings(db,owner,settings);
  assert.deepEqual((await accountVerifications(db,owner,settings.handles)).Codeforces,result.verification);
  await clearVerification(db,owner,'Codeforces');
  const next=await startVerification(db,owner,'Codeforces','Contestant');
  const reused=await checkVerification(db,owner,'Codeforces',next.challengeId,verify);
  assert.deepEqual(reused.verification,next);
  assert.match(reused.message,/already been used/);
});
