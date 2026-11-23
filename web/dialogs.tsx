import { useEffect, useState, type FormEvent } from 'react';
import { Check, Upload, Link2, RefreshCw, ExternalLink } from 'lucide-react';
import { Button, Field, JudgeLabel, Modal, Notice } from './ui';
import { judges, type ConnectionJudge, type Judge, type LinkRow, type Problem, type Settings, type State, type Verification } from './types';
import type { Requester } from './rules';
import { normalizeTimusAuthor, timusOrigin } from '../shared/timus.js';

const verificationPath='/api/connections/verification/';
const compilationErrorSnippet='#error Unified Training account verification\nint main() {}';

function VerifyHandle({judge,handle,verification,disabled,zone,request,onVerified}:{judge:ConnectionJudge;handle:string;verification:Verification;disabled:boolean;zone:string;request:Requester;onVerified:(judge:ConnectionJudge,value:Verification)=>void}) {
  const [now,setNow]=useState(Date.now);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState('');
  const [failed,setFailed]=useState(false);
  const expiresAt=verification.status==='pending'?verification.expiresAt:null;
  useEffect(()=>{
    if(expiresAt===null) return;
    const timeout=window.setTimeout(()=>setNow(Date.now()),Math.max(0,expiresAt-Date.now()));
    return ()=>window.clearTimeout(timeout);
  },[expiresAt]);
  const expired=verification.status==='expired'||expiresAt!==null&&expiresAt<=now;
  const run=async(action:'start'|'check')=>{
    setWorking(true);setMessage('');setFailed(false);
    try{
      const details=action==='check'&&verification.status==='pending'?{challengeId:verification.challengeId}:{handle};
      const result=await request<{verification:Verification;message?:string}>(verificationPath+action,{judge,...details});
      setNow(Date.now());
      onVerified(judge,result.verification);
      if(result.verification.status==='verified'&&judge==='AtCoder')setMessage('Ownership verified. You can restore your original affiliation on AtCoder.');
      else if(result.verification.status==='verified'&&judge==='Timus')setMessage('Ownership verified. You can restore your original Motto on Timus.');
      else setMessage(result.message??'');
    }catch(e){setFailed(true);setMessage((e as Error).message);}finally{setWorking(false);}
  };
  if(!handle)return null;
  if(verification.status==='verified') return <div className="form-stack verification-panel">
    <div><strong>Verified</strong> <span className="secondary">· {new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:zone}).format(verification.verifiedAt)}</span></div>
    {message&&<Notice type="ok">{message}</Notice>}
  </div>;
  return <div className="form-stack verification-panel">
    {verification.status==='pending'&&!expired ? <>
      <div><strong>Verification in progress</strong> <span className="secondary">· Expires at {new Intl.DateTimeFormat(undefined,{timeStyle:'short',timeZone:zone}).format(verification.expiresAt)}</span></div>
      {'code' in verification ? <>
        {judge==='Timus'
          ? <p>Keep a copy of your current Motto. Open <a href={timusOrigin+'/authedit.aspx?locale=en'} target="_blank" rel="noreferrer">Timus’s Update your info page</a>, replace your Motto with the code below, and save.</p>
          : <p>Keep a copy of your current affiliation. In <a href="https://atcoder.jp/settings?lang=en" target="_blank" rel="noreferrer">AtCoder Settings</a>, replace it with the code below and save.</p>}
        <Field label="Verification code"><input className="mono" readOnly value={verification.code} onFocus={e=>e.currentTarget.select()}/></Field>
      </> : <>
        <p>Open <a href={`https://codeforces.com/problemset/problem/${verification.problem.contest}/${verification.problem.task}`} target="_blank" rel="noreferrer">Codeforces {verification.problem.contest}{verification.problem.task}</a> and submit this C++ snippet in practice mode. Click below once Codeforces shows a compilation error.</p>
        <Field label="C++ snippet"><textarea className="mono" rows={2} readOnly value={compilationErrorSnippet} onFocus={e=>e.currentTarget.select()}/></Field>
      </>}
      <div className="button-wrap"><Button variant="main" disabled={disabled||working} onClick={()=>void run('check')}>{working?'Working…':'Check verification'}</Button>
        <Button disabled={disabled||working} onClick={()=>void run('start')}>Start a new challenge</Button></div>
    </> : <div className="button-wrap verification-actions">
      <span className="secondary">{expired?'Verification expired':'Unverified'}</span>
      <Button disabled={disabled||working} onClick={()=>void run('start')}>{working?'Starting…':expired?'Start a new challenge':'Verify ownership'}</Button>
    </div>}
    {message&&<Notice type={failed?'error':'info'}>{message}</Notice>}
  </div>;
}

