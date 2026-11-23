import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Copy, Plus, RefreshCw, UserPlus } from 'lucide-react';
import { UsernameField } from './auth';
import { Button, Empty, Field, Heading, Notice, ProblemLink, Toggle } from './ui';
import type { Problem } from './types';

type Request = <T>(endpoint:string, payload?:unknown)=>Promise<T>;
type User = {id:string;username:string};
type Relationship = 'none'|'friend'|'incoming'|'outgoing';
type Person = User & {relationship:Relationship};
type Group = {id:string;name:string;owner:string;zone:string;totalsOnly:boolean};
type Home = {user:User;groups:Group[];friends:Person[];publicOrigin:string|null};
type Entry = {user:User;day:string;stamp:number|null;source:'manual'|'imported'|'legacy'|'synced';problem:Problem};
type Score = User & {solved:number;grind:number;activeDays:number};
type GroupDetail = {group:Group;members:Person[];standings:Score[];activity:Entry[];inviteCode?:string};
type FriendDetail = {user:User;summary:Pick<Score,'solved'|'activeDays'>;activity:Entry[]};
type Invite = Pick<Group,'id'|'name'>;
type Week = 'current'|'last';
type FriendAction = 'request'|'accept'|'decline'|'cancel'|'remove';
type GroupAction = 'create'|'join'|'leave'|'share'|'rotate'|'remove'|'transfer';
type Tab = 'Activity'|'Groups'|'Friends';
type GroupTab = 'Overview'|'Leaderboard'|'Members';

const metrics = {solved:'Problems solved',grind:'Grind progress',activeDays:'Active days'} as const;
type Metric = keyof typeof metrics;
const solveSources = {synced:'Judge sync',manual:'Self-reported',imported:'Imported',legacy:'Manual or imported'};

export const socialInviteHash = '#social/invite/';

function ActivityList({entries,empty,feedZone}:{entries:Entry[];empty:string;feedZone?:string}) {
  if(!entries.length)return <Empty title={empty} description="Shared solves will appear here."/>;
  return <ul className="social-list">
    {entries.map(entry=>{
      const date = entry.stamp === null ? new Date(entry.day+'T00:00:00Z') : new Date(entry.stamp*1000);
      const label = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',
        timeZone:entry.stamp === null ? 'UTC' : feedZone}).format(date);
      return <li className="social-row" key={entry.user.id+':'+entry.problem.key}>
        <div className="social-solve">
          <span className="social-handle">@{entry.user.username}</span>
          <ProblemLink problem={entry.problem}/>
          <span className="secondary">{entry.problem.judge} · {solveSources[entry.source]}</span>
        </div>
        <time className="secondary" dateTime={date.toISOString()}>{label}</time>
      </li>;
    })}
  </ul>;
}

function Leaderboard({scores,metric}:{scores:Score[];metric:Metric}) {
  const ranked = [...scores].sort((a,b)=>b[metric]-a[metric] || a.username.localeCompare(b.username));
  let rank = 0;
  return <table className="social-table">
    <thead><tr><th scope="col">Rank</th><th scope="col">Member</th><th scope="col">{metrics[metric]}</th></tr></thead>
    <tbody>{ranked.map((row,index)=>{
      if(index===0 || row[metric]!==ranked[index-1][metric])rank=index+1;
      return <tr key={row.id}><td>{rank}</td><th scope="row">@{row.username}</th><td>{row[metric]}</td></tr>;
    })}</tbody>
  </table>;
}

function FriendButtons({person,busy,act,open}:{person:Person;busy:boolean;act:(action:FriendAction)=>void;open:()=>void}) {
  if(person.relationship==='friend')return <>
    <Button disabled={busy} onClick={open}>View profile</Button>
    <Button variant="ghost" disabled={busy} onClick={()=>act('remove')}>Remove friend</Button>
  </>;
  if(person.relationship==='incoming')return <>
    <Button variant="main" disabled={busy} onClick={()=>act('accept')}>Accept</Button>
    <Button disabled={busy} onClick={()=>act('decline')}>Decline</Button>
  </>;
  if(person.relationship==='outgoing')return <Button disabled={busy} onClick={()=>act('cancel')}>Cancel request</Button>;
  return <Button disabled={busy} onClick={()=>act('request')}><UserPlus size={15}/>Add friend</Button>;
}

