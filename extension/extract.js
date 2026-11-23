export function extractCses(doc = document, page = location.href) {
  const url = new URL(page);
  if (url.origin !== 'https://cses.fi' || !/^\/problemset(?:\/list)?\/?$/.test(url.pathname)) {
    return {error:'Open the CSES Problem Set Tasks page first.'};
  }
  const account = doc.querySelector('a.account')?.getAttribute('href');
  if (!account || /\/login(?:[/?#]|$)/.test(account)) {
    return {error:'Sign in to CSES and reopen the task list.'};
  }
  const rows = [...doc.querySelectorAll('ul.task-list li.task')];
  if (!rows.length) return {error:'The CSES task list could not be read.'};
  const good = new Set();
  const recognized = new Set(['task-score','icon','full','partial','zero','none']);
  for (const row of rows) {
    const href = row.querySelector('a[href]')?.getAttribute('href');
    let id;
    if (href) {
      try {
        const task = new URL(href, url);
        if (task.origin === url.origin) id = task.pathname.match(/^\/problemset\/task\/(\d{1,12})\/?$/)?.[1];
      } catch { /* A malformed task link cannot be imported. */ }
    }
    const verdict = row.querySelector('.task-score.icon');
    if (!id || !verdict || [...verdict.classList].some(token=>!recognized.has(token))) {
      return {error:'Could not read the CSES task links or score markers. Open the signed-in Tasks page and try again.'};
    }
    if (verdict.classList.contains('full')) good.add(id);
  }
  return {version:1,source:'cses',solves:[...good].map(id=>({id,day:null}))};
}
