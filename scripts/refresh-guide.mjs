import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { normalizeLink } from '../server/domain.mjs';

const [revision, localArchive] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Pass a full USACO Guide commit SHA.');
const source = 'https://github.com/cpinitiative/usaco-guide';
const destination = fileURLToPath(new URL('../server/guide-catalog.json', import.meta.url));
const pending = destination + '.' + process.pid + '.tmp';
const temp = mkdtempSync(join(tmpdir(), 'unified-training-guide-'));
const divisions = {general:'General', bronze:'Bronze', silver:'Silver', gold:'Gold', plat:'Platinum', adv:'Advanced'};
const folders = ['1_General', '2_Bronze', '3_Silver', '4_Gold', '5_Plat', '6_Advanced'];

function property(object, name) {
  return object.properties.find(node => node.name?.getText() === name)?.initializer;
}

function readOrdering(file) {
  const tree = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const variable = tree.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText() === 'MODULE_ORDERING');
  return Object.keys(divisions).flatMap(section => property(variable.initializer, section).elements.flatMap(chapter =>
    property(chapter, 'items').elements.map(id => ({id:id.text, section, topic:property(chapter, 'name').text}))
  ));
}

function heading(frontmatter, name) {
  const line = frontmatter.match(new RegExp('^' + name + ':[ \\t]*(.+)$', 'm'))?.[1]?.trim();
  if (!line || line === '>' || line === '|') throw new Error('Unsupported module ' + name + ' in ' + frontmatter);
  if (line.startsWith('"')) return JSON.parse(line);
  if (line.startsWith("'")) return line.slice(1, -1).replaceAll("''", "'");
  return line;
}

const problems = new Map();
function listings(data, order=[]) {
  const rows = [];
  for (const key of new Set([...order,...Object.keys(data)])) {
    const group = data[key];
    if (!Array.isArray(group)) continue;
    for (const row of group) {
      const problem = normalizeLink(row.url);
      // The Guide also lists exercises without an external problem URL.
      if (!problem) continue;
      if (typeof row.uniqueId !== 'string' || typeof row.name !== 'string' ||
          row.difficulty != null && typeof row.difficulty !== 'string' ||
          row.tags != null && (!Array.isArray(row.tags) || row.tags.some(tag=>typeof tag !== 'string'))) {
        throw new Error('Invalid Guide problem metadata.');
      }
      const previous = problems.get(row.uniqueId);
      if (!previous) problems.set(row.uniqueId, {...problem, title:row.name});
      else if (previous.key !== problem.key) throw new Error('Conflicting URLs for ' + row.uniqueId);
      rows.push({id:row.uniqueId, difficulty:row.difficulty ?? 'N/A', tags:row.tags ?? []});
    }
  }
  return rows;
}

try {
  const archive = localArchive ?? join(temp, 'guide.tar.gz');
  if (!localArchive) execFileSync('curl', ['-fLsS', '--max-time', '240', '-o', archive,
    'https://codeload.github.com/cpinitiative/usaco-guide/tar.gz/' + revision], {stdio:'inherit'});
  const prefix = 'usaco-guide-' + revision + '/content/';
  const monthliesPath = 'usaco-guide-' + revision + '/src/components/markdown/ProblemsList/DivisionList/div_to_probs.json';
  execFileSync('tar', ['-xzf', archive, '-C', temp, prefix, monthliesPath], {stdio:'inherit'});
  const content = join(temp, prefix);
  const moduleFiles = new Map();
  for (const folder of folders) {
    const dir = join(content, folder);
    const files = readdirSync(dir);
    for (const file of files.filter(file => file.endsWith('.mdx'))) {
      const path = join(dir, file);
      const mdx = readFileSync(path, 'utf8');
      const frontmatter = mdx.split(/^---\s*$/m)[1];
      if (!frontmatter) throw new Error('Missing module metadata in ' + path);
      const id = heading(frontmatter, 'id');
      const metadata = file.replace(/\.mdx$/, '.problems.json');
      const order = [...mdx.matchAll(/<(?:FocusProblem|Problems)\s+[^>]*?\bproblems?\s*=\s*["']([^"']+)["']/g)].map(match=>match[1]);
      moduleFiles.set(id, {title:heading(frontmatter, 'title'), data:files.includes(metadata) ? join(dir, metadata) : null, order});
    }
  }
  const modules = readOrdering(join(content, 'ordering.ts')).map(({id, section, topic}) => {
    const {title, data, order} = moduleFiles.get(id);
    return {id, title, section:divisions[section], topic, url:'https://usaco.guide/' + section + '/' + id,
      listings:data ? listings(JSON.parse(readFileSync(data, 'utf8')),order) : []};
  });
  listings(JSON.parse(readFileSync(join(content, 'extraProblems.json'), 'utf8')));
  const monthlies = JSON.parse(readFileSync(join(temp, monthliesPath), 'utf8'));
  const archiveRows = Object.values(monthlies).flatMap(rows=>rows.map(([id,,name])=>({
    uniqueId:'usaco-'+id, name, url:'https://usaco.org/index.php?page=viewproblem2&cpid='+id
  })));
  modules.find(module=>module.id==='usaco-monthlies').listings = listings({archive:archiveRows});
  if (!modules.some(module => module.section === 'Bronze' && module.listings.length) || !problems.size) {
    throw new Error('The Guide snapshot is missing module problems.');
  }
  const catalog = {version:1, source, revision, modules, problems:Object.fromEntries(problems)};
  writeFileSync(pending, JSON.stringify(catalog) + '\n');
  renameSync(pending, destination);
  console.log('USACO Guide ' + revision + ' · ' + modules.length + ' modules · ' + problems.size + ' problem IDs');
} finally {
  rmSync(pending, {force:true});
  rmSync(temp, {force:true, recursive:true});
}
