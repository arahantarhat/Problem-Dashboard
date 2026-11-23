import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, CirclePlus, Filter, RefreshCw, Search, Shuffle } from 'lucide-react';
import { Button, Empty, Heading, JudgeLabel, Notice, ProblemLink } from './ui';
import { judges, type Problem, type Ranked, type State, type UsacoDivision } from './types';
import type { Requester } from './rules';
import { ProblemDifficulty } from './problem-difficulty';

type QueueView = {query:string; judge:string; rule:string; page:number};
type QueueProblem = Problem & Partial<Pick<Ranked,'rank'|'reason'|'targetDelta'|'guideEntries'>>;
const rememberedViews = new Map<string, QueueView>();
const defaultFilters:QueueView = {query:'',judge:'',rule:'',page:0};
const pageSizes = [20, 50, 100];
const usacoBatchSize = 10;

const signedDelta = (delta: number) => delta > 0 ? '+' + delta : String(delta);
const deltaDescription = (delta: number) => Math.abs(delta) + (delta > 0 ? ' above target' : ' below target');

function QueueReason({ problem }: { problem: QueueProblem }) {
  const { reason='', targetDelta } = problem;
  if (!targetDelta) return reason.replace(/^CSES · |^Manual · /, '');
  const description = deltaDescription(targetDelta);
  return <>{reason} · <span className={'target-delta ' + (targetDelta > 0 ? 'above' : 'below')} title={description}>
    <span aria-hidden="true">{signedDelta(targetDelta)}</span><span className="sr-only">{description}</span>
  </span></>;
}

