/* Scoring and rating helpers adapted from AtCoder Problems Local.

MIT License

Copyright (c) 2019 kenkoooo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { createHash, randomUUID } from 'node:crypto';
import { fetchPublic } from './judges.mjs';

const finite = Number.isFinite;
function rating(weighted, weights, squared) {
  const limit = Math.sqrt(1 / 19);
  const correction =
    (1200 * (Math.sqrt(squared) / weights - limit)) / (1 - limit);
  const raw = 800 * Math.log2(weighted / weights) - correction;
  return Math.round(raw < 400 ? 400 * Math.exp((raw - 400) / 400) : raw);
}
function score(attempt, submissions) {
  const tasks = attempt.contest.tasks.map((t) => ({
    ...t,
    score: 0,
    wrong: 0,
    penalties: 0,
    elapsed: 0,
    accepted: false,
  }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let judging = false;
  for (const s of [...submissions].sort(
    (a, b) => a.epoch_second - b.epoch_second || a.id - b.id
  )) {
    const t = byId.get(s.problem_id);
    if (!t || s.epoch_second < attempt.start || s.epoch_second >= attempt.end)
      continue;
    if (!['AC', 'WA', 'TLE', 'MLE', 'RE', 'OLE', 'CE'].includes(s.result)) {
      judging = true;
      continue;
    }
    if (t.accepted) continue;
    const points =
      s.result === 'AC'
        ? t.points
        : Math.min(t.points, Math.max(0, s.point || 0));
    if (points > t.score) {
      t.score = points;
      t.elapsed = s.epoch_second - attempt.start;
      t.penalties = t.wrong;
    }
    if (s.result === 'AC') t.accepted = true;
    else if (s.result !== 'CE') t.wrong++;
  }
  const points = tasks.reduce((sum, t) => sum + t.score, 0);
  const penalties = tasks.reduce(
    (sum, t) => sum + (t.score ? t.penalties : 0),
    0
  );
  const elapsed = Math.max(
    0,
    ...tasks.filter((t) => t.score).map((t) => t.elapsed)
  );
  return {
    tasks,
    points,
    penalties,
    elapsed,
    totalTime: elapsed + penalties * attempt.contest.penalty,
    judging,
  };
}
const compare = (a, b) => b.points - a.points || a.totalTime - b.totalTime;
function standingsPerformance(result, standings, results, upper) {
  if (
    !standings?.Fixed ||
    !Array.isArray(standings.StandingsData) ||
    !Array.isArray(results)
  )
    return null;
  const rows = standings.StandingsData.filter(
    (s) =>
      s.TotalResult &&
      finite(s.TotalResult.Score) &&
      finite(s.TotalResult.Elapsed)
  );
  if (!rows.length) return null;
  const total = (s) => ({
    points: s.TotalResult.Score / 100,
    totalTime: s.TotalResult.Elapsed / 1e9,
  });
  const rank = 1 + rows.filter((s) => compare(total(s), result) < 0).length;
  const perfs = new Map(
    results
      .filter((r) => r.IsRated && finite(r.Performance))
      .map((r) => [r.UserScreenName, r.Performance])
  );
  const anchors = rows
    .filter((s) => perfs.has(s.UserScreenName))
    .sort((a, b) => compare(total(a), total(b)));
  if (!anchors.length) return null;
  const ties = anchors.filter((s) => compare(total(s), result) === 0);
  let performance;
  if (ties.length)
    performance =
      ties.reduce((n, s) => n + perfs.get(s.UserScreenName), 0) / ties.length;
  else {
    const better = anchors.filter((s) => compare(total(s), result) < 0).at(-1);
    const worse = anchors.find((s) => compare(total(s), result) > 0);
    // Official participant performances already incorporate field strength and the contest cap.
    performance =
      better && worse
        ? (perfs.get(better.UserScreenName) + perfs.get(worse.UserScreenName)) /
          2
        : perfs.get((better || worse).UserScreenName);
  }
  return {
    performance: Math.round(Math.min(upper + 401, performance)),
    rank,
    method: 'standings estimate',
  };
}
function estimate(result, contest, models) {
  // Difficulty-only models are common for hard tasks. Keep their solve
  // probability, and borrow the nearest complete task's time distribution,
  // shifted by difficulty so equal relative skill has equal expected time.
  const validDifficulty = (m) => m && finite(m.difficulty) &&
    finite(m.discrimination) && m.discrimination > 0;
  const validTime = (m) => m &&
    [m.slope, m.intercept, m.variance].every(finite) && m.variance >= 0;
  if (!contest.tasks.every((t) => validDifficulty(models[t.id]))) return null;
  const donors = contest.tasks.map((t) => models[t.id]).filter(validTime);
  const estimatedTimeTasks = [];
  const resolved = {};
  for (const task of contest.tasks) {
    const m = models[task.id];
    if (validTime(m)) {
      resolved[task.id] = m;
      continue;
    }
    if (!donors.length) return null;
    const donor = donors.reduce((best, next) =>
      Math.abs(next.difficulty - m.difficulty) < Math.abs(best.difficulty - m.difficulty)
        ? next : best);
    resolved[task.id] = {
      ...m,
      slope: donor.slope,
      intercept: donor.intercept + donor.slope * (donor.difficulty - m.difficulty),
      variance: donor.variance,
    };
    estimatedTimeTasks.push(task.id);
  }
  models = resolved;
  let seed = 2166136261;
  for (const c of contest.id)
    seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  const random = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const bots = [];
  const ordered = [...contest.tasks].sort(
    (a, b) => models[a.id].difficulty - models[b.id].difficulty
  );
  for (let r = -1000; r <= 4400; r += 10) {
    let time = 0,
      points = 0,
      last = 0;
    for (const task of ordered) {
      const m = models[task.id];
      const probability =
        1 / (1 + Math.exp(-m.discrimination * (r - m.difficulty)));
      if (random() > probability) continue;
      const normal =
        Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) *
        Math.cos(2 * Math.PI * random());
      const solveTime = Math.exp(
        Math.max(
          -10,
          Math.min(
            30,
            m.slope * r + m.intercept + Math.sqrt(m.variance) * normal
          )
        )
      );
      if (time + solveTime > contest.duration) continue;
      time += solveTime;
      last = time;
      points += task.points;
    }
    bots.push({ rating: r, points, totalTime: last });
  }
  const rank =
    bots.filter((b) => compare(b, result) < 0).length +
    bots.filter((b) => compare(b, result) === 0).length / 2 +
    0.5;
  let lo = -10000,
    hi = 10000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const predicted = bots.reduce(
      (n, b) => n + 1 / (1 + 6 ** ((mid - b.rating) / 400)),
      0
    );
    if (predicted < rank) hi = mid;
    else lo = mid;
  }
  return {
    performance: Math.round(
      Math.max(0, Math.min(contest.upper + 401, (lo + hi) / 2))
    ),
    method: 'problem-model approximation',
    ...(estimatedTimeTasks.length ? { estimatedTimeTasks } : {}),
  };
}
function parseMetadata(html, contest, tasks) {
  const plain = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const range = plain.match(/Rated Range:\s*(?:(\d+)\s*)?-\s*(\d+)?|Rated Range:\s*All\b/i);
  const penalty = plain.match(/Penalty:\s*(\d+)\s*minutes/i);
  const points = new Map();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
      x[1].replace(/<[^>]*>/g, '').trim()
    );
    if (
      cells.length === 2 &&
      /^(?:[A-Z]\d?|Ex)$/.test(cells[0]) &&
      /^\d+$/.test(cells[1])
    )
      points.set(cells[0], Number(cells[1]));
  }
  if (!range || !penalty || tasks.some((t) => !points.has(t.index)))
    throw new Error(
      'Original rated range, penalty, or task scores are unavailable for this contest.'
    );
  return {
    ...contest,
    lower: Number(range[1] || 0),
    upper: range[2] ? Number(range[2]) : null,
    penalty: Number(penalty[1]) * 60,
    tasks: tasks.map((t) => ({ ...t, points: points.get(t.index) })),
  };
}

const atcoder = 'https://atcoder.jp/contests/';
const resources = 'https://kenkoooo.com/atcoder/resources/';
const contestPattern = /^(?:abc|arc|agc)\d+$/;
export const validAtCoderVirtualHandle = handle => /^[\w]{1,32}$/.test(handle);
const json = async (url, spacing) => (await fetchPublic(url, spacing)).json();
let cachedCatalog;
async function contestCatalog() {
  if (cachedCatalog?.expires > Date.now()) return cachedCatalog.data;
  const data = Promise.all(['contests','contest-problem','problems'].map(file => json(resources+file+'.json',1150)));
  cachedCatalog = {expires:Date.now()+3_600_000,data};
  try { return await data; }
  catch (error) { if (cachedCatalog?.data===data) cachedCatalog=undefined; throw error; }
}

export async function scheduleAtCoderVirtual(attempts, {contest, start}, now = () => Math.floor(Date.now()/1000)) {
  const id = typeof contest === 'string' && contest.trim().split(/[?#]/,1)[0].match(/^(?:https:\/\/atcoder\.jp\/contests\/)?((?:abc|arc|agc)\d+)(?:\/(?:virtual|tasks)?)?$/i)?.[1].toLowerCase();
  if (!id) throw new Error('Enter an AtCoder ABC, ARC, or AGC contest ID or link.');
  if (!Number.isSafeInteger(start) || start <= now() || start > now()+30*86400) {
    throw new Error('Choose a future start time within 30 days.');
  }
  if (attempts.some(attempt => attempt.status==='scheduled' && attempt.end > now())) throw new Error('You already have a scheduled or active virtual contest.');
  const [contests,mappings,problems] = await contestCatalog();
  const row = contests.find(entry => entry.id===id);
  if (!row || !Number.isInteger(row.duration_second) || row.duration_second <= 0
    || row.start_epoch_second+row.duration_second > now()) throw new Error('Choose a finished AtCoder contest.');
  const byId = new Map(problems.map(problem => [problem.id,problem]));
  const tasks = mappings.filter(entry => entry.contest_id===id).map(entry => {
    const problem = byId.get(entry.problem_id);
    return {id:entry.problem_id,index:entry.problem_index || problem?.problem_index,title:problem?.name ?? entry.problem_id};
  });
  if (!tasks.length) throw new Error('The contest problems are unavailable.');
  const html = await (await fetchPublic(atcoder+id+'?lang=en',300)).text();
  const info = parseMetadata(html,{id,title:row.title,duration:row.duration_second},tasks);
  if (start <= now()) throw new Error('That start time has passed. Choose a new time in both apps.');
  if (attempts.some(attempt => attempt.contest.id===id && attempt.start===start)) throw new Error('That virtual attempt already exists.');
  return {id:randomUUID(),contest:info,start,end:start+info.duration,status:'scheduled',source:'timed'};
}

export function importAtCoderVirtualBackup(value, handle, attempts, now = Math.floor(Date.now()/1000)) {
  if (value?.version !== 1 || typeof value.user !== 'string' || value.user.toLowerCase() !== handle.toLowerCase()
      || !Array.isArray(value.attempts) || value.attempts.length > 10000) {
    throw new Error('Choose a version 1 AtCoder Problems Local export for the connected handle.');
  }
  const byId = new Map(attempts.map(attempt => [attempt.id,attempt]));
  const times = new Set(attempts.map(attempt => attempt.contest.id+':'+attempt.start));
  const ids = new Set();
  const added = [];
  for (const entry of value.attempts) {
    if (!entry || !['active','pending','completed','discarded'].includes(entry.status)) throw new Error('Invalid attempt in the AtCoder history.');
    if (entry.status !== 'completed' || entry.rated !== true || entry.ratingOptOut === true) continue;
    const {id,contest,start,end,result} = entry;
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || ids.has(id)
      || !contestPattern.test(contest?.id) || typeof contest.title !== 'string'
      || !Number.isSafeInteger(start) || start <= 0 || !Number.isSafeInteger(end) || end > now || end <= start || end-start > 86400
      || !Number.isInteger(result?.performance) || Math.abs(result.performance) > 10000
      || !['standings estimate','problem-model approximation'].includes(result.method)
      || !finite(result.points) || result.points < 0) throw new Error('Invalid completed result in the AtCoder history.');
    ids.add(id);
    const key = contest.id+':'+start;
    const existing = byId.get(id);
    if (existing && (existing.contest.id !== contest.id || existing.start !== start || existing.end !== end
      || existing.result?.performance !== result.performance || existing.result?.method !== result.method
      || existing.result?.points !== result.points)) throw new Error('The backup conflicts with a previously imported attempt.');
    if (existing || times.has(key)) continue;
    times.add(key);
    added.push({id,contest:{id:contest.id,title:contest.title.slice(0,240)},start,end,status:'completed',source:'import',
      result:{performance:result.performance,method:result.method,points:result.points}});
  }
  return added;
}

async function virtualSubmissions(handle, start, end) {
  const rows = new Map();
  for (let from = start-1;;) {
    const query = new URLSearchParams({user:handle,from_second:String(from)});
    const page = await json('https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?'+query,1150);
    if (!Array.isArray(page) || page.some(row => !Number.isSafeInteger(row.epoch_second)
      || !Number.isSafeInteger(row.id) || typeof row.problem_id!=='string' || typeof row.result!=='string')) {
      throw new Error('AtCoder Problems returned invalid submissions.');
    }
    for (const row of page) if (row.epoch_second >= start && row.epoch_second < end) rows.set(row.id,row);
    if (page.length < 500 || page.some(row => row.epoch_second >= end)) return [...rows.values()];
    const last = Math.max(...page.map(row => row.epoch_second));
    if (last <= from) throw new Error('AtCoder submissions could not be paginated.');
    from = last;
  }
}

export const atcoderResultDelay = 120;
export async function reviewAtCoderVirtual(attempt, handle, confirmedScore) {
  if (attempt.end+atcoderResultDelay > Date.now()/1000) throw new Error('Results can be reviewed two minutes after the virtual ends.');
  const result = score(attempt,await virtualSubmissions(handle,attempt.start,attempt.end));
  if (result.judging) return {...attempt,result,scoreKey:undefined,notice:'Some submissions are still being judged. Review again when they finish.'};
  const scoreKey = createHash('sha256').update(JSON.stringify(result.tasks)).digest('hex');
  if (!confirmedScore || confirmedScore !== scoreKey) {
    return {...attempt,result,scoreKey,notice:confirmedScore ? 'The score changed. Review the new score before confirming.' : undefined};
  }
  const contest = {...attempt.contest,upper:attempt.contest.upper ?? Infinity};
  let estimateFromStandings;
  try {
    const url = atcoder+attempt.contest.id;
    const standings = await json(url+'/standings/json',300);
    const results = await json(url+'/results/json',300);
    estimateFromStandings = standingsPerformance(result,standings,results,contest.upper);
  } catch {
    // AtCoder sometimes restricts access to the original standings.
  }
  const performance = estimateFromStandings ?? estimate(result,contest,await json(resources+'problem-models.json',1150));
  if (!performance) return {...attempt,result,scoreKey,notice:'A performance estimate is unavailable. You can retry confirmation later.'};
  return {...attempt,result:{...result,...performance},status:'completed',scoreKey:undefined,notice:undefined};
}

function ratingReplay() {
  let weighted = 0;
  let weights = 0;
  let squared = 0;
  return performance => {
    weighted=weighted*0.9+2**(performance/800);
    weights=weights*0.9+1;
    squared=squared*0.81+1;
    return rating(weighted,weights,squared);
  };
}

export function atcoderVirtualHistory(attempts, selection, official, syncedRating = null) {
  const selected = new Set(selection.ids);
  const officialIds = new Set(official?.map(point => point.contestId));
  const entries = [...attempts].sort((a,b) => a.end-b.end || a.id.localeCompare(b.id)).map(attempt => {
    const {id,contest,start,end,status,source,result,scoreKey,notice} = attempt;
    const alreadyRated = officialIds.has(contest.id);
    const counts = Boolean(official) && status==='completed' && !alreadyRated && (selection.mode==='all' || selected.has(id));
    return {id,contestId:contest.id,name:contest.title,start,end,status,source,counts,alreadyRated,scoreKey,notice,
      performance:result?.performance,method:result?.method,points:result?.points,penalties:result?.penalties,
      training:null,delta:null};
  });
  if (!official) return {rating:syncedRating,entries,points:[],hasOfficialHistory:false};

  const events = [
    ...official.map(point => ({kind:'official',...point})),
    ...entries.filter(entry => entry.counts).map(entry => ({kind:'virtual',stamp:entry.end,performance:entry.performance,entry})),
  ].sort((a,b) => a.stamp-b.stamp || Number(a.kind==='virtual')-Number(b.kind==='virtual'));
  const officialReplay = ratingReplay();
  const trainingReplay = ratingReplay();
  let published = 0;
  let estimatedOfficial = 0;
  let training = 0;
  const points = events.map(event => {
    const previous = training;
    if (event.kind==='official') {
      published=event.rating;
      estimatedOfficial=officialReplay(event.performance);
    }
    // Anchor the adjustment to the published rating even if a historical rating differs from the replay.
    training=Math.max(0,published+trainingReplay(event.performance)-estimatedOfficial);
    if (event.kind==='official') return {kind:'official',stamp:event.stamp,rating:published,training};
    event.entry.training=training;
    event.entry.delta=training-previous;
    return {kind:'virtual',stamp:event.stamp,training};
  });
  return {rating:training,entries,points,hasOfficialHistory:true};
}
