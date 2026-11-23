import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { AccountGate } from './auth';
import { Activity, CircleHelp, Command, Database, ListFilter, Settings2, Target, TrendingUp, Users } from 'lucide-react';
import { Button, Empty, Notice } from './ui';
import { Queue } from './queue';
import { ListEditor, RuleEditor, Rules, Templates } from './rules';
import { PracticeMix } from './practice-mix';
import { StatsPage } from './stats';
import { SocialPage, socialInviteHash } from './social';
import { VirtualPage } from './virtual';
import { ColorEditor, Connections, LinkEditor, SolveEditor } from './dialogs';
import { CsesImporter } from './cses-importer';
import { GuideBrowser, GuideImporter, GuideRuleEditor } from './guide';
import { TimusRuleEditor } from './timus';
import { csesImportHash } from './cses-import.js';
import type { GuideData, GuideRule, ManualList, Problem, Settings, State, Sync, TimusRule, VirtualImportStatus } from './types';
import './style.css';

const screens=['Problemset','Rules','Virtual','Stats','Social'] as const;
type Screen=typeof screens[number]|'USACO Guide';
type Profile='demo'|'local';
type Overlay={type:'connections'|'links'|'colors'|'templates'|'guide-import'}|{type:'import';bookmark?:string}|{type:'rule';id:string}|{type:'list';list?:ManualList;cses?:boolean}|{type:'solve';problem:Problem}|{type:'guide-rule';rule?:GuideRule}|{type:'timus-rule';rule?:TimusRule};
const guideHash='#usaco-guide';
const guideRuleFromHash=()=>window.location.hash.startsWith(guideHash+'/') ? window.location.hash.slice(guideHash.length+1) : '';
const socialInviteFromHash=()=>window.location.hash.startsWith(socialInviteHash) ? window.location.hash.slice(socialInviteHash.length) : '';
const fromHash=():Screen=>{
  if(window.location.hash.startsWith(socialInviteHash))return 'Social';
  if(window.location.hash===guideHash||guideRuleFromHash())return 'USACO Guide';
  return screens.find(s=>'#'+s.toLowerCase()===window.location.hash)??'Problemset';
};

