import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CirclePlus, ArrowUp, ArrowDown, ArrowUpToLine, Trash2, Check, LibraryBig, SlidersHorizontal } from 'lucide-react';
import { Button, Empty, Field, Heading, Modal, Notice, ProblemLink, RuleCap, RuleDetails, RulePreview, Toggle } from './ui';
import { trainingRatingValue, type AccountJudge, type GuideRule, type ManualList, type Problem, type RatingSource, type RuleOption, type Series, type Settings, type State, type Upsolve } from './types';

export type Requester = <T>(path:string, data?:unknown)=>Promise<T>;
const signed = (value:number) => value < 0 ? '−'+Math.abs(value) : '+'+value;
const sourceLabel = (source:RatingSource) => source==='official' ? 'Official' : 'Training';
const ratingValue = (state:State, judge:AccountJudge, source:RatingSource) =>
  (source==='official' ? state.sync[judge]?.rating : trainingRatingValue(state,judge)) ?? null;
const ratingLabel = (state:State, judge:AccountJudge, source:RatingSource) =>
  sourceLabel(source)+' rating '+(ratingValue(state,judge,source) ?? 'unavailable');
export const roundName = (rule:Upsolve) => rule.archive
  ? rule.division ? 'Div. '+rule.division+' round practice' : 'All Codeforces rounds'
  : 'Div. '+rule.division+' upsolve';
export const roundSummary = (rule:Upsolve) => [
  rule.cutoff?'Through '+rule.cutoff:'All problems',
  rule.archive||rule.allRounds?'Every finished round':rule.virtual?'Official and virtual':'Official participation',
  rule.order==='hardest'?'Hardest first':rule.order==='earliest'?'Earliest letter first':null,
  !rule.archive&&!rule.allRounds&&!rule.skipped?'Attempted only':null,
].filter(Boolean).join(' · ');

function RatingOptions({state,judge}:{state:State;judge:AccountJudge}) {
  return <>{(['official','training'] as const).map(source=>
    <option key={source} value={source}>{sourceLabel(source)} rating ({ratingValue(state,judge,source) ?? 'unavailable'})</option>
  )}</>;
}

