import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, resolve as pathResolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountJudges, atcoderTarget, validateSettings, normalizeLink, isDay, localDay } from './domain.mjs';
import { openDatabase, settingsFor, saveSettings, syncFor, saveSync, snapshot, putProblems, putSubmissions, transaction, guideModulesFor, saveGuideModules, listFor, codeforcesVirtualCache, atcoderVirtualAttempts, saveAtCoderVirtualAttempts, ensureProfile, one, rows, insertRows } from './db.mjs';
import { collectSolves, resolve } from './resolve.mjs';
import { seedDemo } from './demo.mjs';
import { atcoder, atcoderRatingHistory, codeforces, cses, getEnglish, usacoDivision } from './judges.mjs';
import { importCodeforcesVirtual } from './codeforces-virtual.mjs';
import { importAtCoderVirtualBackup, reviewAtCoderVirtual, scheduleAtCoderVirtual, validAtCoderVirtualHandle } from './atcoder-virtual.mjs';
import { accountVerifications, checkVerification, clearVerification, startVerification } from './verification.mjs';
import { parseGuideCriteria, parseGuideWeights, previewGuideProgress } from './guide.mjs';
import { timusCatalog, timusHistory, timusProfile } from './timus.mjs';
import guide from './guide-catalog.json' with {type:'json'};
import { loadConfig } from './config.mjs';
import { accountVerifier, supabaseConfig } from './auth.mjs';
import { socialApi } from './social.mjs';

loadConfig();
const publicAddress = process.env.TRAINING_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const publicUrl = publicAddress ? new URL(publicAddress) : null;
if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/'
  || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash)) {
  throw new Error('Set TRAINING_PUBLIC_URL to the public HTTPS origin.');
}
const authConfig = supabaseConfig();
const verifyAccount = accountVerifier(authConfig);
const dist = pathResolve(fileURLToPath(new URL('../web/dist/',import.meta.url)));
const db = openDatabase();
try {
  // Check that db:migrate has been run before opening the HTTP listener.
  await ensureProfile(db,'demo');
  await seedDemo(db);
} catch (cause) {
  await db.end();
  const message = cause.code === '42P01'
    ? 'Run npm run db:migrate before starting Unified Training.'
    : 'Could not initialize PostgreSQL. Check DATABASE_URL and database access.';
  console.error(message, cause.code ?? cause.name);
  process.exit(1);
}
const jobs = new Set();
const virtualJobs = new Map();
const cache = new Map();
const guideProblems = new Map(Object.values(guide.problems).map(problem => [problem.key,problem]));
const usacoRequests = new Map();

