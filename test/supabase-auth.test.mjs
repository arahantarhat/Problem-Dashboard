import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { requestApi, startServer, testDatabase } from './database-fixture.mjs';

const {TEST_DATABASE_URL,TEST_SUPABASE_URL,TEST_SUPABASE_PUBLISHABLE_KEY,TEST_MAILPIT_URL}=process.env;
const skip=!(TEST_DATABASE_URL && TEST_SUPABASE_URL && TEST_SUPABASE_PUBLISHABLE_KEY && TEST_MAILPIT_URL)
  && 'Set the TEST_SUPABASE and TEST_MAILPIT variables to exercise real email and password flows.';

async function emailCode(email, subject) {
  const stop=Date.now()+15000;
  while(Date.now()<stop) {
    const list=await fetch(new URL('/api/v1/messages',TEST_MAILPIT_URL));
    assert.ok(list.ok,'Mailpit should be available');
    const {messages}=await list.json();
    const item=messages.find(message=>message.Subject===subject && message.To.some(to=>to.Address.toLowerCase()===email));
    if(item) {
      const {HTML,Text}=await (await fetch(new URL('/api/v1/message/'+item.ID,TEST_MAILPIT_URL))).json();
      const code=(HTML || Text).match(/\b\d{6,10}\b/)?.[0];
      assert.ok(code,'Email template must include an OTP');
      return code;
    }
    await delay(200);
  }
  assert.fail('No matching authentication email received: '+subject);
}

test('Supabase confirms two accounts, isolates their data, and resets a password from email', {skip,timeout:60000}, async t=>{
  const {url}=await testDatabase(t);
  const app=await startServer(t,url,TEST_SUPABASE_URL,TEST_SUPABASE_PUBLISHABLE_KEY);
  const newClient=()=>createClient(TEST_SUPABASE_URL,TEST_SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
  });
  const password='Test-'+randomUUID()+'-A1';
  const confirmed=async(training_username)=>{
    const {auth}=newClient();
    const email='ut-'+randomUUID()+'@example.com';
    const signup=await auth.signUp({email,password,options:{data:{training_username}}});
    assert.ifError(signup.error);
    assert.equal(signup.data.session,null);
    assert.equal((await auth.signInWithPassword({email,password})).error?.code,'email_not_confirmed');
    const token=await emailCode(email,'Confirm your Unified Training account');
    const verified=await auth.verifyOtp({email,token,type:'email'});
    assert.ifError(verified.error);
    assert.ok(verified.data.user.email_confirmed_at);
    assert.equal(verified.data.user.user_metadata.training_username,training_username);
    assert.ifError((await auth.signOut({scope:'local'})).error);
    const signedIn=await auth.signInWithPassword({email,password});
    assert.ifError(signedIn.error);
    return {auth,email,token:signedIn.data.session.access_token};
  };
  const first=await confirmed('SocialTester');
  const second=await confirmed('socialtester');
  assert.equal((await requestApi(app,'social/username',{username:'SocialTester'},first)).status,200);
  assert.equal((await requestApi(app,'social/username',{username:'socialtester'},second)).status,409);
  assert.equal((await requestApi(app,'social/username',{username:'SecondTester'},second)).status,200);
  assert.equal((await requestApi(app,'state',undefined,{mode:'demo'})).status,401);
  assert.equal((await requestApi(app,'settings',{}, {mode:'demo',token:first.token})).status,403);
  assert.equal((await requestApi(app,'cses/import',{source:'cses',version:1,solves:[{id:'1068',day:'2025-05-01'}]},first)).status,200);
  const firstState=await (await requestApi(app,'state',undefined,first)).json();
  const secondState=await (await requestApi(app,'state',undefined,second)).json();
  assert.equal(firstState.stats.timeline[0].key,'cses:1068');
  assert.equal(secondState.stats.timeline.length,0);

  assert.ifError((await first.auth.signOut({scope:'local'})).error);
  assert.equal((await first.auth.getSession()).data.session,null);
  assert.ifError((await first.auth.resetPasswordForEmail(first.email)).error);
  const code=await emailCode(first.email,'Reset your Unified Training password');
  const recovery=await first.auth.verifyOtp({email:first.email,token:code,type:'recovery'});
  assert.ifError(recovery.error);
  const nextPassword='New-'+randomUUID()+'-B2';
  assert.ifError((await first.auth.updateUser({password:nextPassword})).error);
  assert.ifError((await first.auth.signOut({scope:'global'})).error);
  assert.equal((await first.auth.signInWithPassword({email:first.email,password})).error?.code,'invalid_credentials');
  const renewed=await first.auth.signInWithPassword({email:first.email,password:nextPassword});
  assert.ifError(renewed.error);
  const persisted=await (await requestApi(app,'state',undefined,{token:renewed.data.session.access_token})).json();
  assert.equal(persisted.stats.timeline[0].key,'cses:1068');
});