export function Rules({state,onAddRule,onOpen,onList,onGuideRule,onImport,save}:{state:State;onAddRule:()=>void;onOpen:(id:string)=>void;onList:(list:ManualList)=>void;onGuideRule:(rule:GuideRule)=>void;onImport:()=>void;save:(value:Settings)=>Promise<void>}) {
  const s=state.settings;
  const {guideRules,listProgress:manualLists}=state;
  const toggle=(change:(next:Settings)=>void)=>{const draft=structuredClone(s); change(draft); void save(draft).catch(()=>{});};
  const grindSource=s.grind.ratingSource;
  const grindRanges=grindSource==='fixed'
    ? s.grind.intervals.map(([lo,hi])=>lo+'–'+hi).join(', ')
    : ratingLabel(state,'Codeforces',grindSource)+' · '+s.grind.offsets.map(([lo,hi])=>signed(lo)+' to '+signed(hi)).join(', ');
  type Row = {name:string; source:string; enabled:boolean; lanes:string[]; detail:string; edit:()=>void; toggle?:(value:boolean)=>void};
  const rows:Row[]=[
    ...s.atcoder.series.map(rule=>({
      name:rule.name+' grind',source:'AtCoder',enabled:rule.enabled,lanes:['atcoder:'+rule.name],
      detail:rule.fixed===null && ratingValue(state,'AtCoder',rule.ratingSource)===null
        ? 'Choose a fixed target or connect a rating in Connections.'
        : (rule.fixed!=null?'Fixed '+rule.fixed:ratingLabel(state,'AtCoder',rule.ratingSource)+' '+signed(rule.offset))+' · ±'+rule.band+(rule.since?' · From '+rule.since.toUpperCase():''),
      edit:()=>onOpen('atcoder:'+rule.name),toggle:(value:boolean)=>toggle(d=>{
        const item=d.atcoder.series.find(entry=>entry.name===rule.name)!;
        item.enabled=value;if(value&&!item.share)item.share=20;
      })
    })),
    ...s.upsolve.map(rule=>({name:roundName(rule),source:'Codeforces',enabled:rule.enabled,lanes:[(rule.archive?'rounds:':'upsolve:')+rule.id],
      detail:roundSummary(rule),edit:()=>onOpen(rule.id),toggle:(value:boolean)=>toggle(d=>{d.upsolve.find(item=>item.id===rule.id)!.enabled=value;})})),
    {name:'Rating grind',source:'Codeforces',enabled:s.grind.enabled,lanes:['grind'],detail:grindRanges+(s.grind.since?' · From '+s.grind.since:''),edit:()=>onOpen('grind'),toggle:value=>toggle(d=>{d.grind.enabled=value;})},
    {name:'Chapter practice',source:'CSES',enabled:s.cses.enabled,lanes:Object.entries(s.cses.weights).filter(([,weight])=>weight>0).map(([name])=>'cses:'+name),
      detail:Object.values(s.cses.weights).filter(weight=>weight>0).length+' chapters selected',edit:()=>onOpen('cses'),toggle:value=>toggle(d=>{d.cses.enabled=value;})},
    ...s.timusRules.map(rule=>({name:rule.name,source:'Timus',enabled:rule.enabled,lanes:['timus:'+rule.id],detail:'Topic practice',edit:()=>onOpen('timus:'+rule.id),
      toggle:(value:boolean)=>toggle(d=>{d.timusRules.find(item=>item.id===rule.id)!.enabled=value;})})),
    ...guideRules.map(rule=>({name:rule.name,source:'USACO Guide',enabled:rule.enabled,lanes:['guide:'+rule.id],detail:rule.done+' of '+rule.total+' solved',edit:()=>onGuideRule(rule)})),
    ...manualLists.map(list=>({name:list.name,source:'Manual lists',enabled:list.enabled,lanes:['list:'+list.id],detail:list.done+' of '+list.total+' solved',edit:()=>onList(list)}))
  ];
  const counts=new Map<string,number>();
  for(const item of state.nextQueue){
    const source=rows.find(row=>row.lanes.includes(item.lane))?.source??'Other';
    counts.set(source,(counts.get(source)??0)+1);
  }
  function renderRow(row:Row){
    const matches=state.ruleOptions.filter(option=>row.lanes.includes(option.id)).reduce((n,option)=>n+option.count,0);
    const allocated=row.lanes.reduce((n,id)=>n+(state.actual[id]??0),0);
    const guide=guideRules.find(rule=>row.lanes.includes('guide:'+rule.id));
    return <div className="rule-row" key={row.source+row.name+row.lanes.join()}>
      <div><h3>{row.name}</h3><p>{row.source} · {row.detail}</p>{row.enabled&&<small>{matches} unsolved matches · {allocated} in queue</small>}</div>
      {guide&&<a className="button plain" href={'#usaco-guide/'+guide.id}>View problems</a>}
      {row.toggle&&<Toggle checked={row.enabled} onChange={row.toggle}><span className="sr-only">Enable {row.name}</span></Toggle>}
      <Button variant="ghost" aria-label={'Edit '+row.name} onClick={row.edit}>Edit</Button>
    </div>;
  }
  const active=rows.filter(row=>row.enabled), paused=rows.filter(row=>!row.enabled);
  return <>
    <Heading title="Rules" description="Choose what goes into your practice queue." action={<Button variant="main" onClick={onAddRule}><CirclePlus size={16}/>Add rule</Button>}/>
    <section className="card rule-row"><div><h2>{counts.size?'Next '+state.nextQueue.length+' problems':'Your queue is empty'}</h2>
      <p>{Array.from(counts,([source,count])=>source+' '+count).join(' · ')||'Enable a rule with matching problems to start practicing.'}</p></div>
      <div className="button-wrap"><Button onClick={()=>onOpen('allocation')}>Practice mix settings</Button><a href="#problemset" className="button plain">View queue</a></div></section>
    <section className="rules-section"><h2>Active rules ({active.length})</h2><div className="card">{active.length?active.map(renderRow):<Empty title="No active rules" description="Add a rule or enable a paused rule."/>}</div></section>
    {paused.length>0&&<details className="rule-details"><summary>Paused rules ({paused.length})</summary>{paused.map(renderRow)}</details>}
    <div className="button-wrap"><a className="button plain" href="#usaco-guide">Browse Guide</a><Button onClick={onImport}>Import CSES progress</Button></div>
  </>;

}

