import { randomBytes, randomUUID } from 'node:crypto';
import { one, rows, settingsFor, transaction } from './db.mjs';
import { isDay, normalizeLink } from './domain.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) fail('Invalid identifier.');
  return value.toLowerCase();
};
const username = (value) => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_]{3,24}$/.test(name)) fail('Use 3–24 letters, numbers, or underscores.');
  return name;
};
const makeInvite = () => randomBytes(24).toString('base64url');
const publicUser = (row) => ({id:row.profile, username:row.username});
const findUser = (db, profile) => one(db,'SELECT profile, username FROM social_usernames WHERE profile=$1',[profile]);
const findByName = (db, name) => one(db,
  'SELECT profile, username FROM social_usernames WHERE lower(username COLLATE "C")=lower($1 COLLATE "C")',[name]);
const wallTime = (stamp, zone) => `(CASE WHEN left(${zone},1) IN ('+','-')
  THEN timezone(${zone}::interval,${stamp}) ELSE timezone(${zone},${stamp}) END)`;

async function claimUsername(db, profile, value) {
  const name = username(value);
  try {
    await db.query('INSERT INTO social_usernames (profile,username) VALUES ($1,$2) ON CONFLICT (profile) DO NOTHING',[profile,name]);
  } catch (error) {
    if (error.code === '23505') fail('That username is taken. Choose another.',409);
    throw error;
  }
  return publicUser(await findUser(db,profile));
}

const groupFields = 'g.id, g.name, g.zone, g.owner, m.totals_only AS "totalsOnly"';
const groupsFor = (db, profile) => rows(db,`SELECT ${groupFields} FROM social_members m
  JOIN social_groups g ON g.id=m.group_id WHERE m.profile=$1 ORDER BY lower(g.name),g.id`,[profile]);

async function memberGroup(db, profile, id, lock = false) {
  const group = await one(db,`SELECT ${groupFields} FROM social_groups g
    JOIN social_members m ON m.group_id=g.id AND m.profile=$1 WHERE g.id=$2${lock ? ' FOR UPDATE OF g' : ''}`,[profile,uuid(id)]);
  if (!group) fail('Group not found.',404);
  return group;
}

async function invitedGroup(db, code, lock = false) {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(code.trim())) fail('Enter a valid invite code.');
  const group = await one(db,`SELECT id,name FROM social_groups WHERE invite_code=$1${lock ? ' FOR UPDATE' : ''}`,[code.trim()]);
  if (!group) fail('This invite is no longer valid.',404);
  return group;
}

async function friendship(db, profile, target) {
  return one(db,`SELECT * FROM social_friendships
    WHERE first_profile=least($1,$2) AND second_profile=greatest($1,$2)`,[profile,target]);
}

const relationship = (row, profile) => !row ? 'none' : row.accepted ? 'friend' :
  row.requested_by === profile ? 'outgoing' : 'incoming';

const friendsFor = (db, profile) => rows(db,`SELECT u.profile AS id,u.username,
    CASE WHEN f.accepted THEN 'friend' WHEN f.requested_by=$1 THEN 'outgoing' ELSE 'incoming' END AS relationship
  FROM social_friendships f JOIN social_usernames u ON u.profile=
    CASE WHEN f.first_profile=$1 THEN f.second_profile ELSE f.first_profile END
  WHERE $1 IN (f.first_profile,f.second_profile) ORDER BY lower(u.username),u.profile`,[profile]);

async function changeFriendship(db, profile, {target:input, action}) {
  const target = uuid(input);
  if (profile === target) fail('Choose another member.');
  if (!await findUser(db,target)) fail('Member not found.',404);
  const pair = 'first_profile=least($1,$2) AND second_profile=greatest($1,$2)';
  if (action === 'request') {
    await db.query(`INSERT INTO social_friendships (first_profile,second_profile,requested_by)
      VALUES (least($1,$2),greatest($1,$2),$1) ON CONFLICT DO NOTHING`,[profile,target]);
  } else if (action === 'accept') {
    await db.query(`UPDATE social_friendships SET accepted=true WHERE ${pair} AND requested_by=$2`,[profile,target]);
  } else {
    const conditions = {decline:'NOT accepted AND requested_by=$2',cancel:'NOT accepted AND requested_by=$1',remove:'accepted'};
    if (!Object.hasOwn(conditions,action)) fail('Choose a friendship action.');
    await db.query(`DELETE FROM social_friendships WHERE ${pair} AND ${conditions[action]}`,[profile,target]);
  }
  return {relationship:relationship(await friendship(db,profile,target),profile)};
}

