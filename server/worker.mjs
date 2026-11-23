import bend from '../.engine/training.mjs';
import { dayNumber, groups, practiceSources } from './domain.mjs';

export const engineStatus = () => 'Bend 2';
export const practiceLimit = 100;
export const earliest = (a, b) => bend.first_accept(a, b);
// The lowest allowed AtCoder band starts at 0 minus a 6000 offset and a 6000 band.
const ratingBias = 12000;
export const distance = (a, b) => bend.distance(a + ratingBias, b + ratingBias);
export const filterMatches = (rows) => rows.map(([x,lo,hi]) => Boolean(bend.includes(x+ratingBias,lo+ratingBias,hi+ratingBias)));

function nextLane(inGroup, seen) {
  let chosen = [];
  for (const lane of inGroup) {
    if (!lane.weight || lane.served >= lane.cap || lane.quota && lane.quota.remaining === 0) continue;
    if (chosen.length && !bend.precedes(lane.served,lane.weight,chosen[0].served,chosen[0].weight)) continue;
    if (lane.sections) {
      const section = nextLane(lane.sections,seen);
      if (section.length) chosen = [lane,...section];
    } else {
      while (lane.cursor < lane.candidates.length && seen.has(lane.candidates[lane.cursor].p.key)) lane.cursor++;
      if (lane.cursor < lane.candidates.length) chosen = [lane];
    }
  }
  return chosen;
}

function startLane(lane) {
  return {...lane,served:0,cursor:0,sections:lane.sections?.map(startLane)};
}

function takeCandidate(path, seen) {
  const leaf = path.at(-1);
  const item = leaf.candidates[leaf.cursor++];
  for (const lane of path) {
    lane.served++;
    if (lane.quota) lane.quota.remaining--;
  }
  seen.add(item.p.key);
  const lane = item.lane ?? path.find(lane=>lane.id)?.id;
  return lane ? {...item,lane} : item;
}

export function previewMix(lanes, limit) {
  const working = lanes.map(startLane);
  const seen = new Set();
  const result = [];
  while (result.length < limit) {
    const path = nextLane(working,seen);
    if (!path.length) break;
    result.push(takeCandidate(path,seen));
  }
  return result;
}

export function rankAndMix(lanes, shares, upsolveCap, queueMode = 'custom') {
  const automatic = queueMode === 'automatic';
  const buckets = groups.map(group => ({
    group, weight:automatic ? 1 : shares[group],
    cap:!automatic && group==='upsolve' ? upsolveCap : practiceLimit, served:0,
    lanes:lanes.filter(l=>l.group===group).map(lane=>startLane(automatic ? {...lane,cap:practiceLimit} : lane))
  }));
  const seen = new Set();
  const result = [];
  while (result.length < practiceLimit) {
    let bucket = null;
    let chosen = null;
    for (const option of buckets) {
      if (!option.weight || option.served >= option.cap) continue;
      const candidate = nextLane(option.lanes,seen);
      if (candidate.length && (!bucket || bend.precedes(option.served,option.weight,bucket.served,bucket.weight))) {
        bucket=option;
        chosen=candidate;
      }
    }
    if (!chosen) break;
    const item = takeCandidate(chosen,seen);
    bucket.served++;
    result.push(item);
  }
  return result;
}

export function mixSources(lanes, shares, upsolveCap, automatic) {
  const upsolveQuota = {remaining:automatic ? practiceLimit : upsolveCap};
  const sources = Object.entries(practiceSources).map(([source, groups])=>({
    weight:automatic ? 1 : shares[source],
    cap:practiceLimit,
    sections:lanes.filter(lane=>groups.includes(lane.group)).map(lane=>({
      ...lane,
      cap:automatic ? practiceLimit : lane.cap,
      quota:lane.group==='upsolve' ? upsolveQuota : undefined,
    })),
  }));
  return previewMix(sources,practiceLimit);
}

export function summarizeVolume(timeline, windows, judges) {
  const days = new Map();
  for (const record of timeline) {
    if (!record.day) continue;
    const day = dayNumber(record.day);
    const bySource = days.get(day) ?? {};
    bySource[record.judge] = (bySource[record.judge] ?? 0) + 1;
    days.set(day,bySource);
  }
  return windows.map(([label,start,end])=>{
    const split = Object.fromEntries(judges.map(j=>[j,0]));
    let active = 0;
    for (const [day,row] of days) {
      active += bend.contribution(day,start,end,1);
      for (const j of judges) split[j] += bend.contribution(day,start,end,row[j] ?? 0);
    }
    const total = Object.values(split).reduce((a,b)=>a+b,0);
    return {label,total,split,active,average:total/(end-start+1)};
  });
}
