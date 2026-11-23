import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, Upload, X } from 'lucide-react';
import { guideMatches, guideSections } from '../shared/guide.js';
import { Button, Empty, Field, Heading, JudgeLabel, Modal, Notice, ProblemLink, RuleCap, RuleDetails, RulePreview, Toggle } from './ui';
import type { GuideCatalog, GuideCriteria, GuideData, GuideRule, Problem, RuleOption, Settings, State } from './types';
import type { Requester } from './rules';

const emptyCriteria:GuideCriteria = {divisions:[],difficulties:[],topics:[],modules:[],judges:[]};
const guideSettings = 'https://usaco.guide/settings#user-data';
const difficultyOrder = ['Very Easy','Easy','Normal','Medium','Hard','Very Hard','Insane','N/A'];
const unique = (values:string[]) => [...new Set(values)];
type Option = {value:string;label:string};

function FilterMenu({label,options,values,onChange,searchable=false}:{label:string;options:Option[];values:string[];onChange:(next:string[])=>void;searchable?:boolean}) {
  const [query,setQuery]=useState('');
  const search=query.trim().toLowerCase();
  const visible=options.filter(option=>!search||option.label.toLowerCase().includes(search));
  return <details className="guide-filter">
    <summary>{label}{values.length>0&&' ('+values.length+')'}</summary>
    <div className="card guide-options">
      {searchable&&<Field label="Search modules"><input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></Field>}
      {values.length>0&&<Button variant="ghost" onClick={()=>onChange([])}>Clear {label.toLowerCase()}</Button>}
      <div className="checklist" role="group" aria-label={label}>{visible.map(option=><label key={option.value}>
        <input type="checkbox" checked={values.includes(option.value)} onChange={e=>onChange(e.target.checked
          ? [...values,option.value] : values.filter(item=>item!==option.value))}/>{option.label}</label>)}</div>
      {!visible.length&&<p className="secondary">No matching options.</p>}
    </div>
  </details>;
}

function GuideFilters({catalog,criteria,change,moduleProgress,editing=false,initiallyOpen=false}:{catalog:GuideCatalog;criteria:GuideCriteria;change:(value:GuideCriteria)=>void;moduleProgress:GuideData['moduleProgress'];editing?:boolean;initiallyOpen?:boolean}) {
  const options=useMemo(()=>{
    const moduleEntries=catalog.modules.flatMap(module=>module.listings);
    const difficulties=unique(moduleEntries.map(entry=>entry.difficulty));
    const topics=unique([...catalog.modules.map(module=>module.topic),...moduleEntries.flatMap(entry=>entry.tags)]).sort();
    const choices=(values:string[])=>values.map(value=>({value,label:value}));
    return {
      divisions:choices(unique(catalog.modules.map(module=>module.section))),
      difficulties:choices([...difficultyOrder.filter(value=>difficulties.includes(value)),...difficulties.filter(value=>!difficultyOrder.includes(value))]),
      topics:choices(topics),
      modules:catalog.modules.map(module=>({value:module.id,label:module.section+' · '+module.title+
        (moduleProgress[module.id] ? ' · '+moduleProgress[module.id] : '')})),
      judges:choices(unique(Object.values(catalog.problems).map(problem=>problem.judge)).sort()),
    };
  },[catalog,moduleProgress]);
  const labels:Record<keyof GuideCriteria,string>={divisions:'Guide division',difficulties:'Difficulty',topics:'Topic',modules:'Module',judges:'Judge'};
  const setFilter=(field:keyof GuideCriteria,values:string[])=>change({...criteria,[field]:values});
  const filter=(field:keyof GuideCriteria,choices=options[field])=><FilterMenu key={field} label={labels[field]}
    options={choices} values={criteria[field]} onChange={values=>setFilter(field,values)} searchable={field==='modules'}/>;
  if(!editing)return <div className="guide-filters">{(Object.keys(labels) as (keyof GuideCriteria)[]).map(field=>filter(field))}</div>;
  const divisionModuleIds=new Set(catalog.modules.filter(module=>!criteria.divisions.length||criteria.divisions.includes(module.section)).map(module=>module.id));
  const selectedModules=options.modules.filter(module=>criteria.modules.includes(module.value));
  return <>
    <div className="guide-filters">
      {filter('divisions')}
      {filter('modules',options.modules.filter(module=>divisionModuleIds.has(module.value)))}
    </div>
    {selectedModules.length>0&&<div className="button-wrap">
      {selectedModules.map(module=><Button key={module.value} aria-label={'Remove module '+module.label}
        onClick={()=>setFilter('modules',criteria.modules.filter(id=>id!==module.value))}>{module.label}<X size={14}/></Button>)}
    </div>}
    <RuleDetails label="More filters" initiallyOpen={initiallyOpen}>
      <div className="guide-filters">{(['difficulties','topics','judges'] as const).map(field=>filter(field))}</div>
    </RuleDetails>
  </>;
}