export async function recordQueue(db, profile, keys, appearedAt = null, groupId = null) {
  if (!keys.length) return;
  await db.query(`INSERT INTO social_queue (group_id,profile,week,problem,appeared_at)
    SELECT m.group_id,m.profile,date_trunc('week',${wallTime('t.appeared_at','g.zone')})::date,q.problem,t.appeared_at
    FROM social_members m JOIN social_groups g ON g.id=m.group_id
    CROSS JOIN unnest($2::text[]) AS q(problem)
    CROSS JOIN (SELECT coalesce($3::timestamptz,clock_timestamp()) AS appeared_at) t
    WHERE m.profile=$1 AND m.joined_at<=t.appeared_at AND ($4::uuid IS NULL OR g.id=$4)
    FOR KEY SHARE OF m
    ON CONFLICT (group_id,profile,week,problem) DO UPDATE SET appeared_at=excluded.appeared_at
    WHERE excluded.appeared_at < social_queue.appeared_at`,[profile,[...new Set(keys)],appearedAt,groupId]);
}

const accepted = (scope, verified = false) => `SELECT s.profile,s.problem,s.judge,min(s.stamp) AS stamp
  FROM submissions s JOIN ${scope} v ON v.profile=s.profile
  ${verified ? `JOIN profiles p ON p.id=s.profile
    JOIN account_verifications a ON a.profile=s.profile AND a.judge=s.judge AND a.verified_at IS NOT NULL
      AND a.handle=lower(p.settings->'handles'->>s.judge)` : ''}
  WHERE s.verdict IN ('AC','OK') AND s.judge IN ('Codeforces','AtCoder','Timus')
    AND (s.judge<>'Codeforces' OR NOT EXISTS (SELECT 1 FROM codeforces_verification_submissions x WHERE x.id=s.id))
  GROUP BY s.profile,s.problem,s.judge`;

async function standings(db, group, week) {
  return rows(db,`WITH members AS (
    SELECT m.profile,m.joined_at,u.username FROM social_members m
    JOIN social_usernames u ON u.profile=m.profile WHERE m.group_id=$1
  ), first_acceptance AS (${accepted('members',true)}), period AS (
    SELECT (date_trunc('week',${wallTime('now()','$2::text')})::date - $3::int * 7) AS week
  ), eligible AS (
    SELECT a.profile,a.problem,to_timestamp(a.stamp) AS solved_at,${wallTime('to_timestamp(a.stamp)','$2::text')}::date AS day
    FROM first_acceptance a JOIN members m ON m.profile=a.profile
    WHERE to_timestamp(a.stamp)>=m.joined_at AND to_timestamp(a.stamp)<=now()
  )
  SELECT m.profile AS id,m.username,count(e.problem)::int AS solved,count(DISTINCT e.day)::int AS "activeDays",
    count(q.problem)::int AS grind
  FROM members m CROSS JOIN period p
  LEFT JOIN eligible e ON e.profile=m.profile AND e.day>=p.week AND e.day<p.week+7
  LEFT JOIN social_queue q ON q.group_id=$1 AND q.profile=m.profile AND q.week=p.week
    AND q.problem=e.problem AND q.appeared_at<e.solved_at
  GROUP BY m.profile,m.username ORDER BY lower(m.username),m.profile`,[group.id,group.zone,week]);
}

function publicProblem(data) {
  if (!data || data.gym) return null;
  if (['Codeforces','AtCoder'].includes(data.judge) && (data.finished !== true || !data.date)) return null;
  if (!['Codeforces','AtCoder','Timus','CSES','USACO'].includes(data.judge)) return null;
  const safe = normalizeLink(data.url);
  if (!safe || safe.gym || safe.key !== data.key || safe.judge !== data.judge) return null;
  return {...safe,title:typeof data.title === 'string' && data.title.trim() ? data.title : safe.title};
}

const friendsScope = `SELECT CASE WHEN f.first_profile=$1 THEN f.second_profile ELSE f.first_profile END AS profile
  FROM social_friendships f WHERE f.accepted AND $1 IN (f.first_profile,f.second_profile)`;
const groupScope = `SELECT m.profile FROM social_members mine JOIN social_members m USING (group_id)
  WHERE mine.profile=$1 AND m.profile<>$1 AND NOT m.totals_only`;

