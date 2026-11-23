import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { RuleEditor, roundName, roundSummary, type Requester } from './rules';
import { TimusRuleEditor } from './timus';
import { Button, Field, Modal, Notice, RuleDetails } from './ui';
import type { Group, GuideRule, ManualList, PracticeSource, RuleOption, Settings, State } from './types';

const sources: {id:PracticeSource; label:string; groups:Group[]}[] = [
  {id:'atcoder', label:'AtCoder', groups:['atcoder']},
  {id:'codeforces', label:'Codeforces', groups:['upsolve','rounds','grind']},
  {id:'cses', label:'CSES', groups:['cses']},
  {id:'timus', label:'Timus', groups:['timus']},
  {id:'guide', label:'USACO Guide', groups:['guide']},
  {id:'manual', label:'Manual lists', groups:['manual']},
];

type Shares = NonNullable<Settings['sourceShares']>;
type Preview = {nextQueue:{key:string;title:string;lane:string}[];ruleOptions:RuleOption[]};
type SavedRule = {kind:'guide'; rule?:GuideRule} | {kind:'manual'; rule?:ManualList};

function initialShares(settings:Settings):Shares {
  if (settings.sourceShares) return settings.sourceShares;
  const {shares,upsolve,grind}=settings;
  const activeWeight = (['upsolve','rounds','grind'] as const).reduce((sum,group)=>{
    const enabled = group==='grind' ? grind.enabled : upsolve.some(rule=>rule.enabled && !!rule.archive===(group==='rounds'));
    return sum + (enabled ? shares[group] : 0);
  },0);
  return {atcoder:shares.atcoder, codeforces:activeWeight || (settings.queueMode==='automatic'?shares.upsolve:0),
    cses:shares.cses, timus:shares.timus, guide:shares.guide, manual:shares.manual};
}