export function GuideBrowser({data,state,rule,onImport,onSolve}:{data:GuideData;state:State;rule?:GuideRule;onImport:()=>void;onSolve:(problem:Problem)=>void}) {
  const [filters,setFilters]=useState<GuideCriteria>(emptyCriteria);
  const criteria=rule?.criteria??filters;
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('');
  const [page,setPage]=useState(0);
  const {catalog,moduleProgress}=data;
  const solves=useMemo(()=>new Map(state.stats.timeline.map(solve=>[solve.key,solve])),[state.stats.timeline]);
  const pending=useMemo(()=>new Set(state.pendingAtCoder.map(problem=>problem.key)),[state.pendingAtCoder]);
  const matches=useMemo(()=>guideMatches(catalog,criteria,rule?.sectionWeights),[catalog,criteria,rule?.sectionWeights]);
  const done=matches.filter(({problem})=>solves.has(problem.key)).length;
  const visible=matches.filter(({problem})=>problem.title.toLowerCase().includes(query.trim().toLowerCase()) && (!status || solves.has(problem.key)===(status==='completed')));
  const module=criteria.modules.length===1 ? catalog.modules.find(item=>item.id===criteria.modules[0]) : undefined;
  const size=15;
  const current=Math.min(page,Math.max(0,Math.ceil(visible.length/size)-1));
  const change=(next:GuideCriteria)=>{setFilters(next);setPage(0);};
  return <>
    <a className="problem-link" href="#rules"><ArrowLeft size={15}/>Rules</a>
    <Heading title={rule?.name??'USACO Guide'} description={rule?'USACO Guide rule checklist':'Browse modules and find practice problems.'} action={<Button onClick={onImport}><Upload size={16}/>Import progress</Button>}/>
    <div className="guide-actions"><input type="search" aria-label="Search Guide problems" placeholder="Search problems…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/>
      {!rule&&<GuideFilters catalog={catalog} criteria={criteria} change={change} moduleProgress={moduleProgress}/>}
      <select aria-label="Completion status" value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}>
        <option value="">All statuses</option><option value="incomplete">Unsolved</option><option value="completed">Completed</option>
      </select>
      {!rule&&<Button onClick={()=>{change(emptyCriteria);setQuery('');setStatus('');}}>Clear filters</Button>}
    </div>
    {module&&<div className="card guide-module">
      <div><a className="problem-link" href={module.url} target="_blank" rel="noreferrer">{module.title}<ExternalLink size={13}/></a>
        <p className="secondary">{module.section} · {moduleProgress[module.id] ?? 'Not started'}</p></div>
    </div>}
    <section className="queue-section" aria-label="Guide problems">
      <div className="section-head"><div><h2>Practice problems</h2><span className="secondary">{done} of {matches.length} completed</span></div></div>
      <div className="card">
        {visible.length ? <>
          <ul className="guide-problems">{visible.slice(current*size,(current+1)*size).map(({problem,entries})=>{
            const solve=solves.get(problem.key);
            const context=unique(entries.map(entry=>entry.division+' · '+entry.difficulty+' · '+entry.moduleTitle));
            return <li key={problem.key}>
              <div><ProblemLink problem={problem}/><p className="secondary">{context[0]}</p>{context.length>1&&<details><summary>{context.length-1} more placements</summary>{context.slice(1).map(item=><p key={item}>{item}</p>)}</details>}</div>
              <JudgeLabel name={problem.judge} colors={state.settings.colors}/>
              <Button variant={solve?'plain':'ghost'} title={solve?'Solve details':'Record solve'}
                aria-label={(solve?'Solved, view details for ':pending.has(problem.key)?'Pending claim for ':problem.key.startsWith('ac:')?'Claim solve for ':'Log solve for ')+problem.title}
                onClick={()=>onSolve({...problem,solve,pendingAtCoder:pending.has(problem.key)})}>{solve?'Solved':pending.has(problem.key)?'Pending':problem.key.startsWith('ac:')?'Claim solve':'Log solve'}</Button>
            </li>;
          })}</ul>
          <div className="table-footer"><span>Showing {current*size+1}–{Math.min(visible.length,(current+1)*size)} of {visible.length}</span>
            <div><Button disabled={current===0} onClick={()=>setPage(current-1)} aria-label="Previous page"><ArrowLeft size={14}/></Button>
              <Button disabled={(current+1)*size>=visible.length} onClick={()=>setPage(current+1)} aria-label="Next page"><ArrowRight size={14}/></Button></div>
          </div>
        </>:<Empty title="No matching problems" description={rule?'Change completion status or edit the rule in Rules.':'Change the filters to see more practice problems.'}/>}
      </div>
    </section>
  </>;
}