export function Queue({state,profile,demo,busy,savingProgress,request,onRefresh,onLinks,onSolve,onProgress,onSettings}:{
  state:State;profile:string;demo:boolean;busy:boolean;savingProgress:boolean;request:Requester;onRefresh:(judge?:string)=>void;
  onLinks:()=>void;onSolve:(p:Problem)=>void;onProgress:(p:Problem,active:boolean)=>Promise<void>;onSettings:()=>void;
}) {
  const [showInProgress,setShowInProgress]=useState(false);
  const [queueFilters,setQueueFilters]=useState(()=>rememberedViews.get(profile) ?? defaultFilters);
  const [progressFilters,setProgressFilters]=useState(defaultFilters);
  const {query,judge,rule,page}=showInProgress ? progressFilters : queueFilters;
  const pageSizeKey='ut-queue-page-size-'+profile;
  const [limit,setLimit]=useState(()=>{
    const saved=Number(localStorage.getItem(pageSizeKey));
    return pageSizes.includes(saved) ? saved : pageSizes[0];
  });
  const update=(changes:Partial<QueueView>)=>(showInProgress ? setProgressFilters : setQueueFilters)(previous=>({...previous,page:0,...changes}));
  const changePageSize=(size:number)=>{
    setLimit(size);
    localStorage.setItem(pageSizeKey,String(size));
    setQueueFilters(previous=>({...previous,page:0}));
    setProgressFilters(previous=>({...previous,page:0}));
  };
  useEffect(()=>{rememberedViews.set(profile,queueFilters);},[profile,queueFilters]);
  const [usacoDivisions,setUsacoDivisions]=useState<Record<string,UsacoDivision|null>>({});
  useEffect(()=>{
    if(queueFilters.rule&&!state.ruleRows[queueFilters.rule])setQueueFilters(previous=>({...previous,rule:'',page:0}));
  },[queueFilters.rule,state.ruleRows]);
  const list:QueueProblem[]=showInProgress ? state.inProgress : rule ? state.ruleRows[rule] ?? [] : state.queue;
  const inProgressKeys=new Set(state.inProgress.map(p=>p.key));
  const search = query.trim().toLowerCase();
  const filtered = list.filter(p => {
    if (judge && judge !== p.judge) return false;
    const reason = p.targetDelta
      ? p.reason + ' · ' + deltaDescription(p.targetDelta) + ' ' + signedDelta(p.targetDelta)
      : p.reason;
    return [p.title, p.contest, p.index, reason].filter(Boolean).join(' ').toLowerCase().includes(search);
  });
  const openRandomProblem=()=>{
    const problem=filtered[Math.floor(Math.random()*filtered.length)];
    if(problem)window.open(problem.url,'_blank','noopener,noreferrer');
  };
  const current=Math.min(page,Math.max(0,Math.ceil(filtered.length/limit)-1));
  const visible=filtered.slice(current*limit,(current+1)*limit);
  const missingUsaco=visible.filter(p=>p.judge==='USACO' && !p.usacoDivision && !(p.key in usacoDivisions)).map(p=>p.key).sort().join(',');
  useEffect(()=>{
    if (busy || !missingUsaco) return;
    let active=true;
    const keys=missingUsaco.split(',');
    const loadDivisions=async()=>{
      const divisions:Record<string,UsacoDivision|null>={};
      for(let offset=0;active&&offset<keys.length;offset+=usacoBatchSize){
        const batch=await request<Record<string,UsacoDivision|null>>('/api/usaco/divisions',{keys:keys.slice(offset,offset+usacoBatchSize)});
        Object.assign(divisions,batch);
      }
      if(active)setUsacoDivisions(previous=>({...previous,...divisions}));
    };
    void loadDivisions().catch(()=>{});
    return ()=>{active=false;};
  },[missingUsaco,request,busy]);
  const refresh = () => {
    setUsacoDivisions(previous=>Object.fromEntries(Object.entries(previous).filter(([,division])=>division)));
    onRefresh();
  };
  const status=Object.entries(state.sync).filter(([,x])=>x.error);
  const latest=Object.entries(state.sync).filter(([,sync])=>sync.lastSuccess).sort((a,b)=>b[1].lastSuccess!-a[1].lastSuccess!)[0];
  const next=showInProgress ? undefined : visible[0];
  const hasFilters=Boolean(search||judge||rule);
  return <>
    <Heading title="Problemset" description="Practice from your training queue and pick up problems you’ve started." action={<div className="button-wrap"><a className="button plain" href="#usaco-guide">Browse Guide</a><Button onClick={onLinks}><CirclePlus size={17}/>Add links</Button></div>}/>
    {status.map(([j,s])=><Notice key={j} type="error">{j} refresh failed. {s.error} {s.lastSuccess&&'Showing previous results. '}<button className="text-button" disabled={busy||savingProgress} onClick={()=>onRefresh(j)}>Retry</button></Notice>)}
    {!demo&&!Object.values(state.settings.handles).some(Boolean)&&!state.cses.length&&!state.timusCount&&
      <Notice><button className="text-button" onClick={onSettings}>Connect your handles</button> or add problem links to start a training queue.</Notice>}
    {!!state.pendingAtCoder.length&&<details className="card queue-section" style={{padding:'1rem'}}>
      <summary>Awaiting AtCoder confirmation ({state.pendingAtCoder.length})</summary>
      {state.pendingAtCoder.map(p=><div className="summary-line" key={p.key}><ProblemLink problem={p}/><Button onClick={()=>onSolve({...p,pendingAtCoder:true})}>Review claim</Button></div>)}
    </details>}
    <section className="queue-section" aria-label={showInProgress?'In progress':'Practice queue'}>
      <div className="section-head queue-section-head">
        <div className="queue-view-controls">
          <div className="queue-view-switch" role="group" aria-label="Problemset view">
            <Button variant="ghost" aria-pressed={!showInProgress} onClick={()=>setShowInProgress(false)}>Practice queue</Button>
            <Button variant="ghost" aria-pressed={showInProgress} onClick={()=>setShowInProgress(true)}>In progress <span className="queue-view-count">{state.inProgress.length}</span></Button>
          </div>
          {(!showInProgress||hasFilters)&&<span className="secondary" role="status">{filtered.length} {filtered.length===1?'problem':'problems'}</span>}
        </div>
        <div className="sync-label">{latest&&<span>Last sync · {latest[0]} · {new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:state.settings.zone}).format(latest[1].lastSuccess)}</span>}
          <Button onClick={refresh} disabled={busy||savingProgress}><RefreshCw className={busy?'spin':''} size={15}/>{busy?'Refreshing…':'Refresh'}</Button></div></div>
      <div className="toolbar queue-toolbar">
        <label className="search"><Search size={17}/><input type="search" placeholder="Search problems…" aria-label="Search problems" value={query} onChange={e=>update({query:e.target.value})}/></label>
        <select aria-label="Filter by judge" value={judge} onChange={e=>update({judge:e.target.value})}><option value="">All judges</option>{judges.map(j=><option key={j}>{j}</option>)}</select>
        {!showInProgress&&<div className="rule-filter"><Filter size={15}/><select aria-label="Filter by rule" value={rule} onChange={e=>update({rule:e.target.value})}><option value="">All rules</option>{state.ruleOptions.filter(r=>r.count||r.id===rule).map(r=><option value={r.id} key={r.id}>{r.name}</option>)}</select></div>}
        <select className="queue-page-size" aria-label="Problems per page" value={limit} onChange={e=>changePageSize(Number(e.target.value))}>
          {pageSizes.map(size=><option value={size} key={size}>{size} per page</option>)}
        </select>
        {!showInProgress&&<Button className="queue-random" onClick={openRandomProblem} disabled={!filtered.length}><Shuffle size={16} aria-hidden="true"/>Random problem</Button>}
      </div>
      <div className="card table-card">
        {filtered.length===0 ? <Empty
          title={hasFilters?'No matching problems':showInProgress?'No problems in progress':busy?'Refreshing problem data':'Your practice queue is empty'}
          description={hasFilters?'Try clearing a filter or using a different search.':showInProgress?'Choose Start working on a problem in the Practice queue to save it here.':busy?'Your results will update when the judges finish syncing.':'Add problem links, connect a judge, or update your practice rules.'}
          action={hasFilters?<Button onClick={()=>update(defaultFilters)}>Clear filters</Button>:showInProgress?<Button onClick={()=>setShowInProgress(false)}>View practice queue</Button>:undefined}/> :
        <table className={'problem-table'+(showInProgress?' in-progress-table':'')}><thead><tr>{!showInProgress&&<th className="queue-rank-col"><span className="rank-header">Rank <ArrowDown size={12}/></span></th>}<th className="queue-problem-col">Problem</th><th className="queue-judge-col">Judge</th><th className="queue-difficulty-col">Difficulty</th>{!showInProgress&&<th>Why it’s here</th>}<th className="queue-actions-col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{visible.map(p=>{
            const difficulty=<ProblemDifficulty problem={p} csesTopSolvers={state.csesTopSolvers} usacoDivision={usacoDivisions[p.key]}/>;
            const active=inProgressKeys.has(p.key);
            const progressAction=active?'Remove from In progress':'Start working on';
            const solveAction=p.pendingAtCoder?'Review claim':p.key.startsWith('ac:')?'Claim solve':'Log solve';
            return <tr key={p.key}>
            {!showInProgress&&<td className="rank mono">{String(p.rank).padStart(2,'0')}</td>}
            <td className="problem-cell">{p===next?<a className="problem-link queue-first" href={p.url} target="_blank" rel="noreferrer">{p.title}<span>Open problem ↗</span></a>:<ProblemLink problem={p}/>}<div className="problem-meta">{[p.gym?'Gym '+p.contest:p.contest?.toUpperCase(),p.index].filter(Boolean).join(' · ')}</div>
              <div className="mobile-meta"><JudgeLabel name={p.judge} colors={state.settings.colors}/>{difficulty}</div>{!showInProgress&&<div className="mobile-reason"><QueueReason problem={p}/></div>}</td>
            <td className="desktop-cell"><JudgeLabel name={p.judge} colors={state.settings.colors}/></td>
            <td className="difficulty desktop-cell">{difficulty}</td>{!showInProgress&&<td className="secondary desktop-cell"><QueueReason problem={p}/></td>}
            <td className="row-actions"><div className="queue-row-buttons">
              <Button variant="ghost" className="queue-progress-action" data-active={active&&!showInProgress} disabled={busy||savingProgress} onClick={()=>void onProgress(p,!active)} aria-label={progressAction+' '+p.title} title={progressAction+' '+p.title}>{showInProgress?'Remove':active?'In progress':'Start working'}</Button>
              <Button variant="ghost" disabled={savingProgress} onClick={()=>onSolve(p)} aria-label={solveAction+' for '+p.title} title={solveAction}>{solveAction}</Button>
            </div></td>
          </tr>;})}</tbody></table>}
        {!!filtered.length&& <div className="table-footer"><span>Showing {current*limit+1}–{Math.min(filtered.length,(current+1)*limit)} of {filtered.length}</span>
          <div><Button disabled={current<=0} onClick={()=>update({page:current-1})} aria-label="Previous page"><ArrowLeft size={14}/></Button><Button disabled={(current+1)*limit>=filtered.length} onClick={()=>update({page:current+1})} aria-label="Next page"><ArrowRight size={14}/></Button></div></div>}
      </div>
    </section>
  </>;
}