const templateGroups = [
  {name:'AtCoder',options:[{id:'atcoder',name:'Contest mix',configure:true}]},
  {name:'Codeforces',options:[
    {id:'new-upsolve',name:'Contest upsolve'},
    {id:'new-rounds',name:'Practice all rounds'},
    {id:'grind',name:'Rating grind',configure:true},
  ]},
  {name:'CSES',options:[
    {id:'cses',name:'Chapter practice',configure:true},
    {id:'cses-list',name:'Finish a checklist'},
  ]},
  {name:'Timus',options:[{id:'new-timus',name:'Topic practice'}]},
  {name:'USACO Guide',options:[{id:'guide',name:'Practice problems'}]},
  {name:'Manual lists',options:[{id:'manual',name:'Problem links'}]},
];

export function Templates({close,select}:{close:()=>void;select:(id:string)=>void}) {
  return <Modal title="Add rule" close={close}><div className="dialog-body template-list">
    {templateGroups.map(group=><section className="template-group" key={group.name} aria-label={group.name}>
      <h3>{group.name}</h3>
      {group.options.map(option=><button key={option.id} className="template" onClick={()=>select(option.id)}>
        <strong>{option.name}</strong><span>{option.configure?'Configure':<CirclePlus size={17}/>}</span>
      </button>)}
    </section>)}
  </div></Modal>;
}