function error(text, code=400) { return Object.assign(new Error(text),{status:code}); }
function guideRuleFields(body) {
  try { return {guide:parseGuideCriteria(body.criteria),sectionWeights:parseGuideWeights(body.sectionWeights)}; }
  catch(e) { throw error(e.message); }
}
function ruleCap(value, previous = 100) {
  const cap = value === undefined ? previous : value;
  if (!Number.isInteger(cap) || cap < 0 || cap > 100) throw error('Enter a cap between 0 and 100.');
  return cap;
}
function routeResult(res, data, code=200) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
async function body(req) {
  let input = '';
  for await (const buffer of req) {
    input+=buffer;
    if(input.length>2_000_000) throw error('The import is too large.',413);
  }
  try { return JSON.parse(input || '{}'); } catch { throw error('This request needs valid JSON.'); }
}
async function state(profile) {
  const {source,verifications} = await transaction(db,async db=>{
    const source=await snapshot(db,profile);
    const verifications=await accountVerifications(db,profile,source.settings.handles);
    return {source,verifications};
  },{readOnly:true});
  try {
    const value=resolve(source,new Date(),guide);
    cache.set(profile,value);
    return {...value,verifications};
  } catch(e) {
    if (!cache.has(profile)) throw e;
    return {...cache.get(profile),verifications,engineError:'Bend could not update the training view. Showing cached results.'};
  }
}
async function catalog(profile,judge) {
  return (await rows(db,'SELECT data FROM catalog WHERE profile=$1 AND judge=$2',[profile,judge])).map(r=>r.data);
}
async function lookup(db,profile,key) {
  if (typeof key !== 'string') return undefined;
  return (await one(db,'SELECT data FROM catalog WHERE profile=$1 AND key=$2',[profile,key]))?.data ?? guideProblems.get(key);
}
async function lookupMany(db,profile,keys) {
  const saved = await rows(db,'SELECT key,data FROM catalog WHERE profile=$1 AND key=ANY($2::text[])',[profile,keys]);
  const byKey = new Map(saved.map(row=>[row.key,row.data]));
  return key => byKey.get(key) ?? guideProblems.get(key);
}
async function loadUsacoDivisions(profile, keys) {
  const valid = Array.isArray(keys) && keys.length <= 10 && keys.every(key => typeof key === 'string' && /^usaco:\d{1,12}$/.test(key));
  if (!valid) throw error('Choose up to ten USACO problems.');
  const entries = await Promise.all([...new Set(keys)].map(async key => {
    const problem = await lookup(db,profile,key);
    if (!problem || problem.usacoDivision) return [key,problem?.usacoDivision ?? null];
    const id = key.slice('usaco:'.length);
    let pending = usacoRequests.get(id);
    if (!pending) {
      pending = usacoDivision(id).catch(()=>null).finally(()=>usacoRequests.delete(id));
      usacoRequests.set(id,pending);
    }
    const division = await pending;
    if (division && profile !== 'demo') await transaction(db,async db=>{
      const current = await lookup(db,profile,key);
      if (current) await putProblems(db,profile,[{...current,usacoDivision:division}]);
    },{profile});
    return [key,division];
  }));
  return Object.fromEntries(entries);
}
async function previewLinks(profile, raw) {
  const strings=String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  if(strings.length>500) throw error('Import up to 500 links at a time.');
  const normalized=strings.map(input=>({input,problem:normalizeLink(input)}));
  const find=await lookupMany(db,profile,normalized.flatMap(({problem})=>problem?[problem.key]:[]));
  const seen=new Set();
  return normalized.flatMap(({input,problem:p})=>{
    if(!p) return [{input,error:'Enter a valid HTTP or HTTPS URL.'}];
    if(seen.has(p.key)) return [];
    seen.add(p.key);
    return [{input,problem:find(p.key) ?? p}];
  });
}
async function csesImport(db, profile, raw) {
  if(raw?.version!==1 || raw.source!=='cses' || !Array.isArray(raw.solves) || raw.solves.length>2000)
    throw error('Choose a version 1 CSES export file.');
  const source=await snapshot(db,profile);
  const today=localDay(new Date(),source.settings.zone);
  const entries=new Map();
  for(const s of raw.solves) {
    if(typeof s?.id!=='string' || !/^\d{1,12}$/.test(s.id) || (s.day!=null && (!isDay(s.day) || s.day>today)))
      throw error('The CSES export contains an invalid task or date.');
    if(!entries.has(s.id) || s.day) entries.set(s.id,s.day ?? null);
  }
  const records=collectSolves(source);
  const saved=new Map(source.problems.map(problem=>[problem.key,problem]));
  return [...entries].map(([id,day])=>{
    const p=normalizeLink('https://cses.fi/problemset/task/'+id);
    return {id,day,problem:saved.get(p.key) ?? p,previous:records.has(p.key)};
  });
}

async function english(profile, pendingTasks) {
  const source = await transaction(db,db=>snapshot(db,profile),{readOnly:true});
  const opts=source.settings.atcoder;
  if(!opts.english) return 0;
  const solved=collectSolves(source);
  const claimed=new Set(source.atcoderClaims);
  const options=new Map(opts.series.filter(r=>r.enabled).map(r=>[r.name,{...r,target:atcoderTarget(source,r)}]));
  const distance=(p)=>Math.abs(p.difficulty-options.get(p.series).target);
  const candidates=source.problems.filter(p=>{
    const r=options.get(p.series);
    return r && r.target!=null && p.finished!==false && p.english==null && Number.isFinite(p.difficulty)
      && !solved.has(p.key) && !claimed.has(p.key) && (opts.experimental || !p.experimental)
      && (!r.since || +(p.contest.match(/\d+$/)?.[0] ?? 0) >= +(r.since.match(/\d+$/)?.[0] ?? 0)) && distance(p)<=r.band;
  }).sort((a,b)=>distance(a)-distance(b) || (b.date??'').localeCompare(a.date??''));
  const findings=[];
  for(const p of candidates.slice(0,pendingTasks)){
    try {
      const available = await getEnglish(p);
      if(available!==null) findings.push({...p,english:available});
    } catch { break; }
  }
  if(findings.length) await transaction(db,db=>putProblems(db,profile,findings),{profile});
  return findings.length;
}