export function Connections({state,close,save,refresh,busy,onImport,onGuideImport,demo,request,onVerified}:{state:State;close:()=>void;save:(s:Settings)=>Promise<void>;refresh:(judge?:string)=>void;busy:boolean;onImport:()=>void;onGuideImport:()=>void;demo:boolean;request:Requester;onVerified:(judge:ConnectionJudge,value:Verification)=>void}) {
  const [draft,setDraft]=useState(()=>structuredClone(state.settings));
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  const submit=async(e:FormEvent)=>{e.preventDefault();setPending(true);setError('');try{await save(draft);setDraft({...draft,handles:{AtCoder:draft.handles.AtCoder.trim(),Codeforces:draft.handles.Codeforces.trim(),Timus:normalizeTimusAuthor(draft.handles.Timus)??''}});}catch(e){setError((e as Error).message);}finally{setPending(false);}};
  const change=(j:ConnectionJudge,handle:string)=>setDraft({...draft,handles:{...draft.handles,[j]:handle}});
  const timus=state.sync.Timus;
  const author=state.settings.handles.Timus;
  const timusSaved=(normalizeTimusAuthor(draft.handles.Timus)??(draft.handles.Timus.trim()?'invalid':''))===author;
  return <Modal title="Connections" description="Connect judge handles and import your progress." close={close}>
    <form onSubmit={submit}><div className="dialog-body form-stack">
      {error&&<Notice type="error">{error}</Notice>}
      {(['AtCoder','Codeforces'] as const).map(j=><div className="connect-row" key={j}><Field label={j+' handle'} hint={state.sync[j]?.lastSuccess?'Last refreshed '+new Date(state.sync[j].lastSuccess!).toLocaleDateString():state.settings.handles[j]?'Ready to refresh':'Optional'}>
        <input value={draft.handles[j]} placeholder="Public handle" onChange={e=>change(j,e.target.value)}/></Field>
        <Button disabled={busy||(j==='AtCoder'&&!state.settings.handles[j])||draft.handles[j]!==state.settings.handles[j]} onClick={()=>refresh(j)}>
          <RefreshCw size={15}/>{state.settings.handles[j]?'Sync':'Refresh catalog'}
        </Button>
        {!demo&&draft.handles[j]===state.settings.handles[j]&&<VerifyHandle key={state.settings.handles[j].toLowerCase()} judge={j} handle={state.settings.handles[j]}
          verification={state.verifications[j]} zone={state.settings.zone} disabled={pending} request={request} onVerified={onVerified}/>}
        {state.sync[j]?.error&&<Notice type="error">{state.sync[j].error}</Notice>}
        {state.sync[j]?.ratingNotice&&<Notice>{state.sync[j].ratingNotice} You can set a training rating in Virtual.</Notice>}
      </div>)}
      <div className="connect-row">
        <Field label="Timus author ID or profile URL" hint={timus?.historyAt?'Last refreshed '+new Date(timus.historyAt).toLocaleDateString():'Optional'}>
          <input value={draft.handles.Timus} placeholder={timusOrigin+'/author.aspx?id=12345'} onChange={e=>change('Timus',e.target.value)}/>
        </Field>
        <Button disabled={demo||pending||busy||!timusSaved} onClick={()=>refresh('Timus')}><RefreshCw size={15}/>{author?(timus?.backfill?'Continue history sync':'Sync'):'Refresh catalog'}</Button>
        {author&&timusSaved&&<div className="form-stack verification-panel">
          <a className="problem-link" href={timusOrigin+'/author.aspx?id='+author} target="_blank" rel="noreferrer">{timus?.authorName||'View Timus profile'} <ExternalLink size={13}/></a>
          <a className="problem-link" href={timusOrigin+'/status.aspx?author='+author} target="_blank" rel="noreferrer">View submission history <ExternalLink size={13}/></a>
        </div>}
        {!demo&&author&&timusSaved&&<VerifyHandle key={author} judge="Timus" handle={author} verification={state.verifications.Timus}
          zone={state.settings.zone} disabled={pending} request={request} onVerified={onVerified}/>}
        {timus?.backfill&&<Notice>{busy?'Syncing older submissions…':'Continue syncing to load older submissions.'}</Notice>}
        {timus?.error&&<Notice type="error">{timus.error}</Notice>}
      </div>
      <div className="connect-row"><div><strong>CSES</strong><p className="secondary">Import solves from a saved page or browser bookmark</p></div><Button disabled={busy} onClick={()=>refresh('CSES')}>Refresh catalog</Button><Button onClick={onImport}><Upload size={15}/>Import progress</Button></div>
      <div className="connect-row"><div><strong>USACO Guide</strong><p className="secondary">Bring over problem and module progress from your Guide export</p></div><Button onClick={onGuideImport}><Upload size={15}/>Import Guide progress</Button></div>
      <Field label="Timezone"><input required value={draft.zone} onChange={e=>setDraft({...draft,zone:e.target.value})}/></Field>
    </div><div className="dialog-actions"><Button onClick={close}>Close</Button><Button variant="main" type="submit" disabled={pending||busy}>{pending?'Saving…':'Save connections'}</Button></div></form>
  </Modal>;
}
export function ColorEditor({state,save,close}:{state:State;save:(s:Settings)=>Promise<void>;close:()=>void}) {
  const [colors,setColors]=useState(state.settings.colors);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const change=(j:Judge,value:string)=>setColors({...colors,[j]:value});
  return <Modal title="Judge colors" description="Colors are used in the heatmap and judge breakdowns." close={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await save({...state.settings,colors});close();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
    <div className="dialog-body form-stack">{error&&<Notice type="error">{error}</Notice>}{judges.map(j=><label className="connect-row" key={j}><JudgeLabel name={j} colors={colors}/><input aria-label={j+' color'} type="color" value={colors[j]} onChange={e=>change(j,e.target.value)}/><span className="mono secondary">{colors[j]}</span></label>)}</div>
    <div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button variant="main" type="submit" disabled={busy}>Save colors</Button></div>
  </form></Modal>;
}

export function LinkEditor({profile,state,request,done,close}:{profile:string;state:State;request:Requester;done:(s:State)=>void;close:()=>void}) {
  const [links,setLinks]=useState('');
  const [preview,setPreview]=useState<LinkRow[]|null>(null);
  const preferred=localStorage.getItem('ut-last-list-'+profile);
  const initialList=state.listProgress.find(list=>list.id===preferred) ?? state.listProgress.find(list=>list.name==='Inbox');
  const [listId,setListId]=useState(initialList?.id??'');
  const [name,setName]=useState('Inbox');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const existing=state.listProgress.find(l=>l.id===listId);
  const valid=preview?.filter(entry=>entry.problem)??[];
  const single=!!links.trim()&&!/\s/.test(links.trim());
  const run=async(e:FormEvent,reviewOnly=false)=>{
    e.preventDefault();setBusy(true);setError('');
    try{
      const rows=preview??await request<LinkRow[]>('/api/links/preview',{links});
      if(!preview&&(reviewOnly||!single||!rows[0]?.problem)){setPreview(rows);return;}
      const next=await request<State>('/api/lists',{id:existing?.id,name:existing?.name??name,enabled:existing?.enabled??true,keys:existing?.keys??[],links:rows.filter(row=>row.problem).map(r=>({url:r.problem!.url,title:r.problem!.title}))});
      const destination=existing??next.listProgress.find(list=>!state.listProgress.some(old=>old.id===list.id));
      if(destination)localStorage.setItem('ut-last-list-'+profile,destination.id);
      done(next);close();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <Modal title="Add problem links" description="Save links from QOJ, Codeforces Gym, and other judges." close={close}><form onSubmit={run}>
    <div className="dialog-body form-stack">{error&&<Notice type="error">{error}</Notice>}
      {!preview?<Field label="Problem URLs" hint="Paste one or several links separated by spaces or new lines."><textarea autoFocus rows={5} required placeholder={'https://codeforces.com/gym/101480/problem/A\nhttps://qoj.ac/problem/2'} value={links} onChange={e=>setLinks(e.target.value)}/></Field>:<>
        <div className="preview"><strong>{valid.length} {valid.length===1?'link':'links'} ready</strong>{preview.map((row,i)=>row.problem?<div className="link-preview" key={row.input}><JudgeLabel name={row.problem.judge} colors={state.settings.colors}/><input aria-label={'Title for '+row.input} value={row.problem.title} onChange={e=>setPreview(preview.map((p,k)=>i===k?{...p,problem:{...row.problem!,title:e.target.value}}:p))}/><a aria-label="Open link" href={row.problem.url} target="_blank" rel="noreferrer"><ExternalLink size={15}/></a></div>:<p key={i} className="error-copy">{row.input} · {row.error}</p>)}</div>
        <Field label="Save to"><select value={listId} onChange={e=>setListId(e.target.value)}><option value="">Create a new list</option>{state.listProgress.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        {!existing&&<Field label="New list name"><input required maxLength={90} placeholder="e.g. Gym upsolves" value={name} onChange={e=>setName(e.target.value)}/></Field>}
      </>}
    </div><div className="dialog-actions"><Button onClick={preview?()=>setPreview(null):close}>{preview?'Back':'Cancel'}</Button>{single&&!preview&&<Button disabled={busy} onClick={e=>void run(e,true)}>Review or change list</Button>}<Button variant="main" disabled={busy||!!preview&&!valid.length} type="submit"><Link2 size={16}/>{busy?'Working…':preview?'Add to list':single?'Add to '+(existing?.name??name):'Preview links'}</Button></div>
  </form></Modal>;
}

export function SolveEditor({problem,atcoderHandle,today,request,done,close}:{problem:Problem;atcoderHandle:string;today:string;request:Requester;done:(s:State)=>void;close:()=>void}) {
  const [date,setDate]=useState(problem.solve?.day??today);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const claim=problem.key.startsWith('ac:')&&!problem.solve;
  const submissionUrl=problem.contest&&atcoderHandle ? `https://atcoder.jp/contests/${encodeURIComponent(problem.contest)}/submissions?`+new URLSearchParams({'f.Task':problem.key.slice(3),'f.User':atcoderHandle,'f.Status':'AC'}) : null;
  const save=async(remove=false)=>{
    setBusy(true);
    try{done(await request<State>('/api/solves',{key:problem.key,day:date||null,remove,removeClaim:claim&&remove}));}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  if(claim) return <Modal title={problem.pendingAtCoder?'Pending AtCoder solve':'Claim AtCoder solve'} description={problem.title} close={close}>
    <div className="dialog-body form-stack">
      {error&&<Notice type="error">{error}</Notice>}
      <p className="secondary">{atcoderHandle?'The problem leaves your queue while the claim is pending. It counts as solved after a refresh finds an accepted submission.':'Save your AtCoder handle in Connections to claim this solve.'}</p>
      {submissionUrl&&<a href={submissionUrl} target="_blank" rel="noreferrer" className="problem-link">Check on AtCoder <ExternalLink size={13}/></a>}
    </div>
    <div className="dialog-actions"><Button onClick={close}>Close</Button>{problem.pendingAtCoder
      ?<Button variant="danger" disabled={busy} onClick={()=>void save(true)}>Withdraw claim</Button>
      :<Button variant="main" disabled={busy||!atcoderHandle} onClick={()=>void save()}>Claim solve</Button>}</div>
  </Modal>;
  return <Modal title={problem.solve?'Edit solve date':'Mark problem solved'} description={problem.title} close={close}><form onSubmit={e=>{e.preventDefault();void save();}}>
    <div className="dialog-body form-stack">{error&&<Notice type="error">{error}</Notice>}
      {problem.solve?.source==='synced'?<Notice type="ok">First acceptance recorded on {problem.solve.day}.</Notice>:<>
        <Field label="Solve date" hint="Leave the date blank to track completion only."><input type="date" max={today} value={date} onChange={e=>setDate(e.target.value)}/></Field>
        {problem.solve&&<Button variant="danger" onClick={()=>void save(true)} disabled={busy}>Remove manual solve</Button>}
      </>}
    </div><div className="dialog-actions"><Button onClick={close}>Close</Button>{problem.solve?.source!=='synced'&&<Button variant="main" type="submit" disabled={busy}><Check size={15}/>Save solve</Button>}</div>
  </form></Modal>;
}
