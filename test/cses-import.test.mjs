import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { csesBookmark, csesTasksUrl, readCsesBookmark, readCsesFile } from '../web/cses-import.js';

function tasksDocument({account='/user/1',tasks=[
  ['https://cses.fi/problemset/task/1068/','full'],
  ['/problemset/task/1083','partial'],
  ['/problemset/task/1069','none'],
]}={}) {
  return {
    querySelector:()=>({getAttribute:()=>account}),
    querySelectorAll:()=>tasks.map(([href,score])=>({
      querySelector:selector=>selector==='a[href]'
        ? {getAttribute:()=>href}
        : {classList:Object.assign(['task-score','icon',score],{contains:value=>value===score})},
    })),
  };
}

test('bookmark sends only full-score task IDs to the app fragment',()=>{
  let destination;
  const bookmark=csesBookmark('http://127.0.0.1:4175/?unused=1#stats');
  runInNewContext(decodeURIComponent(bookmark.slice('javascript:'.length)),{
    URL,document:tasksDocument(),location:{href:csesTasksUrl,assign:url=>{destination=url;}},
    alert:message=>assert.fail(message),
  });
  assert.equal(destination,'http://127.0.0.1:4175/#import-cses=1068');
  assert.deepEqual(readCsesBookmark(new URL(destination).hash),{version:1,source:'cses',solves:[{id:'1068',day:null}]});
  assert.deepEqual(readCsesBookmark('#import-cses=1068,1068').solves,[{id:'1068',day:null}]);
  assert.deepEqual(readCsesBookmark('#import-cses=').solves,[]);
  assert.throws(()=>readCsesBookmark('#import-cses=1068,<html>'),/invalid/i);
});

test('bookmark rejects the wrong page and a signed-out task list',()=>{
  const script=decodeURIComponent(csesBookmark('http://127.0.0.1:4175/').slice('javascript:'.length));
  const alertFor=(href,account)=>{
    let shown;
    runInNewContext(script,{URL,document:tasksDocument({account}),location:{href,assign:()=>assert.fail('Unexpected navigation')},alert:value=>{shown=value;}});
    return shown;
  };
  assert.match(alertFor('https://cses.fi/problemset/stats/','/user/1'),/Tasks page first/i);
  assert.match(alertFor(csesTasksUrl,'https://cses.fi/login'),/sign in/i);
});

test('saved HTML is passed to the inert template and legacy JSON is still accepted',async t=>{
  let contents;
  t.mock.method(globalThis,'fetch',()=>assert.fail('Import should not request the saved page'));
  const previousDocument=globalThis.document;
  globalThis.document={createElement:tag=>{
    assert.equal(tag,'template');
    return {set innerHTML(value){contents=value;},content:tasksDocument()};
  }};
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const markup='<html><body>Saved CSES Tasks page</body></html>';
  assert.deepEqual((await readCsesFile(new File([markup],'CSES.htm'))).solves,[{id:'1068',day:null}]);
  assert.equal(contents,markup);
  const legacy={version:1,source:'cses',solves:[{id:'1068',day:'2026-11-19'}]};
  assert.deepEqual(await readCsesFile(new File([JSON.stringify(legacy)],'cses.json')),legacy);
  await assert.rejects(readCsesFile(new File(['invalid'],'cses.json')),/not valid JSON/);
  await assert.rejects(readCsesFile(new File(['archive'],'CSES.webarchive')),/Page Source/);
});
