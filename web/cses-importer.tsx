import { useEffect, useState } from 'react';
import { Bookmark, Upload } from 'lucide-react';
import { csesBookmark, csesTasksUrl, readCsesBookmark, readCsesFile } from './cses-import.js';
import type { Requester } from './rules';
import type { ImportFile, ImportRow, State } from './types';
import { Button, Field, Modal, Notice } from './ui';

type Review={file:ImportFile;rows:ImportRow[]};

function CsesTasksLink() {
  return <a href={csesTasksUrl} target="_blank" rel="noreferrer">CSES Tasks page</a>;
}

export function CsesImporter({request,done,close,bookmark,profile}:{request:Requester;done:(s:State)=>void;close:()=>void;bookmark?:string;profile:'local'|'demo'}) {
  const [review,setReview]=useState<Review|null>(null);
  const [busy,setBusy]=useState(!!bookmark);
  const [error,setError]=useState('');
  const [bookmarkHint,setBookmarkHint]=useState(false);
  const appUrl=new URL(window.location.pathname,window.location.origin).href;
  const bookmarkUrl=csesBookmark(appUrl);

  useEffect(()=>{
    if(bookmark===undefined) return;
    let current=true;
    void (async()=>{
      try {
        const file=readCsesBookmark(bookmark);
        const rows=await request<ImportRow[]>('/api/cses/preview',file);
        if(current)setReview({file,rows});
      } catch(e) {if(current)setError((e as Error).message);}
      finally {if(current)setBusy(false);}
    })();
    return ()=>{current=false;};
  },[bookmark,request]);

  const previewFile=async(data?:File)=>{
    if(!data||busy)return;
    setBusy(true);setError('');
    try {
      const file=await readCsesFile(data);
      const rows=await request<ImportRow[]>('/api/cses/preview',file);
      setReview({file,rows});
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  };
  const importSolves=async()=>{
    if(!review?.rows.length||busy)return;
    setBusy(true);setError('');
    try {done(await request<State>('/api/cses/import',review.file));close();}
    catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  };
  const newCount=review?.rows.filter(row=>!row.previous).length??0;

  return <Modal title="Import CSES progress" description="Bring over your full-score solves from CSES." close={close}>
    <div className="dialog-body form-stack">
      {error&&<Notice type="error">{error}</Notice>}
      {busy&&!review&&<Notice>Preparing your CSES preview…</Notice>}
      {review ? <div className="preview">
        <strong>{newCount} new · {review.rows.length-newCount} already recorded</strong>
        <p>Importing into {profile==='local'?'My personal profile':'the Demo profile'}.</p>
        {review.rows.length===0 ? <p>No full-score solves were found on this page.</p> : <>
          <p>CSES page imports have no solve dates. Add dates in Stats to include them in activity.</p>
          {review.rows.slice(0,6).map(row=><p key={row.id}>{row.problem.title}{row.previous?' · Already recorded':''}</p>)}
          {review.rows.length>6&&<p>And {review.rows.length-6} more</p>}
        </>}
      </div> : <>
          <div className="cses-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void previewFile(e.dataTransfer.files[0]);}}>
            <Field label="Choose or drop a CSES file" hint="Saved HTML or an existing Unified Training JSON export.">
              <input type="file" accept=".html,.htm,.json,text/html,application/json" disabled={busy}
                onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void previewFile(file);}}/>
            </Field>
          </div>
          <p>Unified Training reads the file locally and sends only the solve records for review.</p>
        <details className="preview cses-method">
          <summary>How to save the CSES page</summary>
          <ol className="import-steps">
            <li>Sign in to CSES and open the <CsesTasksLink/>. Make sure you can see your solve markers beside the tasks.</li>
            <li>Save that page from your browser. Choose the HTML option for your browser.
              <ul className="import-steps">
                <li><strong>Safari on Mac</strong> — Choose <strong>File → Save As</strong>, then <strong>Page Source</strong> in the Format menu.</li>
                <li><strong>Chrome, Firefox, Edge, and Vivaldi</strong> — Press <kbd>⌘S</kbd> on Mac or <kbd>Ctrl+S</kbd> on Windows or Linux, then choose <strong>HTML Only</strong>.</li>
              </ul>
            </li>
            <li>Choose or drop the saved <code>.html</code> or <code>.htm</code> file above. Review the solves, then click <strong>Import solves</strong>.</li>
          </ol>
        </details>
        <details className="preview cses-method">
          <summary>Set up a bookmark for repeat imports</summary>
          <ol className="import-steps">
            <li>Use the same desktop browser for Unified Training and CSES. If you’re in the macOS app, leave it running, open <code>{appUrl}</code> in your browser, and reopen this dialog there.</li>
            <li>Show your bookmarks bar. In Safari, use <strong>View → Show Favorites Bar</strong>. In Chrome or Edge, press <kbd>⌘⇧B</kbd> on Mac or <kbd>Ctrl+Shift+B</kbd> on Windows or Linux. In Firefox, use <strong>View → Toolbars → Bookmarks Toolbar</strong>.</li>
            <li>Drag the <strong>Import CSES solves</strong> link below onto that bar. You only need to do this once.</li>
            <li>Open the <CsesTasksLink/> while signed in. Click the new bookmark in your browser’s bar. It opens a preview in your Unified Training profile. Review it and click <strong>Import solves</strong>.</li>
          </ol>
          <a className="cses-bookmark" draggable ref={element=>{element?.setAttribute('href',bookmarkUrl);}}
            onClick={e=>{e.preventDefault();setBookmarkHint(true);}}><Bookmark size={16}/>Import CSES solves</a>
          {bookmarkHint&&<Notice>Drag this link onto your bookmarks bar, then click the saved bookmark from the CSES Tasks page.</Notice>}
          <p>If the browser won’t save or run the bookmark, use the saved-page option above.</p>
        </details>
      </>}
    </div>
    <div className="dialog-actions">
      <Button onClick={close}>Cancel</Button>
      {review&&<><Button disabled={busy} onClick={()=>{setReview(null);setError('');}}>Import options</Button>
        <Button variant="main" disabled={busy||!review.rows.length} onClick={()=>void importSolves()}><Upload size={15}/>{busy?'Importing…':'Import solves'}</Button></>}
    </div>
  </Modal>;
}