async function syncTimus(profile, author, old) {
  const {error:previousError,...info}=old;
  const errors=[];
  if (!info.catalogAt || Date.now()-info.catalogAt>=86_400_000) {
    try {
      const problems=await timusCatalog();
      await transaction(db,db=>putProblems(db,profile,problems),{profile});
      info.catalogAt=Date.now();
    } catch(e) { if(e.severity) throw e; errors.push('Catalog: '+e.message); }
  }
  if (author) {
    try {
      const result=await timusHistory(author,info);
      const updated={...info,...result.info,historyAt:Date.now()};
      await transaction(db,async db=>{
        await putProblems(db,profile,result.problems,true);
        await putSubmissions(db,profile,'Timus',result.submissions);
        await saveSync(db,profile,'Timus',updated);
      },{profile});
      Object.assign(info,updated);
    } catch(e) { if(e.severity) throw e; errors.push('Submissions: '+e.message); }
  }
  const now=Date.now();
  await transaction(db,db=>saveSync(db,profile,'Timus',errors.length
    ? {...info,error:errors.join(' '),lastAttempt:now} : {...info,lastSuccess:now}),{profile});
}

async function doSync(profile, only) {
  if(jobs.has(profile)) throw error('A refresh is already running.',409);
  const allowed=['Codeforces','AtCoder','CSES','Timus'];
  if(only && !allowed.includes(only)) throw error('Unknown judge.');
  jobs.add(profile);
  try {
    const settings=await settingsFor(db,profile);
    const prior=await syncFor(db,profile);
    const selected=only?[only]:allowed.filter(j=>j==='CSES'||settings.handles[j]||
      (j==='Codeforces'&&settings.upsolve.some(rule=>rule.enabled&&(rule.archive||rule.allRounds)))||
      (j==='Timus'&&settings.timusRules.some(rule=>rule.enabled)));
    const adapters={Codeforces:codeforces, AtCoder:atcoder, CSES:cses};
    const results=await Promise.allSettled(selected.map(async judge=>{
      const old=prior[judge] ?? {};
      try {
        if(judge==='Timus') return await syncTimus(profile,settings.handles.Timus,old);
        const {problems,submissions,info}=await adapters[judge](settings.handles[judge],old,await catalog(profile,judge));
        await transaction(db,async db=>{
          await putProblems(db,profile,problems);
          await putSubmissions(db,profile,judge,submissions);
          await saveSync(db,profile,judge,{...info,...(judge==='Codeforces' && old.virtual ? {virtual:old.virtual} : {}),lastSuccess:Date.now()});
        },{profile});
      }catch(e){
        if(e.severity) throw e;
        await transaction(db,db=>saveSync(db,profile,judge,{...old,error:e.message,lastAttempt:Date.now()}),{profile});
      }
    }));
    const failed=results.find(result=>result.status==='rejected');
    if(failed) throw failed.reason;
    if(selected.includes('AtCoder') && !(await syncFor(db,profile)).AtCoder?.error) await english(profile,28);
    return {results:await syncFor(db,profile)};
  }finally{jobs.delete(profile);}
}

async function startVirtualImport(profile) {
  if (jobs.has(profile)) throw error('A refresh is already running.',409);
  jobs.add(profile);
  let handle;
  try {
    handle = (await settingsFor(db,profile)).handles.Codeforces;
    if (!handle) throw error('Save your Codeforces handle in Connections first.');
  } catch (cause) { jobs.delete(profile); throw cause; }
  const status = {running:true};
  virtualJobs.set(profile,status);
  const progress = (completed,total) => Object.assign(status,{completed,total});
  void importCodeforcesVirtual(handle,{...codeforcesVirtualCache(db,profile),progress})
    .then(({history,rating}) => transaction(db,async db=>{
      const prior = (await syncFor(db,profile)).Codeforces ?? {};
      await saveSync(db,profile,'Codeforces',{...prior,rating,ratingNotice:undefined,virtual:history});
    },{profile}))
    .catch(err => { status.error = err.message; })
    .finally(() => { status.running = false; jobs.delete(profile); });
  return status;
}

