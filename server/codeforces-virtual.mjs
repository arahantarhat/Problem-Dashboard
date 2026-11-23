import { createHash } from 'node:crypto';
import { codeforcesApi, codeforcesSubmissionPages } from './judges.mjs';

const initialRating = 1500;
const cacheVersion = 1;
const pendingVerdicts = new Set(['TESTING', 'SUBMITTED', 'FAILED']);
const ignoredVerdicts = new Set(['COMPILATION_ERROR', 'SKIPPED', 'FAILED', 'REJECTED']);

export function virtualSessions(rows) {
  const contests = new Map();
  for (const row of rows) {
    if (row.author?.participantType !== 'VIRTUAL') continue;
    const {id, contestId, creationTimeSeconds:stamp, relativeTimeSeconds:elapsed, verdict} = row;
    if (!Number.isInteger(contestId) || !Number.isInteger(stamp)) continue;
    const start = row.author.startTimeSeconds || (Number.isInteger(elapsed) && elapsed >= 0 ? stamp - elapsed : null);
    const sessions = contests.get(contestId) ?? new Map();
    const submissions = sessions.get(start) ?? new Map();
    submissions.set(id, {id, stamp, index:row.problem?.index, verdict, tests:row.passedTestCount,
      testset:row.testset, team:row.author.members?.length > 1});
    sessions.set(start, submissions);
    contests.set(contestId, sessions);
  }
  return [...contests].map(([contestId, sessions]) => [contestId, [...sessions].map(([start, submissions]) => ({
    start, submissions:[...submissions.values()].sort((a,b) => a.stamp-b.stamp || a.id-b.id)
  })).sort((a,b) => (a.start ?? Infinity)-(b.start ?? Infinity))]);
}

function icpcAttemptPenalty(rows) {
  const evidence = new Map();
  for (const row of rows) {
    const solved = row.problemResults?.filter(problem => problem.points > 0) ?? [];
    if (!solved.length || solved.some(problem => !Number.isInteger(problem.bestSubmissionTimeSeconds)
      || !Number.isInteger(problem.rejectedAttemptCount))) continue;
    const elapsed = solved.reduce((sum,problem) => sum+Math.floor(problem.bestSubmissionTimeSeconds/60),0);
    const rejected = solved.reduce((sum,problem) => sum+problem.rejectedAttemptCount,0);
    const minutes = (row.penalty-elapsed)/rejected;
    if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 120) {
      evidence.set(minutes,(evidence.get(minutes) ?? 0)+1);
    }
  }
  return [...evidence].sort((a,b) => b[1]-a[1])[0]?.[0];
}

export function scoreVirtualSession(session, {contest, problems}, attemptPenalty, now) {
  if (session.start == null) return {reason:'Missing virtual start time'};
  if (session.start+contest.durationSeconds > now) return {reason:'Virtual contest still in progress', retry:true};
  const submissions = session.submissions.filter(s => s.stamp >= session.start && s.stamp < session.start+contest.durationSeconds);
  if (!submissions.length) return {reason:'No submissions during the virtual contest'};
  if (submissions.some(s => s.team)) return {reason:'Team virtual contest'};
  if (submissions.some(s => !s.verdict || pendingVerdicts.has(s.verdict))) return {reason:'Submissions awaiting final results', retry:true};
  if (submissions.some(s => s.verdict === 'PARTIAL')) return {reason:'Partial scoring is unavailable'};
  const values = new Map(problems.map(problem => [problem.index,problem.points]));
  const byProblem = new Map();
  for (const submission of submissions) {
    if (!values.has(submission.index)) return {reason:'Contest problem data unavailable'};
    const attempts = byProblem.get(submission.index) ?? [];
    attempts.push(submission);
    byProblem.set(submission.index,attempts);
  }
  let points = 0;
  let penalty = 0;
  for (const [index, attempts] of byProblem) {
    const isAccepted = s => s.verdict === 'OK';
    const solvedAt = contest.type === 'CF' ? attempts.findLastIndex(isAccepted) : attempts.findIndex(isAccepted);
    if (solvedAt === -1) continue;
    const elapsed = Math.floor((attempts[solvedAt].stamp-session.start)/60);
    const rejected = attempts.slice(0,solvedAt).filter(s => !ignoredVerdicts.has(s.verdict)
      && (contest.type !== 'CF' || s.tests !== 0 || s.testset !== 'PRETESTS')).length;
    if (contest.type === 'ICPC') {
      if (rejected && attemptPenalty == null) return {reason:'Contest penalty rules unavailable'};
      points++;
      penalty += elapsed+rejected*(attemptPenalty ?? 0);
    } else {
      const max = values.get(index);
      if (!Number.isFinite(max) || max <= 0) return {reason:'Problem point values unavailable'};
      const decay = Math.floor(120*max*elapsed/(250*(contest.durationSeconds/60)));
      points += Math.max(0.3*max,max-decay-50*rejected);
    }
  }
  return {points, penalty};
}

