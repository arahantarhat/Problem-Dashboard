import { atcoderTarget, codeforcesIntervals, dateWindows, dayNumber, isoDay, localDay, judges } from './domain.mjs';
import { filterMatches, rankAndMix, mixSources, previewMix, summarizeVolume, engineStatus, distance, earliest, practiceLimit } from './worker.mjs';
import { guideMatches, guideSections } from '../shared/guide.js';
import { timusCategories } from '../shared/timus.js';

const abcNumber = (name) => +(String(name).match(/\d+$/)?.[0] || 0);
const pairOrder = (a, b) => (a.index ?? '').localeCompare(b.index ?? '', 'en', {numeric:true});
const recent = (a,b) => (b.date ?? '').localeCompare(a.date ?? '') || pairOrder(a,b) || a.key.localeCompare(b.key);
const recentRound = (a,b) => (b.date ?? '').localeCompare(a.date ?? '') ||
  (b.contestStart ?? 0)-(a.contestStart ?? 0) ||
  Number(b.contest)-Number(a.contest);
const roundProblemOrder = order => (a,b) => {
  const round = recentRound(a,b);
  if (round || order !== 'hardest') return round || pairOrder(a,b);
  return (b.difficulty ?? -1) - (a.difficulty ?? -1) || pairOrder(b,a);
};
const finishedPublicRound = p => p.key.startsWith('cf:') && p.finished!==false && (p.contestName || p.date);
const nonempty = (value) => Number.isFinite(value);
const variant = (a, b) => a ? a[0] <= b : false;
const guideUsacoListings = new WeakMap();

function usacoGuideEntries(guide, problem) {
  if (!guide || problem.judge !== 'USACO') return [];
  if (!guideUsacoListings.has(guide)) {
    guideUsacoListings.set(guide, new Map(guideMatches(guide,{judges:['USACO']}).map(({problem,entries})=>[problem.key,entries])));
  }
  return guideUsacoListings.get(guide).get(problem.key) ?? [];
}

function displayGuideEntries(guide, problem, entries) {
  return problem.judge==='USACO' ? (entries ?? usacoGuideEntries(guide,problem)).filter(entry=>entry.difficulty && entry.difficulty!=='N/A') : [];
}

export function collectSolves(state) {
  const records = new Map(state.manual.map((item) => [item.problem, {day:item.day, source:'manual'}]));
  const accepted = new Map();
  for (const s of state.submissions) {
    if (!['AC','OK'].includes(s.verdict)) continue;
    accepted.set(s.problem, earliest(accepted.get(s.problem) ?? s.stamp,s.stamp));
  }
  for (const [problem,stamp] of accepted) records.set(problem, {stamp, day:localDay(new Date(stamp * 1000), state.settings.zone), source:'synced'});
  return records;
}

