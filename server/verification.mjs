import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { settingsFor, transaction, one, rows } from './db.mjs';
import { fetchPublic, recentCodeforcesSubmissions } from './judges.mjs';
import { accountJudges as judges } from './domain.mjs';
import { timusProfile } from './timus.mjs';

const duration=15*60*1000;
const practiceContests=[4,71,231];
const recentCount=100;

function fail(message,status=400) {
  throw Object.assign(new Error(message),{status});
}

function verificationFor(db,profile,judge) {
  return one(db,'SELECT * FROM account_verifications WHERE profile=$1 AND judge=$2',[profile,judge]);
}

function publicVerification(record,now=Date.now()) {
  if(!record) return {status:'unverified'};
  const {judge,handle,verified_at:verifiedAt,expires_at:expiresAt,challenge,code,contest,task}=record;
  if(verifiedAt!==null) return {status:'verified',handle,verifiedAt};
  if(expiresAt<=now) return {status:'expired',handle};
  const details=judge==='Codeforces' ? {problem:{contest,task}} : {code};
  return {status:'pending',handle,challengeId:challenge,expiresAt,...details};
}

export async function accountVerifications(db,profile,handles) {
  const records = await rows(db,'SELECT * FROM account_verifications WHERE profile=$1',[profile]);
  return Object.fromEntries(judges.map(judge=>{
    const record=records.find(row=>row.judge===judge);
    return [judge,publicVerification(record?.handle===(handles[judge] ?? '').toLowerCase()?record:null)];
  }));
}

export function clearVerification(db,profile,judge) {
  return db.query('DELETE FROM account_verifications WHERE profile=$1 AND judge=$2',[profile,judge]);
}

async function savedHandle(db,profile,judge) {
  if(!judges.includes(judge)) fail('Choose AtCoder, Codeforces, or Timus.');
  if(profile==='demo') fail('Account verification is available in your personal profile.',403);
  const handle=(await settingsFor(db,profile)).handles[judge];
  if(!handle) fail(judge==='Timus'?'Save your Timus profile in Connections first.':'Save your '+judge+' handle in Connections first.');
  return handle;
}

export function startVerification(db,profile,judge,expectedHandle) {
  return transaction(db,async db=>{
    const handle=(await savedHandle(db,profile,judge)).toLowerCase();
    if(typeof expectedHandle!=='string' || expectedHandle.toLowerCase()!==handle) fail('The saved handle changed. Reopen Connections to continue.',409);
    const record=await verificationFor(db,profile,judge);
    if(record?.handle===handle && record.verified_at!==null) return publicVerification(record);
    const startedAt=Date.now();
    const code=judge==='Codeforces'?null:'UT-'+randomBytes(12).toString('hex');
    const contest=judge==='Codeforces'?practiceContests[randomInt(practiceContests.length)]:null;
    await db.query(`INSERT INTO account_verifications
      (profile,judge,handle,challenge,started_at,expires_at,code,contest,task)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (profile,judge) DO UPDATE SET handle=excluded.handle,challenge=excluded.challenge,
      started_at=excluded.started_at,expires_at=excluded.expires_at,code=excluded.code,
      contest=excluded.contest,task=excluded.task,verified_at=NULL`,
      [profile,judge,handle,randomUUID(),startedAt,startedAt+duration,code,contest,contest===null?null:'A']);
    return publicVerification(await verificationFor(db,profile,judge));
  }, {profile});
}

export function atcoderAffiliation(html,handle) {
  const markup=html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const title=markup.match(/<title>\s*([\w.-]+)\s*-\s*AtCoder\s*<\/title>/i);
  if(title?.[1].toLowerCase()!==handle.toLowerCase()) throw new Error('AtCoder did not return the expected public profile.');
  const row=markup.match(/<tr\b[^>]*>\s*<th\b[^>]*>\s*Affiliation\s*<\/th>\s*<td\b[^>]*>([^<]*)<\/td>\s*<\/tr>/i);
  return row?.[1].trim() ?? null;
}

