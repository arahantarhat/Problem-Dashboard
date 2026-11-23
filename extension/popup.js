import { extractCses } from './extract.js';

const button = document.querySelector('button');
const status = document.querySelector('[role="status"]');
button.addEventListener('click', async () => {
  button.disabled=true;
  document.querySelector('#open-import').hidden=true;
  status.textContent='Reading the active tab…';
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !/^https:\/\/cses\.fi\/problemset(?:\/list)?\/?(?:[?#]|$)/.test(tab.url ?? '')) {
      throw new Error('Open the signed-in CSES problemset before exporting.');
    }
    const [response] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:extractCses});
    const value = response?.result;
    if (!value || value.error) throw new Error(value?.error ?? 'Could not read the active CSES tab.');
    const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    const a = document.createElement('a');
    a.href=url;
    a.download='unified-training-cses.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent='Exported '+value.solves.length+' solved tasks.';
    const destination=document.querySelector('#open-import');
    destination.href='http://127.0.0.1:4175/#import-cses='+value.solves.map(solve=>solve.id).join(',');
    destination.hidden=false;
  } catch (e) {
    status.textContent=e.message;
  } finally {
    button.disabled=false;
  }
});