async function updateAtCoderVirtual(profile, action, body) {
  if (jobs.has(profile)) throw error('Wait for the current refresh to finish.',409);
  jobs.add(profile);
  try {
    const settings = await settingsFor(db,profile);
    const handle = settings.handles.AtCoder.toLowerCase();
    if (!validAtCoderVirtualHandle(handle)) throw error('Save a valid AtCoder handle in Connections first.');
    if (action==='history') {
      const ratingHistory = await atcoderRatingHistory(settings.handles.AtCoder);
      await transaction(db,async db=>{
        const previous = (await syncFor(db,profile)).AtCoder ?? {};
        await saveSync(db,profile,'AtCoder',{...previous,ratingHistory,rating:ratingHistory.at(-1)?.rating ?? null,ratingNotice:undefined});
      },{profile});
      return {state:await state(profile)};
    }
    const attempts = await atcoderVirtualAttempts(db,profile,handle);
    let imported;
    let scheduled;
    if (action==='import') {
      const added = importAtCoderVirtualBackup(body.backup,handle,attempts);
      imported = added.length;
      attempts.push(...added);
    } else if (action==='schedule') {
      scheduled = await scheduleAtCoderVirtual(attempts,body);
      attempts.push(scheduled);
    } else {
      const attempt = attempts.find(entry => entry.id===body.id && entry.status==='scheduled');
      if (!attempt) throw error('That timed attempt is unavailable.');
      if (action==='cancel') {
        if (attempt.end<=Date.now()/1000) throw error('This attempt has already ended.');
        attempt.status='cancelled';
      } else {
        if (action==='confirm' && (!attempt.scoreKey || attempt.scoreKey!==body.scoreKey)) throw error('Review the latest score before confirming.');
        const updated = await reviewAtCoderVirtual(attempt,handle,action==='confirm' ? body.scoreKey : undefined);
        attempts[attempts.indexOf(attempt)] = updated;
      }
    }
    await transaction(db,async db=>{
      if (scheduled && settings.virtualSelection.AtCoder.mode==='selected') {
        settings.virtualSelection.AtCoder.ids.push(scheduled.id);
        await saveSettings(db,profile,settings);
      }
      await saveAtCoderVirtualAttempts(db,profile,handle,attempts);
    },{profile});
    return {state:await state(profile),imported};
  } catch (cause) {
    if (cause.severity) throw cause;
    throw error(cause.message,cause.status);
  } finally { jobs.delete(profile); }
}

function insertImportedSolves(db,profile,records) {
  return insertRows(db,'solves',['profile','problem','day','origin'],records.map(({problem,day})=>[profile,problem.key,day,'imported']),
    'ON CONFLICT (profile,problem) DO UPDATE SET day=COALESCE(solves.day,excluded.day)');
}

const demoPreviews = new Set(['/api/usaco/divisions','/api/preview','/api/guide/rules/preview','/api/links/preview','/api/guide/preview','/api/cses/preview']);

async function socialQueue(db, profile) {
  const source = await snapshot(db,profile);
  return resolve(source,new Date(),guide).queue.map(problem=>problem.key);
}

