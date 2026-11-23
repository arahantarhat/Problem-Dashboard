import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { Button, Field, Notice } from './ui';

type Step = 'sign-in' | 'signup' | 'confirm' | 'forgot' | 'recovery-code' | 'reset';
const recoveryKey = 'ut-password-recovery';
const titles: Record<Step, string> = {
  'sign-in': 'Sign in', signup: 'Create an account', confirm: 'Confirm your email',
  forgot: 'Reset your password', 'recovery-code': 'Enter your recovery code', reset: 'Choose a new password'
};

export function AccountGate({children}:{children:(client:SupabaseClient,session:Session)=>ReactNode}) {
  const [client,setClient]=useState<SupabaseClient|null>(null);
  const [session,setSession]=useState<Session|null|undefined>(undefined);
  const [error,setError]=useState('');
  const [recovery,setRecovery]=useState(()=>sessionStorage.getItem(recoveryKey)==='pending');
  useEffect(()=>{
    const abort=new AbortController();
    let unsubscribe: (()=>void)|undefined;
    void (async()=>{
      try {
        const response=await fetch('/api/auth/config',{signal:abort.signal});
        if(!response.ok)throw new Error('Account service configuration is unavailable.');
        const {url,key}=await response.json() as {url:string;key:string};
        const {createClient}=await import('@supabase/supabase-js');
        if(abort.signal.aborted)return;
        const supabase=createClient(url,key,{auth:{detectSessionInUrl:false}});
        const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));
        unsubscribe=()=>subscription.unsubscribe();
        setClient(supabase);
      } catch (cause) {
        if(!abort.signal.aborted)setError((cause as Error).message);
      }
    })();
    return ()=>{abort.abort();unsubscribe?.();};
  },[]);

  const recovering=(value:boolean)=>{
    if(value)sessionStorage.setItem(recoveryKey,'pending');
    else sessionStorage.removeItem(recoveryKey);
    setRecovery(value);
  };

  if(client && session!==undefined) {
    if(session && !recovery)return <SignupUsername key={session.user.id} session={session}>{children(client,session)}</SignupUsername>;
    return <AccountForm client={client} reset={Boolean(session && recovery)} recovering={recovering}/>;
  }
  return <AccountLayout title="Unified Training">
    {error?<><Notice type="error">{error}</Notice><Button onClick={()=>window.location.reload()}>Retry</Button></>:<p role="status">Loading sign-in…</p>}
  </AccountLayout>;
}

function AccountLayout({title,children}:{title:string;children:ReactNode}) {
  return <main className="account-page">
    <div className="card account-card">
      <div className="brand"><span className="brand-icon"><TrendingUp size={20} strokeWidth={2.1}/></span>Unified Training</div>
      <h1>{title}</h1>
      {children}
    </div>
  </main>;
}

export function UsernameField({value,onChange,disabled}:{value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  return <Field label="Username" hint="Use 3–24 letters, numbers, or underscores.">
    <input autoComplete="username" autoCapitalize="off" spellCheck={false} required
      pattern="[A-Za-z0-9_]{3,24}" maxLength={24} value={value} disabled={disabled}
      onChange={event=>onChange(event.currentTarget.value)}/>
  </Field>;
}

function SignupUsername({session,children}:{session:Session;children:ReactNode}) {
  const requested = session.user.user_metadata.training_username;
  if (typeof requested !== 'string' || !requested) return children;
  return <ClaimSignupUsername requested={requested} token={session.access_token}>{children}</ClaimSignupUsername>;
}

function ClaimSignupUsername({requested,token,children}:{requested:string;token:string;children:ReactNode}) {
  const [value,setValue]=useState(requested);
  const [done,setDone]=useState(false);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState({name:requested});
  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try {
        const headers={Authorization:'Bearer '+token,'X-Training-Timezone':Intl.DateTimeFormat().resolvedOptions().timeZone};
        const identity=await fetch('/api/social/identity',{headers,signal:controller.signal});
        if(!identity.ok)throw new Error('Could not load your username. Try again.');
        const {user}=await identity.json();
        if(!user) {
          const response=await fetch('/api/social/username',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
            body:JSON.stringify({username:attempt.name}),signal:controller.signal});
          if(!response.ok)throw new Error((await response.json()).error ?? 'Could not save your username.');
        }
        if(!controller.signal.aborted)setDone(true);
      } catch(cause) {
        if(!controller.signal.aborted)setError((cause as Error).message);
      } finally { if(!controller.signal.aborted)setBusy(false); }
    })();
    return()=>controller.abort();
  },[attempt,token]);
  if(done)return children;
  return <AccountLayout title="Choose your username">
    {error&&<Notice type="error">{error}</Notice>}
    <form className="form-stack" onSubmit={event=>{
      event.preventDefault();setBusy(true);setError('');setAttempt({name:value});
    }}>
      <UsernameField value={value} onChange={setValue} disabled={busy}/>
      <Button type="submit" variant="main" disabled={busy}>{busy?'Saving username…':'Save username'}</Button>
    </form>
  </AccountLayout>;
}

