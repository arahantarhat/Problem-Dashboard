import { normalizeLink } from './domain.mjs';
import { fetchPublic } from './judges.mjs';
import { timusCategories, timusOrigin } from '../shared/timus.js';

const spacing = 700;
const backfillPages = 25;
const entities = {amp:'&', quot:'"', lt:'<', gt:'>', apos:"'", nbsp:' ', ndash:'–', mdash:'—'};
const months = [
  ['jan','янв'], ['feb','фев'], ['mar','мар'], ['apr','апр'], ['may','май','мая'], ['jun','июн'],
  ['jul','июл'], ['aug','авг'], ['sep','сен'], ['oct','окт'], ['nov','ноя'], ['dec','дек'],
];
const offsetAt = new Intl.DateTimeFormat('en', {timeZone:'Asia/Yekaterinburg', timeZoneName:'longOffset'});

function plain(html) {
  return html.replace(/<br\b[^>]*>/gi,' ').replace(/<[^>]*>/g,'')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(entity,value)=>{
      if (value[0] !== '#') return entities[value] ?? entity;
      const code = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2),16) : Number(value.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }).replace(/\s+/g,' ').trim();
}

function links(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([,href,label])=>({url:new URL(href.replace(/&amp;/gi,'&'),timusOrigin),label:plain(label)}));
}

function url(path, params) {
  return timusOrigin + path + '?' + new URLSearchParams(params);
}

async function read(target) {
  return (await fetchPublic(target,spacing)).text();
}

