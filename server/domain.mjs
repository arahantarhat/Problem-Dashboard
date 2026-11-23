import { normalizeTimusAuthor, timusCategories, timusHosts } from '../shared/timus.js';

export const judges = ['AtCoder', 'Codeforces', 'CSES', 'Timus', 'USACO', 'QOJ', 'Other'];
export const groups = ['atcoder', 'upsolve', 'rounds', 'grind', 'cses', 'timus', 'guide', 'manual'];
export const practiceSources = {
  atcoder:['atcoder'], codeforces:['upsolve','rounds','grind'], cses:['cses'],
  timus:['timus'], guide:['guide'], manual:['manual'],
};
export const series = ['ABC', 'ARC', 'AGC'];
const ratingJudges = ['AtCoder', 'Codeforces'];
export const accountJudges = [...ratingJudges, 'Timus'];
const defaultGrindOffsets = () => [[0, 200]];
const defaultVirtualSelection = () => ({Codeforces:{mode:'all',ids:[]},AtCoder:{mode:'all',ids:[]}});
const usacoColor = '#8654ad';
const timusColor = '#8a5c16';
export const defaultSettings = () => ({
  handles: { AtCoder: '', Codeforces: '', Timus: '' },
  timusRules: [],
  trainingRatings: { AtCoder: null, Codeforces: null },
  virtualSelection: defaultVirtualSelection(),
  colors: { AtCoder: '#3157ce', Codeforces: '#ac4924', CSES: '#16755b', Timus: timusColor, USACO: usacoColor, QOJ: '#7b47ba', Other: '#536177' },
  zone: 'America/Santo_Domingo',
  queueMode: 'automatic',
  shares: { atcoder: 80, upsolve: 20, rounds: 10, grind: 0, cses: 0, timus: 0, guide: 0, manual: 0 },
  atcoder: { experimental: false, english: true, series: series.map((name, i) => ({
    name, enabled: i < 2, share: [80, 20, 0][i], ratingSource: 'official', offset: [300, 100, 0][i], band: 100, fixed: null, since: ''
  })) },
  upsolve: [2, 3].map((division, i) => ({ id: 'div' + division, division, cutoff: ['D', 'F'][i], enabled: true, virtual: false, skipped: true })),
  upsolveCap: 20,
  upsolveMinRating: null,
  upsolveMaxRating: null,
  grind: { enabled: false, ratingSource: 'fixed', intervals: [[1400, 1600]], offsets: defaultGrindOffsets(), since: '' },
  cses: { enabled: false, weights: {} },
});

export function withRatingDefaults(settings) {
  return {
    ...settings,
    queueMode: settings.queueMode ?? 'automatic',
    upsolveMinRating: settings.upsolveMinRating ?? null,
    upsolveMaxRating: settings.upsolveMaxRating ?? null,
    handles: { Timus: '', ...settings.handles },
    timusRules: settings.timusRules ?? [],
    shares: { timus: 0, guide: 0, rounds: 10, ...settings.shares },
    colors: { Timus: timusColor, USACO: usacoColor, ...settings.colors },
    trainingRatings: { AtCoder: null, Codeforces: null, ...settings.trainingRatings },
    virtualSelection: {...defaultVirtualSelection(), ...settings.virtualSelection},
    atcoder: { ...settings.atcoder, series: settings.atcoder.series.map(row => ({ ratingSource: 'official', ...row })) },
    grind: { ratingSource: 'fixed', offsets: defaultGrindOffsets(), ...settings.grind },
  };
}

function ratingFor({settings, sync, atcoderVirtual}, judge, source) {
  return (source === 'training'
    ? (judge === 'Codeforces' ? sync.Codeforces?.virtual?.rating : atcoderVirtual?.rating) ?? settings.trainingRatings?.[judge]
    : sync[judge]?.rating) ?? null;
}

export function atcoderTarget(state, rule) {
  if (rule.fixed != null) return rule.fixed;
  const rating = ratingFor(state, 'AtCoder', rule.ratingSource);
  return rating === null ? null : rating + rule.offset;
}