export function RuleEditor({view,state,request,save,close,saveLabel='Save changes'}:{view:string;state:State;request:Requester;save:(settings:Settings)=>Promise<void>;close:()=>void;saveLabel?:string}) {
  const [draft,setDraft]=useState(()=>structuredClone(state.settings));
  const [preview,setPreview]=useState<{ruleOptions:RuleOption[]}|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const newArchive=view==='new-rounds';
  const creatingRoundRule=newArchive||view==='new-upsolve';
  const [newRule,setNewRule]=useState<Upsolve>(()=>({id:crypto.randomUUID(),division:newArchive?0:4,cutoff:newArchive?'':'E',
    enabled:true,virtual:false,skipped:true,archive:newArchive}));
  const [openSeries,setOpenSeries]=useState(()=>view.startsWith('atcoder:')?view.slice('atcoder:'.length):draft.atcoder.series.find(rule=>rule.enabled)?.name??'ABC');
  const isAtCoder=view==='atcoder'||view.startsWith('atcoder:');
  const upsolve=creatingRoundRule?newRule:draft.upsolve.find(rule=>rule.id===view);
  const originalUpsolve=state.settings.upsolve.find(rule=>rule.id===view);
  const modify=(edit:(d:Settings)=>void)=>setDraft(prev=>{const d=structuredClone(prev);edit(d);return d;});
  const model=useMemo(()=>creatingRoundRule?{...draft,upsolve:[...draft.upsolve,newRule]}:draft,[creatingRoundRule,draft,newRule]);
  useEffect(()=>{
    let active=true;
    setPreview(null);
    setPreviewError('');
    const timer=window.setTimeout(()=>{
      void request<NonNullable<typeof preview>>('/api/preview',model)
        .then(result=>{if(active)setPreview(result);},error=>{if(active)setPreviewError(error.message);});
    },260);
    return()=>{active=false;window.clearTimeout(timer);};
  },[model,request]);
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{await save(model);close();}catch(err){setError((err as Error).message);}finally{setBusy(false);}};
  const changeRule=(patch:Partial<Upsolve>)=>{
    if(creatingRoundRule){ setNewRule(r=>({...r,...patch}));return; }
    modify(d=>{Object.assign(d.upsolve.find(r=>r.id===view)!,patch);});
  };
  const changeSeries=(index:number,patch:Partial<Series>)=>modify(d=>Object.assign(d.atcoder.series[index],patch));
  const selectedSeries=draft.atcoder.series.find(rule=>rule.name===openSeries);
  const relevant=(preview?.ruleOptions??[]).filter(option=>isAtCoder ? option.id==='atcoder:'+selectedSeries?.name
    : view==='grind' ? option.group==='grind'
    : view==='cses' ? option.group==='cses' && draft.cses.weights[option.name]>0
    : option.id===(upsolve?.archive?'rounds:':'upsolve:')+upsolve?.id);
  const count=relevant.reduce((total,option)=>total+option.count,0);
  const pending=relevant.reduce((total,option)=>total+option.pending,0);
  const grindSource=draft.grind.ratingSource;
  const rangeKey=grindSource==='fixed'?'intervals':'offsets';
  const grindRating=grindSource==='fixed'?null:ratingValue(state,'Codeforces',grindSource);
  const ranges=draft.grind[rangeKey];
  const rangeLabel=rangeKey==='intervals'?'rating':'offset';
  const rangeMin=rangeKey==='intervals'?0:-6000;
  const rangeMax=rangeKey==='intervals'?10000:6000;
  const addRange=()=>modify(d=>{d.grind[rangeKey].push(rangeKey==='intervals'?[1600,1800]:[0,200]);});
  const rangeInputs=([lo,hi]:[number,number],i:number)=> <div className="interval" key={i}>
    <input type="number" min={rangeMin} max={rangeMax} required aria-label={'Lower '+rangeLabel+' '+(i+1)} value={lo}
      onChange={e=>modify(d=>{d.grind[rangeKey][i][0]=Number(e.target.value);})}/>
    <span>to</span><input type="number" min={rangeMin} max={rangeMax} required aria-label={'Upper '+rangeLabel+' '+(i+1)} value={hi}
      onChange={e=>modify(d=>{d.grind[rangeKey][i][1]=Number(e.target.value);})}/>
    {ranges.length>1&&<Button variant="ghost" className="icon-button" aria-label={'Remove interval '+(i+1)}
      onClick={()=>modify(d=>{d.grind[rangeKey].splice(i,1);})}><Trash2 size={16}/></Button>}
  </div>;
  const title=isAtCoder?'AtCoder contest mix':view==='grind'?'Codeforces rating grind'
    :view==='cses'?'CSES chapter practice':view==='new-upsolve'?'Codeforces upsolve'
    :newArchive?'Practice all Codeforces rounds':upsolve?roundName(upsolve):'Rule';
  const paused=isAtCoder ? !selectedSeries?.enabled : view==='grind' ? !draft.grind.enabled : view==='cses' ? !draft.cses.enabled : !upsolve?.enabled;
  const unavailable=isAtCoder && selectedSeries?.fixed===null && ratingValue(state,'AtCoder',selectedSeries.ratingSource)===null
    ? 'Set a fixed target or load the selected rating.'
    : view==='grind' && grindSource!=='fixed' && grindRating===null
      ? grindSource==='training' ? 'Set a Codeforces training rating in Virtual.' : 'Sync Codeforces in Connections to load your rating.'
    : view==='cses' && !state.csesProgress.length ? 'Refresh the CSES catalog from Problemset.'
    : (upsolve?.archive||upsolve?.allRounds) && !state.sync.Codeforces?.catalogAt && preview && !count
      ? 'Refresh Problemset to load the public Codeforces catalog.'
    : upsolve && !upsolve.archive && !upsolve.allRounds && (!state.settings.handles.Codeforces || !state.sync.Codeforces?.lastSuccess)
      ? 'Connect and sync Codeforces to load your contests.'
    : undefined;
  const previewNote=paused ? 'Turn it on to add matching problems to the practice queue.'
    : unavailable ?? (pending ? pending+' awaiting an English statement check.'
      : preview && count===0 ? view==='cses' && !Object.values(draft.cses.weights).some(weight=>weight>0)
        ? 'Select a chapter to find practice problems.' : 'Try widening the rule filters.' : undefined);
  return <Modal title={title} description={upsolve?.archive?'Queue unsolved problems from finished Codeforces rounds, including rounds you never entered.':undefined} close={close}>
    <form onSubmit={submit}><div className="dialog-body form-stack">
      {error&&<Notice type="error">{error}</Notice>}
      {isAtCoder&&<>
        <div className="series-options">{draft.atcoder.series.map((rule,i)=>{
          const rating=ratingValue(state,'AtCoder',rule.ratingSource);
          const target=rule.fixed??(rating===null?null:rating+rule.offset);
          const original=state.settings.atcoder.series[i];
          const expanded=openSeries===rule.name;
          return <div className="series-option" key={rule.name}>
            <div className="series-option-row">
              <Toggle checked={rule.enabled} onChange={enabled=>changeSeries(i,{enabled,share:enabled&&!rule.share?20:rule.share})}>{rule.name}</Toggle>
              <Button variant="ghost" aria-expanded={expanded} aria-controls={'series-'+rule.name}
                onClick={()=>setOpenSeries(expanded?'':rule.name)}>{expanded?'Hide settings':'Edit '+rule.name}</Button>
            </div>
            <div id={'series-'+rule.name} hidden={!expanded}>
              {expanded&&<div className="form-stack series-settings">
                <Field label={rule.name+' difficulty target'}>
                  <select value={rule.fixed===null?rule.ratingSource:'fixed'} onChange={e=>{
                    const mode=e.target.value;
                    changeSeries(i,mode==='fixed'?{fixed:Math.max(0,Math.min(10000,target??1200))}:{fixed:null,ratingSource:mode as RatingSource});
                  }}><RatingOptions state={state} judge="AtCoder"/><option value="fixed">Fixed target</option></select>
                </Field>
                {rule.fixed!==null&&<Field label={rule.name+' fixed target'}>
                  <input type="number" min="0" max="10000" required value={rule.fixed} onChange={e=>changeSeries(i,{fixed:Number(e.target.value)})}/>
                </Field>}
                {target!==null&&<p className="secondary">Difficulty range {target-rule.band}–{target+rule.band}</p>}
                <RuleDetails label="Advanced settings" initiallyOpen={Boolean(original.since)||original.band!==100||original.share!==[80,20,0][i]||original.offset!==[300,100,0][i]}>
                  <div className="section-weights">
                    {rule.fixed===null&&<Field label={rule.name+' rating offset'}><input type="number" min={-6000} max={6000} value={rule.offset} onChange={e=>changeSeries(i,{offset:Number(e.target.value)})}/></Field>}
                    <Field label={rule.name+' difficulty band (±)'}><input type="number" min="0" max="6000" value={rule.band} onChange={e=>changeSeries(i,{band:Number(e.target.value)})}/></Field>
                    <Field label={rule.name+' earliest contest'}><input placeholder={rule.name.toLowerCase()+'212'} value={rule.since} onChange={e=>changeSeries(i,{since:e.target.value})}/></Field>
                    <Field label={rule.name+' series weight'}><input type="number" min="0" max="100" value={rule.share} onChange={e=>changeSeries(i,{share:Number(e.target.value)})}/></Field>
                  </div>
                </RuleDetails>
              </div>}
            </div>
          </div>;
        })}</div>
        <RuleDetails label="Statement and rating filters" initiallyOpen={!state.settings.atcoder.english||state.settings.atcoder.experimental}>
          <Toggle checked={!draft.atcoder.experimental} onChange={on=>modify(d=>{d.atcoder.experimental=!on;})}>Exclude experimental estimates</Toggle>
          <Toggle checked={draft.atcoder.english} onChange={on=>modify(d=>{d.atcoder.english=on;})}>Require an English statement</Toggle>
        </RuleDetails>
      </>}
      {view==='grind'&&<>
        <Toggle checked={draft.grind.enabled} onChange={enabled=>modify(d=>{d.grind.enabled=enabled;})}>Enable rating grind</Toggle>
        <Field label="Difficulty target">
          <select value={grindSource} onChange={e=>modify(d=>{d.grind.ratingSource=e.target.value as Settings['grind']['ratingSource'];})}>
            <option value="fixed">Fixed range</option><RatingOptions state={state} judge="Codeforces"/>
          </select>
        </Field>
        <div className="form-stack">
          <strong>{rangeKey==='intervals'?'Rating range':'Offsets from rating'}</strong>
          {ranges.length ? rangeInputs(ranges[0],0) : <Button onClick={addRange}>Add range</Button>}
          {grindRating!==null&&ranges.length>0&&<p className="secondary">Matching ratings {ranges.map(([lo,hi])=>(grindRating+lo)+'–'+(grindRating+hi)).join(', ')}</p>}
        </div>
        <RuleDetails key={rangeKey} label="More filters" initiallyOpen={state.settings.grind[rangeKey].length>1||Boolean(state.settings.grind.since)}>
          {ranges.slice(1).map((range,i)=>rangeInputs(range,i+1))}
          {ranges.length>0&&<div><Button disabled={ranges.length>=20} onClick={addRange}>Add another range</Button></div>}
          <Field label="Earliest contest date"><input type="date" value={draft.grind.since} onChange={e=>modify(d=>{d.grind.since=e.target.value;})}/></Field>
        </RuleDetails>
      </>}
      {view==='cses'&&<>
        <Toggle checked={draft.cses.enabled} onChange={enabled=>modify(d=>{d.cses.enabled=enabled;})}>Enable CSES chapter practice</Toggle>
        <div className="chapter-options" role="group" aria-label="CSES chapters">
          {state.csesProgress.map(section=><label key={section.name}>
            <input type="checkbox" checked={(draft.cses.weights[section.name]??0)>0} onChange={e=>modify(d=>{
              d.cses.weights[section.name]=e.target.checked?state.settings.cses.weights[section.name]||1:0;
            })}/><span>{section.name}</span><small>{section.done} / {section.total} solved</small>
          </label>)}
        </div>
        {state.csesProgress.length>0&&<RuleDetails label="Chapter weights" initiallyOpen={Object.values(state.settings.cses.weights).some(weight=>weight>1)}>
          <div className="section-weights">{state.csesProgress.filter(section=>draft.cses.weights[section.name]>0).map(section=><Field key={section.name} label={section.name}>
            <input type="number" min="1" max="100" value={draft.cses.weights[section.name]} onChange={e=>modify(d=>{d.cses.weights[section.name]=Number(e.target.value)||1;})}/>
          </Field>)}</div>
        </RuleDetails>}
      </>}
      {!!upsolve&&<>
        <Field label="Division"><select value={upsolve.division} onChange={e=>changeRule({division:Number(e.target.value)})}>
          {upsolve.archive&&<option value={0}>All rounds</option>}
          {[1,2,3,4].map(i=><option key={i} value={i}>Div. {i}</option>)}</select></Field>
        <Field label="Last problem letter" hint={upsolve.archive?'Leave blank to include every problem.':'Includes numbered variants such as F1 and F2.'}>
          <input maxLength={1} pattern="[A-Z]" required={!upsolve.archive} value={upsolve.cutoff} onChange={e=>changeRule({cutoff:e.target.value.toUpperCase()})}/></Field>
        {!upsolve.archive&&<Field label="Round scope" hint={upsolve.allRounds?'Includes rounds you never entered, newest first.':undefined}>
          <select value={upsolve.allRounds?'all':'entered'} onChange={e=>changeRule({allRounds:e.target.value==='all'})}>
            <option value="entered">Rounds I entered</option><option value="all">Every finished round</option>
          </select>
        </Field>}
        <Field label="Problem order" hint={upsolve.order==='hardest'?'Highest rated first within each round. Unrated problems follow, latest letter first.':undefined}>
          <select value={upsolve.order ?? (upsolve.archive||upsolve.allRounds?'earliest':'attempted')}
            onChange={e=>changeRule({order:e.target.value==='attempted'?undefined:e.target.value as Upsolve['order']})}>
            {!upsolve.archive&&!upsolve.allRounds&&<option value="attempted">Attempted first</option>}
            <option value="earliest">Earliest letter first</option>
            <option value="hardest">Hardest first</option>
          </select>
        </Field>
        {!upsolve.archive&&!upsolve.allRounds&&<RuleDetails label="More filters" initiallyOpen={!!originalUpsolve&&(originalUpsolve.virtual||!originalUpsolve.skipped)}>
          <Toggle checked={upsolve.virtual} onChange={virtual=>changeRule({virtual})}>Include virtual rounds</Toggle>
          <Toggle checked={upsolve.skipped} onChange={skipped=>changeRule({skipped})}>Include problems skipped in-round</Toggle>
        </RuleDetails>}
        <Toggle checked={upsolve.enabled} onChange={enabled=>changeRule({enabled})}>Enable {upsolve.archive?'round practice':'upsolve rule'}</Toggle>
        {!creatingRoundRule&&<div><Button variant="danger" onClick={()=>{const d={...draft,upsolve:draft.upsolve.filter(r=>r.id!==upsolve.id)};void save(d).then(close).catch(e=>setError((e as Error).message));}}>Remove rule</Button></div>}
      </>}
      {previewError&&<Notice type="error">{previewError}</Notice>}
      {!previewError&&(!isAtCoder||selectedSeries)&&<RulePreview count={preview?count:undefined}
        examples={relevant.flatMap(option=>option.preview)} status={paused?'Rule paused':unavailable?'Preview unavailable':undefined} note={previewNote}/>}
    </div><div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="main" type="submit" disabled={busy}>{busy?'Saving…':saveLabel}</Button></div></form>
  </Modal>;
}

