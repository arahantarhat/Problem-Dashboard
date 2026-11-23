import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Notice } from './ui';
import type { Requester } from './rules';
import type { AtCoderVirtualEntry, Settings, State } from './types';
import { RatingChart, VirtualSelectionForm } from './virtual-rating';

const contestUrl = (id:string) => 'https://atcoder.jp/contests/'+id;
const matchContest = (input:string) => input.trim().split(/[?#]/,1)[0].match(/^(?:https:\/\/atcoder\.jp\/contests\/)?((?:abc|arc|agc)\d+)(?:\/(?:virtual|tasks)?)?$/i)?.[1].toLowerCase();
const remainingTime = (seconds:number) => {
  const hours = Math.floor(seconds/3600);
  const minutes = Math.floor(seconds/60)%60;
  return (hours ? hours+':' : '')+[minutes,seconds%60].map(value=>String(value).padStart(2,'0')).join(':');
};
const signed = (value:number|null) => value===null ? '—' : value>0 ? '+'+value : String(value);
const resultDelay = 120;

type Props = {state:State;save:(settings:Settings)=>Promise<void>;request:Requester;updateState:(state:State)=>void;disabled:boolean};

export function AtCoderVirtual({state,save,request,updateState,disabled}:Props) {
  const history = state.atcoderVirtual;
  const selection = state.settings.virtualSelection.AtCoder;
  const [contest,setContest] = useState('');
  const [suggestions,setSuggestions] = useState<{id:string;day:string|null}[]|null>(null);
  const [start,setStart] = useState('');
  const [notice,setNotice] = useState('');
  const [failure,setFailure] = useState('');
  const [busy,setBusy] = useState('');
  const [now,setNow] = useState(()=>Math.floor(Date.now()/1000));
  const entries = history?.entries ?? [];
  const timed = entries.filter(entry=>entry.status==='scheduled');
  const hasTimed = timed.length>0;
  useEffect(()=>{
    if(!hasTimed)return;
    const clock=()=>setNow(Math.floor(Date.now()/1000));
    clock();
    const interval=window.setInterval(clock,1000);
    return()=>window.clearInterval(interval);
  },[hasTimed]);
  const scheduled = timed.find(entry=>entry.end>now);
  const completed = entries.filter(entry=>entry.status==='completed');
  const eligible = completed.filter(entry=>!entry.alreadyRated);
  const zone = state.settings.zone;
  const dates = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:zone});
  const times = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:zone});
  const date = (seconds:number) => dates.format(seconds*1000);
  const time = (seconds:number) => times.format(seconds*1000);
  const id = matchContest(contest);
  const startSeconds = Date.parse(start)/1000;
  const japan = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'});
  const blocked = disabled||!!busy;
  const update = async (action:string,payload:unknown) => {
    const response = await request<{state:State;imported?:number}>('/api/virtual/atcoder/'+action,payload);
    updateState(response.state);
    setNow(Math.floor(Date.now()/1000));
    if(response.imported!==undefined)setNotice(response.imported===0?'No new rated virtual contests to import.':`Imported ${response.imported} rated virtual ${response.imported===1?'contest':'contests'}.`);
  };
  const perform = async(action:string, payload:unknown|(()=>Promise<unknown>)) => {
    setNotice('');setFailure('');setBusy(action);
    try { await update(action,typeof payload==='function' ? await payload() : payload); }
    catch(error) { setFailure((error as Error).message); }
    finally { setBusy(''); }
  };
  const schedule = (event:FormEvent) => {
    event.preventDefault();
    if(id&&Number.isFinite(startSeconds))void perform('schedule',{contest:id,start:startSeconds});
  };
  const showAttempt = (entry:AtCoderVirtualEntry) => {
    const before = entry.start>now;
    const running = !before && entry.end>now;
    const waiting = !before && !running && entry.end+resultDelay>now;
    return <div key={entry.id} className="virtual-attempt form-stack">
      <div className="rating-history-head">
        <div><h3>{entry.name}</h3><p className="secondary">{time(entry.start)}–{time(entry.end)}</p></div>
        {before ? <strong className="mono">Starts in {remainingTime(entry.start-now)}</strong>
          : running ? <strong className="mono">{remainingTime(entry.end-now)} left</strong>
          : waiting ? <span className="secondary">Review available in {remainingTime(entry.end+resultDelay-now)}</span>
          : <span className="secondary">Ready for review</span>}
      </div>
      {entry.notice&&<Notice>{entry.notice}</Notice>}
      {entry.points!==undefined&&<p className="secondary">Fetched score {entry.points} · {entry.penalties ?? 0} penalties. Compare it with AtCoder before confirming.</p>}
      <div className="button-wrap">
        <a className="button plain" href={contestUrl(entry.contestId)+(before?'/virtual':running?'/tasks':'/standings/virtual')} target="_blank" rel="noreferrer">
          {before?'AtCoder virtual setup':running?'Open contest tasks':'View AtCoder virtual standings'}
        </a>
        {(before||running) && <Button variant="ghost" disabled={blocked} onClick={()=>void perform('cancel',{id:entry.id})}>Cancel tracking</Button>}
        {!before&&!running&&<>
          <Button disabled={blocked||waiting} onClick={()=>void perform('review',{id:entry.id})}>{busy==='review'?'Fetching…':entry.points===undefined?'Review result':'Refresh score'}</Button>
          {entry.scoreKey&&<Button variant="main" disabled={blocked||waiting} onClick={()=>void perform('confirm',{id:entry.id,scoreKey:entry.scoreKey})}>
            {busy==='confirm'?'Estimating…':'Confirm score and rate'}
          </Button>}
        </>}
      </div>
    </div>;
  };

  return <section className="card rating-card form-stack" aria-labelledby="atcoder-history">
    <div className="rating-history-head">
      <h2 id="atcoder-history">AtCoder</h2>
      {history&&<Button disabled={blocked} onClick={()=>void perform('history',{})}>
        {busy==='history'?'Loading…':history.hasOfficialHistory?'Refresh official history':'Load official history'}
      </Button>}
    </div>
    {history&&<>
      {timed.map(showAttempt)}
      {!scheduled&&<form className="form-stack virtual-attempt" onSubmit={schedule}>
        <h3>Schedule a rated virtual</h3>
        <div className="rating-grid">
          <Field label="AtCoder contest">
            <input type="text" list="atcoder-virtual-contests" value={contest} onChange={event=>setContest(event.currentTarget.value)}
              onFocus={()=>{if(!suggestions)void request<NonNullable<typeof suggestions>>('/api/virtual/atcoder/contests').then(setSuggestions).catch(()=>{});}}
              placeholder="Contest ID or link" required disabled={blocked}/>
            <datalist id="atcoder-virtual-contests">{suggestions?.map(option=><option key={option.id} value={option.id}>{option.day ?? ''}</option>)}</datalist>
          </Field>
          <Field label="Start time on this device" hint={Number.isFinite(startSeconds) ? japan.format(startSeconds*1000)+' JST' : undefined}>
            <input type="datetime-local" value={start} onChange={event=>setStart(event.currentTarget.value)} required disabled={blocked}/>
          </Field>
        </div>
        <p className="secondary">Register on AtCoder and enter the same start time here. Unified Training counts submissions from that instant until the original contest duration ends.</p>
        <div className="button-wrap">
          {id&&<a className="button plain" href={contestUrl(id)+'/virtual'} target="_blank" rel="noreferrer">Open AtCoder virtual setup</a>}
          <Button variant="main" type="submit" disabled={blocked||!id||!Number.isFinite(startSeconds)}>{busy==='schedule'?'Scheduling…':'Schedule rated virtual'}</Button>
        </div>
      </form>}
    </>}
    <div className="rating-grid">
      <div className="rating-official"><span>Official rating</span><strong className="mono">{state.sync.AtCoder?.rating ?? 'Unavailable'}</strong></div>
      <div className="rating-official"><span>Training rating</span><strong className="mono">{history?.rating ?? 'Unavailable'}</strong></div>
    </div>
    {state.sync.AtCoder?.ratingNotice&&<Notice>{state.sync.AtCoder.ratingNotice}</Notice>}
    {failure&&<Notice type="error">{failure}</Notice>}
    {notice&&<Notice type="ok">{notice}</Notice>}
    {!history ? <p className="secondary">Connect your AtCoder handle in your personal profile to track virtual contests.</p> : <>
      <p className="secondary">{history.hasOfficialHistory
        ? 'Training rating combines your official rated contests with the virtual contests you select.'
        : 'Load your official rating history to calculate how virtual contests affect your training rating.'}</p>
      {history.points.length>0&&<RatingChart points={history.points} judge="AtCoder" zone={zone}/>}
      <details className="rule-details">
        <summary>Import AtCoder Problems Local history</summary>
        <div className="form-stack">
          <p className="secondary">Import completed rated virtuals for your connected handle from a JSON export.</p>
          <div className="button-wrap">
            <label className="virtual-file">{busy==='import'?'Importing…':'Import JSON export'}
              <input type="file" accept="application/json,.json" disabled={blocked} onChange={event=>{
                const file=event.currentTarget.files?.[0];
                event.currentTarget.value='';
                if(file)void perform('import',async()=>({backup:JSON.parse(await file.text())}));
              }}/>
            </label>
          </div>
        </div>
      </details>
      {completed.length>0&&<>
        {eligible.length>0&&<VirtualSelectionForm key={JSON.stringify(selection)} value={selection} entries={eligible.map(entry=>({id:entry.id,name:entry.name,stamp:entry.start}))}
          formatDate={date} busy={blocked} save={next=>save({...state.settings,virtualSelection:{...state.settings.virtualSelection,AtCoder:next}})}/>}
        <details className="rule-details rating-history" open>
          <summary>Completed virtual contests ({completed.length})</summary>
          <div className="rating-table-wrap"><table className="rating-table">
            <thead><tr><th scope="col">Contest</th><th scope="col">Date</th><th scope="col">Performance</th><th scope="col">Training rating</th><th scope="col">Change</th></tr></thead>
            <tbody>{[...completed].reverse().map(entry=><tr key={entry.id}>
              <th scope="row"><a href={contestUrl(entry.contestId)} target="_blank" rel="noreferrer">{entry.name}</a></th>
              <td>{date(entry.start)}</td><td title={entry.method}>{entry.performance}</td>
              <td>{entry.training ?? (entry.alreadyRated?'Already rated officially':history.hasOfficialHistory?'Excluded':'Load official history')}</td><td>{signed(entry.delta)}</td>
            </tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </>}
  </section>;
}
