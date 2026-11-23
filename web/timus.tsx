import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { timusCategories } from '../shared/timus.js';
import { Button, Field, Modal, Notice, RuleCap, RuleDetails, RulePreview, Toggle } from './ui';
import type { Requester } from './rules';
import type { RuleOption, Settings, State, TimusRule } from './types';

type Preview = {ruleOptions: RuleOption[]};
const newRule = ():TimusRule => ({
  id:crypto.randomUUID(), name:'Timus topic practice', categories:[], min:null, max:null,
  progress:'unsolved', order:'easiest', enabled:true, cap:100,
});

export function TimusRuleEditor({state,rule,request,save,close,busy,canRefresh,refresh,saveLabel='Save rule'}:{
  state:State; rule?:TimusRule; request:Requester; save:(settings:Settings)=>Promise<void>;
  close:()=>void; busy:boolean; canRefresh:boolean; refresh:()=>void; saveLabel?:string;
}) {
  const [draft,setDraft] = useState(()=>rule ?? newRule());
  const [preview,setPreview] = useState<Preview | null>(null);
  const [previewError,setPreviewError] = useState('');
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const [deleting,setDeleting] = useState(false);
  const change = (patch:Partial<TimusRule>) => setDraft(current=>({...current,...patch}));
  const model = useMemo(()=>{
    const saved = state.settings.timusRules;
    const rules = rule ? saved.map(entry=>entry.id===draft.id ? draft : entry) : [...saved,draft];
    return {...state.settings,timusRules:rules};
  },[draft,rule,state.settings]);

  useEffect(()=>{
    let active = true;
    setPreview(null);
    setPreviewError('');
    if(!draft.enabled || !state.timusCount)return;
    const timer = window.setTimeout(async()=>{
      try {
        const result=await request<Preview>('/api/preview',model);
        if(active) setPreview(result);
      } catch(e) {
        if(active) setPreviewError((e as Error).message);
      }
    },260);
    return()=>{active=false; window.clearTimeout(timer);};
  },[model,request,draft.enabled,state.timusCount]);

  const commit = async(settings:Settings) => {
    setSaving(true); setError('');
    try { await save(settings); close(); }
    catch(e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };
  const submit = (event:FormEvent) => {event.preventDefault(); void commit(model);};
  const remove = () => void commit({...state.settings,timusRules:state.settings.timusRules.filter(entry=>entry.id!==draft.id)});
  const ruleId = 'timus:'+draft.id;
  const matches = preview?.ruleOptions.find(option=>option.id===ruleId);
  const history = state.sync.Timus;
  const historyComplete = state.settings.handles.Timus && history?.historyAt && history.backfill===null;
  const historyNote = draft.progress!=='unsolved'&&!history?.historyAt
    ? 'Connect and sync a Timus profile to use attempt history.'
    : draft.progress==='unattempted'&&!historyComplete
      ? 'Finish syncing older submissions to identify unattempted problems.'
      : undefined;
  const selectedTopics=draft.categories.map(tag=>timusCategories[tag]).join(', ');

  return <Modal title={rule?'Edit Timus rule':'Timus topic practice'} close={close}>
    <form onSubmit={submit}>
      <div className="dialog-body form-stack">
        {error&&<Notice type="error">{error}</Notice>}
        <Field label="Rule name"><input required maxLength={90} value={draft.name} onChange={e=>change({name:e.target.value})}/></Field>
        <RuleDetails label={draft.categories.length?'Topics ('+draft.categories.length+')':'Topics'}>
          <div className="checklist" role="group" aria-label="Timus topics">
            {Object.entries(timusCategories).map(([tag,label])=><label key={tag}>
              <input type="checkbox" checked={draft.categories.includes(tag)}
                onChange={e=>change({categories:e.target.checked?[...draft.categories,tag]:draft.categories.filter(value=>value!==tag)})}/>
              {label}
            </label>)}
          </div>
        </RuleDetails>
        <p className="secondary">{selectedTopics||'All topics'}</p>
        <RuleDetails label="More filters" initiallyOpen={!!rule&&(rule.min!==null||rule.max!==null||rule.progress!=='unsolved'||rule.order!=='easiest')}>
        <div className="section-weights">
          <Field label="Minimum Timus difficulty"><input type="number" min="0" placeholder="Any" value={draft.min??''}
            onChange={e=>change({min:e.target.value===''?null:Number(e.target.value)})}/></Field>
          <Field label="Maximum Timus difficulty"><input type="number" min={draft.min??0} placeholder="Any" value={draft.max??''}
            onChange={e=>change({max:e.target.value===''?null:Number(e.target.value)})}/></Field>
        </div>
        <Field label="Progress"><select value={draft.progress} onChange={e=>change({progress:e.target.value as TimusRule['progress']})}>
          <option value="unsolved">All unsolved</option><option value="unattempted">Unattempted</option>
          <option value="attempted">Attempted but unsolved</option>
        </select></Field>
        {historyNote&&<Notice>{historyNote}</Notice>}
        <Field label="Order"><select value={draft.order} onChange={e=>change({order:e.target.value as TimusRule['order']})}>
          <option value="easiest">Easiest first</option><option value="hardest">Hardest first</option>
        </select></Field>
        </RuleDetails>
        {state.settings.queueMode==='custom'&&<RuleCap value={draft.cap} initiallyOpen={!!rule&&rule.cap!==100} onChange={cap=>change({cap})}/>}
        <Toggle checked={draft.enabled} onChange={enabled=>change({enabled})}>Enable rule</Toggle>
        {(!state.timusCount||!history?.catalogAt)&&<Notice>
          {canRefresh
            ? <>Load the Timus catalog to preview matches. <button type="button" className="text-button" disabled={busy} onClick={refresh}>{busy?'Refreshing…':'Refresh Timus'}</button></>
            : 'Refresh Timus from Problemset in your personal profile to load the catalog.'}
        </Notice>}
        {history?.error&&<Notice type="error">{history.error}</Notice>}
        {previewError&&<Notice type="error">{previewError}</Notice>}
        {!previewError&&<RulePreview count={matches?.count} examples={matches?.preview}
          status={!draft.enabled?'Rule paused':!state.timusCount||historyNote?'Preview unavailable':undefined}
          note={!draft.enabled?'Turn it on to add matching problems to the practice queue.':matches?.count===0&&!historyNote?'Try broadening your Timus filters.':undefined}/>}
        {rule&&(deleting
          ? <Notice type="error">Delete this rule? <button type="button" className="text-button" disabled={saving||busy} onClick={remove}>Confirm deletion</button></Notice>
          : <Button variant="danger" onClick={()=>setDeleting(true)}>Delete rule</Button>)}
      </div>
      <div className="dialog-actions"><Button onClick={close}>Cancel</Button>
        <Button variant="main" type="submit" disabled={saving||busy}>{saving?'Saving…':saveLabel}</Button></div>
    </form>
  </Modal>;
}