function AccountForm({client,reset,recovering}:{client:SupabaseClient;reset:boolean;recovering:(value:boolean)=>void}) {
  const [view,setView]=useState<Step>('sign-in');
  const [email,setEmail]=useState('');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const step=reset?'reset':view;
  const withPassword=['sign-in','signup','reset'].includes(step);
  const withCode=step==='confirm'||step==='recovery-code';

  function navigate(next:Step,message='') {
    setView(next);setPassword('');setCode('');setError('');setNotice(message);
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);setError('');
    const address=email.trim();
    try {
      if(step==='sign-in') {
        const {error}=await client.auth.signInWithPassword({email:address,password});
        if(error?.code==='email_not_confirmed') navigate('confirm','Enter the code from your confirmation email.');
        else if(error)throw error;
        else recovering(false);
      } else if(step==='signup') {
        const {data,error}=await client.auth.signUp({email:address,password,options:{data:{training_username:username}}});
        if(error)throw error;
        if(!data.session)navigate('confirm','If an account can be created for that address, we’ll email you a confirmation code.');
      } else if(step==='confirm') {
        const {error}=await client.auth.verifyOtp({email:address,token:code.trim(),type:'email'});
        if(error)throw error;
      } else if(step==='forgot') {
        const {error}=await client.auth.resetPasswordForEmail(address);
        if(error)throw error;
        navigate('recovery-code','If an account exists for that email address, we’ll send a recovery code.');
      } else if(step==='recovery-code') {
        // Set the gate before Supabase publishes the recovered session.
        recovering(true);
        const {error}=await client.auth.verifyOtp({email:address,token:code.trim(),type:'recovery'});
        if(error){recovering(false);throw error;}
        setCode('');
      } else {
        const {error}=await client.auth.updateUser({password});
        if(error)throw error;
        const signedOut=await client.auth.signOut({scope:'global'});
        if(signedOut.error)throw signedOut.error;
        navigate('sign-in','Password updated. Sign in with your new password.');
        recovering(false);
      }
    } catch (cause) {
      if(step==='recovery-code')recovering(false);
      setError((cause as Error).message);
    } finally {setBusy(false);}
  }

  async function resend() {
    setBusy(true);setError('');
    try {
      const {error}=await client.auth.resend({type:'signup',email:email.trim()});
      if(error)throw error;
      setNotice('If confirmation is pending, we’ll send a new code.');
    } catch (cause) {setError((cause as Error).message);}
    finally {setBusy(false);}
  }

  async function cancelReset() {
    setBusy(true);setError('');
    try {
      const {error}=await client.auth.signOut({scope:'local'});
      if(error)throw error;
      navigate('sign-in');recovering(false);
    } catch (cause) {setError((cause as Error).message);}
    finally {setBusy(false);}
  }

  return <AccountLayout title={titles[step]}>
    {!reset && window.location.hash.startsWith('#import-cses=') && <p className="secondary">Sign in to review your CSES import.</p>}
    {!reset && window.location.hash.startsWith('#social/invite/') && <p className="secondary">Sign in to review your group invitation.</p>}
    {notice&&<Notice>{notice}</Notice>}
    {error&&<Notice type="error">{error}</Notice>}
    <form className="form-stack" onSubmit={event=>void submit(event)}>
      {step!=='reset'&&<Field label="Email address">
        <input type="email" autoComplete="email" value={email} required disabled={busy} onChange={event=>setEmail(event.currentTarget.value)}/>
      </Field>}
      {step==='signup'&&<UsernameField value={username} onChange={setUsername} disabled={busy}/>}
      {withPassword&&<Field label={step==='reset'?'New password':'Password'} hint={step==='sign-in'?undefined:'Use at least 8 characters.'}>
        <input type="password" autoComplete={step==='sign-in'?'current-password':'new-password'} value={password} required
          minLength={step==='sign-in'?undefined:8} disabled={busy} onChange={event=>setPassword(event.currentTarget.value)}/>
      </Field>}
      {withCode&&<Field label="Email code">
        <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]+" maxLength={12} required
          value={code} disabled={busy} onChange={event=>setCode(event.currentTarget.value)}/>
      </Field>}
      <Button type="submit" variant="main" disabled={busy}>{busy?'Please wait…':step==='forgot'?'Send recovery code':step==='reset'?'Save new password':titles[step]}</Button>
    </form>
    <div className="account-actions">
      {step==='sign-in'?<>
        <button type="button" className="text-button" onClick={()=>navigate('signup')} disabled={busy}>Create an account</button>
        <button type="button" className="text-button" onClick={()=>navigate('forgot')} disabled={busy}>Forgot password?</button>
      </>:<>
        {step==='confirm'&&<button type="button" className="text-button" onClick={()=>void resend()} disabled={busy}>Resend code</button>}
        {step==='recovery-code'&&<button type="button" className="text-button" onClick={()=>navigate('forgot')} disabled={busy}>Request a new code</button>}
        <button type="button" className="text-button" onClick={()=>step==='reset'?void cancelReset():navigate('sign-in')} disabled={busy}>Back to sign-in</button>
      </>}
    </div>
  </AccountLayout>;
}