export function ListEditor({list,state,startCses=false,request,done,close,onSolve}:{list?:ManualList;state:State;startCses?:boolean;request:Requester;done:(state:State)=>void;close:()=>void;onSolve:(p:Problem)=>void}) {
  const [name,setName]=useState(list?.name??'');
  const [items,setItems]=useState<Problem[]>(list?.items??[]);
  const [cap,setCap]=useState(list?.cap??100);
  const [enabled,setEnabled]=useState(list?.enabled??true);
  const [section,setSection]=useState('');
  const [tasks,setTasks]=useState<string[]>([]);
  const [wantCses,setWantCses]=useState(startCses);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [remove,setRemove]=useState(false);
  const move=(from:number,to:number)=>setItems(current=>{
    const next=[...current];
    const [item]=next.splice(from,1);
    next.splice(to,0,item);
    return next;
  });
  const add=(keys:string[])=>{
    const seen=new Set(items.map(i=>i.key));
    const rest=state.cses.filter(p=>keys.includes(p.key)&&!seen.has(p.key)).map(p=>({...p,judge:'CSES' as const,url:'https://cses.fi/problemset/task/'+p.key.split(':')[1],solve:p.solved?{day:p.day??null,source:'manual' as const}:null}));
    setItems([...items,...rest]);setTasks([]);
  };
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const next=await request<State>('/api/lists',{id:list?.id,name,cap,enabled,keys:items.map(p=>p.key)});done(next);close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal title={list?'Edit list':'Create a list'} description="Set the order of the problems you want to finish." close={close}>
    <form onSubmit={submit}><div className="dialog-body form-stack">
      {error&&<Notice type="error">{error}</Notice>}
      <Field label="List name"><input required maxLength={90} placeholder="e.g. ICPC Gym upsolves" value={name} onChange={e=>setName(e.target.value)}/></Field>
      {state.settings.queueMode==='custom'&&<RuleCap value={cap} initiallyOpen={!!list&&list.cap!==100} onChange={setCap}/>}
      <Toggle checked={enabled} onChange={setEnabled}>Include list in practice queue</Toggle>
      {!wantCses&&<Button onClick={()=>setWantCses(true)}><LibraryBig size={16}/>Pick CSES tasks</Button>}
      {wantCses&&<div className="preview form-stack">
        <Field label="CSES section"><select value={section} onChange={e=>{setSection(e.target.value);setTasks([]);}}><option value="">Choose a section</option>{state.csesProgress.map(p=><option key={p.name}>{p.name}</option>)}</select></Field>
        {section&&<><div className="checklist">{state.cses.filter(p=>p.section===section).map(p=><label key={p.key}><input type="checkbox" checked={tasks.includes(p.key)} onChange={e=>setTasks(e.target.checked?[...tasks,p.key]:tasks.filter(t=>t!==p.key))}/>{p.title}</label>)}</div>
          <div className="button-wrap"><Button onClick={()=>add(state.cses.filter(p=>p.section===section).map(p=>p.key))}>Add section</Button><Button disabled={!tasks.length} onClick={()=>add(tasks)}>Add selected ({tasks.length})</Button></div></>}
      </div>}
      {!!items.length&&<><p className="secondary">{items.filter(item=>!item.solve&&!item.pendingAtCoder).length} unsolved · {items.length} total</p><div className="card ordered-list">{items.map((p,i)=><div className="ordered-item" key={p.key}><span className="mono">{i+1}.</span><span><ProblemLink problem={p}/>{p.solve&&<small>Solved{p.solve.day?' · '+p.solve.day:''}</small>}{p.pendingAtCoder&&<small>Awaiting AtCoder confirmation</small>}</span><div className="ordered-actions">
        <Button variant="ghost" className="icon-button" title="Move to top" aria-label={'Move '+p.title+' to top'} disabled={!i} onClick={()=>move(i,0)}><ArrowUpToLine size={16}/></Button>
        <Button variant="ghost" className="icon-button" title="Move up" aria-label={'Move '+p.title+' up'} disabled={!i} onClick={()=>move(i,i-1)}><ArrowUp size={14}/></Button>
        <Button variant="ghost" className="icon-button" title="Move down" aria-label={'Move '+p.title+' down'} disabled={i===items.length-1} onClick={()=>move(i,i+1)}><ArrowDown size={14}/></Button>
        {list&&list.items.some(item=>item.key===p.key)&&<Button variant="ghost" className="icon-button" title="Solve details" aria-label={'Solve details for '+p.title} onClick={()=>onSolve(p)}><Check size={14}/></Button>}
        <Button variant="ghost" className="icon-button" title="Remove" aria-label={'Remove '+p.title} onClick={()=>setItems(items.filter(x=>x.key!==p.key))}><Trash2 size={14}/></Button>
      </div></div>)}</div></>}
      {list&&(!remove?<Button variant="danger" onClick={()=>setRemove(true)}>Delete list</Button>:<Notice type="error">Delete this list? Solve history is kept. <button type="button" className="text-button" onClick={()=>void request<State>('/api/lists/delete',{id:list.id}).then(next=>{done(next);close();}).catch(e=>setError((e as Error).message))}>Confirm deletion</button></Notice>)}
    </div><div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="main" type="submit" disabled={busy}>{busy?'Saving…':'Save list'}</Button></div></form>
  </Modal>;
}
