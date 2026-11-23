import { setTimeout as wait } from 'node:timers/promises';
import { isoDay, normalizeLink } from './domain.mjs';

const day = (seconds) => Number.isFinite(seconds) ? isoDay(new Date(seconds*1000)) : undefined;
const CF = 'https://codeforces.com';
const ATP = 'https://kenkoooo.com/atcoder';
const AC = 'https://atcoder.jp';
const lastCall = new Map();

export async function fetchPublic(url, spacing=0, acceptedStatus) {
  const origin = new URL(url).origin;
  const next = Math.max(Date.now(),lastCall.get(origin) ?? 0);
  lastCall.set(origin,next+spacing);
  if (next>Date.now()) await wait(next-Date.now());
  let response;
  for (let i=0;i<2;i++) {
    try {
      response = await fetch(url,{headers:{'user-agent':'UnifiedTraining/0.1 (personal practice dashboard)'},signal:AbortSignal.timeout(25000)});
    } catch (cause) {
      throw new Error('Could not reach ' + new URL(url).hostname + '.', {cause});
    }
    if (response.status !== 429 || i===1) break;
    await response.body?.cancel();
    await wait(3500);
  }
  if (!response.ok && response.status !== acceptedStatus) throw new Error(new URL(url).hostname + ' returned HTTP ' + response.status + '.');
  return response;
}
const json = async (url, spacing=0) => (await fetchPublic(url,spacing)).json();
export const codeforcesApi = async (name, params={}) => {
  const http=await fetchPublic(CF+'/api/'+name+'?'+new URLSearchParams(params),2150,400);
  const response=await http.json().catch(cause=>{
    if(!http.ok) throw new Error('codeforces.com returned HTTP '+http.status+'.',{cause});
    throw cause;
  });
  if(response.status!=='OK') throw new Error(response.comment ?? 'Codeforces sync failed.');
  return response.result;
};
const cf = codeforcesApi;
export async function recentCodeforcesSubmissions(handle, count) {
  const rows=await cf('user.status',{handle,from:'1',count:String(count)});
  if(!Array.isArray(rows)) throw new Error('Codeforces returned an invalid submission list.');
  return rows;
}
export async function* codeforcesSubmissionPages(handle, cutoff = -Infinity) {
  const size = 500;
  for (let from = 1; ; from += size) {
    const rows = await cf('user.status', {handle, from, count:size});
    if (!Array.isArray(rows)) throw new Error('Codeforces returned an invalid submission list.');
    yield rows;
    if (rows.length < size || rows.at(-1).creationTimeSeconds < cutoff) return;
  }
}
function divisionOf(name='') {
  const label = name.match(/\bDiv\.?\s*([1-4])\b/gi) ?? [];
  if (new Set(label.map(x=>x.at(-1))).size!==1) return undefined;
  return +label[0].at(-1);
}
function cfProblem(p, c) {
  if (!p.contestId || !p.index) return null;
  const gym = p.contestId >= 100000;
  const contest=String(p.contestId), index=p.index.toUpperCase();
  const problem=normalizeLink(CF+'/'+(gym?'gym':'contest')+'/'+contest+'/problem/'+index);
  if (!problem) return null;
  return {...problem,title:p.name, difficulty:p.rating, tags:p.tags, division:divisionOf(c?.name), contestName:c?.name,
    finished:c ? c.phase==='FINISHED' : undefined, date:day(c?.startTimeSeconds), contestStart:c?.startTimeSeconds};
}

