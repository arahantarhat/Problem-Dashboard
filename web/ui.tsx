import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { X, Check, AlertCircle, CircleHelp, ExternalLink } from 'lucide-react';
import type { Judge, Problem, RuleOption, Settings } from './types';

export function Button({variant='plain',className='',children,...props}:ComponentProps<'button'> & {variant?:'main'|'plain'|'ghost'|'danger'}) {
  return <button type="button" className={'button '+variant+' '+className} {...props}>{children}</button>;
}
export function Modal({title,description,close,children,wide=false}:{title:string;description?:string;close:()=>void;children:ReactNode;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return ()=>dialog?.close();},[]);
  return <dialog ref={ref} className={'dialog'+(wide?' wide':'')} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}} aria-labelledby={titleId}>
    <div className="dialog-head"><div><h2 id={titleId}>{title}</h2>{description&&<p>{description}</p>}</div><Button variant="ghost" aria-label="Close dialog" className="icon-button" onClick={close}><X size={19}/></Button></div>{children}
  </dialog>;
}
export function Field({label, hint, children}:{label:string;hint?:string;children:ReactNode}) {
  return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;
}
export function RuleDetails({label,initiallyOpen=false,children}:{label:string;initiallyOpen?:boolean;children:ReactNode}) {
  return <details className="rule-details" open={initiallyOpen} onInvalid={e=>{e.currentTarget.open=true;}}>
    <summary>{label}</summary>
    <div className="form-stack">{children}</div>
  </details>;
}
export function RuleCap({value,initiallyOpen,onChange}:{value:number;initiallyOpen:boolean;onChange:(value:number)=>void}) {
  return <RuleDetails label="Advanced queue settings" initiallyOpen={initiallyOpen}>
    <Field label="Maximum problems in the practice queue">
      <input type="number" min={0} max={100} required value={value} onChange={e=>onChange(Number(e.target.value))}/>
    </Field>
  </RuleDetails>;
}
export function RulePreview({count,examples=[],status,note}:{count?:number;examples?:RuleOption['preview'];status?:string;note?:string}) {
  return <div className="preview">
    <strong>{status || (count === undefined ? 'Finding matches…' : count+' unsolved '+(count===1?'match':'matches'))}</strong>
    {!status && examples.slice(0,3).map(problem=><div className="preview-example" key={problem.key}>
      <span>{problem.title}</span>{problem.difficulty!=null&&<span className="mono">{problem.difficulty}</span>}
    </div>)}
    {note&&<p>{note}</p>}
  </div>;
}
export function Toggle({checked, onChange,children}:{checked:boolean;onChange:(value:boolean)=>void;children:ReactNode}) {
  return <label className="toggle"><input type="checkbox" role="switch" checked={checked} onChange={e=>onChange(e.currentTarget.checked)}/><span className="switch-track" aria-hidden="true"/><span>{children}</span></label>;
}
export function Heading({title,description,action}:{title:string;description:string;action?:ReactNode}) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
export function Notice({children,type='info'}:{children:ReactNode;type?:'info'|'ok'|'error'}) {
  const Icon=type==='error'?AlertCircle:type==='ok'?Check:CircleHelp;
  return <div className={'notice '+type} role={type==='error'?'alert':'status'}><Icon size={17}/><span>{children}</span></div>;
}
export function JudgeLabel({name,colors}:{name:Judge;colors:Settings['colors']}) {
  return <span className="judge"><i style={{background:colors[name]}}/>{name}</span>;
}
export function ProblemLink({problem}:{problem:Problem}) {
  return <a className="problem-link" href={problem.url} target="_blank" rel="noopener noreferrer">{problem.title}<ExternalLink size={13}/></a>;
}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}) {
  return <div className="empty"><strong>{title}</strong><p>{description}</p>{action}</div>;
}