export function PracticeMix({state,request,save,close,editSavedRule}:{state:State;request:Requester;
  save:(settings:Settings)=>Promise<void>;close:()=>void;editSavedRule:(entry:SavedRule)=>void}) {
  const [draft,setDraft]=useState(()=>({
    ...state.settings,
    sourceShares:initialShares(state.settings),
    upsolveCap:!state.settings.sourceShares && state.settings.queueMode==='automatic' && state.settings.upsolveCap===20
      ? 100 : state.settings.upsolveCap,
  }));
  const [visible,setVisible]=useState(()=>sources.filter(({id})=>draft.sourceShares[id]>0).map(({id})=>id));
  const [expanded,setExpanded]=useState<PracticeSource|null>(null);
  const [editor,setEditor]=useState<string|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [previewError,setPreviewError]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    setPreview(null);
    setPreviewError('');
    const timer=window.setTimeout(()=>{
      void request<Preview>('/api/preview',draft).then(result=>{
        if(active)setPreview(result);
      },(err:Error)=>{if(active)setPreviewError(err.message);});
    },260);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[draft,request]);

  const custom=draft.queueMode==='custom';
  const total=Object.values(draft.sourceShares).reduce((sum,weight)=>sum+weight,0);
  const setWeight=(id:PracticeSource,weight:number)=>setDraft(current=>({...current,sourceShares:{...current.sourceShares,[id]:weight}}));
  const commit=async(action:()=>void)=>{
    setBusy(true);setError('');
    try{await save(draft);action();}catch(err){setError((err as Error).message);}finally{setBusy(false);}
  };
  const submit=(event:FormEvent)=>{event.preventDefault();void commit(close);};
  const setRuleDraft=async(settings:Settings)=>setDraft({...settings,sourceShares:settings.sourceShares ?? draft.sourceShares});
  const toggleUpsolve=(id:string,enabled:boolean)=>setDraft(current=>({...current,
    upsolve:current.upsolve.map(rule=>rule.id===id?{...rule,enabled}:rule),
  }));
  const edit=(view:string)=>()=>setEditor(view);
  const openSaved=(entry:SavedRule)=>()=>void commit(()=>editSavedRule(entry));
  const sourceByLane=new Map(preview?.ruleOptions.map(option=>[
    option.id,sources.find(source=>source.groups.includes(option.group)),
  ]));
  const available=sources.filter(({id})=>!visible.includes(id));
  const ruleRow=(label:string,editRule:()=>void,details?:string,toggle?:{enabled:boolean;change:(enabled:boolean)=>void},buttonLabel='Edit')=>
    <div className="mix-rule" key={label}>
      {toggle&&<input type="checkbox" checked={toggle.enabled} onChange={e=>toggle.change(e.currentTarget.checked)} aria-label={'Include '+label}/>}
      <div><strong>{label}</strong>{details&&<small>{details}</small>}</div>
      <Button variant="ghost" disabled={busy} onClick={editRule} aria-label={buttonLabel+' '+label}>{buttonLabel}</Button>
    </div>;

  return <>
    <Modal title="Practice mix settings" close={close}>
      <form onSubmit={submit}><div className="dialog-body form-stack">
        {error&&<Notice type="error">{error}</Notice>}
        <Field label="Practice mix" hint={custom?'Weights set the target split. Sources with available problems fill any open spots.':'Take turns among sources with matching problems.'}>
          <select value={draft.queueMode} onChange={e=>setDraft(current=>({...current,queueMode:e.target.value as Settings['queueMode']}))}>
            <option value="automatic">Automatic</option><option value="custom">Custom</option>
          </select>
        </Field>
        {sources.filter(({id})=>!custom||visible.includes(id)).map(({id,label})=><section className="mix-source" key={id} aria-label={label}>
          <div className="mix-source-head">
            <button type="button" className="mix-expand" aria-expanded={expanded===id} aria-controls={'mix-'+id}
              onClick={()=>setExpanded(current=>current===id?null:id)}>
              <ChevronDown size={16}/><strong>{label}</strong>
            </button>
            {custom&&<div className="mix-share">
              <input type="number" min="0" max="300" aria-label={label+' weight'} value={draft.sourceShares[id]} onChange={e=>setWeight(id,Number(e.target.value))}/>
              <span>{total?Number((100*draft.sourceShares[id]/total).toFixed(1)):0}%</span>
            </div>}
          </div>
          <div className="mix-rules" hidden={expanded!==id} id={'mix-'+id}>
            {id==='atcoder'&&ruleRow('Contest series',edit('atcoder'),draft.atcoder.series.filter(rule=>rule.enabled).map(rule=>rule.name).join(', ')||'All series paused')}
            {id==='codeforces'&&<>
              <fieldset className="mix-upsolve-ratings" aria-describedby="mix-upsolve-ratings-hint">
                <legend>Upsolve rating range</legend>
                <div>
                  <Field label="Minimum rating">
                    <input type="number" min="0" max="10000" value={draft.upsolveMinRating??''}
                      onChange={e=>setDraft(current=>({...current,upsolveMinRating:e.target.value===''?null:e.target.valueAsNumber}))}/>
                  </Field>
                  <Field label="Maximum rating">
                    <input type="number" min="0" max="10000" value={draft.upsolveMaxRating??''}
                      onChange={e=>setDraft(current=>({...current,upsolveMaxRating:e.target.value===''?null:e.target.valueAsNumber}))}/>
                  </Field>
                </div>
                <p id="mix-upsolve-ratings-hint">Applies to all upsolve rules. Leave either bound blank to keep it open. Setting a bound excludes unrated problems.</p>
              </fieldset>
              {draft.upsolve.map(rule=><div key={rule.id}>{ruleRow(roundName(rule),edit(rule.id),roundSummary(rule),
                {enabled:rule.enabled,change:enabled=>toggleUpsolve(rule.id,enabled)})}</div>)}
              {ruleRow('Rating grind',edit('grind'),undefined,{enabled:draft.grind.enabled,
                change:enabled=>setDraft(current=>({...current,grind:{...current.grind,enabled}}))})}
              <Button variant="ghost" onClick={edit('new-upsolve')} disabled={draft.upsolve.length>=16}>Add upsolve rule</Button>
            </>}
            {id==='cses'&&ruleRow('Chapter practice',edit('cses'),Object.values(draft.cses.weights).filter(weight=>weight>0).length+' chapters selected',
              {enabled:draft.cses.enabled,change:enabled=>setDraft(current=>({...current,cses:{...current.cses,enabled}}))})}
            {id==='timus'&&<>
              {draft.timusRules.map(rule=><div key={rule.id}>{ruleRow(rule.name,edit('timus:'+rule.id),rule.enabled?'Active':'Paused')}</div>)}
              <Button variant="ghost" onClick={edit('new-timus')} disabled={draft.timusRules.length>=32}>Add topic rule</Button>
            </>}
            {id==='guide'&&<>
              {state.guideRules.map(rule=><div key={rule.id}>{ruleRow(rule.name,openSaved({kind:'guide',rule}),rule.enabled?'Active':'Paused',undefined,'Save & edit')}</div>)}
              <Button variant="ghost" disabled={busy} onClick={openSaved({kind:'guide'})}>Save & add Guide rule</Button>
            </>}
            {id==='manual'&&<>
              {state.listProgress.map(rule=><div key={rule.id}>{ruleRow(rule.name,openSaved({kind:'manual',rule}),rule.enabled?'Active':'Paused',undefined,'Save & edit')}</div>)}
              <Button variant="ghost" disabled={busy} onClick={openSaved({kind:'manual'})}>Save & add problem links</Button>
            </>}
          </div>
        </section>)}
        {custom&&available.length>0&&<Field label="Add a source">
          <select value="" onChange={e=>{
            const id=sources.find(source=>source.id===e.target.value)?.id;
            if(!id)return;
            setVisible(current=>[...current,id]);setExpanded(id);setWeight(id,10);
          }}>
            <option value="">Choose a source</option>{available.map(({id,label})=><option key={id} value={id}>{label}</option>)}
          </select>
        </Field>}
        {custom&&<RuleDetails label="Advanced queue settings">
          <Field label="Maximum Codeforces upsolve problems" hint="Applies across all upsolve rules in the 100-problem queue.">
            <input type="number" min="0" max="100" value={draft.upsolveCap} onChange={e=>setDraft(current=>({...current,upsolveCap:Number(e.target.value)}))}/>
          </Field>
        </RuleDetails>}
        {previewError?<Notice type="error">{previewError}</Notice>:<div className="preview" aria-live="polite">
          <strong>{!preview?'Updating queue preview…':preview.nextQueue.length?'Next '+preview.nextQueue.length+' problems':'No matching problems in the queue'}</strong>
          {preview&&preview.nextQueue.length>0&&<>
            <div className="legend">{sources.map(({id,label})=>{
              const count=preview.nextQueue.filter(({lane})=>sourceByLane.get(lane)?.id===id).length;
              return count>0&&<span key={id}>{label} {count}</span>;
            })}</div>
            <details className="mix-preview"><summary>Show problems</summary><ol>
              {preview.nextQueue.map(problem=><li key={problem.key}>{problem.title} <small>· {sourceByLane.get(problem.lane)?.label}</small></li>)}
            </ol></details>
          </>}
        </div>}
      </div><div className="dialog-actions"><Button onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="main" disabled={busy}>{busy?'Saving…':'Save changes'}</Button>
      </div></form>
    </Modal>
    {editor&&(editor==='new-timus'||editor.startsWith('timus:')
      ? <TimusRuleEditor key={editor} state={{...state,settings:draft}} rule={draft.timusRules.find(rule=>'timus:'+rule.id===editor)}
          request={request} save={setRuleDraft} saveLabel="Apply to mix" close={()=>setEditor(null)} busy={false} canRefresh={false} refresh={()=>{}}/>
      : <RuleEditor key={editor} view={editor} state={{...state,settings:draft}} request={request} save={setRuleDraft}
          saveLabel="Apply to mix" close={()=>setEditor(null)}/>)}
  </>;
}