export function resolve(state, now = new Date(), guide) {
  const {settings, problems, lists, submissions, sync} = state;
  const today = localDay(now, settings.zone);
  const solved = collectSolves(state);
  const lookup = new Map(problems.map(p => [p.key,p]));
  const pendingKeys = new Set((state.atcoderClaims ?? []).filter(key=>!solved.has(key)));
  const pendingAtCoder = [...pendingKeys].map(key=>lookup.get(key)).filter(Boolean);
  const inProgress = (state.inProgress ?? []).flatMap(key => {
    const problem = lookup.get(key);
    if (!problem || solved.has(key)) return [];
    const guideEntries = displayGuideEntries(guide,problem);
    return [{...problem,pendingAtCoder:pendingKeys.has(key),...(guideEntries.length && {guideEntries})}];
  });
  const attempted = new Set();
  const official = new Set();
  const virtual = new Set();
  for (const s of submissions) {
    if (!s.problem.startsWith('cf:')) continue;
    const contest = lookup.get(s.problem)?.contest ?? s.problem.split(':')[1];
    if (s.in_round && s.participation === 'CONTESTANT') {
      official.add(contest);
      attempted.add('official:' + s.problem);
    }
    if (s.participation === 'VIRTUAL') {
      virtual.add(contest);
      attempted.add('virtual:' + s.problem);
    }
  }
  const lanes = [];
  const focusBands = [];
  const unsolved = candidates => candidates.filter(({p}) => !solved.has(p.key) && !pendingKeys.has(p.key));
  const add = (group, id, name, weight, cap, candidates, pending = 0, sections) => {
    lanes.push({group,id,name,weight,cap,candidates:unsolved(candidates),pending,sections});
  };
  const grid = new Map();
  const allRoundLanes = new Set();
  for (const rule of settings.atcoder.series) {
    const target = atcoderTarget(state, rule);
    const id = 'atcoder:' + rule.name;
    if (!rule.enabled || target === null) { add('atcoder',id,rule.name + ' grind',0,100,[]); continue; }
    focusBands.push({judge:'AtCoder', series:rule.name, label:'AtCoder ' + rule.name, intervals:[[target-rule.band, target+rule.band]]});
    const pool = problems.filter((p) => p.series === rule.name && p.finished !== false && nonempty(p.difficulty) && (!rule.since || abcNumber(p.contest) >= abcNumber(rule.since)) && (settings.atcoder.experimental || !p.experimental) && !solved.has(p.key) && !pendingKeys.has(p.key));
    const ordered = pool.sort((a,b) => distance(a.difficulty,target)-distance(b.difficulty,target) || recent(a,b));
    const matching = filterMatches(ordered.map(p => [p.difficulty, target-rule.band, target+rule.band]));
    const pending = ordered.filter((p,i) => matching[i] && settings.atcoder.english && p.english == null).length;
    const candidates = ordered.flatMap((p,i) => {
      if (!matching[i] || (settings.atcoder.english && p.english !== true)) return [];
      const delta = p.difficulty-target;
      return delta === 0
        ? [{p, reason: rule.name + ' · At target'}]
        : [{p, reason: rule.name, targetDelta: delta}];
    });
    add('atcoder',id,rule.name + ' grind',rule.share,100,candidates,pending);
  }
  const {upsolveMinRating,upsolveMaxRating} = settings;
  const hasUpsolveRatingFilter = upsolveMinRating != null || upsolveMaxRating != null;
  for (const rule of settings.upsolve) {
    const roundOrder = roundProblemOrder(rule.order);
    if (rule.archive) {
      const name = rule.division ? 'Div. '+rule.division+' round practice' : 'All Codeforces rounds';
      const matches = rule.enabled ? problems.filter(p=>finishedPublicRound(p) && (!rule.division || p.division===rule.division) &&
        (!rule.cutoff || variant(p.index,rule.cutoff))) : [];
      matches.sort(roundOrder);
      add('rounds','rounds:'+rule.id,name,rule.enabled ? 1 : 0,100,matches.map(p=>({p,reason:p.contestName ?? 'Codeforces round '+p.contest})));
      continue;
    }
    const id = 'upsolve:' + rule.id;
    const qualified = (p) => p.division === rule.division && (rule.allRounds ? finishedPublicRound(p) :
      p.finished !== false && (official.has(p.contest) || rule.virtual && virtual.has(p.contest)));
    const tried = (p) => attempted.has('official:' + p.key) || rule.virtual && attempted.has('virtual:' + p.key);
    const all = problems.filter(p => p.key.startsWith('cf:') && qualified(p) && variant(p.index, rule.cutoff));
    if (rule.enabled) for (const p of all) {
      const key = id + ':' + p.contest;
      const entry = grid.get(key) ?? {rule:rule.id, contest:p.contest, name:p.contestName ?? 'Contest '+p.contest,
        date:p.date, contestStart:p.contestStart, division:rule.division, cutoff:rule.cutoff,total:0,done:0};
      entry.contestStart ??= p.contestStart;
      entry.total++;
      entry.done += Number(solved.has(p.key));
      grid.set(key,entry);
    }
    const eligible = hasUpsolveRatingFilter ? all.filter(({difficulty})=>nonempty(difficulty) &&
      difficulty >= (upsolveMinRating ?? -Infinity) && difficulty <= (upsolveMaxRating ?? Infinity)) : all;
    if (rule.allRounds) {
      const matches = eligible.sort(roundOrder).map(p=>({p,lane:id,reason:'Div. '+rule.division+' · '+(p.contestName ?? 'Codeforces round '+p.contest)}));
      add('upsolve',id,'Div. '+rule.division+' upsolve',rule.enabled ? 1 : 0,100,matches);
      if (rule.enabled) allRoundLanes.add(id);
      continue;
    }
    const matches = eligible.filter(p => rule.skipped || tried(p)).sort(rule.order ? roundOrder : (a,b) => Number(tried(b))-Number(tried(a)) || recent(a,b));
    add('upsolve',id,'Div. '+rule.division+' upsolve',rule.enabled ? 1 : 0,100,matches.map(p => ({p,reason:'Div. ' + rule.division + ' · ' + (tried(p) ? 'Attempted in round' : 'Skipped in round')})));
  }
  const grind = settings.grind;
  const intervals = codeforcesIntervals(state);
  if (grind.enabled && intervals.length) focusBands.push({judge:'Codeforces', label:'Codeforces', intervals});
  const cf = problems.filter(p => p.key.startsWith('cf:') && nonempty(p.difficulty) && p.finished !== false && (!grind.since || p.date && p.date >= grind.since)).sort(recent);
  const bands = cf.flatMap(p => intervals.map(([lo,hi]) => [p.difficulty,lo,hi]));
  const bandMatches = grind.enabled ? filterMatches(bands) : [];
  add('grind','grind','Codeforces Grind',grind.enabled ? 1 : 0,100,cf.flatMap((p,i) =>
    bandMatches.slice(i*intervals.length,(i+1)*intervals.length).some(Boolean) ? [{p,reason:'Codeforces · Rating grind'}] : []));
  const cses = problems.filter(p => p.judge === 'CSES');
  const csesTopSolvers = cses.reduce((top,p)=>Math.max(top,p.solvers ?? 0),0);
  const sections = [...new Set(cses.map(p => p.section).filter(Boolean))];
  const csesProgress = sections.map(name => {
    const tasks = cses.filter(p => p.section === name).sort((a,b) => a.order-b.order);
    add('cses','cses:'+name,name,settings.cses.enabled ? (settings.cses.weights[name] ?? 0) : 0,100,tasks.map(p => ({p,reason:'CSES · '+name})));
    return {name,total:tasks.length,done:tasks.filter(p=>solved.has(p.key)).length};
  });
  const timusCatalog = problems.filter(p => p.judge==='Timus' && nonempty(p.difficulty));
  const timusAttempted = new Set(submissions.filter(s=>s.problem.startsWith('timus:')).map(s=>s.problem));
  for (const rule of settings.timusRules ?? []) {
    const direction = rule.order==='hardest' ? -1 : 1;
    const historyComplete = settings.handles.Timus && sync.Timus?.historyAt && sync.Timus.backfill===null;
    const pool = rule.progress==='unattempted' && !historyComplete ? [] : timusCatalog;
    const eligible = pool.filter(p=>(rule.min===null || p.difficulty>=rule.min) &&
      (rule.max===null || p.difficulty<=rule.max) &&
      (!rule.categories.length || rule.categories.some(tag=>p.categories?.includes(tag))) &&
      (rule.progress==='unsolved' || timusAttempted.has(p.key)===(rule.progress==='attempted')));
    eligible.sort((a,b)=>direction*(a.difficulty-b.difficulty) || a.key.localeCompare(b.key,'en',{numeric:true}));
    add('timus','timus:'+rule.id,rule.name,rule.enabled ? 1 : 0,rule.cap,eligible.map(p=>{
      const topics=rule.categories.filter(tag=>p.categories?.includes(tag)).map(tag=>timusCategories[tag]);
      return {p,reason:topics.join(' · ') || 'Timus topic practice'};
    }));
  }
  const guideRules = lists.filter(list=>list.guide).map(({id,name,enabled,cap,guide:criteria,sectionWeights=null})=>{
    const matching = guide ? guideMatches(guide,criteria,sectionWeights) : [];
    const entriesByKey = new Map(matching.map(({problem,entries})=>[problem.key,entries]));
    const problemByKey = new Map(matching.map(({problem})=>{
      const saved = lookup.get(problem.key);
      const merged = saved ? {...problem,...saved,title:saved.title === 'USACO ' + problem.key.slice(6) ? problem.title : saved.title} : problem;
      return [problem.key,merged];
    }));
    const tasks = [...problemByKey.values()];
    const candidate = (p, reason, section) => ({
      p,reason,guideEntries:entriesByKey.get(p.key).filter(entry=>!section || entry.section===section)
    });
    const weighted = sectionWeights && guideSections(matching).map(section=>({
      weight:sectionWeights[section.key] ?? 1, cap:100,
      candidates:unsolved(section.problems.map(p=>candidate(problemByKey.get(p.key),'USACO Guide · '+section.label,section.key)))
    }));
    add('guide','guide:'+id,name,enabled ? 1 : 0,cap,tasks.map(p=>candidate(p,'USACO Guide · '+name)),0,weighted);
    return {id,name,enabled,cap,criteria,sectionWeights,total:tasks.length,done:tasks.filter(p=>solved.has(p.key)).length};
  });
  const listProgress = lists.filter(list=>!list.guide).map(list => {
    const tasks = list.keys.map(k => lookup.get(k)).filter(Boolean);
    add('manual','list:'+list.id,list.name,list.enabled ? 1 : 0,list.cap,tasks.map(p => ({p,reason:'Manual · '+list.name})));
    return {...list,total:tasks.length,done:tasks.filter(p=>solved.has(p.key)).length,items:tasks.map(p=>({...p,solve:solved.get(p.key) ?? null,pendingAtCoder:pendingKeys.has(p.key)}))};
  });
  // Every-round rules share one chronological stream across divisions.
  const everyRound = lanes.filter(lane=>allRoundLanes.has(lane.id));
  const queueLanes = everyRound.length > 1 ? [
    ...lanes.filter(lane=>!allRoundLanes.has(lane.id)),
    {...everyRound[0], candidates:everyRound.flatMap(lane=>lane.candidates).sort((a,b)=>recentRound(a.p,b.p))},
  ] : lanes;
  const automatic = settings.queueMode !== 'custom';
  const mixed = automatic || settings.sourceShares
    ? mixSources(queueLanes, settings.sourceShares, settings.upsolveCap, automatic)
    : rankAndMix(queueLanes, settings.shares, settings.upsolveCap);
  const matches = new Map();
  for (const lane of lanes) for (const {p} of lane.candidates) {
    if (!matches.has(p.key)) matches.set(p.key,[]);
    matches.get(p.key).push(lane.id);
  }
  const rankedRow = ({p,reason,targetDelta,guideEntries},i) => {
    const entries = displayGuideEntries(guide,p,guideEntries);
    return {...p,reason,targetDelta,rules:matches.get(p.key),rank:i+1,...(entries.length && {guideEntries:entries})};
  };
  const queue = mixed.map(rankedRow);
  const shortlists = lanes.map(l=>l.sections ? previewMix(l.sections,practiceLimit) : l.candidates.slice(0,practiceLimit));
  const ruleOptions = lanes.map((l,i) => ({id:l.id,group:l.group,name:l.name,pending:l.pending,count:l.candidates.length,preview:shortlists[i].slice(0,3).map(({p,reason,targetDelta})=>({key:p.key,title:p.title,difficulty:p.difficulty,reason,targetDelta}))}));
  const ruleRows = Object.fromEntries(lanes.map((l,i) => [l.id,shortlists[i].map(rankedRow)]));
  const timeline = [...solved].flatMap(([key,record]) => {
    const p = lookup.get(key);
    return p ? [{...record, key, title:p.title, judge:p.judge, url:p.url, difficulty:p.difficulty, series:p.series}] : [];
  }).sort((a,b) => (b.day ?? '').localeCompare(a.day ?? '') || a.title.localeCompare(b.title));
  const numbers = dateWindows(today);
  const volume = summarizeVolume(timeline, numbers, judges);
  const focusStart = isoDay(new Date((dayNumber(today) - 29) * 86400000));
  const trainingFocus = focusBands.map(({judge, series, label, intervals}) => {
    let done = 0;
    let total = 0;
    for (const solve of timeline) {
      if (solve.judge !== judge || (series && solve.series !== series) || !nonempty(solve.difficulty) ||
          !solve.day || solve.day < focusStart || solve.day > today) continue;
      total++;
      if (intervals.some(([lo, hi]) => solve.difficulty >= lo && solve.difficulty <= hi)) done++;
    }
    return {judge,label,intervals,done,total};
  });
  const atcoderDifficulty = {};
  for (const solve of timeline) {
    if (solve.judge !== 'AtCoder' || !solve.day || dayNumber(solve.day)<numbers[1][1] || dayNumber(solve.day)>numbers[1][2] || !solve.series) continue;
    const bucket = Number.isFinite(solve.difficulty) ? String(Math.floor(solve.difficulty/200)*200) : 'Unknown';
    const counts = atcoderDifficulty[bucket] ??= {ABC:0, ARC:0, AGC:0};
    counts[solve.series]++;
  }
  const actual = Object.fromEntries(lanes.map(l => [l.id,0]));
  for (const {lane} of mixed) actual[lane]++;
  const nextQueue = mixed.slice(0,20).map(({p,lane})=>({key:p.key,title:p.title,lane}));
  const grindMatches = timeline.filter(s => {
    if (s.judge !== 'Codeforces') return false;
    const p = lookup.get(s.key);
    return p?.key.startsWith('cf:') && (!grind.since || p.date && p.date >= grind.since) && intervals.some(([lo,hi]) => p.difficulty >= lo && p.difficulty <= hi);
  }).length;
  return {settings,sync,atcoderVirtual:state.atcoderVirtual,today,queue,pendingAtCoder,inProgress,actual,nextQueue,ruleOptions,ruleRows,engine:engineStatus(),listProgress,guideRules,csesProgress,csesTopSolvers,timusCount:timusCatalog.length,
    cses:cses.map(p=>({key:p.key,title:p.title,section:p.section,day:solved.get(p.key)?.day,solved:solved.has(p.key)})),
    stats:{timeline,volume,trainingFocus,atcoderDifficulty,grindMatches,upsolves:[...grid.values()].sort(recentRound),heatStart:isoDay(new Date(numbers[3][1]*86400000))}};
}