function App({client,session}:{client:SupabaseClient;session:Session}) {
  const account = session.user.id;
  const modeKey = 'ut-profile-'+account;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [screen,setScreen]=useState<Screen>(fromHash);
  const [inviteCode,setInviteCode]=useState(socialInviteFromHash);
  const [profile,setProfile]=useState<Profile>(()=>fromHash()==='Social'||window.location.hash.startsWith(csesImportHash)||localStorage.getItem(modeKey)!=='demo'?'local':'demo');
  const [state,setState]=useState<State|null>(null);
  const [overlay,setOverlay]=useState<Overlay|null>(null);
  const [guideData,setGuideData]=useState<GuideData|null>(null);
  const [guideRuleId,setGuideRuleId]=useState(guideRuleFromHash);
  const [guideError,setGuideError]=useState('');
  const [guideRevision,setGuideRevision]=useState(0);
  const [resumeList,setResumeList]=useState<string|null>(null);
  const [judgeSyncing,setSyncing]=useState(false);
  const [virtualImport,setVirtualImport]=useState<VirtualImportStatus|null>(null);
  const importingVirtual=virtualImport?.running ?? false;
  const syncing=judgeSyncing || importingVirtual;
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [menu,setMenu]=useState(false);
  const [queueTrackingError,setQueueTrackingError]=useState('');
  const activeProfile=useRef(profile);
  const pendingCses=useRef('');
  const personalLoaded=useRef(false);
  const preferenceScope=account+'-'+profile;
  const signOut=async()=>{
    const {error}=await client.auth.signOut({scope:'local'});
    if(error)setError(error.message);
  };
  const request=useCallback(async<T,>(endpoint:string, payload?:unknown):Promise<T>=>{
    const {data:{session},error}=await client.auth.getSession();
    if(error || !session || session.user.id!==account) throw new Error('Sign in to Unified Training to continue.');
    const headers:Record<string,string>={Authorization:'Bearer '+session.access_token,'X-Training-Timezone':timezone};
    if(payload!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(endpoint+'?profile='+(profile==='local'?'personal':'demo'),payload===undefined
      ? {headers}
      : {method:'POST',headers,body:JSON.stringify(payload)});
    const value=await response.json();
    if(response.status===401){
      const latest=(await client.auth.getSession()).data.session;
      if(latest?.access_token===session.access_token)await client.auth.signOut({scope:'local'});
    }
    if(!response.ok)throw new Error(value.error??'The request failed.');
    return value as T;
  },[account,client,profile,timezone]);
  const showGuide=screen==='USACO Guide'||overlay?.type==='guide-rule';
  useEffect(()=>{
    if(!showGuide)return;
    let current=true;
    setGuideError('');
    void request<GuideData>('/api/guide').then(data=>{if(current)setGuideData(data);})
      .catch(e=>{if(current)setGuideError(e.message);});
    return()=>{current=false;};
  },[showGuide,request,guideRevision]);
  useEffect(()=>{
    let current=true;
    setError('');
    void request<State>('/api/state').then(s=>{
      if(!current)return;
      setState(s);
      personalLoaded.current=profile==='local';
      if(profile==='local' && pendingCses.current && window.location.hash===pendingCses.current) {
        history.replaceState(history.state,'','#problemset');
        pendingCses.current='';
      }
    }).catch(err=>{if(current)setError(err.message);});
    return()=>{current=false;};
  },[request,profile]);
  useEffect(()=>{
    if(screen!=='Problemset'||profile!=='local'||!state||state.engineError)return;
    let current=true;
    setQueueTrackingError('');
    void request('/api/social/queue',{}).catch(()=>{
      if(current)setQueueTrackingError('Could not record this queue for your group’s grind progress.');
    });
    return()=>{current=false;};
  },[screen,profile,state,request]);
  useEffect(()=>{
    if(profile!=='local')return;
    let active=true;
    let timer:number;
    const check=async()=>{
      try {
        const status=await request<VirtualImportStatus>('/api/virtual/codeforces');
        if(!active)return;
        if(importingVirtual && !status.running && !status.error) {
          const next=await request<State>('/api/state');
          if(!active)return;
          setState(next);
        }
        setVirtualImport(status);
        if(status.running)timer=window.setTimeout(check,2000);
      } catch {
        if(active && importingVirtual)timer=window.setTimeout(check,3000);
      }
    };
    if(importingVirtual)timer=window.setTimeout(check,1000);
    else void check();
    return()=>{active=false;window.clearTimeout(timer);};
  },[profile,request,importingVirtual]);
  useEffect(()=>{if(!message)return;const t=window.setTimeout(()=>setMessage(''),4200);return()=>window.clearTimeout(t);},[message]);
  const [importFromConnections,setImportFromConnections]=useState(false);
  const close=()=>{
    setOverlay(importFromConnections?{type:'connections'}:null);
    setImportFromConnections(false);
  };
  const changeProfile=useCallback((next:Profile)=>{
    if(next===activeProfile.current){setMenu(false);return;}
    activeProfile.current=next;
    personalLoaded.current=false;
    setProfile(next); setState(null); setGuideData(null); setGuideError(''); setSyncing(false); setVirtualImport(null); setError('');setMessage('');setMenu(false);setResumeList(null);
    setOverlay(null); setLogged(null);setImportFromConnections(false);
    localStorage.setItem(modeKey,next);
  },[modeKey]);
  useEffect(()=>{
    const handler=()=>{
      const hash=window.location.hash;
      if(fromHash()==='Social')changeProfile('local');
      if(hash.startsWith(csesImportHash)) {
        changeProfile('local');
        setOverlay({type:'import',bookmark:hash});
        if(personalLoaded.current){
          history.replaceState(history.state,'','#problemset');
        } else pendingCses.current=hash;
      }
      setScreen(fromHash());
      setInviteCode(socialInviteFromHash());
      setGuideRuleId(guideRuleFromHash());
    };
    handler();
    window.addEventListener('hashchange',handler);
    return()=>window.removeEventListener('hashchange',handler);
  },[changeProfile]);
  const save=async(settings:Settings)=>{
    try{
      const next=await request<State>('/api/settings',settings);
      if(activeProfile.current===profile){
        if(next.settings.handles.Codeforces.toLowerCase()!==state?.settings.handles.Codeforces.toLowerCase())setVirtualImport(null);
        setState(next);setMessage('Settings saved.');
      }
    }
    catch(e){if(activeProfile.current===profile)setError((e as Error).message);throw e;}
  };
  const refresh=async(judge?:string)=>{
    setSyncing(true);setError('');
    try{
      let response=await request<{results:Record<string,Sync>}>('/api/sync',{judge});
      let next=await request<State>('/api/state');
      if(activeProfile.current!==profile)return;
      setState(next);
      while((!judge||judge==='Timus')&&response.results.Timus?.backfill&&!response.results.Timus.error) {
        setMessage('Syncing older Timus submissions…');
        response=await request<{results:Record<string,Sync>}>('/api/sync',{judge:'Timus'});
        next=await request<State>('/api/state');
        if(activeProfile.current!==profile)return;
        setState(next);
      }
      if(Object.values(response.results).some(s=>s.error))setMessage('Refresh finished with a judge error.');
      else setMessage(profile==='demo'?'Demo results are current.':'Judge progress refreshed.');
    }catch(e){if(activeProfile.current===profile)setError((e as Error).message);}
    finally{if(activeProfile.current===profile)setSyncing(false);}
  };
  const [logged,setLogged]=useState<Problem|null>(null);
  const writingSolve=useRef(false);
  const [savingProgress,setSavingProgress]=useState(false);
  const saveProgress=async(problem:Problem,active:boolean)=>{
    if(syncing || savingProgress || writingSolve.current)return;
    setSavingProgress(true);
    setError('');
    try {
      const next=await request<State>('/api/in-progress',{key:problem.key,active});
      if(activeProfile.current===profile)setState(next);
    } catch(e) {
      if(activeProfile.current===profile)setError((e as Error).message);
    } finally {
      setSavingProgress(false);
    }
  };
  const writeManual=async(problem:Problem,remove=false)=>{
    if(!state || writingSolve.current)return;
    writingSolve.current=true;
    try{
      const next=await request<State>('/api/solves',{key:problem.key,day:state.today,remove});
      if(activeProfile.current!==profile)return;
      setState(next);
      setLogged(remove?null:{...problem,solve:{source:'manual',day:state.today}});
      setMessage(remove?'Solve removed.':'');
    }catch(e){if(activeProfile.current===profile)setError((e as Error).message);}
    finally{writingSolve.current=false;}
  };
  const mark=(p:Problem,listId?:string)=>{
    if(!listId&&!p.solve&&!p.key.startsWith('ac:')){void writeManual(p);return;}
    setResumeList(listId??null);setOverlay({type:'solve',problem:p});
  };
  const importVirtual=async()=>{
    setError('');setSyncing(true);
    try {
      const status=await request<VirtualImportStatus>('/api/virtual/codeforces',{});
      if(activeProfile.current===profile)setVirtualImport(status);
    } catch(e) {
      if(activeProfile.current===profile)setError((e as Error).message);
    } finally {
      if(activeProfile.current===profile)setSyncing(false);
    }
  };
  const importGuide=()=>{if(profile==='demo')changeProfile('local');setOverlay({type:'guide-import'});};
  const finishSolve=(next?:State)=>{
    if(next){
      const pending=overlay?.type==='solve'&&next.pendingAtCoder.some(p=>p.key===overlay.problem.key);
      setState(next);setMessage(pending?'Claim saved. Awaiting AtCoder confirmation.':'Solve history updated.');
    }
    const list=(next??state)?.listProgress.find(l=>l.id===resumeList);
    setOverlay(list?{type:'list',list}:null);
    setResumeList(null);
  };
  const chooseRule=(id:string)=>{
    if(id==='manual')setOverlay({type:'links'});
    else if(id==='cses-list')setOverlay({type:'list',cses:true});
    else if(id==='guide')setOverlay({type:'guide-rule'});
    else if(id==='new-timus'||id.startsWith('timus:'))setOverlay({type:'timus-rule',rule:state?.settings.timusRules.find(r=>'timus:'+r.id===id)});
    else setOverlay({type:'rule',id});
  };
  const runEnglish=async()=>{
    setSyncing(true);
    try{const res=await request<{checked:number}>('/api/english',{});setState(await request<State>('/api/state'));setMessage(res.checked?res.checked+' statements checked.':'No additional statement results were available.');}
    catch(e){setError((e as Error).message);}
    finally{setSyncing(false);}
  };
  const guideRule=state?.guideRules.find(rule=>rule.id===guideRuleId);
  return <>
    <a className="skip" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById('main-content')?.focus();}}>Skip to content</a>
    <header className="site-header"><div className="container header-content">
      <a className="brand" href="#problemset" aria-label="Unified Training home"><span className="brand-icon"><TrendingUp size={20} strokeWidth={2.1}/></span>Unified Training</a>
      <nav aria-label="Main navigation">{screens.map((s,i)=>{const Icon=[ListFilter,Settings2,Target,Activity,Users][i];return <a key={s} href={'#'+s.toLowerCase()} aria-current={s===screen||s==='Rules'&&screen==='USACO Guide'?'page':undefined}><Icon size={15}/>{s}</a>;})}</nav>
      <div className="profile-controls"><Button onClick={()=>{setMenu(false);setOverlay({type:'connections'});}} variant="ghost" className="connections-button" aria-label="Connections"><Settings2 size={15}/><span>Connections</span></Button>
        <div className="profile-menu"><Button className="profile-button" onClick={()=>setMenu(!menu)} aria-expanded={menu} aria-label="Switch profile"><span className="profile-dot"/>{profile==='demo'?'Demo':'Personal profile'}</Button>
          {menu&&<div className="menu-popover"><button onClick={()=>changeProfile('demo')}>Demo profile</button><button onClick={()=>changeProfile('local')}>My personal profile</button><button onClick={()=>void signOut()}>Sign out</button></div>}</div>
      </div>
    </div></header>
    <main className="container main" id="main-content" tabIndex={-1}>
      {error&&<Notice type="error">{error} <button className="text-button" onClick={()=>setError('')}>Dismiss</button></Notice>}
      {state?.engineError&&<Notice type="error">{state.engineError}</Notice>}
      {screen==='Problemset'&&profile==='local'&&queueTrackingError&&<Notice type="error">{queueTrackingError} <button className="text-button" onClick={()=>void request<State>('/api/state').then(setState).catch(cause=>setError(cause.message))}>Retry</button></Notice>}
      {screen==='Social'?(profile==='local'?<SocialPage request={request} inviteCode={inviteCode}/>
        :<div className="card"><Empty title="Social is available in your personal profile" description="Switch profiles to see your groups and friends."
          action={<Button onClick={()=>changeProfile('local')}>Switch to my personal profile</Button>}/></div>):state ? <>
        {profile==='demo'&&<Notice>Demo changes are disabled. <button className="text-button" onClick={()=>changeProfile('local')}>Switch to my personal profile</button></Notice>}
        {screen==='Problemset'&&<Queue key={profile} state={state} profile={preferenceScope} demo={profile==='demo'} busy={syncing} savingProgress={savingProgress} request={request} onRefresh={j=>void refresh(j)} onLinks={()=>setOverlay({type:'links'})} onSolve={mark} onProgress={saveProgress} onSettings={()=>setOverlay({type:'connections'})}/>}
        {screen==='USACO Guide'&&(guideData
          ?<GuideBrowser key={profile+guideRuleId} data={guideData} state={state} rule={guideRule} onImport={importGuide} onSolve={mark}/>
          :<div className="card"><Empty title={guideError?'USACO Guide unavailable':'Loading USACO Guide'} description={guideError||'Getting the Guide catalog ready.'} action={guideError?<Button onClick={()=>setGuideRevision(value=>value+1)}>Retry</Button>:undefined}/></div>)}
        {screen==='Rules'&&<><Rules state={state} onAddRule={()=>setOverlay({type:'templates'})} onOpen={chooseRule} onList={list=>setOverlay({type:'list',list})} onGuideRule={rule=>setOverlay({type:'guide-rule',rule})} onImport={()=>setOverlay({type:'import'})} save={save}/>
          {state.ruleOptions.some(r=>r.pending>0)&&<Notice>{state.ruleOptions.reduce((n,r)=>n+r.pending,0)} AtCoder problems await an English statement check. <button className="text-button" disabled={syncing} onClick={()=>void runEnglish()}>{syncing?'Checking…':'Check more'}</button></Notice>}</>}
        {screen==='Stats'&&<StatsPage key={profile} profile={preferenceScope} state={state} onColors={()=>setOverlay({type:'colors'})} onSolve={mark}/>}
        {screen==='Virtual'&&<VirtualPage key={profile} state={state} save={save} syncing={syncing} demo={profile==='demo'} onSetup={()=>{changeProfile('local');setOverlay({type:'connections'});}} status={virtualImport} importHistory={importVirtual}
          request={request} updateState={next=>{if(activeProfile.current===profile)setState(next);}}/>}
      </>:<div className="card"><Empty title={error?'Training data unavailable':'Loading Unified Training'} description={error?'Check that the local server is running.':'Getting your profile ready.'} action={error?<Button onClick={()=>window.location.reload()}>Retry</Button>:undefined}/></div>}
    </main>
    <footer className="container site-footer"><span><Command size={14}/>Unified Training</span><span><Database size={13}/>{state?.engine??'Bend 2'} engine</span><span><CircleHelp size={13}/>Activity uses local time</span></footer>
    {logged&&<div className="toast solve-feedback" role="status"><span>Logged {logged.title}</span><Button onClick={()=>void writeManual(logged,true)}>Undo</Button><Button onClick={()=>{mark(logged);setLogged(null);}}>Edit date</Button><Button aria-label="Dismiss solve notification" onClick={()=>setLogged(null)}>×</Button></div>}
    {message&&!logged&&<div className="toast" role="status">{message}</div>}
    {state&&(overlay?.type==='connections'||importFromConnections)&&<Connections key={profile} state={state} close={close} save={save} busy={syncing} demo={profile==='demo'}
      request={request} onVerified={(judge,verification)=>{
        if(activeProfile.current===profile)setState(current=>current&&'handle' in verification&&current.settings.handles[judge].toLowerCase()===verification.handle
          ? {...current,verifications:{...current.verifications,[judge]:verification}} : current);
      }} refresh={j=>void refresh(j)} onImport={()=>{setImportFromConnections(true);setOverlay({type:'import'});}} onGuideImport={()=>{importGuide();setImportFromConnections(true);}}/>}
    {state&&overlay?.type==='links'&&<LinkEditor profile={preferenceScope} state={state} request={request} done={next=>{setState(next);setMessage('Links added to the list.');}} close={close}/>}
    {state&&overlay?.type==='colors'&&<ColorEditor state={state} save={save} close={close}/>}
    {state&&overlay?.type==='templates'&&<Templates close={close} select={chooseRule}/>}
    {state&&overlay?.type==='rule'&&(overlay.id==='allocation'
      ? <PracticeMix state={state} request={request} save={save} close={close} editSavedRule={entry=>{
          if(entry.kind==='guide')setOverlay({type:'guide-rule',rule:entry.rule});
          else setOverlay(entry.rule?{type:'list',list:entry.rule}:{type:'links'});
        }}/>
      : <RuleEditor key={overlay.id} view={overlay.id} state={state} request={request} save={save} close={close}/>)}
    {state&&overlay?.type==='timus-rule'&&<TimusRuleEditor state={state} rule={overlay.rule} request={request} save={save} close={close}
      busy={syncing} canRefresh={profile==='local'} refresh={()=>void refresh('Timus')}/>}
    {state&&overlay?.type==='list'&&<ListEditor state={state} list={overlay.list} startCses={overlay.cses} request={request} done={setState} close={close} onSolve={p=>mark(p,overlay.list?.id)}/>}
    {state&&overlay?.type==='import'&&<CsesImporter key={overlay.bookmark??'file'} bookmark={overlay.bookmark} profile={profile}
      request={request} done={next=>{setState(next);setMessage('CSES progress imported.');}} close={close}/>}
    {state&&overlay?.type==='guide-import'&&<GuideImporter request={request} close={close}
      done={next=>{setState(next);setMessage('USACO Guide progress imported.');setGuideRevision(value=>value+1);close();}}/>}
    {state&&overlay?.type==='guide-rule'&&<GuideRuleEditor data={guideData} loadError={guideError} onRetry={()=>setGuideRevision(value=>value+1)}
      rule={overlay.rule} queueMode={state.settings.queueMode} request={request} close={close}
      done={next=>{setState(next);setMessage('USACO Guide rules updated.');close();}}/>}
    {state&&overlay?.type==='solve'&&<SolveEditor problem={overlay.problem} atcoderHandle={state.settings.handles.AtCoder} today={state.today} request={request} done={finishSolve} close={()=>finishSolve()}/>}
  </>;
}

createRoot(document.getElementById('root')!).render(<AccountGate>{(client,session)=><App key={session.user.id} client={client} session={session}/>}</AccountGate>);
