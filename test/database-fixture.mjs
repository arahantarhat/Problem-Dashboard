import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ensureProfile, migrateDatabase, openDatabase } from '../server/db.mjs';

export const databaseTest = {
  skip: !process.env.TEST_DATABASE_URL && 'Set TEST_DATABASE_URL to run PostgreSQL tests.'
};
export const owner = '2cb5f6c2-f444-465a-8a29-651342460527';
export const other = 'd6186b34-6578-4246-95e0-aa267b24c734';

export async function testDatabase(t) {
  const url = new URL(process.env.TEST_DATABASE_URL);
  const name = 'ut_test_' + randomUUID().replaceAll('-','');
  const admin = new pg.Client({connectionString:url.href});
  await admin.connect();
  try { await admin.query('CREATE DATABASE ' + name); }
  catch (error) { await admin.end(); throw error; }
  url.pathname = '/'+name;
  const db = openDatabase(url.href);
  t.after(async()=>{
    await db.end();
    try { await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)'); }
    finally { await admin.end(); }
  });
  await migrateDatabase(db);
  await ensureProfile(db,owner);
  await ensureProfile(db,'demo');
  return {db,url:url.href};
}

export async function testServer(t, databaseUrl) {
  const identities = {owner,other,unconfirmed:other};
  const auth = createServer((req,res)=>{
    const token=req.headers.authorization?.slice('Bearer '.length);
    const id=Object.hasOwn(identities,token) && identities[token];
    res.setHeader('Content-Type','application/json');
    if(req.url!=='/auth/v1/user' || !id) {
      res.writeHead(401);
      return res.end(JSON.stringify({message:'Invalid token'}));
    }
    return res.end(JSON.stringify({id,email_confirmed_at:token==='unconfirmed'?null:'2026-01-01T00:00:00Z'}));
  });
  auth.listen(0,'127.0.0.1');
  await once(auth,'listening');
  const authUrl='http://127.0.0.1:'+auth.address().port;
  const base=await startServer(t,databaseUrl,authUrl,'sb_publishable_test',{mockJudges:true});
  t.after(()=>new Promise(resolve=>auth.close(resolve)));
  return (path,payload,{mode='personal',token='owner'}={})=>requestApi(base,path,payload,{mode,token});
}

export async function startServer(t,databaseUrl,authUrl,key,{mockJudges=false}={}) {
  const preload = mockJudges ? ['--import',fileURLToPath(new URL('./judge-fixture.mjs',import.meta.url))] : [];
  const app=spawn(process.execPath,[...preload,'server/index.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,
    PORT:'0',DATABASE_URL:databaseUrl,SUPABASE_URL:authUrl,SUPABASE_PUBLISHABLE_KEY:key}});
  const exit=once(app,'exit');
  t.after(async()=>{
    app.kill();
    await exit;
  });
  let log='';
  app.stderr.on('data',data=>{log+=data;});
  const base=await new Promise((resolve,reject)=>{
    app.once('error',reject);
    app.once('exit',code=>reject(new Error('Test server exited with '+code+'\n'+log)));
    app.stdout.on('data',data=>{
      const url=data.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if(url)resolve(url);
    });
  });
  return base;
}

export function requestApi(base,path,payload,{mode='personal',token}={}) {
  return fetch(base+'/api/'+path+'?profile='+encodeURIComponent(mode),{
    method:payload===undefined?'GET':'POST',
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(payload===undefined?{}:{'Content-Type':'application/json'})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
}