async function api(req, res, u) {
  const url = u.pathname;
  if(req.method==='GET' && url==='/api/health') return routeResult(res,{ok:true,engine:'Bend 2'});
  if(req.method==='GET' && url==='/api/auth/config') return routeResult(res,authConfig);
  const account = await verifyAccount(req.headers.authorization);
  if(!account) throw error('Sign in to Unified Training to continue.',401);
  const mode = u.searchParams.get('profile') ?? 'personal';
  if(!['personal','demo'].includes(mode) || u.searchParams.getAll('profile').length > 1) throw error('Choose personal or demo mode.');
  const profile = mode === 'demo' ? 'demo' : account;
  if(mode==='personal') await ensureProfile(db,profile,req.headers['x-training-timezone']);
  const socialAction = /^\/api\/social\/([a-z-]+)$/.exec(url)?.[1];
  if (socialAction && mode === 'demo') throw error('Switch to your personal profile to use Social.',403);
  if (req.method === 'GET' && socialAction === 'identity') {
    return routeResult(res,await socialApi(db,profile,socialAction));
  }
  if(req.method==='GET' && url==='/api/virtual/codeforces') return routeResult(res,virtualJobs.get(profile) ?? {running:false});
  if(req.method==='GET' && url==='/api/virtual/atcoder/contests') {
    const contests = await rows(db,`SELECT data->>'contest' AS id, max(data->>'date') AS day
      FROM catalog WHERE profile=$1 AND judge='AtCoder' AND data->>'series' IN ('ABC','ARC','AGC')
      AND data->'finished' IS DISTINCT FROM 'false'::jsonb AND data->'finished' IS DISTINCT FROM '0'::jsonb
      GROUP BY id ORDER BY day DESC NULLS LAST, id DESC NULLS LAST LIMIT 120`,[profile]);
    return routeResult(res,contests);
  }
  if(req.method==='GET' && url==='/api/state') return routeResult(res,await state(profile));
  if(req.method==='GET' && url==='/api/guide') return routeResult(res,{catalog:guide,moduleProgress:await guideModulesFor(db,profile)});
  if(req.method!=='POST') throw error('Route not found.',404);
  if(req.headers['content-type']?.split(';')[0]!=='application/json') throw error('Requests must use JSON.',415);
  const origin=req.headers.origin;
  if(origin && origin!==u.origin) throw error('This request must come from Unified Training.',403);
  if(profile==='demo' && !demoPreviews.has(url)) throw error('Switch to your personal profile to save changes.',403);
  const b=await body(req);
  if(!b || typeof b!=='object' || Array.isArray(b)) throw error('Requests must contain a JSON object.');
  if (socialAction) return routeResult(res,await socialApi(db,profile,socialAction,b,socialQueue,publicUrl?.origin ?? null));
  if(url==='/api/usaco/divisions') return routeResult(res,await loadUsacoDivisions(profile,b.keys));
  if(url==='/api/settings') {
    if(jobs.has(profile)) throw error('Wait for the current sync before changing settings.',409);
    let value;
    try { value=validateSettings(b); } catch(e){ throw error(e.message); }
    jobs.add(profile);
    try {
      const before=await settingsFor(db,profile);
      const timusChanged=before.handles.Timus!==value.handles.Timus;
      let authorName;
      if(timusChanged && value.handles.Timus) {
        try { ({name:authorName}=await timusProfile(value.handles.Timus)); }
        catch(e) { throw error(e.message); }
      }
      await transaction(db,async db=>{
        if(JSON.stringify(before)!==JSON.stringify(await settingsFor(db,profile))) {
          throw error('The profile changed while checking settings. Try saving again.',409);
        }
        for(const judge of ['Codeforces','AtCoder']) {
          if(before.handles[judge].toLowerCase()!==value.handles[judge].toLowerCase()) value.virtualSelection[judge]={mode:'all',ids:[]};
        }
        await saveSettings(db,profile,value);
        for(const judge of accountJudges) if(before.handles[judge].toLowerCase()!==value.handles[judge].toLowerCase()){
          const catalogAt=judge==='Timus'?(await syncFor(db,profile)).Timus?.catalogAt:undefined;
          await db.query('DELETE FROM submissions WHERE profile=$1 AND judge=$2',[profile,judge]);
          await db.query('DELETE FROM sync WHERE profile=$1 AND judge=$2',[profile,judge]);
          if(judge==='Codeforces') await db.query('DELETE FROM codeforces_virtual_rounds WHERE profile=$1',[profile]);
          await clearVerification(db,profile,judge);
          if(judge==='Timus' && (catalogAt || authorName)) await saveSync(db,profile,judge,{catalogAt,authorName});
        }
      },{profile});
      if(before.handles.Codeforces.toLowerCase()!==value.handles.Codeforces.toLowerCase()) virtualJobs.delete(profile);
    } finally { jobs.delete(profile); }
    return routeResult(res,await state(profile));
  }
  if(url==='/api/connections/verification/start') {
    return routeResult(res,{verification:await startVerification(db,profile,b.judge,b.handle)});
  }
  if(url==='/api/connections/verification/check') {
    return routeResult(res,await checkVerification(db,profile,b.judge,b.challengeId));
  }
  if(url==='/api/preview') {
    let settings;
    try { settings=validateSettings(b); } catch(e){ throw error(e.message); }
    const s=await transaction(db,db=>snapshot(db,profile,settings),{readOnly:true});
    const result=resolve(s,new Date(),guide);
    return routeResult(res,{actual:result.actual,nextQueue:result.nextQueue,ruleOptions:result.ruleOptions});
  }
  if(url==='/api/guide/rules/preview') {
    const source=await transaction(db,db=>snapshot(db,profile),{readOnly:true});
    const index=source.lists.findIndex(list=>list.guide && list.id===b.id);
    const cap=ruleCap(b.cap,source.lists[index]?.cap);
    const draft={id:b.id ?? 'preview',name:'USACO Guide',cap,enabled:!!b.enabled,...guideRuleFields(b)};
    if(index<0) source.lists.push(draft);
    else source.lists[index]=draft;
    const result=resolve(source,new Date(),guide);
    const id='guide:'+draft.id;
    const {count,preview}=result.ruleOptions.find(rule=>rule.id===id);
    return routeResult(res,{queued:result.actual[id],count,preview});
  }
  if(url==='/api/sync') return routeResult(res,await doSync(profile,b.judge));
  if(url==='/api/virtual/codeforces') return routeResult(res,await startVirtualImport(profile),202);
  const atcoderAction = /^\/api\/virtual\/atcoder\/(history|import|schedule|cancel|review|confirm)$/.exec(url)?.[1];
  if(atcoderAction) return routeResult(res,await updateAtCoderVirtual(profile,atcoderAction,b));
  if(url==='/api/english') {
    if(jobs.has(profile)) throw error('A refresh is already running.',409);
    jobs.add(profile);
    try{const checked=await english(profile,40);return routeResult(res,{checked});}finally{jobs.delete(profile);}
  }
  if(url==='/api/links/preview') return routeResult(res,await previewLinks(profile,b.links));
  if(url==='/api/lists' || url==='/api/guide/rules') {
    const guideRule=url==='/api/guide/rules';
    const name=String(b.name ?? '').trim();
    if(!name || name.length>90) throw error('Enter a name up to 90 characters.');
    const id=b.id || randomUUID();
    const guideFields=guideRule ? guideRuleFields(b) : {};
    const requested = !guideRule && Array.isArray(b.keys) ? b.keys.slice(0,1000).filter(key=>typeof key==='string') : [];
    const newItems=[];
    for(const link of (!guideRule&&Array.isArray(b.links)?b.links.slice(0,500):[])){
      const p=normalizeLink(link?.url);
      if(!p) throw error('A link is invalid.');
      if(typeof link.title==='string' && link.title.trim()) p.title=link.title.trim().slice(0,200);
      newItems.push(p);
    }
    await transaction(db,async db=>{
      const existing=b.id && (await listFor(db,profile)).find(row=>row.id===b.id && Boolean(row.guide)===guideRule);
      if(b.id && !existing) throw error(guideRule?'Guide rule not found.':'List not found.',404);
      const find=await lookupMany(db,profile,requested);
      const keys=[...new Set([...requested.filter(key=>find(key)), ...newItems.map(p=>p.key)])];
      const list={id,name,cap:ruleCap(b.cap,existing?.cap),enabled:!!b.enabled,keys,...guideFields};
      await putProblems(db,profile,newItems,true);
      await db.query(`INSERT INTO lists (profile,id,data) VALUES ($1,$2,$3)
        ON CONFLICT (profile,id) DO UPDATE SET data=excluded.data`,[profile,id,list]);
    },{profile});
    return routeResult(res,await state(profile));
  }
  if(url==='/api/lists/delete' || url==='/api/guide/rules/delete') {
    await transaction(db,db=>db.query("DELETE FROM lists WHERE profile=$1 AND id=$2 AND COALESCE(jsonb_typeof(data->'guide')='object',false)=$3",
      [profile,b.id,url==='/api/guide/rules/delete']),{profile});
    return routeResult(res,await state(profile));
  }
  if(url==='/api/in-progress') {
    if(typeof b.key!=='string' || typeof b.active!=='boolean') throw error('Choose a problem and its progress status.');
    await transaction(db,async db=>{
      if (b.active) {
        const problem=await lookup(db,profile,b.key);
        if(!problem) throw error('Problem not found.',404);
        await putProblems(db,profile,[problem],true);
        await db.query('INSERT INTO in_progress (profile,problem) VALUES ($1,$2) ON CONFLICT DO NOTHING',[profile,b.key]);
      } else await db.query('DELETE FROM in_progress WHERE profile=$1 AND problem=$2',[profile,b.key]);
    },{profile});
    return routeResult(res,await state(profile));
  }
  if(url==='/api/solves') {
    await transaction(db,async db=>{
      const problem=await lookup(db,profile,b.key);
      if(!problem) throw error('Problem not found.',404);
      const atcoder=problem.key.startsWith('ac:');
      const existingManual=atcoder && await one(db,'SELECT 1 FROM solves WHERE profile=$1 AND problem=$2',[profile,b.key]);
      if(atcoder && (b.removeClaim || (!b.remove && !existingManual))) {
        const handle=(await settingsFor(db,profile)).handles.AtCoder.toLowerCase();
        if(b.removeClaim) await db.query('DELETE FROM atcoder_claims WHERE profile=$1 AND handle=$2 AND problem=$3',[profile,handle,b.key]);
        else {
          if(!handle) throw error('Save your AtCoder handle in Connections before claiming a solve.');
          await putProblems(db,profile,[problem],true);
          await db.query('INSERT INTO atcoder_claims (profile,handle,problem) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[profile,handle,b.key]);
        }
      } else if(b.remove) await db.query('DELETE FROM solves WHERE profile=$1 AND problem=$2',[profile,b.key]);
      else {
        const day=b.day ?? null;
        const today=localDay(new Date(),(await settingsFor(db,profile)).zone);
        if(day!==null && (!isDay(day) || day>today)) throw error('Choose a past or current solve date.');
        await putProblems(db,profile,[problem],true);
        await db.query(`INSERT INTO solves (profile,problem,day,origin) VALUES ($1,$2,$3,'manual')
          ON CONFLICT (profile,problem) DO UPDATE SET day=excluded.day`,[profile,b.key,day]);
      }
    },{profile});
    return routeResult(res,await state(profile));
  }
  if(url==='/api/guide/preview' || url==='/api/guide/import') {
    const preview = async db => {
      const source=await snapshot(db,profile);
      try { return previewGuideProgress(guide,b,collectSolves(source),source.settings.zone); }
      catch(e) { throw error(e.message); }
    };
    if(url.endsWith('/preview')) return routeResult(res,await transaction(db,preview,{readOnly:true}));
    await transaction(db,async db=>{
      const {solves,modules}=await preview(db);
      await putProblems(db,profile,solves.map(row=>row.problem),true);
      await insertImportedSolves(db,profile,solves.filter(row=>!row.confirmed));
      await saveGuideModules(db,profile,{...await guideModulesFor(db,profile),...modules});
    },{profile});
    return routeResult(res,await state(profile));
  }
  if(url==='/api/cses/preview' || url==='/api/cses/import'){
    const preview = db => csesImport(db,profile,b);
    if(url.endsWith('/preview')) return routeResult(res,await transaction(db,preview,{readOnly:true}));
    await transaction(db,async db=>{
      const entries=await preview(db);
      await putProblems(db,profile,entries.map(row=>row.problem),true);
      await insertImportedSolves(db,profile,entries);
    },{profile});
    return routeResult(res,await state(profile));
  }
  throw error('Route not found.',404);
}

const mimes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
const delayNumber=Number(process.env.PORT ?? 4173);
const port=Number.isInteger(delayNumber)?delayNumber:4173;
const server=createServer(async(req,res)=>{
  try{
    const host=String(req.headers.host ?? '');
    const validHost = publicUrl ? host.toLowerCase() === publicUrl.host : /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host);
    if(!validHost) throw error('Use the Unified Training address.',403);
    if(!req.url?.startsWith('/') || req.url.startsWith('//')) throw error('Invalid request URL.');
    const base = publicUrl?.origin ?? new URL('http://'+host).origin;
    const url=new URL(req.url,base);
    if(url.origin !== base) throw error('Invalid request URL.');
    if(url.pathname.startsWith('/api/')) return await api(req,res,url);
    if(req.method!=='GET' && req.method!=='HEAD') throw error('Route not found.',404);
    let filename=pathResolve(dist,'.'+decodeURIComponent(url.pathname));
    if(filename!==dist && !filename.startsWith(dist+sep)) throw error('Route not found.',404);
    if(!extname(filename) || (await stat(filename).catch(()=>null))?.isDirectory()) filename=pathResolve(dist,'index.html');
    const data=await readFile(filename).catch(()=>{throw error('Web assets are unavailable. Run npm run build.',404);});
    res.writeHead(200,{'content-type':mimes[extname(filename)] ?? 'application/octet-stream','x-content-type-options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch(e){
    if(!e.status) console.error('Request failed:',e.code ?? e.name, e.severity ? '' : e.message);
    if(!res.headersSent) routeResult(res,{error:e.status?e.message:'Unified Training could not complete that request.'},e.status ?? 500);
  }
});
server.listen(port,publicUrl ? '0.0.0.0' : '127.0.0.1',()=>{
  console.log('Unified Training · '+(publicUrl?.origin ?? 'http://127.0.0.1:'+server.address().port));
});
