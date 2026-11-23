import { setTimeout as delay } from 'node:timers/promises';

const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input==='string' || input instanceof URL ? input : input.url);
  if (url.href.startsWith('https://codeforces.com/api/user.rating?')) {
    await delay(750);
    return Response.json({status:'OK',result:[]});
  }
  if (url.href.startsWith('https://codeforces.com/api/user.status?')) {
    return Response.json({status:'OK',result:[]});
  }
  return networkFetch(input,options);
};