function estimateDelta(rating, {rank, tied, field}) {
  const seed = value => 1+field.reduce((sum,[opponent,count]) => sum+count/(1+10**((value-opponent)/400)),0);
  const target = Math.sqrt(seed(rating)*(rank+tied/2));
  let low = 1;
  let high = 8000;
  while (high-low > 1) {
    const middle = Math.floor((low+high)/2);
    if (seed(middle) < target) high = middle;
    else low = middle;
  }
  return Math.trunc((low-rating)/2);
}

export function replayCodeforcesHistory(official, rounds) {
  const events = [
    ...official.map(({contestId, contestName:name, ratingUpdateTimeSeconds:stamp, oldRating, newRating:rating, rank}) => ({
      contestId,name,stamp,rating,oldRating,rank,kind:'official'
    })),
    ...rounds.filter(round => round.field).map(round => ({...round,kind:'virtual'})),
  ].sort((a,b) => a.stamp-b.stamp || Number(a.kind==='virtual')-Number(b.kind==='virtual') || a.contestId-b.contestId);
  let training = events.find(event => event.kind === 'official')?.oldRating || initialRating;
  let hasOfficial = false;
  let hasVirtual = false;
  const points = events.map(event => {
    const {field, oldRating, ...point} = event;
    const previous = training;
    if (event.kind === 'official') {
      training = !hasOfficial && oldRating === 0 ? event.rating+(training-initialRating) : training+event.rating-oldRating;
      hasOfficial = true;
    } else {
      training += estimateDelta(training,event);
      hasVirtual = true;
    }
    training = Math.max(0,training);
    return {...point,...(event.kind==='official' ? {oldRating} : {}),training,delta:training-previous};
  });
  const skipped = rounds.filter(round => !round.field).map(({retry,...round}) => round);
  return {points,skipped,rating:hasVirtual ? training : null,updatedAt:Date.now()};
}

export function selectCodeforcesHistory(history, selection, read) {
  const virtual = history.points.filter(point => point.kind==='virtual');
  const eligible = virtual.map(({contestId,name,stamp}) => ({contestId,name,stamp}));
  if (selection.mode==='all') return {...history,eligible};
  const ids = new Set(selection.ids);
  const rounds = virtual.filter(point => ids.has(String(point.contestId))).map(point => read(point.contestId)?.result).filter(round => round?.field);
  let previous = history.points.length ? history.points[0].training-history.points[0].delta : 0;
  const official = history.points.filter(point => point.kind==='official').map(point => {
    const result = {contestId:point.contestId,contestName:point.name,ratingUpdateTimeSeconds:point.stamp,
      oldRating:point.oldRating ?? previous,newRating:point.rating,rank:point.rank};
    previous = point.rating;
    return result;
  });
  const replay = replayCodeforcesHistory(official,rounds);
  return {...history,points:replay.points,rating:replay.rating ?? (eligible.length ? (official.at(-1)?.newRating ?? null) : null),eligible};
}

