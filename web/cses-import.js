import { extractCses } from '../extension/extract.js';

export const csesTasksUrl='https://cses.fi/problemset/list/';
export const csesImportHash='#import-cses=';

export function csesBookmark(appUrl) {
  const destination=new URL(appUrl);
  destination.hash='';
  destination.search='';
  const script=`(() => {
    const result=(${extractCses.toString()})();
    if(result.error) { alert(result.error); return; }
    location.assign(${JSON.stringify(destination.href+csesImportHash)}+result.solves.map(solve=>solve.id).join(','));
  })();`;
  return 'javascript:'+encodeURIComponent(script);
}

export function readCsesBookmark(hash) {
  const csv=hash.slice(csesImportHash.length);
  if (!hash.startsWith(csesImportHash) || csv.length>25999) throw new Error('The CSES bookmark import is invalid. Run the bookmark again on the Tasks page.');
  const ids=csv ? csv.split(',') : [];
  if (ids.length>2000 || ids.some(id=>!/^\d{1,12}$/.test(id))) throw new Error('The CSES bookmark import is invalid. Run the bookmark again on the Tasks page.');
  return {version:1,source:'cses',solves:[...new Set(ids)].map(id=>({id,day:null}))};
}

export async function readCsesFile(file) {
  if (file.size>2_000_000) throw new Error('This file is too large. Save the CSES Tasks page as HTML only or Page Source.');
  if (/\.json$/i.test(file.name)) {
    try { return JSON.parse(await file.text()); }
    catch { throw new Error('This file is not valid JSON. Choose a CSES extension export or a saved Tasks page.'); }
  }
  if (!/\.html?$/i.test(file.name)) throw new Error('Choose an .html or .htm file. In Safari use Page Source and in other desktop browsers use HTML only.');
  // Template contents stay inert. The saved page is neither rendered nor sent to the server.
  const template=document.createElement('template');
  template.innerHTML=await file.text();
  const result=extractCses(template.content,csesTasksUrl);
  if (result.error) throw new Error(result.error);
  return result;
}
