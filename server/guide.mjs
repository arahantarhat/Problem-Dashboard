import { localDay } from './domain.mjs';
import { guideFilterFields } from '../shared/guide.js';

const completed = new Set(['Solved','Reviewing']);
const moduleStatus = new Set(['Not Started','Reading','Practicing','Complete','Skipped','Ignored']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseGuideCriteria(raw) {
  if (!isObject(raw)) throw new Error('Choose USACO Guide filters.');
  return Object.fromEntries(guideFilterFields.map(field => {
    const values = raw[field] ?? [];
    if (!Array.isArray(values) || values.length > 200 || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 150)) {
      throw new Error('A USACO Guide filter is invalid.');
    }
    return [field,[...new Set(values)]];
  }));
}

export function parseGuideWeights(raw) {
  if (raw == null) return null;
  if (!isObject(raw) || Object.entries(raw).some(([key,weight]) =>
    !/^[^/]+\/.+$/.test(key) || key.length>200 || !Number.isInteger(weight) || weight<0 || weight>100)) {
    throw new Error('Guide section weights must be whole numbers between 0 and 100.');
  }
  return raw;
}

export function previewGuideProgress(catalog, raw, existing, zone, now = Date.now()) {
  if (!isObject(raw?.userProgressOnProblems) ||
      (raw.userProgressOnProblemsActivity !== undefined && !Array.isArray(raw.userProgressOnProblemsActivity)) ||
      (raw.userProgressOnModules !== undefined && !isObject(raw.userProgressOnModules))) {
    throw new Error('Choose the JSON file from USACO Guide’s Export User Data button.');
  }
  const firstSolved = new Map();
  for (const event of raw.userProgressOnProblemsActivity ?? []) {
    if (event?.problemProgress !== 'Solved' || typeof event.problemID !== 'string' ||
        !Number.isSafeInteger(event.timestamp) || event.timestamp <= 0 || event.timestamp > now) continue;
    firstSolved.set(event.problemID, Math.min(firstSolved.get(event.problemID) ?? Infinity,event.timestamp));
  }
  const matches = new Map();
  const unmatched = [];
  for (const [id,status] of Object.entries(raw.userProgressOnProblems)) {
    if (!completed.has(status)) continue;
    const problem = Object.hasOwn(catalog.problems,id) ? catalog.problems[id] : null;
    if (!problem) { unmatched.push(id); continue; }
    const time = firstSolved.get(id);
    const day = time === undefined ? null : localDay(new Date(time),zone);
    const previous = existing.get(problem.key);
    const row = matches.get(problem.key);
    const earliest = row?.day && day ? (row.day < day ? row.day : day) : row?.day ?? day;
    matches.set(problem.key,{problem,day:previous?.day ?? earliest,previous:!!previous,confirmed:previous?.source==='synced'});
  }
  const moduleIds = new Set(catalog.modules.map(module => module.id));
  const modules = Object.fromEntries(Object.entries(raw.userProgressOnModules ?? {})
    .filter(([id,status]) => moduleIds.has(id) && moduleStatus.has(status)));
  return {solves:[...matches.values()], unmatched, modules};
}
