export const guideFilterFields = ['divisions', 'difficulties', 'topics', 'modules', 'judges'];

export function guideMatches(catalog, criteria, sectionWeights = null) {
  const matches = new Map();
  let order = 0;
  const selected = Object.fromEntries(guideFilterFields.map(field => [field, new Set(criteria[field])]));
  const includes = (field, value) => !selected[field].size || selected[field].has(value);
  for (const module of catalog.modules) {
    if (!includes('divisions', module.section) || !includes('modules', module.id)) continue;
    const section = module.section + '/' + module.topic;
    if (sectionWeights?.[section] === 0) continue;
    for (const listing of module.listings) {
      const problem = catalog.problems[listing.id];
      if (!includes('judges', problem.judge) || !includes('difficulties', listing.difficulty)) continue;
      if (selected.topics.size && !selected.topics.has(module.topic) && !listing.tags.some(tag => selected.topics.has(tag))) continue;
      const entry = {moduleId:module.id, moduleTitle:module.title, division:module.section, difficulty:listing.difficulty,
        section, topic:module.topic, order:order++};
      const existing = matches.get(problem.key);
      if (!existing) matches.set(problem.key, {problem, entries:[entry]});
      else if (!existing.entries.some(item => item.moduleId === entry.moduleId && item.difficulty === entry.difficulty)) {
        existing.entries.push(entry);
      }
    }
  }
  return [...matches.values()];
}

export function guideSections(matches) {
  const sections = new Map();
  for (const {problem,entries} of matches) for (const entry of entries) {
    if (!sections.has(entry.section)) sections.set(entry.section, {
      key:entry.section, label:entry.division+' · '+entry.topic, problems:new Map()
    });
    const problems = sections.get(entry.section).problems;
    if (!problems.has(problem.key)) problems.set(problem.key,{problem,order:entry.order});
  }
  return [...sections.values()].map(({key,label,problems})=>{
    const rows=[...problems.values()].sort((a,b)=>a.order-b.order);
    return {key,label,first:rows[0].order,problems:rows.map(row=>row.problem)};
  }).sort((a,b)=>a.first-b.first);
}