export function codeforcesIntervals(state) {
  const {grind} = state.settings;
  if (!grind.ratingSource || grind.ratingSource === 'fixed') return grind.intervals;
  const rating = ratingFor(state, 'Codeforces', grind.ratingSource);
  return rating === null ? [] : grind.offsets.map(([lo, hi]) => [rating + lo, rating + hi]);
}

export function localDay(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
export const isoDay = (d) => d.toISOString().slice(0, 10);
export const dayNumber = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
export function isDay(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(dayNumber(d)) && isoDay(new Date(dayNumber(d) * 86400000)) === d;
}
export function dateWindows(today) {
  const end = dayNumber(today);
  const starting = (months) => {
    const t = new Date(end * 86400000);
    const day = t.getUTCDate();
    t.setUTCDate(1);
    t.setUTCMonth(t.getUTCMonth() - months);
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return dayNumber(isoDay(t)) + 1;
  };
  return [
    ['This month', dayNumber(today.slice(0, 7) + '-01'), end],
    ['Last 90 days', end - 89, end],
    ['Last 6 months', starting(6), end],
    ['Last year', starting(12), end],
  ];
}

export function normalizeLink(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/\/$/, '');
  const parts = path.split('/').slice(1);
  const result = (key, judge, title, target, data = {}) => ({ key, judge, title, url: target, ...data });
  if (host === 'codeforces.com') {
    const match = path.match(/^\/(contest|gym)\/(\d+)\/problem\/([a-z]\d*)$/i) || path.match(/^\/(problemset)\/problem\/(\d+)\/([a-z]\d*)$/i);
    if (match) {
      const [, kind, contest, rawIndex] = match;
      const gym = kind.toLowerCase() === 'gym';
      const index = rawIndex.toUpperCase();
      return result((gym ? 'gym:' : 'cf:') + contest + ':' + index, 'Codeforces',
        (gym ? 'Gym ' : 'Codeforces ') + contest + index,
        'https://codeforces.com/' + (gym ? 'gym' : 'contest') + '/' + contest + '/problem/' + index, { contest, index, gym });
    }
  }
  if (host === 'atcoder.jp' && /^\/contests\/[a-z0-9_-]+\/tasks\/[a-z0-9_-]+$/i.test(path)) {
    return result('ac:' + parts[3].toLowerCase(), 'AtCoder', parts[3], 'https://atcoder.jp' + path, {contest: parts[1]});
  }
  if (timusHosts.includes(host) && path.toLowerCase() === '/problem.aspx' && !url.port) {
    const id = url.searchParams.get('num')?.match(/^0*([1-9]\d{0,11})$/)?.[1];
    const space = (url.searchParams.get('space') ?? '1').match(/^0*([1-9]\d{0,11})$/)?.[1];
    if (id && space) {
      const key = 'timus:' + (space === '1' ? id : space + ':' + id);
      const target = 'https://acm.timus.ru/problem.aspx?' + (space === '1' ? '' : 'space=' + space + '&') + 'num=' + id;
      return result(key, 'Timus', 'Timus ' + id, target);
    }
  }
  if (host === 'usaco.org' && (path === '/index.php' || path === '') && /^viewproblem2?$/.test(url.searchParams.get('page') ?? '')) {
    const id = url.searchParams.get('cpid')?.match(/^0*([1-9]\d{0,11})$/)?.[1];
    if (id) return result('usaco:' + id, 'USACO', 'USACO ' + id, 'https://usaco.org/index.php?page=viewproblem2&cpid=' + id);
  }
  const known = host === 'cses.fi' ? path.match(/^\/problemset\/task\/(\d+)$/) : host === 'qoj.ac' ? path.match(/^\/(?:contest\/\d+\/)?problem\/(\d+)$/) : null;
  if (known) {
    const id = known[1];
    return host === 'cses.fi'
      ? result('cses:' + id, 'CSES', 'CSES ' + id, 'https://cses.fi/problemset/task/' + id)
      : result('qoj:' + id, 'QOJ', 'QOJ ' + id, 'https://qoj.ac/problem/' + id);
  }
  url.hash = '';
  return result('url:' + url.href, 'Other', url.hostname + (path === '' ? '' : path), url.href);
}