async function assessContest(api, contestId, sessions, officialIds, now) {
  const first = sessions[0];
  const fallback = {contestId,name:'Contest '+contestId,stamp:first.start ?? first.submissions[0].stamp};
  if (contestId >= 100000) return {...fallback,reason:'Gym contest'};
  if (officialIds.has(contestId)) return {...fallback,name:officialIds.get(contestId),reason:'Already counted as an official contest'};
  let changes;
  try {
    changes = await api('contest.ratingChanges',{contestId});
    if (!Array.isArray(changes)) throw new Error('Codeforces returned invalid rating changes.');
  } catch (error) {
    if (/rating changes (?:are )?(?:unavailable|not available)/i.test(error.message)) {
      // An unfinished rating update can produce the same response as an unrated round.
      return {...fallback,reason:'Rating changes unavailable',retry:true};
    }
    throw error;
  }
  if (!changes.length) return {...fallback,reason:'No rated results for this round',retry:true};
  const standings = await api('contest.standings',{contestId});
  const contest = standings?.contest;
  if (!contest || !Array.isArray(standings.problems) || !Array.isArray(standings.rows)
      || !Number.isInteger(contest.durationSeconds) || contest.durationSeconds <= 0) {
    throw new Error('Codeforces returned invalid contest standings.');
  }
  const base = {...fallback,name:contest.name || fallback.name};
  if (contest.phase !== 'FINISHED') return {...base,reason:'Official standings still in progress',retry:true};
  if (!['CF','ICPC'].includes(contest.type)) return {...base,reason:'Unsupported contest scoring format'};
  const ratings = new Map(changes.filter(change => typeof change.handle === 'string' && Number.isInteger(change.oldRating))
    .map(change => [change.handle.toLowerCase(),change.oldRating || initialRating]));
  const opponents = standings.rows.flatMap(row => {
    const members = row.party?.members;
    if (row.party?.participantType !== 'CONTESTANT' || members?.length !== 1) return [];
    const rating = ratings.get(members[0].handle?.toLowerCase());
    return rating !== undefined && Number.isFinite(row.points) && (contest.type === 'CF' || Number.isFinite(row.penalty))
      ? [{...row,rating}] : [];
  });
  // Public standings can omit historical rows. Use the observable rated field
  // only when it contains at least half of the original rating changes.
  if (!opponents.length || opponents.length*2 < ratings.size) {
    return {...base,reason:'Too few rated competitors in the public standings',retry:true};
  }
  const attemptPenalty = contest.type === 'ICPC' ? icpcAttemptPenalty(opponents) : undefined;
  for (const session of sessions) {
    const score = scoreVirtualSession(session,standings,attemptPenalty,now);
    if (score.reason) {
      if (session === first) Object.assign(base,score);
      if (score.retry) return {...base,...score};
      continue;
    }
    let better = 0;
    let tied = 0;
    const field = new Map();
    for (const row of opponents) {
      const order = row.points-score.points || (contest.type === 'ICPC' ? score.penalty-row.penalty : 0);
      better += Number(order > 0);
      tied += Number(order === 0);
      field.set(row.rating,(field.get(row.rating) ?? 0)+1);
    }
    return {...fallback,name:base.name,stamp:session.start,score:score.points,rank:better+1,
      tied,field:[...field],fieldSize:opponents.length+1,originalFieldSize:ratings.size+1};
  }
  return base;
}

export async function importCodeforcesVirtual(handle, {read, write, progress, api = codeforcesApi, pages = codeforcesSubmissionPages}) {
  const official = await api('user.rating',{handle});
  if (!Array.isArray(official) || official.some(row => ![row.contestId,row.ratingUpdateTimeSeconds,row.oldRating,row.newRating].every(Number.isInteger))) {
    throw new Error('Codeforces returned invalid rating history.');
  }
  const officialIds = new Map(official.map(row => [row.contestId,row.contestName]));
  const submissions = [];
  for await (const page of pages(handle)) submissions.push(...page.filter(row => row.author?.participantType === 'VIRTUAL'));
  const contests = virtualSessions(submissions);
  const rounds = [];
  progress(0,contests.length);
  for (const [contestId,sessions] of contests) {
    const signature = createHash('sha256').update(JSON.stringify([cacheVersion,sessions,officialIds.has(contestId)])).digest('hex');
    const cached = await read(contestId);
    let result = cached?.signature === signature ? cached.result : null;
    if (!result) {
      try {
        result = await assessContest(api,contestId,sessions,officialIds,Date.now()/1000);
      } catch (error) {
        const session = sessions[0];
        result = {contestId,name:cached?.result.name ?? 'Contest '+contestId,
          stamp:session.start ?? session.submissions[0].stamp,reason:error.message,retry:true};
      }
      if (!result.retry) await write(contestId,signature,result);
    }
    rounds.push(result);
    progress(rounds.length,contests.length);
  }
  const history = replayCodeforcesHistory(official,rounds);
  return {history, rating:history.points.findLast(point => point.kind === 'official')?.rating ?? null};
}