export function parseTimusProfile(html, author) {
  const markup = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const name = markup.match(/<h2\b[^>]*\bclass=["']author_name["'][^>]*>([\s\S]*?)<\/h2>/i);
  const history = markup.match(/<div\b[^>]*\bclass=["']author_links["'][^>]*>([\s\S]*?)<\/div>/i);
  const correctAuthor = history && links(history[1]).some(({url:u})=>
    u.origin===timusOrigin && u.pathname==='/status.aspx' && u.searchParams.get('author')===author);
  if (!name || !plain(name[1]) || !correctAuthor) throw new Error('Timus did not return the expected public author profile.');
  const motto = markup.match(/<table\b[^>]*\bclass=["']author_motto["'][^>]*>([\s\S]*?)<\/table>/i);
  return {name:plain(name[1]),motto:motto ? plain(motto[1]) : null};
}

export async function timusProfile(author) {
  return parseTimusProfile(await read(url('/author.aspx',{id:author,locale:'en'})),author);
}

export function parseTimusCatalog(html) {
  const problems = [];
  for (const [,row] of html.matchAll(/<tr\b[^>]*\bclass=["']content["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(match=>match[1]);
    if (!cells.length) continue; // Header row.
    const match = links(cells[2] ?? '').find(({url:u})=>u.origin===timusOrigin && u.pathname==='/problem.aspx');
    const problem = match && normalizeLink(match.url.href);
    const score = plain(cells[5] ?? '');
    if (problem?.judge !== 'Timus' || problem.key !== 'timus:'+plain(cells[1] ?? '') || !match.label || !/^\d+$/.test(score)) {
      throw new Error('Timus returned an unexpected problem catalog row.');
    }
    problems.push({...problem,title:match.label,difficulty:Number(score),categories:[]});
  }
  if (!problems.length) throw new Error('Timus returned an empty or unrecognized problem catalog.');
  return problems;
}

export async function timusCatalog() {
  const path = '/problemset.aspx';
  const problems = parseTimusCatalog(await read(url(path,{page:'all',space:'1',locale:'en'})));
  const byKey = new Map(problems.map(problem=>[problem.key,problem]));
  for (const tag of Object.keys(timusCategories)) {
    const tagged = parseTimusCatalog(await read(url(path,{space:'1',tag,locale:'en'})));
    for (const item of tagged) byKey.get(item.key)?.categories.push(tag);
  }
  return problems;
}

function stamp(date) {
  const match = date.match(/^(\d{2}):(\d{2}):(\d{2}) (\d{1,2}) ([\p{L}]+)\.? (\d{4})$/u);
  if (!match) throw new Error('Timus returned an unrecognized submission date.');
  const [,hour,minute,second,day,month,year] = match;
  const monthIndex = months.findIndex(names=>names.some(name=>month.toLowerCase().startsWith(name)));
  const wall = new Date(Date.UTC(+year,monthIndex,+day,+hour,+minute,+second));
  if (monthIndex<0 || wall.getUTCDate()!==+day || wall.getUTCHours()!==+hour || +minute>59 || +second>59) {
    throw new Error('Timus returned an invalid submission date.');
  }
  const offset = offsetAt.formatToParts(wall).find(part=>part.type==='timeZoneName').value.match(/GMT([+-])(\d{2}):(\d{2})/);
  const seconds = offset ? (offset[1]==='-'?-1:1)*(+offset[2]*3600 + +offset[3]*60) : 0;
  return wall.getTime()/1000 - seconds;
}

export function parseTimusStatus(html, author) {
  const filter = html.match(/<p\b[^>]*\bclass=["']status_filter["'][^>]*>([\s\S]*?)<\/p>/i);
  if (!filter || !links(filter[1]).some(({url:u})=>u.origin===timusOrigin &&
      u.pathname==='/author.aspx' && u.searchParams.get('id')===author)) {
    throw new Error('Timus did not return the expected author history.');
  }
  const submissions = [], problems = [];
  for (const [,row] of html.matchAll(/<tr\b[^>]*\bclass=["'](?:even|odd)["'][^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Object.fromEntries([...row.matchAll(/<td\b[^>]*\bclass=["']([^"']+)["'][^>]*>([\s\S]*?)<\/td>/gi)]
      .map(([,name,contents])=>[name.toLowerCase(),contents]));
    const verdictCell = Object.keys(cells).find(name=>name.startsWith('verdict'));
    const id = Number(plain(cells.id ?? ''));
    const coder = links(cells.coder ?? '')[0]?.url;
    const match = links(cells.problem ?? '')[0];
    const problem = match && normalizeLink(match.url.href);
    if (!Number.isSafeInteger(id) || id<=0 || !verdictCell || coder?.origin!==timusOrigin || coder.pathname!=='/author.aspx'
        || coder.searchParams.get('id')!==author || problem?.judge!=='Timus') {
      throw new Error('Timus returned an unexpected submission row.');
    }
    const verdict = verdictCell==='verdict_ac' ? 'AC' : plain(cells[verdictCell]);
    submissions.push({id,problem:problem.key,stamp:stamp(plain(cells.date ?? '')),verdict});
    problems.push({...problem,title:match.label.replace(/^\d+\.\s*/, '') || problem.title});
  }
  if (!submissions.length && (!/<th\b[^>]*class=["']id["']/i.test(html) ||
      !/<td\b[^>]*class=["']status_footer["']/i.test(html) || /<td\b[^>]*class=["']id["']/i.test(html))) {
    throw new Error('Timus returned an unrecognized submission history.');
  }
  const next = links(html).find(({url:u,label})=>u.origin===timusOrigin && u.pathname==='/status.aspx' &&
    u.searchParams.get('author')===author && /^(?:Next|Следующие)\s+\d+$/i.test(label));
  const cursor = next ? Number(next.url.searchParams.get('from')) : null;
  if (cursor!==null && (!Number.isSafeInteger(cursor) || cursor<=0 || cursor>=Math.min(...submissions.map(row=>row.id)))) {
    throw new Error('Timus returned an invalid submission cursor.');
  }
  return {submissions,problems,cursor};
}

export async function timusHistory(author, previous, readPage=read) {
  const submissions = new Map(), problems = new Map();
  const seen = new Set();
  const load = async cursor=>{
    if (seen.has(cursor)) throw new Error('Timus repeated a submission page.');
    seen.add(cursor);
    // The default status URL and the site's from link work for public history.
    const params = cursor===null ? {author} : {author,from:String(cursor)};
    const page = parseTimusStatus(await readPage(url('/status.aspx',params)),author);
    if (cursor!==null && page.submissions.some(row=>row.id>cursor)) throw new Error('Timus did not advance to older submissions.');
    for (const row of page.submissions) submissions.set(row.id,row);
    for (const problem of page.problems) problems.set(problem.key,problem);
    return page;
  };

  const first = await load(null);
  const head = Math.max(previous.head ?? 0,...first.submissions.map(row=>row.id));
  let cursor = first.cursor;
  if (previous.head) {
    let overlap = 0;
    let page = first;
    while (cursor!==null) {
      if (page.submissions.some(row=>row.id<=previous.head) && ++overlap>=2) break;
      page = await load(cursor);
      cursor = page.cursor;
    }
    // The head walk may already have reached or crossed the older checkpoint.
    cursor = previous.backfill == null || cursor===null ? null : Math.min(previous.backfill,cursor);
  }
  for (let i=0; cursor!==null && i<backfillPages; i++) cursor = (await load(cursor)).cursor;
  return {problems:[...problems.values()],submissions:[...submissions.values()],info:{head,backfill:cursor}};
}