export function GuideRuleEditor({data,loadError,onRetry,rule,queueMode,request,done,close}:{data:GuideData|null;loadError:string;onRetry:()=>void;rule?:GuideRule;queueMode:Settings['queueMode'];request:Requester;done:(state:State)=>void;close:()=>void}) {
  const [criteria,setCriteria]=useState(rule?.criteria ?? emptyCriteria);
  const [name,setName]=useState(rule?.name ?? 'USACO Guide');
  const [cap,setCap]=useState(rule?.cap ?? 100);
  const [enabled,setEnabled]=useState(rule?.enabled ?? true);
  const [useWeights,setUseWeights]=useState(rule?.sectionWeights!=null);
  const [weights,setWeights]=useState(rule?.sectionWeights ?? {});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [preview,setPreview]=useState<{count:number;preview:RuleOption['preview']}|null>(null);
  const [previewError,setPreviewError]=useState('');
  const matches=useMemo(()=>data ? guideMatches(data.catalog,criteria) : null,[data,criteria]);
  const sections=useMemo(()=>guideSections(matches??[]),[matches]);
  const draft=useMemo(()=>({id:rule?.id,cap,enabled,criteria,sectionWeights:useWeights?weights:null}),[rule?.id,cap,enabled,criteria,useWeights,weights]);
  useEffect(()=>{
    setPreview(null);
    setPreviewError('');
    if(!data||!draft.enabled)return;
    let active=true;
    const timer=window.setTimeout(()=>{
      void request<NonNullable<typeof preview>>('/api/guide/rules/preview',draft)
        .then(result=>{if(active)setPreview(result);},error=>{if(active)setPreviewError(error.message);});
    },260);
    return()=>{active=false;window.clearTimeout(timer);};
  },[data,draft,request]);
  const save=async(event:FormEvent)=>{
    event.preventDefault();
    setBusy(true);setError('');
    try { done(await request<State>('/api/guide/rules',{...draft,name})); }
    catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove=async()=>{
    setBusy(true);setError('');
    try { done(await request<State>('/api/guide/rules/delete',{id:rule?.id})); }
    catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const original=rule?.criteria;
  return <Modal title={rule?'Edit USACO Guide rule':'USACO Guide'} close={close}>
    <form onSubmit={save}>
      <div className="dialog-body form-stack">
        {error&&<Notice type="error">{error}</Notice>}
        <Field label="Rule name"><input required maxLength={90} value={name} onChange={e=>setName(e.target.value)}/></Field>
        {data ? <><GuideFilters catalog={data.catalog} criteria={criteria} change={setCriteria} moduleProgress={data.moduleProgress}
          editing initiallyOpen={Boolean(original&&(original.difficulties.length||original.topics.length||original.judges.length))}/>
          <Field label="Practice order"><select value={useWeights?'mix':'guide'} onChange={e=>setUseWeights(e.target.value==='mix')}>
            <option value="guide">Guide order</option><option value="mix">Mix sections</option>
          </select></Field>
          {useWeights&&<RuleDetails label="Section weights" initiallyOpen={Object.values(rule?.sectionWeights??{}).some(weight=>weight!==1)}>
            <p className="secondary">Sections start at weight 1. Higher weights appear more often. A weight of 0 excludes a section.</p>
            {sections.length>0&&<div className="section-weights guide-rule-weights">{sections.map(section=><Field key={section.key} label={section.label} hint={section.problems.length+' matching problems'}>
              <input required type="number" min="0" max="100" value={weights[section.key]??1}
                onChange={e=>setWeights(current=>({...current,[section.key]:Number(e.target.value)}))}/>
            </Field>)}</div>}
          </RuleDetails>}</>
          : loadError ? <Notice type="error">{loadError} <button type="button" className="text-button" onClick={onRetry}>Retry</button></Notice>
          : <p className="secondary">Loading Guide filters…</p>}
        {queueMode==='custom'&&<RuleCap value={cap} initiallyOpen={!!rule&&rule.cap!==100} onChange={setCap}/>}
        <Toggle checked={enabled} onChange={setEnabled}>Enable rule</Toggle>
        {previewError&&<Notice type="error">{previewError}</Notice>}
        {data&&!previewError&&<RulePreview count={preview?.count} examples={preview?.preview} status={!enabled?'Rule paused':undefined}
          note={!enabled?'Turn it on to add matching problems to the practice queue.':preview?.count===0?'Try broadening your Guide filters.':undefined}/>}
        {rule&&(confirmDelete
          ? <Notice type="error">Delete this Guide rule? <button type="button" className="text-button" disabled={busy} onClick={()=>void remove()}>Confirm deletion</button></Notice>
          : <div><Button variant="danger" disabled={busy} onClick={()=>setConfirmDelete(true)}>Delete rule</Button></div>)}
      </div>
      <div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="main" type="submit" disabled={busy||!data}>Save rule</Button></div>
    </form>
  </Modal>;
}

type ProgressPreview = {solves:{problem:Problem;day:string|null;previous:boolean}[];unmatched:string[];modules:Record<string,string>};

export function GuideImporter({request,done,close}:{request:Requester;done:(state:State)=>void;close:()=>void}) {
  const [review,setReview]=useState<{payload:unknown;preview:ProgressPreview}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const read=async(file?:File)=>{
    if(!file)return;
    setBusy(true);setError('');setReview(null);
    try {
      if(file.size>2_000_000) throw new Error('The export is larger than 2 MB.');
      let payload:unknown;
      try { payload=JSON.parse(await file.text()); }
      catch { throw new Error('Choose a valid USACO Guide JSON export.'); }
      setReview({payload,preview:await request<ProgressPreview>('/api/guide/preview',payload)});
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const confirm=async()=>{
    if(!review)return;
    setBusy(true);setError('');
    try { done(await request<State>('/api/guide/import',review.payload)); }
    catch(e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const preview=review?.preview;
  const newSolves=preview?.solves.filter(row=>!row.previous).length ?? 0;
  return <Modal wide title="Import USACO Guide progress" close={close}>
    <div className="dialog-body form-stack">
      {error&&<Notice type="error">{error}</Notice>}
      <p>In <a href={guideSettings} target="_blank" rel="noreferrer">USACO Guide Settings</a>, open User Data and click Export User Data.</p>
      <Field label="USACO Guide export" hint="Choose usacoguide-userdata.json from your downloads.">
        <input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void read(e.currentTarget.files?.[0]);e.currentTarget.value='';}}/>
      </Field>
      {busy&&!preview&&<Notice>Reading Guide progress…</Notice>}
      {preview&&<>
        <Notice>{newSolves} new completions · {preview.solves.length-newSolves} already recorded · {Object.keys(preview.modules).length} module statuses · {preview.unmatched.length} unmatched</Notice>
        {!!preview.solves.length&&<details className="preview" open><summary>Review matched problems</summary>
          <ul className="guide-import-rows">{preview.solves.map(row=><li key={row.problem.key}>
            <ProblemLink problem={row.problem}/><span className="secondary">{row.previous?'Already recorded · ':''}{row.day??'Undated'}</span>
          </li>)}</ul>
        </details>}
        {!!preview.unmatched.length&&<details className="preview"><summary>Review unmatched problem IDs</summary>
          <ul className="guide-import-rows">{preview.unmatched.map(id=><li key={id}>{id}</li>)}</ul>
        </details>}
      </>}
    </div>
    <div className="dialog-actions"><Button onClick={close}>Close</Button>
      <Button variant="main" disabled={busy||!preview||(!preview.solves.length&&!Object.keys(preview.modules).length)} onClick={()=>void confirm()}>Import progress</Button></div>
  </Modal>;
}