export function SocialPage({request,inviteCode}:{request:Request;inviteCode:string}) {
  const [tab,setTab]=useState<Tab>(inviteCode?'Groups':'Activity');
  const [identity,setIdentity]=useState<User|null>();
  const [home,setHome]=useState<Home>();
  const [username,setUsername]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [feedFilter,setFeedFilter]=useState('all');
  const [feed,setFeed]=useState<Entry[]>();
  const [groupId,setGroupId]=useState('');
  const [group,setGroup]=useState<GroupDetail>();
  const [loadedWeek,setLoadedWeek]=useState<Week>();
  const [groupTab,setGroupTab]=useState<GroupTab>('Overview');
  const [week,setWeek]=useState<Week>('current');
  const [metric,setMetric]=useState<Metric>('solved');
  const [groupName,setGroupName]=useState('');
  const [code,setCode]=useState(inviteCode);
  const [pendingInvite,setPendingInvite]=useState<(Invite & {code:string})>();
  const [lookup,setLookup]=useState('');
  const [found,setFound]=useState<Person>();
  const [friendId,setFriendId]=useState('');
  const [friend,setFriend]=useState<FriendDetail>();
  const selectedWeek=groupTab==='Leaderboard'?week:'current';
  const reload=()=>setRevision(value=>value+1);

  const api=useCallback(<T,>(path:string,body:unknown={})=>request<T>('/api/social/'+path,body),[request]);
  useEffect(()=>{
    let active=true;
    void request<{user:User|null}>('/api/social/identity').then(({user})=>{if(active)setIdentity(user);})
      .catch(cause=>{if(active)setError(cause.message);});
    return()=>{active=false;};
  },[request,revision]);
  useEffect(()=>{
    if(!identity)return;
    let active=true;
    void api<Home>('home').then(result=>{
      if(!active)return;
      setHome(result);
      setFeedFilter(filter=>filter==='all'||filter==='friends'||result.groups.some(item=>item.id===filter)?filter:'all');
    }).catch(cause=>{if(active)setError(cause.message);});
    return()=>{active=false;};
  },[api,identity?.id,revision]);
  useEffect(()=>{
    if(!identity || tab!=='Activity')return;
    let active=true;
    setFeed(undefined);
    const body=feedFilter==='all'||feedFilter==='friends'?{filter:feedFilter}:{filter:'group',id:feedFilter};
    void api<{activity:Entry[]}>('activity',body).then(result=>{if(active)setFeed(result.activity);})
      .catch(cause=>{if(active){setFeed([]);setError(cause.message);}});
    return()=>{active=false;};
  },[api,identity?.id,tab,feedFilter,revision]);
  useEffect(()=>{
    if(!identity || !groupId || tab!=='Groups')return;
    let active=true;
    void api<GroupDetail>('group',{id:groupId,week:selectedWeek}).then(result=>{
      if(active){setGroup(result);setLoadedWeek(selectedWeek);}
    })
      .catch(cause=>{if(active){setGroupId('');setError(cause.message);}});
    return()=>{active=false;};
  },[api,identity?.id,tab,groupId,selectedWeek,revision]);
  useEffect(()=>{
    if(!identity || !friendId || tab!=='Friends')return;
    let active=true;
    setFriend(undefined);
    void api<FriendDetail>('friend-profile',{id:friendId}).then(result=>{if(active)setFriend(result);})
      .catch(cause=>{if(active){setFriendId('');setError(cause.message);}});
    return()=>{active=false;};
  },[api,identity?.id,tab,friendId,revision]);
  useEffect(()=>{
    if(!identity || !inviteCode)return;
    let active=true;
    setTab('Groups');setGroupId('');setCode(inviteCode);setPendingInvite(undefined);
    void api<Invite>('invite',{code:inviteCode}).then(result=>{
      if(active)setPendingInvite({...result,code:inviteCode});
    }).catch(cause=>{if(active)setError(cause.message);});
    return()=>{active=false;};
  },[api,identity?.id,inviteCode]);

  async function run(task:()=>Promise<void>) {
    setBusy(true);setError('');setNotice('');
    try { await task(); }
    catch(cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  function openGroup(id:string) {
    setGroup(undefined);setGroupId(id);setGroupTab('Overview');setWeek('current');setMetric('solved');setTab('Groups');
  }
  function openFriend(id:string) {
    setFriend(undefined);setFriendId(id);setTab('Friends');
  }
  function switchTab(next:Tab) {
    setTab(next);setError('');setNotice('');
  }
  function actOnFriend(person:Person,action:FriendAction) {
    void run(async()=>{
      const result=await api<{relationship:Relationship}>('friend',{target:person.id,action});
      setFound(current=>current?.id===person.id?{...current,...result}:current);
      if(action==='remove' && friendId===person.id)setFriendId('');
      reload();
    });
  }
  function actOnGroup(action:GroupAction,fields:object={}) {
    void run(async()=>{
      const result=await api<{id:string;inviteCode?:string}>('group-action',{action,id:groupId,...fields});
      if(action==='rotate')setGroup(current=>current && {...current,inviteCode:result.inviteCode});
      if(action==='leave')setGroupId('');
      if(action==='create'||action==='join'){
        if(inviteCode)window.location.hash='#social';
        setGroupName('');setCode('');setPendingInvite(undefined);openGroup(result.id);
      }
      reload();
    });
  }
  function reviewInvite(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async()=>{
      setPendingInvite(undefined);
      const candidate=code.trim();
      setPendingInvite({...await api<Invite>('invite',{code:candidate}),code:candidate});
    });
  }
  const feedback=<>
    {error&&<Notice type="error">{error}</Notice>}
    {notice&&<Notice type="ok">{notice}</Notice>}
  </>;

  if(!identity)return <section className="social-page">
    <Heading title="Social" description="Practice alongside friends and groups."/>
    {feedback}
    {identity===null?<form className="card social-panel form-stack" onSubmit={event=>{
      event.preventDefault();
      void run(async()=>{setIdentity((await api<{user:User}>('username',{username})).user);});
    }}>
      <h2>Choose your username</h2>
      <p className="secondary">This is how friends and group members will find you.</p>
      <UsernameField value={username} onChange={setUsername} disabled={busy}/>
      <Button variant="main" type="submit" disabled={busy}>Save username</Button>
    </form>:error?<Button onClick={()=>{setError('');reload();}}>Retry</Button>:<p role="status">Loading Social…</p>}
  </section>;

  const tabs:Tab[]=['Activity','Groups','Friends'];
  const groupTabs:GroupTab[]=['Overview','Leaderboard','Members'];
  const personActions=(person:Person)=><FriendButtons person={person} busy={busy} act={action=>actOnFriend(person,action)} open={()=>openFriend(person.id)}/>;
  const outgoingInvite=group?.inviteCode;
  const inviteText=outgoingInvite && (home?.publicOrigin ? home.publicOrigin+'/'+socialInviteHash+outgoingInvite : outgoingInvite);
  return <section className="social-page">
    <Heading title="Social" description={'Signed in as @'+identity.username}
      action={<Button disabled={busy} onClick={()=>{setError('');reload();}}><RefreshCw size={15}/>Refresh</Button>}/>
    <div className="social-tabs" role="group" aria-label="Social views">
      {tabs.map(item=><Button key={item} variant="ghost" aria-pressed={tab===item} onClick={()=>switchTab(item)}>
        {item}{item==='Friends' && home?.friends.some(person=>person.relationship==='incoming')?' · New':''}
      </Button>)}
    </div>
    {feedback}
    {tab==='Activity'&&<section className="card social-panel">
      <div className="social-section-head">
        <h2>Recent solves</h2>
        <select aria-label="Filter recent solves" value={feedFilter} onChange={event=>setFeedFilter(event.currentTarget.value)}>
          <option value="all">Everyone I know</option><option value="friends">Friends</option>
          {home?.groups.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </div>
      {feed?<ActivityList entries={feed} empty="No recent solves"/>:<p role="status">Loading activity…</p>}
    </section>}
    {tab==='Groups'&&!groupId&&<>
      <section className="card social-panel">
        <h2>Your groups</h2>
        {!home?<p role="status">Loading groups…</p>:home.groups.length===0
          ?<Empty title="You haven’t joined a group yet" description="Create a private group or enter an invitation below."/>
          :<ul className="social-list">{home.groups.map(item=><li className="social-row" key={item.id}>
            <button className="text-button" onClick={()=>openGroup(item.id)}>{item.name}</button>
            <span className="secondary">{item.owner===identity.id?'Owner':'Member'}</span>
          </li>)}</ul>}
      </section>
      <div className="social-forms">
        <form className="card social-panel form-stack" onSubmit={event=>{event.preventDefault();actOnGroup('create',{name:groupName});}}>
          <h2>Create a group</h2>
          <Field label="Group name"><input required maxLength={60} value={groupName} onChange={event=>setGroupName(event.currentTarget.value)}/></Field>
          <Button type="submit" variant="main" disabled={busy}><Plus size={15}/>Create group</Button>
        </form>
        <form className="card social-panel form-stack" onSubmit={reviewInvite}>
          <h2>Join a group</h2>
          <Field label="Invite code"><input required maxLength={32} value={code} onChange={event=>{setCode(event.currentTarget.value);setPendingInvite(undefined);}}/></Field>
          <Button type="submit" disabled={busy}>Review invitation</Button>
          {pendingInvite&&<div className="social-invite-review">
            <strong>{pendingInvite.name}</strong>
            <p className="secondary">Group members can see your recent solves. You can switch to totals only after joining.</p>
            <Button variant="main" disabled={busy} onClick={()=>actOnGroup('join',{code:pendingInvite.code})}>Join group</Button>
          </div>}
        </form>
      </div>
    </>}
    {tab==='Groups'&&groupId&&<>
      <Button className="social-back" variant="ghost" onClick={()=>setGroupId('')}><ArrowLeft size={15}/>Your groups</Button>
      {group?<section className="card social-panel">
        <div className="social-section-head"><h2>{group.group.name}</h2><span className="secondary">{group.group.zone}</span></div>
        <div className="social-tabs" role="group" aria-label="Group views">
          {groupTabs.map(item=><Button key={item} variant="ghost" aria-pressed={groupTab===item} onClick={()=>setGroupTab(item)}>{item}</Button>)}
        </div>
        {groupTab==='Overview'&&<>
          <div className="social-section-head"><h3>Weekly standings</h3>
            <Button onClick={()=>{setWeek('current');setGroupTab('Leaderboard');}}>View leaderboard</Button></div>
          {loadedWeek===selectedWeek?<Leaderboard scores={group.standings} metric="solved"/>:<p role="status">Loading standings…</p>}
          <h3>Recent solves</h3>
          <ActivityList entries={group.activity} empty="No recent group solves" feedZone={group.group.zone}/>
        </>}
        {groupTab==='Leaderboard'&&<>
          <div className="social-filters">
            <Field label="Metric"><select value={metric} onChange={event=>setMetric(event.currentTarget.value as Metric)}>
              {Object.entries(metrics).map(([value,label])=><option value={value} key={value}>{label}</option>)}
            </select></Field>
            <Field label="Week"><select value={week} onChange={event=>setWeek(event.currentTarget.value as Week)}>
              <option value="current">This week</option><option value="last">Last week</option>
            </select></Field>
          </div>
          <p className="secondary">{metric==='grind'?'Verified solves from each member’s own Problemset queue.':'Only solves from verified judge accounts count.'} Weeks start Monday.</p>
          {loadedWeek===selectedWeek?<Leaderboard scores={group.standings} metric={metric}/>:<p role="status">Loading standings…</p>}
        </>}
        {groupTab==='Members'&&<ul className="social-list">
          {group.members.map(person=><li className="social-row" key={person.id}>
            <span className="social-handle">@{person.username}{person.id===group.group.owner&&<small className="secondary">Owner</small>}</span>
            {person.id!==identity.id&&<div className="social-actions">
              {personActions(person)}
              {group.group.owner===identity.id&&<>
                <Button disabled={busy} onClick={()=>{if(window.confirm('Transfer group ownership to @'+person.username+'?'))actOnGroup('transfer',{target:person.id});}}>Transfer ownership</Button>
                <Button variant="danger" disabled={busy} onClick={()=>{if(window.confirm('Remove @'+person.username+' from this group?'))actOnGroup('remove',{target:person.id});}}>Remove member</Button>
              </>}
            </div>}
          </li>)}
        </ul>}
        <div className="social-group-settings">
          <Toggle checked={group.group.totalsOnly} onChange={value=>{if(!busy)actOnGroup('share',{totalsOnly:value});}}>Share totals only with this group</Toggle>
          {group.group.owner===identity.id&&<div className="social-actions">
            <Button disabled={busy} onClick={()=>{if(window.confirm('Replace the current invite? The old code will stop working.'))actOnGroup('rotate');}}>Replace invite</Button>
            {inviteText&&<>
              <input aria-label={home?.publicOrigin?'Invite link':'Invite code'} readOnly value={inviteText} onFocus={event=>event.currentTarget.select()}/>
              <Button disabled={busy} onClick={()=>void run(async()=>{
                await navigator.clipboard.writeText(inviteText);setNotice(home?.publicOrigin?'Invite link copied.':'Invite code copied.');
              })}><Copy size={15}/>{home?.publicOrigin?'Copy link':'Copy code'}</Button>
            </>}
          </div>}
          <div><Button variant="danger" disabled={busy} onClick={()=>{if(window.confirm('Leave '+group.group.name+'?'))actOnGroup('leave');}}>Leave group</Button></div>
        </div>
      </section>:<p role="status">Loading group…</p>}
    </>}
    {tab==='Friends'&&friendId&&<>
      <Button className="social-back" variant="ghost" onClick={()=>setFriendId('')}><ArrowLeft size={15}/>Friends</Button>
      {friend?<section className="card social-panel">
        <div className="social-section-head"><h2>@{friend.user.username}</h2>
          <Button disabled={busy} onClick={()=>actOnFriend({...friend.user,relationship:'friend'},'remove')}>Remove friend</Button>
        </div>
        <div className="social-totals"><span><strong>{friend.summary.solved}</strong> problems solved this week</span>
          <span><strong>{friend.summary.activeDays}</strong> active days this week</span></div>
        <h3>Latest solves</h3><ActivityList entries={friend.activity} empty="No recent solves"/>
      </section>:<p role="status">Loading friend’s profile…</p>}
    </>}
    {tab==='Friends'&&!friendId&&<>
      <section className="card social-panel">
        <h2>Find a friend</h2>
        <form className="social-inline" onSubmit={event=>{
          event.preventDefault();
          void run(async()=>{setFound(undefined);setFound(await api<Person>('lookup',{username:lookup}));});
        }}>
          <Field label="Username"><input required maxLength={25} value={lookup} autoCapitalize="off" onChange={event=>setLookup(event.currentTarget.value)}/></Field>
          <Button type="submit" variant="main" disabled={busy}>Find member</Button>
        </form>
        {found&&<div className="social-row"><span className="social-handle">@{found.username}</span><div className="social-actions">{personActions(found)}</div></div>}
      </section>
      <section className="card social-panel">
        <h2>Friends and requests</h2>
        {!home?<p role="status">Loading friends…</p>:home.friends.length===0
          ?<Empty title="No friends yet" description="Find someone by username or send a request from your group’s member list."/>
          :<ul className="social-list">{home.friends.map(person=><li className="social-row" key={person.id}>
            <span className="social-handle">@{person.username}
              {person.relationship!=='friend'&&<small className="secondary">{person.relationship==='incoming'?'Incoming request':'Request sent'}</small>}
            </span>
            <div className="social-actions">{personActions(person)}</div>
          </li>)}</ul>}
      </section>
    </>}
  </section>;
}