async function activity(db, profile, filter, target = null) {
  let scope = friendsScope;
  const params = [profile];
  if (filter === 'all') scope += ' UNION ' + groupScope;
  if (filter === 'group') {
    scope = groupScope + ' AND m.group_id=$2';
    params.push(target);
  }
  if (filter === 'person') {
    scope = 'SELECT profile FROM (' + friendsScope + ') AS friends WHERE profile=$2';
    params.push(target);
  }
  const data = await rows(db,`WITH visible AS (${scope}), synced AS (${accepted('visible')}), solves AS (
    SELECT profile,problem,stamp,(to_timestamp(stamp) AT TIME ZONE 'UTC')::text AS sort_at,'synced' AS source FROM synced
    WHERE to_timestamp(stamp)<=now()
    UNION ALL
    SELECT m.profile,m.problem,NULL,m.day||' 00:00:00',m.origin FROM solves m
    JOIN visible v ON v.profile=m.profile JOIN profiles p ON p.id=m.profile
    WHERE m.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND m.day<=to_char(${wallTime('now()',"(p.settings->>'zone')")},'YYYY-MM-DD')
      AND NOT EXISTS (SELECT 1 FROM synced s WHERE s.profile=m.profile AND s.problem=m.problem AND to_timestamp(s.stamp)<=now())
  )
  SELECT s.profile,u.username,s.stamp,s.source,left(s.sort_at,10) AS day,c.data
  FROM solves s JOIN catalog c ON c.profile=s.profile AND c.key=s.problem
  JOIN social_usernames u ON u.profile=s.profile
  WHERE c.judge IN ('Timus','CSES','USACO') OR (c.judge IN ('Codeforces','AtCoder')
    AND s.problem NOT LIKE 'gym:%' AND c.data->'finished'='true'::jsonb AND c.data->>'date' IS NOT NULL)
  ORDER BY s.sort_at DESC,s.profile,s.problem LIMIT 50`,params);
  return data.flatMap(row=>{
    const problem = publicProblem(row.data);
    return problem && isDay(row.day) ? [{user:publicUser(row),day:row.day,stamp:row.stamp,source:row.source,
      problem:{key:problem.key,judge:problem.judge,title:problem.title,url:problem.url}}] : [];
  });
}

async function friendProfile(db, profile, id) {
  if (!(await friendship(db,profile,id))?.accepted) fail('Friend profile not found.',404);
  const user = publicUser(await findUser(db,id));
  const {zone} = await settingsFor(db,profile);
  const summary = await one(db,`WITH person AS (SELECT $1::text AS profile), synced AS (
    SELECT a.problem,to_char(${wallTime('to_timestamp(a.stamp)','$2::text')},'YYYY-MM-DD') AS day
    FROM (${accepted('person')}) a WHERE to_timestamp(a.stamp)<=now()
  ), dates AS (
    SELECT day FROM synced
    UNION ALL
    SELECT m.day FROM solves m WHERE m.profile=$1 AND m.day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND NOT EXISTS (SELECT 1 FROM synced s WHERE s.problem=m.problem)
  ), period AS (
    SELECT ${wallTime('now()','$2::text')} AS today
  )
  SELECT count(*)::int AS solved,count(DISTINCT day)::int AS "activeDays" FROM dates CROSS JOIN period
  WHERE day BETWEEN to_char(date_trunc('week',today),'YYYY-MM-DD') AND to_char(today,'YYYY-MM-DD')`,[id,zone]);
  return {user,summary,activity:await activity(db,profile,'person',id)};
}