export async function codeforces(handle, previous, current) {
  const refreshCatalog = !previous.catalogAt || Date.now()-previous.catalogAt>86400000 || !current.length;
  const contests = new Map();
  let problems=[];
  if (refreshCatalog) {
    for (const c of await cf('contest.list',{gym:'false'})) contests.set(c.id,c);
    problems=(await cf('problemset.problems')).problems.map(p=>cfProblem(p,contests.get(p.contestId))).filter(Boolean);
  }
  const catalogAt=refreshCatalog ? Date.now() : previous.catalogAt;
  if (!handle) return {problems,submissions:[],info:{catalogAt}};
  const known = new Map([...current,...problems].map(p=>[p.key,p]));
  const cutoff = previous.cursor ? previous.cursor - 7*86400 : -Infinity;
  const submissions=[];
  let cursor=previous.cursor ?? 0;
  for await (const rows of codeforcesSubmissionPages(handle, cutoff)) {
    for (const s of rows) {
      if(s.creationTimeSeconds<cutoff) continue;
      cursor=Math.max(cursor,s.creationTimeSeconds);
      const id=s.problem?.contestId ?? s.contestId;
      const c=contests.get(id);
      const p=cfProblem({...s.problem,contestId:id},c);
      if(!p) continue;
      if (!known.has(p.key)) { known.set(p.key,p); problems.push(p); }
      const canonical=known.get(p.key);
      const start=c?.startTimeSeconds;
      const inRound = Number.isFinite(start) && Number.isFinite(c?.durationSeconds)
        ? s.creationTimeSeconds>=start && s.creationTimeSeconds<start+c.durationSeconds
        : s.author?.participantType==='CONTESTANT';
      submissions.push({id:s.id,problem:canonical.key,stamp:s.creationTimeSeconds,verdict:s.verdict ?? 'TESTING',participation:s.author?.participantType,inRound});
    }
  }
  let rating=previous.rating ?? null;
  let ratingNotice;
  try {
    const [user]=await cf('user.info',{handles:handle});
    if (!user) throw new Error('Codeforces returned no user information.');
    rating=Number.isInteger(user.rating) ? user.rating : null;
  } catch(error) { ratingNotice=error.message; }
  return {problems,submissions, info:{cursor,rating,ratingNotice,catalogAt}};
}

function problemSeries(p, projects) {
  const candidates=[p.contest_id,...(projects.get(p.id) ?? [])].filter(Boolean);
  return candidates.find(c=>/^(abc|arc|agc)\d+$/i.test(c)) ?? p.contest_id;
}
export function atcoderDifficulty(value) {
  return !Number.isFinite(value) ? undefined : Math.round(value < 400 ? 400 * Math.exp((value-400)/400) : value);
}

