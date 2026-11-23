import { createClient } from '@supabase/supabase-js';

export const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseConfig(env = process.env) {
  const url = new URL(env.SUPABASE_URL ?? 'http://invalid');
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (!env.SUPABASE_URL || url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('Set SUPABASE_URL to your Supabase project URL or local Supabase endpoint.');
  }
  if (!key || (!key.startsWith('sb_publishable_') && !isAnonKey(key))) {
    throw new Error('Set SUPABASE_PUBLISHABLE_KEY to your Supabase publishable or legacy anon key.');
  }
  return {url:url.toString().replace(/\/$/, ''), key};
}

function isAnonKey(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url')).role === 'anon'; }
  catch { return false; }
}

export function accountVerifier({url,key}) {
  const {auth} = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input, init) => fetch(input,{...init,signal:AbortSignal.timeout(7000)})}});
  return async header => {
    const token = /^Bearer ([\w.-]+)$/i.exec(header ?? '')?.[1];
    if (!token) return null;
    const {data,error} = await auth.getUser(token);
    if (error) {
      if (!error.status || error.status >= 500) throw Object.assign(new Error('Sign-in is temporarily unavailable.'),{status:503});
      return null;
    }
    const user = data.user;
    return user?.email_confirmed_at && !user.is_anonymous && accountIdPattern.test(user.id) ? user.id.toLowerCase() : null;
  };
}