async function groupAction(db, profile, {action,id,code,name,target,totalsOnly}, queueFor) {
  if (action === 'create' || action === 'join') {
    let groupId, inviteCode;
    if (action === 'create') {
      const title = typeof name === 'string' ? name.trim() : '';
      if (!title || title.length > 60) fail('Enter a group name of 1–60 characters.');
      const {zone} = await settingsFor(db,profile);
      groupId = randomUUID();
      inviteCode = makeInvite();
      await db.query('INSERT INTO social_groups (id,name,zone,owner,invite_code) VALUES ($1,$2,$3,$4,$5)',
        [groupId,title,zone,profile,inviteCode]);
    } else groupId = (await invitedGroup(db,code,true)).id;
    const added = await one(db,`INSERT INTO social_members (group_id,profile) VALUES ($1,$2)
      ON CONFLICT DO NOTHING RETURNING profile`,[groupId,profile]);
    if (added) {
      await recordQueue(db,profile,await queueFor(db,profile),null,groupId);
    }
    return {id:groupId,inviteCode};
  }
  const group = await memberGroup(db,profile,id,true);
  if (action === 'share') {
    if (typeof totalsOnly !== 'boolean') fail('Choose a sharing preference.');
    await db.query('UPDATE social_members SET totals_only=$3 WHERE group_id=$1 AND profile=$2',[group.id,profile,totalsOnly]);
  } else if (action === 'leave') {
    if (group.owner === profile) {
      if (await one(db,'SELECT 1 FROM social_members WHERE group_id=$1 AND profile<>$2',[group.id,profile])) {
        fail('Transfer ownership before leaving this group.',409);
      }
      await db.query('DELETE FROM social_groups WHERE id=$1',[group.id]);
    } else await db.query('DELETE FROM social_members WHERE group_id=$1 AND profile=$2',[group.id,profile]);
  } else {
    if (group.owner !== profile) fail('Only the group owner can do that.',403);
    if (action === 'rotate') {
      const inviteCode = makeInvite();
      await db.query('UPDATE social_groups SET invite_code=$2 WHERE id=$1',[group.id,inviteCode]);
      return {id:group.id,inviteCode};
    }
    const member = uuid(target);
    if (member === profile) fail('Choose another group member.');
    await memberGroup(db,member,group.id);
    if (action === 'transfer') await db.query('UPDATE social_groups SET owner=$2 WHERE id=$1',[group.id,member]);
    else if (action === 'remove') await db.query('DELETE FROM social_members WHERE group_id=$1 AND profile=$2',[group.id,member]);
    else fail('Choose a group action.');
  }
  return {id:group.id};
}

export async function socialApi(pool, profile, action, body, queueFor, publicOrigin) {
  if (action === 'identity') return {user:(await findUser(pool,profile).then(user=>user && publicUser(user))) ?? null};
  if (action === 'username') return {user:await claimUsername(pool,profile,body.username)};
  if (action === 'queue') {
    return transaction(pool,async db=>{
      if (await one(db,'SELECT 1 FROM social_members WHERE profile=$1 LIMIT 1',[profile])) {
        await recordQueue(db,profile,await queueFor(db,profile));
      }
      return {ok:true};
    },{profile});
  }
  return transaction(pool,async db=>{
    const user = await findUser(db,profile);
    if (!user) fail('Choose a username to use Social.',409);
    if (action === 'home') return {user:publicUser(user),groups:await groupsFor(db,profile),friends:await friendsFor(db,profile),publicOrigin};
    if (action === 'lookup') {
      const match = await findByName(db,username(typeof body.username === 'string' ? body.username.trim().replace(/^@/,'') : ''));
      if (!match || match.profile === profile) fail('No other member has that username.',404);
      return {...publicUser(match),relationship:relationship(await friendship(db,profile,match.profile),profile)};
    }
    if (action === 'friend') return changeFriendship(db,profile,body);
    if (action === 'friend-profile') return friendProfile(db,profile,uuid(body.id));
    if (action === 'invite') return invitedGroup(db,body.code);
    if (action === 'group-action') return groupAction(db,profile,body,queueFor);
    if (action === 'activity') {
      const filter = body.filter ?? 'all';
      if (!['all','friends','group'].includes(filter)) fail('Choose an activity filter.');
      const target = filter === 'group' ? (await memberGroup(db,profile,body.id)).id : null;
      return {activity:await activity(db,profile,filter,target)};
    }
    if (action === 'group') {
      const group = await memberGroup(db,profile,body.id);
      const invite = group.owner===profile
        ? await one(db,'SELECT invite_code AS "inviteCode" FROM social_groups WHERE id=$1',[group.id])
        : {};
      const members = await rows(db,`SELECT u.profile AS id,u.username,
          CASE WHEN f.accepted THEN 'friend' WHEN f.requested_by=$1 THEN 'outgoing'
            WHEN f.requested_by=m.profile THEN 'incoming' ELSE 'none' END AS relationship
        FROM social_members m JOIN social_usernames u ON u.profile=m.profile
        LEFT JOIN social_friendships f ON f.first_profile=least($1,m.profile) AND f.second_profile=greatest($1,m.profile)
        WHERE m.group_id=$2 ORDER BY lower(u.username),u.profile`,[profile,group.id]);
      return {group,members,...invite,standings:await standings(db,group,body.week === 'last' ? 1 : 0),
        activity:await activity(db,profile,'group',group.id)};
    }
    fail('Route not found.',404);
  },action==='group-action' ? {profile} : {readOnly:action!=='friend'});
}