export function parseEnglish(html) {
  const mark=html.match(/id\s*=\s*["']task-statement["']/i);
  if (!mark) throw new Error('AtCoder task statement was unavailable.');
  const body=html.slice(mark.index);
  if (/class\s*=\s*["'][^"']*\blang-en\b/i.test(body)) return true;
  if (/class\s*=\s*["'][^"']*\blang-ja\b/i.test(body)) return false;
  // Older tasks may be wrapped in a section but omit the language spans.
  if (/<h[23][^>]*>\s*(?:Problem Statement|Input|Constraints)\s*<\/h[23]>/i.test(body)) return true;
  if (/<h[23][^>]*>\s*(?:問題文|入力|制約)\s*<\/h[23]>/i.test(body)) return false;
  return null;
}
export async function atcoderRatingHistory(handle) {
  const history=await json(AC+'/users/'+encodeURIComponent(handle)+'/history/json',300);
  if(!Array.isArray(history)) throw new Error('Could not read the AtCoder rating history.');
  const rated = history.filter(row=>row?.IsRated===true).map(row=>({
    contestId:typeof row.ContestScreenName==='string' ? row.ContestScreenName.split('.')[0].toLowerCase() : '',
    stamp:Date.parse(row.EndTime)/1000,
    rating:row.NewRating,
    performance:row.Performance,
  }));
  if (rated.some(row=>!row.contestId || !Number.isFinite(row.stamp)
    || !Number.isInteger(row.rating) || !Number.isInteger(row.performance))) {
    throw new Error('Could not read the AtCoder rating history.');
  }
  return rated.sort((a,b)=>a.stamp-b.stamp);
}
export async function atcoder(handle, previous, current) {
  if (!handle) throw new Error('Connect an AtCoder handle first.');
  const refreshCatalog=!previous.catalogAt || Date.now()-previous.catalogAt>86400000 || !current.length;
  const prior=new Map(current.map(p=>[p.key,p]));
  const problems=[];
  const mapped=new Map(prior);
  if(refreshCatalog) {
    const resources=(name)=>json(ATP+'/resources/'+name+'.json',1150);
    const contests=new Map((await resources('contests')).map(c=>[c.id,c]));
    const projects=new Map();
    for (const item of await resources('contest-problem')) {
      const ids=projects.get(item.problem_id) ?? [];
      ids.push(item.contest_id);
      projects.set(item.problem_id,ids);
    }
    const models=await resources('problem-models');
    for (const p of await resources('problems')) {
      const contest=problemSeries(p,projects);
      if(!contest) continue;
      const c=contests.get(contest), model=models[p.id];
      const key='ac:'+p.id.toLowerCase();
      const item={key,contest,judge:'AtCoder',title:p.name ?? p.title ?? p.id,
        index:p.problem_index, url:AC+'/contests/'+contest+'/tasks/'+p.id,
        date:day(c?.start_epoch_second),finished:c?c.start_epoch_second+c.duration_second <= Date.now()/1000:true,
        series:contest.match(/^(abc|arc|agc)\d+$/i)?.[1].toUpperCase(),difficulty:atcoderDifficulty(model?.difficulty),
        experimental:!!model?.is_experimental, english:prior.get(key)?.english};
      mapped.set(key,item);
      problems.push(item);
    }
  }
  const submissions=[];
  let after=Math.max(0,(previous.cursor ?? 0)-7*86400);
  let cursor=previous.cursor ?? 0;
  for (;;) {
    const page=await json(ATP+'/atcoder-api/v3/user/submissions?'+new URLSearchParams({user:handle,from_second:String(after)}),1150);
    if (!Array.isArray(page)) throw new Error('AtCoder Problems returned an invalid submissions page.');
    for (const s of page) {
      const key='ac:'+s.problem_id.toLowerCase();
      if(!mapped.has(key)) {
        const p=normalizeLink(AC+'/contests/'+s.contest_id+'/tasks/'+s.problem_id);
        if(p) { mapped.set(key,p); problems.push(p); }
      }
      if(mapped.has(key)) submissions.push({id:s.id,problem:key,stamp:s.epoch_second,verdict:s.result});
      cursor=Math.max(cursor,s.epoch_second);
    }
    if(page.length<500) break;
    const next=Math.max(...page.map(s=>s.epoch_second));
    if(next<=after) throw new Error('AtCoder submissions pagination could not advance.');
    after=next;
  }
  let rating=previous.rating ?? null;
  let ratingHistory=previous.ratingHistory;
  let ratingNotice;
  try {
    ratingHistory=await atcoderRatingHistory(handle);
    rating=ratingHistory.at(-1)?.rating ?? null;
  } catch(error) { ratingNotice=error.message; }
  return {problems,submissions,info:{cursor,rating,ratingHistory,ratingNotice,catalogAt:refreshCatalog?Date.now():previous.catalogAt}};
}
export const getEnglish = async (p) => parseEnglish(await (await fetchPublic(p.url+'?lang=en',150)).text());

const htmlText=(value)=>value.replace(/<[^>]*>/g,'').replace(/&(?:amp|quot|lt|gt|#39|nbsp);/g,e=>({'&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&#39;':"'",'&nbsp;':' '})[e]).trim();
export function parseUsacoDivision(html) {
  for (const [, heading] of html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)) {
    const division = /^USACO\b.*?,\s*(Bronze|Silver|Gold|Platinum)$/i.exec(htmlText(heading))?.[1];
    if (division) return division[0].toUpperCase() + division.slice(1).toLowerCase();
  }
  return null;
}

export async function usacoDivision(id) {
  return parseUsacoDivision(await (await fetchPublic('https://usaco.org/index.php?page=viewproblem2&cpid='+id,350)).text());
}

export function parseCses(html) {
  const rows=[];
  let section;
  for(const [, heading, id, title, count] of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>|<a\s[^>]*href=["']\/problemset\/task\/(\d+)\/?["'][^>]*>([\s\S]*?)<\/a>(?:\s*<span\b[^>]*class=["']detail["'][^>]*>\s*(\d+)\s*\/\s*\d+\s*<\/span>)?/gi)) {
    if (heading !== undefined) { section=htmlText(heading); continue; }
    if (!section) continue;
    const item=normalizeLink('https://cses.fi/problemset/task/'+id);
    rows.push({...item, title:htmlText(title), section, order:rows.length, ...(count !== undefined && {solvers:Number(count)})});
  }
  if(!rows.length) throw new Error('CSES task sections could not be read.');
  return rows;
}
export async function cses() {
  return {problems:parseCses(await (await fetchPublic('https://cses.fi/problemset/')).text()),submissions:[],info:{catalogAt:Date.now()}};
}
