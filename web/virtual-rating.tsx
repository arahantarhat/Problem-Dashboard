import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from './ui';
import type { AccountJudge, VirtualSelection } from './types';

type PlotPoint = {stamp:number;training:number} & ({kind:'official';rating:number} | {kind:'virtual'});

export function RatingChart({points,zone,judge}:{points:PlotPoint[];zone:string;judge:AccountJudge}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const calculated = points.some(point => point.kind!=='official');
  const hasOfficial = points.some(point => point.kind==='official');
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if(!element || !context) return;
    const draw = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if(!width || !height) return;
      const pixelRatio = window.devicePixelRatio || 1;
      element.width = Math.round(width*pixelRatio);
      element.height = Math.round(height*pixelRatio);
      context.scale(pixelRatio,pixelRatio);
      const official = points.flatMap(point => point.kind==='official' ? [{stamp:point.stamp,rating:point.rating}] : []);
      const training = calculated ? points.map(point => ({stamp:point.stamp,rating:point.training})) : [];
      const first = points[0].stamp;
      const last = points[points.length-1].stamp;
      const values = [...official,...training].map(point => point.rating);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const step = Math.max(50,Math.ceil((maximum-minimum)/200)*50);
      const low = Math.max(0,Math.floor((minimum-1)/step)*step);
      const high = Math.ceil((maximum+1)/step)*step;
      const left = 43;
      const right = width-17;
      const top = 13;
      const bottom = height-29;
      const x = (stamp:number) => first===last ? (left+right)/2 : left+(right-left)*(stamp-first)/(last-first);
      const y = (rating:number) => bottom-(bottom-top)*(rating-low)/(high-low);
      const date = new Intl.DateTimeFormat(undefined,{month:'short',...(last-first<90*86400 ? {day:'numeric'} : {year:'2-digit'}),timeZone:zone});
      context.font = '12px -apple-system, system-ui, sans-serif';
      context.fillStyle = '#586478';
      context.textAlign = 'right';
      context.textBaseline = 'middle';
      context.strokeStyle = '#e1e6ee';
      for(let tick=low;tick<=high;tick+=step) {
        context.beginPath();
        context.moveTo(left,y(tick));
        context.lineTo(right,y(tick));
        context.stroke();
        context.fillText(String(tick),left-8,y(tick));
      }
      context.textBaseline = 'top';
      const ticks = first===last ? 1 : width < 490 ? 3 : 5;
      for(let i=0;i<ticks;i++) {
        const stamp = ticks===1 ? first : first+(last-first)*i/(ticks-1);
        context.textAlign = ticks===1 ? 'center' : i===0 ? 'left' : i===ticks-1 ? 'right' : 'center';
        context.fillText(date.format(stamp*1000),x(stamp),bottom+10);
      }
      const line = (series:typeof official, color:string, dash:number[], radius:number) => {
        if(!series.length) return;
        context.strokeStyle = context.fillStyle = color;
        context.lineWidth = 2;
        context.setLineDash(dash);
        context.beginPath();
        const start = series[0];
        context.moveTo(x(start.stamp),y(start.rating));
        for(let i=1;i<series.length;i++) {
          context.lineTo(x(series[i].stamp),y(series[i].rating));
        }
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        for(const point of series) {
          const cx = x(point.stamp);
          const cy = y(point.rating);
          context.moveTo(cx+radius,cy);
          context.arc(cx,cy,radius,0,2*Math.PI);
        }
        context.fill();
      };
      line(training,'#2c4fc8',[],3);
      line(official,'#64748b',[5,4],2.5);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  },[points,zone,calculated]);
  return <div className="rating-chart">
    <div className="legend">
      {hasOfficial&&<span><i className="rating-key official"/>Official rating</span>}
      {calculated&&<span><i className="rating-key training"/>Training rating</span>}
    </div>
    <canvas ref={canvas} role="img" aria-label={judge+' '+(hasOfficial && calculated?'official and training ratings':hasOfficial?'official rating':'training rating')+' over time'}/>
  </div>;
}


type SelectionEntry = {id:string;name:string;stamp:number};

export function VirtualSelectionForm({value,entries,formatDate,busy,save}:{value:VirtualSelection;entries:SelectionEntry[];
  formatDate:(stamp:number)=>string;busy:boolean;save:(selection:VirtualSelection)=>Promise<void>}) {
  const [draft,setDraft] = useState(value);
  const [saving,setSaving] = useState(false);
  const selected = new Set(draft.ids);
  const changed = draft.mode!==value.mode || (draft.mode==='selected' && (selected.size!==value.ids.length || value.ids.some(id=>!selected.has(id))));
  const submit = async (event:FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try { await save(draft); }
    catch { /* App displays the error. */ }
    finally { setSaving(false); }
  };
  return <form className="form-stack virtual-selection" onSubmit={submit}>
    <label className="field">
      <span>Virtual contests that count</span>
      <select value={draft.mode} disabled={busy||saving} onChange={event=>{
        const mode=event.currentTarget.value as VirtualSelection['mode'];
        setDraft(current=>({mode,ids:mode==='selected'&&current.mode==='all'&&!current.ids.length ? entries.map(entry=>entry.id) : current.ids}));
      }}>
        <option value="all">All eligible contests</option>
        <option value="selected">Selected contests</option>
      </select>
    </label>
    {draft.mode==='selected'&&<>
      <div className="button-wrap">
        <Button variant="ghost" disabled={busy||saving} onClick={()=>setDraft({mode:'selected',ids:entries.map(entry=>entry.id)})}>Select all shown</Button>
        <Button variant="ghost" disabled={busy||saving} onClick={()=>setDraft({mode:'selected',ids:[]})}>Clear selection</Button>
      </div>
      <div className="checklist virtual-selection-list">
        {[...entries].sort((a,b)=>b.stamp-a.stamp).map(entry=><label key={entry.id}>
          <input type="checkbox" checked={selected.has(entry.id)} disabled={busy||saving} onChange={event=>{
            const checked=event.currentTarget.checked;
            setDraft(current=>({...current,ids:checked ? [...current.ids,entry.id] : current.ids.filter(id=>id!==entry.id)}));
          }}/>
          <span>{entry.name}</span><small>{formatDate(entry.stamp)}</small>
        </label>)}
      </div>
    </>}
    <div><Button type="submit" disabled={!changed||busy||saving}>{saving?'Saving…':'Save contest selection'}</Button></div>
  </form>;
}