export function validateSettings(raw) {
  const d = defaultSettings();
  const fail = (message) => { throw new Error(message); };
  let zone = raw.zone;
  try { if (typeof zone !== 'string' || !zone) throw new Error(); new Intl.DateTimeFormat('en-US', {timeZone:zone}); } catch { fail('Choose a valid timezone.'); }
  const handles = Object.fromEntries(accountJudges.map((j) => {
    const handle = String(raw.handles?.[j] ?? '').trim();
    if (j === 'Timus') {
      const id = normalizeTimusAuthor(handle);
      if (handle && !id) fail('Enter a public Timus author ID or profile URL.');
      return [j, id ?? ''];
    }
    if (handle && !/^[\w.-]{1,40}$/.test(handle)) fail('Enter a valid ' + j + ' handle.');
    return [j, handle];
  }));
  const colors = Object.fromEntries(judges.map((j) => [j, /^#[a-f\d]{6}$/i.test(raw.colors?.[j] ?? '') ? raw.colors[j] : d.colors[j]]));
  const integer = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) fail(label + ' must be between ' + min + ' and ' + max + '.');
    return value;
  };
  const trainingRatings = Object.fromEntries(ratingJudges.map(j => [
    j, raw.trainingRatings?.[j] == null ? null : integer(raw.trainingRatings[j], 0, 10000, j + ' training rating')
  ]));
  const virtualSelection = defaultVirtualSelection();
  for (const judge of ratingJudges) {
    const selection = raw.virtualSelection?.[judge];
    if (selection === undefined) continue;
    if (!['all','selected'].includes(selection?.mode) || !Array.isArray(selection.ids) || selection.ids.length > 10000
      || selection.ids.some(id => typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id))) fail('Choose valid virtual contest history.');
    virtualSelection[judge] = {mode:selection.mode,ids:[...new Set(selection.ids)]};
  }
  const ratingSource = (value, sources, fallback) => {
    if (value === undefined) return fallback;
    if (!sources.includes(value)) fail('Choose a valid rating source.');
    return value;
  };
  const optionalShares = {guide:0,timus:0,rounds:10};
  const shares = Object.fromEntries(groups.map((g) => [g, integer(raw.shares?.[g] ?? optionalShares[g], 0, 100, 'Queue weight')]));
  const sourceShares = raw.sourceShares === undefined ? undefined : Object.fromEntries(
    Object.keys(practiceSources).map(source=>[source,integer(raw.sourceShares?.[source],0,300,'Source weight')])
  );
  const queueMode = raw.queueMode === undefined ? 'automatic' : raw.queueMode;
  if (!['automatic','custom'].includes(queueMode)) fail('Choose Automatic or Custom for the practice mix.');
  const rawTimusRules = raw.timusRules ?? [];
  if (!Array.isArray(rawTimusRules) || rawTimusRules.length > 32) fail('Save up to 32 Timus rules.');
  const timusRules = rawTimusRules.map(rule => {
    const name = typeof rule?.name === 'string' ? rule.name.trim() : '';
    if (!name || name.length > 90 || typeof rule.id !== 'string' || !/^[\w-]{1,64}$/.test(rule.id)) fail('Enter a valid Timus rule name.');
    if (!Array.isArray(rule.categories) || rule.categories.some(category => !Object.hasOwn(timusCategories, category))) fail('Choose valid Timus categories.');
    if (!['unsolved','unattempted','attempted'].includes(rule.progress)) fail('Choose a Timus progress filter.');
    if (!['easiest','hardest'].includes(rule.order)) fail('Choose a Timus sort order.');
    const min = rule.min == null ? null : integer(rule.min, 0, Number.MAX_SAFE_INTEGER, 'Minimum Timus difficulty');
    const max = rule.max == null ? null : integer(rule.max, min ?? 0, Number.MAX_SAFE_INTEGER, 'Maximum Timus difficulty');
    return {id:rule.id,name,enabled:!!rule.enabled,categories:[...new Set(rule.categories)],min,max,progress:rule.progress,
      order:rule.order,cap:integer(rule.cap===undefined ? 100 : rule.cap,0,100,'Timus rule cap')};
  });
  if (new Set(timusRules.map(rule => rule.id)).size !== timusRules.length) fail('Duplicate Timus rule.');
  const atcoder = { english: Boolean(raw.atcoder?.english), experimental: Boolean(raw.atcoder?.experimental),
    series: series.map((name) => {
      const row = raw.atcoder?.series?.find((item) => item.name === name);
      if (!row) fail('Missing ' + name + ' settings.');
      const since = String(row.since || '').toLowerCase().replace(/\s+/g, '');
      if (since && !new RegExp('^' + name.toLowerCase() + '\\d{1,5}$').test(since)) fail('Enter a ' + name + ' cutoff such as ' + name + '212.');
      return { name, enabled: !!row.enabled, share: integer(row.share, 0, 100, 'Series weight'),
        ratingSource: ratingSource(row.ratingSource, ['official', 'training'], 'official'),
        offset: integer(row.offset, -6000, 6000, 'Rating offset'), band: integer(row.band, 0, 6000, 'Difficulty band'), fixed: row.fixed === null ? null : integer(row.fixed, 0, 10000, 'Fixed rating'), since };
    }) };
  const upsolve = (raw.upsolve ?? []).slice(0, 16).map((item) => {
    const archive = item.archive === true;
    if (item.order !== undefined && !['earliest','hardest'].includes(item.order)) fail('Choose a round problem order.');
    if (!(archive && item.cutoff === '') && !/^[A-Z]$/.test(item.cutoff)) fail('The last problem must be one letter.');
    return { id: String(item.id).slice(0, 64), division: integer(item.division, archive ? 0 : 1, 4, 'Division'),
      ...(item.order && {order:item.order}), cutoff: item.cutoff, enabled: !!item.enabled, virtual: !archive && !!item.virtual, skipped: archive || !!item.skipped,
      ...(archive ? {archive:true} : item.allRounds === true ? {allRounds:true} : {}) };
  });
  if (new Set(upsolve.map((item) => item.id)).size !== upsolve.length) fail('Duplicate upsolve rule.');
  const upsolveMinRating = raw.upsolveMinRating == null ? null : integer(raw.upsolveMinRating, 0, 10000, 'Minimum upsolve rating');
  const upsolveMaxRating = raw.upsolveMaxRating == null ? null : integer(raw.upsolveMaxRating, 0, 10000, 'Maximum upsolve rating');
  if (upsolveMinRating !== null && upsolveMaxRating !== null && upsolveMinRating > upsolveMaxRating) {
    fail('Maximum upsolve rating must be at least the minimum.');
  }
  const grind = {
    enabled: !!raw.grind?.enabled, since: raw.grind?.since || '',
    ratingSource: ratingSource(raw.grind?.ratingSource, ['fixed', 'official', 'training'], 'fixed'),
    intervals: (raw.grind?.intervals ?? []).slice(0, 20).map(([lo, hi]) => [integer(lo, 0, 10000, 'Lower rating'), integer(hi, lo, 10000, 'Upper rating')]),
    offsets: (raw.grind?.offsets ?? defaultGrindOffsets()).slice(0, 20).map(([lo, hi]) => [integer(lo, -6000, 6000, 'Lower offset'), integer(hi, lo, 6000, 'Upper offset')]),
  };
  if (grind.since && !isDay(grind.since)) fail('Enter a valid Codeforces cutoff date.');
  if (grind.enabled && !(grind.ratingSource === 'fixed' ? grind.intervals : grind.offsets).length) fail('Add at least one Codeforces rating interval.');
  const cses = { enabled: !!raw.cses?.enabled, weights: Object.fromEntries(Object.entries(raw.cses?.weights ?? {}).slice(0, 100).map(([name, weight]) => [name, integer(weight, 0, 100, 'Section weight')])) };
  return { handles, trainingRatings, virtualSelection, colors, zone, queueMode, shares, ...(sourceShares && {sourceShares}), atcoder, upsolve, upsolveCap: integer(raw.upsolveCap, 0, 100, 'Upsolve cap'), upsolveMinRating, upsolveMaxRating, grind, cses, timusRules };
}