export function matchingCodeforcesSubmissions(rows,record) {
  return rows.filter(row=>{
    const author=row?.author;
    return row?.verdict==='COMPILATION_ERROR' && Number.isSafeInteger(row.id) && row.id>0
      && Number.isSafeInteger(row.creationTimeSeconds) && row.creationTimeSeconds*1000>=record.started_at
      && row.creationTimeSeconds*1000<record.expires_at && row.contestId===record.contest
      && row.problem?.index===record.task && author?.participantType==='PRACTICE' && author.members?.length===1
      && author.members[0]?.handle?.toLowerCase()===record.handle && author.teamId==null && !author.ghost;
  }).map(row=>String(row.id));
}

async function findProof(judge,handle,record) {
  if(judge==='Timus') {
    const {motto}=await timusProfile(handle);
    return {matched:motto===record.code,message:'The code is not visible in the public Timus Motto yet. Save it on Timus and try again.'};
  }
  if(judge==='AtCoder') {
    const url='https://atcoder.jp/users/'+encodeURIComponent(handle)+'?lang=en';
    const response=await fetchPublic(url,1150);
    const affiliation=atcoderAffiliation(await response.text(),handle);
    return {matched:affiliation===record.code,message:'The code is not visible in the public Affiliation field yet. Save it on AtCoder and try again.'};
  }
  const rows=await recentCodeforcesSubmissions(handle,recentCount);
  const submissions=matchingCodeforcesSubmissions(rows,record);
  const message=rows.length>=recentCount && rows.at(-1)?.creationTimeSeconds*1000>=record.started_at
    ? 'No matching compilation error in the latest 100 submissions. If your submission is older, start a new challenge.'
    : 'A matching compilation error is not visible yet. Check the assigned problem and verdict on Codeforces, then try again.';
  return {matched:submissions.length>0,submissions,message};
}

async function currentChallenge(db,profile,judge,handle,challengeId) {
  const record=await verificationFor(db,profile,judge);
  if((await settingsFor(db,profile)).handles[judge].toLowerCase()!==handle || record?.handle!==handle || record.challenge!==challengeId) {
    fail('This challenge is no longer active. Reopen Connections to check the current challenge.',409);
  }
  return record;
}

export async function checkVerification(db,profile,judge,challengeId,lookup=findProof) {
  const handle=await savedHandle(db,profile,judge);
  const normalized=handle.toLowerCase();
  const record=await currentChallenge(db,profile,judge,normalized,challengeId);
  if(record.verified_at!==null || record.expires_at<=Date.now()) return {verification:publicVerification(record)};
  let proof;
  try { proof=await lookup(judge,handle,record); }
  catch(error) { proof={matched:false,message:`${error.message} Try again before the challenge expires.`}; }
  return transaction(db,async db=>{
    const current=await currentChallenge(db,profile,judge,normalized,challengeId);
    const now=Date.now();
    if(current.verified_at!==null || current.expires_at<=now) return {verification:publicVerification(current,now)};
    if(!proof.matched) return {verification:publicVerification(current,now),message:proof.message};
    if(judge==='Codeforces') {
      let consumed = false;
      for (const id of proof.submissions) {
        const result = await db.query('INSERT INTO codeforces_verification_submissions (id) VALUES ($1) ON CONFLICT DO NOTHING',[id]);
        if (result.rowCount) { consumed=true; break; }
      }
      if (!consumed) return {verification:publicVerification(current,now),message:'That submission has already been used. Submit a new compilation error for this challenge.'};
    }
    await db.query(`UPDATE account_verifications SET verified_at=$3,code=NULL,contest=NULL,task=NULL
      WHERE profile=$1 AND judge=$2`,[profile,judge,now]);
    return {verification:publicVerification({...current,verified_at:now},now)};
  }, {profile});
}
