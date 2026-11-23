import { useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Field, Heading, Notice } from './ui';
import { RatingChart, VirtualSelectionForm } from './virtual-rating';
import { AtCoderVirtual } from './atcoder-virtual';
import type { Requester } from './rules';
import { trainingRatingValue, type AccountJudge, type CodeforcesRound, type Settings, type State, type VirtualImportStatus } from './types';

const platforms = ['Codeforces', 'AtCoder'] as const;
const signed = (value:number) => value > 0 ? '+'+value : String(value);

function ContestLink({round}:{round:CodeforcesRound}) {
  const section = round.contestId >= 100000 ? 'gym' : 'contest';
  return <a href={`https://codeforces.com/${section}/${round.contestId}`} target="_blank" rel="noreferrer">{round.name}</a>;
}

function CodeforcesHistory({state,syncing,demo,status,importHistory,save}:{state:State;syncing:boolean;demo:boolean;status:VirtualImportStatus|null;importHistory:()=>Promise<void>;save:(settings:Settings)=>Promise<void>}) {
  const synced = state.sync.Codeforces;
  const history = synced?.virtual;
  const attempts = history?.points.filter(point => point.kind==='virtual').reverse() ?? [];
  const date = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:state.settings.zone});
  const formatDate = (stamp:number) => date.format(stamp*1000);
  const progress = status?.running && (status.total === undefined
    ? 'Fetching Codeforces rating history and submissions…'
    : `Checked ${status.completed} of ${status.total} contests…`);
  return <section className="card rating-card form-stack" aria-labelledby="codeforces-history">
    <div className="rating-history-head">
      <h2 id="codeforces-history">Codeforces</h2>
      <Button variant="main" disabled={demo||syncing||!state.settings.handles.Codeforces} onClick={()=>void importHistory()}>
        <RefreshCw size={16}/>{status?.running?'Importing…':history?'Refresh contest history':'Import contest history'}
      </Button>
    </div>
    <div className="rating-grid">
      <div className="rating-official"><span>Official rating</span><strong className="mono">{synced?.rating ?? 'Unavailable'}</strong></div>
      <div className="rating-official"><span>Training rating {history?.rating != null ? '(estimated)' : trainingRatingValue(state,'Codeforces') != null ? '(manual)' : ''}</span>
        <strong className="mono">{trainingRatingValue(state,'Codeforces') ?? 'Unavailable'}</strong></div>
    </div>
    {synced?.ratingNotice&&<Notice>{synced.ratingNotice}</Notice>}
    {status?.error&&<Notice type="error">{status.error}</Notice>}
    {progress&&<p className="secondary" role="status">{progress}</p>}
    {history && history.points.length>0 && <RatingChart points={history.points} zone={state.settings.zone} judge="Codeforces"/>}
    {!history && !progress && <p className="secondary">{demo?'Switch to your personal profile to import your contest history.':state.settings.handles.Codeforces
      ? 'Import your official and virtual contests to see your rating history.' : 'Add a Codeforces handle in Connections to import contest history.'}</p>}
    {history && history.eligible.length>0 && <VirtualSelectionForm key={state.settings.handles.Codeforces}
      value={state.settings.virtualSelection.Codeforces} entries={history.eligible.map(round=>({id:String(round.contestId),name:round.name,stamp:round.stamp}))}
      formatDate={formatDate} busy={syncing} save={selection=>save({...state.settings,virtualSelection:{...state.settings.virtualSelection,Codeforces:selection}})}/>}
    {history && <p className="secondary">{attempts.length
      ? 'Training rating combines official rating changes with your first eligible virtual attempt per round. Estimated ranks use rated competitors visible in the public standings.'
      : history.eligible.length ? 'No virtual contests are selected.' : 'No eligible virtual contests have been rated. Your manual rating is used when available.'}
      {' Last imported '+date.format(history.updatedAt)+'.'}</p>}
    {attempts.length>0 && <details className="rule-details rating-history" open>
      <summary>Rated virtual contests ({attempts.length})</summary>
      <div className="rating-table-wrap"><table className="rating-table">
        <thead><tr><th scope="col">Contest</th><th scope="col">Date</th><th scope="col">Estimated rank</th><th scope="col">Training rating</th><th scope="col">Change</th></tr></thead>
        <tbody>{attempts.map(point => <tr key={point.contestId}>
          <th scope="row"><ContestLink round={point}/></th><td>{formatDate(point.stamp)}</td>
          <td title={point.fieldSize < point.originalFieldSize ? `Public standings include ${point.fieldSize-1} of ${point.originalFieldSize-1} rated competitors.` : undefined}>{point.tied>0?'=':''}{point.rank.toLocaleString()} / {point.fieldSize.toLocaleString()}</td>
          <td>{point.training}</td><td>{signed(point.delta)}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {history && history.skipped.length>0 && <details className="rule-details rating-history">
      <summary>Skipped contests ({history.skipped.length})</summary>
      <div className="rating-table-wrap"><table className="rating-table">
        <thead><tr><th scope="col">Contest</th><th scope="col">Date</th><th scope="col">Reason</th></tr></thead>
        <tbody>{[...history.skipped].sort((a,b)=>b.stamp-a.stamp).map(round => <tr key={round.contestId}>
          <th scope="row"><ContestLink round={round}/></th><td>{formatDate(round.stamp)}</td><td>{round.reason}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </section>;
}

export function VirtualPage({state,save,syncing,demo,onSetup,status,importHistory,request,updateState}:{onSetup:()=>void;state:State;save:(settings:Settings)=>Promise<void>;syncing:boolean;demo:boolean;status:VirtualImportStatus|null;importHistory:()=>Promise<void>;request:Requester;updateState:(state:State)=>void}) {
  const [platform,setPlatform]=useState<AccountJudge>(()=>state.settings.handles.AtCoder?'AtCoder':'Codeforces');
  const [ratings, setRatings] = useState(state.settings.trainingRatings);
  const [saving, setSaving] = useState(false);
  const changed = platforms.some(judge => ratings[judge] !== state.settings.trainingRatings[judge]);
  const setRating = (judge:AccountJudge, value:string) => {
    setRatings(current => ({...current, [judge]:value === '' ? null : Number(value)}));
  };
  const submit = async (event:FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try { await save({...state.settings, trainingRatings:ratings}); }
    catch { /* App displays the save error. */ }
    finally { setSaving(false); }
  };
  return <>
    <Heading title="Virtual" description="Track virtual contests and use your training rating in practice rules." action={<a className="button plain" href="#rules">Open Rules</a>}/>
    <div className="form-stack">
      <div className="button-wrap" role="group" aria-label="Contest judge">{platforms.map(judge=><Button key={judge} variant={platform===judge?'main':'plain'} aria-pressed={platform===judge} onClick={()=>setPlatform(judge)}>{judge}</Button>)}</div>
      {demo?<div className="card rule-row"><div><h2>Track your {platform} contests</h2><p>Connect your handle in your personal profile to get started.</p></div><Button onClick={onSetup}>Set up my contests</Button></div>:platform==='Codeforces'?<CodeforcesHistory state={state} syncing={syncing||saving} demo={demo} status={status} importHistory={importHistory} save={save}/>
      :<AtCoderVirtual key={state.settings.handles.AtCoder} state={state} save={save} request={request} updateState={updateState} disabled={syncing||saving||demo}/>}
      <details className="rule-details"><summary>Manual training ratings</summary><form className="form-stack" onSubmit={submit}>

        <div className="rating-grid">
          {platforms.map(judge => <Field key={judge} label={judge}
            hint={judge==='Codeforces' ? 'Used when an estimated training rating is unavailable.' : 'Used when no AtCoder handle is connected.'}>
            <input type="number" min="0" max="10000" value={ratings[judge] ?? ''} placeholder="Optional" disabled={saving}
              onChange={event => setRating(judge, event.currentTarget.value)}/>
          </Field>)}
        </div>
        <div className="rating-actions">
          <Button type="submit" disabled={!changed||saving||syncing}>{saving?'Saving…':'Save manual ratings'}</Button>
        </div>
      </form></details>
    </div>
  </>;
}
