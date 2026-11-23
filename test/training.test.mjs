import test from 'node:test';
import assert from 'node:assert/strict';
import { dateWindows, defaultSettings, normalizeLink, validateSettings } from '../server/domain.mjs';
import { collectSolves, resolve } from '../server/resolve.mjs';
import { filterMatches, rankAndMix } from '../server/worker.mjs';
import { parseCses, parseEnglish, parseUsacoDivision } from '../server/judges.mjs';
import { extractCses } from '../extension/extract.js';
import { one, settingsFor, saveSettings } from '../server/db.mjs';
import { databaseTest, testDatabase, owner } from './database-fixture.mjs';
import { seedDemo } from '../server/demo.mjs';

const now = new Date('2026-11-19T16:00:00Z');
const stamp=(day)=>Date.parse(day)/1000;
const at=(number,index,difficulty,extra={})=>({...normalizeLink('https://atcoder.jp/contests/abc'+number+'/tasks/abc'+number+'_'+index.toLowerCase()),title:'ABC '+number+index,index,series:'ABC',difficulty,english:true,...extra});
const cf=(contest,index,difficulty,date,division=3)=>({...normalizeLink('https://codeforces.com/contest/'+contest+'/problem/'+index),title:'CF '+contest+index,difficulty,date,division});
const base=(problems)=>({problems,settings:defaultSettings(),submissions:[],lists:[],manual:[],sync:{AtCoder:{rating:1400}}});

test('Bend evaluates inclusive intervals and apportions capped queues without duplicates',()=>{
  assert.deepEqual(filterMatches([[0,-12000,0],[1900,1900,2100],[2200,1900,2100]]),[true,true,false]);
  const lane=(group, ids)=>({group,id:group,weight:1,cap:100,candidates:ids.map(key=>({p:{key}}))});
  const result=rankAndMix([lane('atcoder',['same','a']),lane('upsolve',['same','x','y']),lane('manual',['m'])],{atcoder:80,upsolve:20,manual:10},1);
  assert.deepEqual(result.map(item=>item.p.key),['same','a','x','m']);
});

test('legacy profiles alternate eligible sources automatically and keep their custom shares and caps',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const settings=defaultSettings();
  delete settings.queueMode;
  settings.upsolveCap=0;
  settings.shares.manual=0;
  await saveSettings(db,owner,settings);
  const loaded=await settingsFor(db,owner);
  assert.equal(loaded.queueMode,'automatic');
  assert.equal(validateSettings(settings).queueMode,'automatic');
  assert.throws(()=>validateSettings({...settings,queueMode:'other'}),/Automatic or Custom/);
  const lane=(group,cap,keys,weight=1)=>({
    group,id:group,weight,cap,candidates:keys.map(key=>({p:{key}}))
  });
  const lanes=[
    lane('atcoder',100,['shared','a','b']),
    lane('upsolve',100,['upsolve']),
    lane('manual',0,['shared','manual']),
    lane('timus',100,['paused'],0),
  ];
  const automatic=rankAndMix(lanes,loaded.shares,loaded.upsolveCap,loaded.queueMode);
  assert.deepEqual(automatic.map(({p})=>p.key),['shared','upsolve','manual','a','b']);
  const custom=validateSettings({...loaded,queueMode:'custom'});
  assert.deepEqual(custom.shares,settings.shares);
  assert.equal(custom.upsolveCap,0);
  assert.deepEqual(rankAndMix(lanes,custom.shares,custom.upsolveCap,custom.queueMode).map(({p})=>p.key),['shared','a','b']);
  const many=lane('manual',0,Array.from({length:120},(_,index)=>'problem-'+index));
  assert.equal(rankAndMix([many],loaded.shares,0,'automatic').length,100);
});

test('AtCoder cutoff, band, language and experimental filters',()=>{
  const s=base([at(211,'D',1700),at(212,'D',1700),at(213,'D',1800),
    at(214,'D',1801),at(215,'D',1710,{english:false}),at(216,'D',1720,{experimental:true}),at(217,'D',1720,{english:undefined})]);
  s.settings.atcoder.series[0].since='abc212';
  const view=resolve(s,now);
  assert.deepEqual(view.queue.map(p=>p.contest),['abc212','abc213']);
  assert.equal(view.ruleOptions.find(r=>r.id==='atcoder:ABC').pending,1);
});

test('a failed official submission opens a contest and inclusive F includes F1/F2',()=>{
  const s=base([cf(1,'E',1500,'2019-12-31'),cf(1,'F1',1800,'2019-12-31'),cf(1,'F2',1900,'2019-12-31'),cf(1,'G',2300,'2019-12-31'),cf(2,'A',1400,'2020-01-01')]);
  s.submissions=[{problem:'cf:1:F2',stamp:1,verdict:'WRONG_ANSWER',participation:'CONTESTANT',in_round:1}];
  s.settings.grind={enabled:true,intervals:[[1400,1600]],since:'2020-01-01'};
  s.settings.shares.grind=10;
  const view=resolve(s,now);
  assert.deepEqual(view.ruleRows['upsolve:div3'].map(p=>p.index),['F2','E','F1']);
  assert.deepEqual(view.ruleRows.grind.map(p=>p.key),['cf:2:A']);
});

test('optional upsolve rating bounds filter the queue and both round scopes',()=>{
  const ratings=[800,1200,1600,2000,undefined];
  const problems=ratings.map((rating,i)=>cf(50,'ABCDE'[i],rating,'2026-10-01'));
  const s=base(problems);
  s.submissions=[{problem:problems[0].key,stamp:1,verdict:'WRONG_ANSWER',participation:'CONTESTANT',in_round:1}];
  s.settings.upsolve.push({id:'archive',archive:true,enabled:true,division:0,cutoff:''});
  const ruleRows=()=>resolve(s,now).ruleRows;
  delete s.settings.upsolveMinRating;
  delete s.settings.upsolveMaxRating;
  assert.equal(ruleRows()['upsolve:div3'].length,5);
  s.settings=validateSettings({...s.settings,upsolveMinRating:1200});
  assert.deepEqual(ruleRows()['upsolve:div3'].map(p=>p.difficulty).sort(),[1200,1600,2000]);
  s.settings=validateSettings({...s.settings,upsolveMaxRating:1600});
  for (const allRounds of [false,true]) {
    s.settings.upsolve.find(rule=>rule.id==='div3').allRounds=allRounds;
    const view=resolve(s,now);
    assert.deepEqual(view.ruleRows['upsolve:div3'].map(p=>p.difficulty).sort(),[1200,1600]);
    assert.equal(view.ruleRows['rounds:archive'].length,5);
    assert.equal(view.stats.upsolves.find(row=>row.rule==='div3').total,5);
  }
  s.settings.upsolve.find(rule=>rule.id==='archive').enabled=false;
  assert.deepEqual(resolve(s,now).queue.map(p=>p.difficulty).sort(),[1200,1600]);
  s.settings=validateSettings({...s.settings,upsolveMinRating:null,upsolveMaxRating:1200});
  assert.deepEqual(ruleRows()['upsolve:div3'].map(p=>p.difficulty).sort((a,b)=>a-b),[800,1200]);
  assert.throws(()=>validateSettings({...s.settings,upsolveMinRating:1300}),/Maximum upsolve rating must be at least the minimum/);
});

test('round order reaches the preview and queue for entered and every-round rules',()=>{
  const problems=['F10','C','F2','B'].map((index,i)=>cf(50,index,[undefined,1500,undefined,1800][i],'2026-10-01'));
  const older=cf(40,'D',2200,'2026-09-01');
  const s=base([...problems,older]);
  s.submissions=[problems[0],older].map(p=>({problem:p.key,stamp:1,verdict:'WRONG_ANSWER',participation:'CONTESTANT',in_round:1}));
  for (const allRounds of [false,true]) {
    for (const [order,indices] of [['earliest',['B','C','F2','F10','D']],['hardest',['B','C','F10','F2','D']]]) {
      s.settings.upsolve=s.settings.upsolve.map(rule=>({...rule,allRounds,order}));
      s.settings=validateSettings(s.settings);
      const view=resolve(s,now);
      assert.deepEqual(view.queue.map(p=>p.index),indices);
      assert.deepEqual(view.ruleRows['upsolve:div3'].map(p=>p.index),indices);
    }
  }
});

test('Codeforces round practice includes unentered rounds and skips solved and unfinished problems',()=>{
  const round=cf(2,'A',1500,'2026-10-01',2);
  const advanced=cf(2,'F1',undefined,'2026-10-01',2);
  const otherDivision=cf(3,'B',1400,'2026-09-01');
  const unclassified=cf(4,'A',1400,'2026-08-01',null);
  const solved=cf(2,'B',1600,'2026-10-01',2);
  const live={...cf(5,'A',1200,'2026-11-01',2),finished:false};
  const gym=normalizeLink('https://codeforces.com/gym/101480/problem/A');
  const s=base([advanced,round,otherDivision,unclassified,solved,live,{...gym,date:'2026-10-02'}]);
  s.manual=[{problem:solved.key,day:null}];
  delete s.settings.shares.rounds;
  s.settings.upsolve.push({id:'archive',archive:true,enabled:true,division:0,cutoff:''});
  s.settings=validateSettings(s.settings);
  s.settings.queueMode='custom';
  s.settings.upsolveCap=0;
  const all=resolve(s,now);
  assert.deepEqual(all.queue.map(p=>p.key),[round.key,advanced.key,otherDivision.key,unclassified.key]);
  assert.deepEqual(all.ruleRows['upsolve:div2'],[]);
  assert.equal(all.ruleOptions.find(option=>option.id==='rounds:archive').count,4);
  const archive=s.settings.upsolve.at(-1);
  archive.division=2;
  archive.cutoff='A';
  assert.deepEqual(resolve(s,now).queue.map(p=>p.key),[round.key]);
  archive.enabled=false;
  assert.deepEqual(resolve(s,now).queue,[]);
});

test('every-round upsolve shares a newest-first backlog across divisions and tracks completion',()=>{
  const latest = {...cf(50,'A',1200,'2026-10-01',2),contestStart:200};
  const sameDay = {...cf(51,'F2',1400,'2026-10-01'),contestStart:100};
  const solved = cf(50,'B',1300,'2026-10-01',2);
  const older = cf(40,'C',1500,'2026-09-01',2);
  const live = {...cf(60,'A',1200,'2026-11-01',2),finished:false};
  const beyondCutoff = cf(50,'E',1700,'2026-10-01',2);
  const s = base([older,sameDay,live,solved,beyondCutoff,latest]);
  for (const rule of s.settings.upsolve) Object.assign(rule,{allRounds:true,skipped:false});
  s.settings=validateSettings(s.settings);
  s.manual=[{problem:solved.key,day:null}];
  s.submissions=[{problem:older.key,stamp:1,verdict:'WRONG_ANSWER',participation:'CONTESTANT',in_round:1}];
  const view=resolve(s,now);
  assert.deepEqual(view.queue.map(p=>p.key),[latest.key,sameDay.key,older.key]);
  assert.deepEqual(view.ruleRows['upsolve:div2'].map(p=>p.key),[latest.key,older.key]);
  assert.deepEqual(view.stats.upsolves.map(({contest,done,total})=>[contest,done,total]),[['50',1,2],['51',0,1],['40',0,1]]);
  assert.equal(view.actual['upsolve:div2'],2);
  assert.equal(view.actual['upsolve:div3'],1);
  s.settings.upsolve[0].allRounds=false;
  assert.deepEqual(resolve(s,now).ruleRows['upsolve:div2'].map(p=>p.key),[older.key]);
});

test('source shares apply across Codeforces rules and the preview reflects queue order and backfill',()=>{
  const atcoder=Array.from({length:100},(_,i)=>at(300+i,'D',1700));
  const codeforces=Array.from({length:100},(_,i)=>cf(1000+i,'A',1500,'2026-10-01',i%2?2:3));
  const s=base([...atcoder,...codeforces]);
  for (const rule of s.settings.upsolve) rule.allRounds=true;
  Object.assign(s.settings,{
    queueMode:'custom',upsolveCap:100,
    sourceShares:{atcoder:80,codeforces:20,cses:0,timus:0,guide:0,manual:0},
  });
  s.settings=validateSettings(s.settings);
  const view=resolve(s,now);
  assert.equal(view.queue.filter(p=>p.judge==='Codeforces').length,20);
  assert.equal(view.nextQueue.filter(p=>p.lane.startsWith('upsolve:')).length,4);
  assert.deepEqual(view.nextQueue.map(p=>p.key),view.queue.slice(0,20).map(p=>p.key));
  s.settings.upsolveCap=2;
  const capped=resolve(s,now);
  assert.equal(capped.queue.length,100);
  assert.equal(capped.queue.filter(p=>p.judge==='Codeforces').length,2);
});

test('AtCoder rating sources are per series and also control pending statement checks',()=>{
  const s=base([at(212,'D',1700),at(213,'D',2000),at(214,'D',2050,{english:undefined}),
    at(215,'D',2350,{series:'ARC'}),at(216,'D',1500,{series:'ARC'})]);
  const [abc]=s.settings.atcoder.series;
  abc.ratingSource='training';
  s.settings.trainingRatings.AtCoder=1700;
  const abcRows=()=>resolve(s,now).ruleRows['atcoder:ABC'].map(p=>p.key);
  const view=resolve(s,now);
  assert.deepEqual(abcRows(),['ac:abc213_d']);
  assert.deepEqual(view.ruleRows['atcoder:ARC'].map(p=>p.key),['ac:abc216_d']);
  assert.equal(view.ruleOptions.find(r=>r.id==='atcoder:ABC').pending,1);
  s.settings.trainingRatings.AtCoder=null;
  assert.deepEqual(abcRows(),[]);
  abc.fixed=1700;
  assert.deepEqual(abcRows(),['ac:abc212_d']);
});

test('Codeforces rating offsets follow the selected rating for both queue and solve counts',()=>{
  const s=base([cf(1,'A',1400,'2024-01-01'),cf(2,'A',1500,'2024-01-02'),
    cf(3,'A',1750,'2024-01-03'),cf(4,'A',1850,'2024-01-04')]);
  s.sync.Codeforces={rating:1440};
  s.settings.trainingRatings.Codeforces=1790;
  s.settings.grind={enabled:true,ratingSource:'training',intervals:[[1500,1500]],offsets:[[-40,60]],since:'2024-01-01'};
  s.manual=[{problem:'cf:3:A',day:'2026-11-19'}];
  const result=()=>{
    const view=resolve(s,now);
    return [view.ruleRows.grind.map(p=>p.key),view.stats.grindMatches];
  };
  assert.deepEqual(result(),[['cf:4:A'],1]);
  s.sync.Codeforces.virtual={rating:1460};
  assert.deepEqual(result(),[['cf:2:A'],0]);
  s.settings.grind.ratingSource='official';
  assert.deepEqual(result(),[['cf:2:A','cf:1:A'],0]);
  s.sync.Codeforces={};
  assert.deepEqual(result(),[[],0]);
  s.settings.grind.ratingSource='fixed';
  assert.deepEqual(result(),[['cf:2:A'],0]);
});

test('legacy saved profiles get rating defaults and training ratings validate independently',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  const old=defaultSettings();
  delete old.trainingRatings;
  delete old.grind.ratingSource;
  delete old.grind.offsets;
  for (const rule of old.atcoder.series) delete rule.ratingSource;
  await saveSettings(db,owner,old);
  const settings=await settingsFor(db,owner);
  assert.deepEqual(settings.trainingRatings,{AtCoder:null,Codeforces:null});
  assert.equal(settings.atcoder.series[0].ratingSource,'official');
  assert.equal(settings.grind.ratingSource,'fixed');
  assert.deepEqual(settings.grind.intervals,old.grind.intervals);
  assert.deepEqual(validateSettings(old),settings);
  settings.trainingRatings={AtCoder:0,Codeforces:1600};
  const validated=validateSettings(settings);
  await saveSettings(db,owner,validated);
  assert.deepEqual((await settingsFor(db,owner)).trainingRatings,settings.trainingRatings);
  assert.equal((await settingsFor(db,'demo')).trainingRatings.Codeforces,null);
  settings.trainingRatings.Codeforces=1600.5;
  assert.throws(()=>validateSettings(settings),/Codeforces training rating/);
});

test('first acceptance overrides manual date, solves leave queue, and undated imports leave volume unchanged',()=>{
  const first=at(212,'D',1700);
  const cses={...normalizeLink('https://cses.fi/problemset/task/1068'),section:'Intro',order:0};
  const s=base([first,cses]);
  const initial=resolve(s,now);
  assert.equal(initial.queue.length,1);
  s.manual=[{problem:first.key,day:'2026-11-19'},{problem:cses.key,day:null}];
  s.submissions=[
    {problem:first.key,stamp:stamp('2026-11-19T11:00:00Z'),verdict:'AC'},
    {problem:first.key,stamp:stamp('2026-11-19T02:00:00Z'),verdict:'AC'}
  ];
  assert.equal(collectSolves(s).get(first.key).day,'2026-11-18');
  const finished=resolve(s,now);
  assert.equal(finished.queue.length,0);
  assert.equal(finished.stats.volume[0].total,1);
  assert.equal(finished.stats.volume[0].active,1);
  assert.equal(finished.stats.volume[0].average,1/19);
  assert.equal(finished.csesProgress[0].done,1);
  const [,start,end]=dateWindows('2026-11-19')[1];
  assert.equal(end-start+1,90);
});

test('training focus counts recent rated solves against current bands once per rule',()=>{
  const problems = [
    at(211,'D',1600), at(212,'D',1801), at(213,'D',1700), at(214,'D',undefined),
    cf(1,'A',1550,'2026-10-01'), cf(2,'A',1300,'2026-10-01'),
    cf(3,'A',1500,'2026-10-01'), at(215,'D',1700),
  ];
  const s = base(problems);
  s.settings.grind = {enabled:true, intervals:[[1400,1600],[1500,1700]], since:''};
  const days = ['2026-10-21','2026-11-19','2026-10-20','2026-11-19','2026-11-19','2026-11-19',null,'2026-11-20'];
  s.manual = problems.map((p,i) => ({problem:p.key, day:days[i]}));
  const {trainingFocus} = resolve(s,now).stats;
  assert.deepEqual(trainingFocus.map(({label,done,total}) => [label,done,total]), [
    ['AtCoder ABC',1,2], ['AtCoder ARC',0,0], ['Codeforces',1,2],
  ]);
});

test('AtCoder claims leave the queue and count only after a matching acceptance',()=>{
  const problem=at(212,'D',1700);
  const s=base([problem]);
  s.lists=[{id:'practice',name:'Practice',keys:[problem.key],enabled:true,cap:5}];
  s.atcoderClaims=[problem.key];
  s.submissions=[{problem:problem.key,stamp:stamp('2026-11-19T11:00:00Z'),verdict:'WA'}];
  const pending=resolve(s,now);
  assert.deepEqual(pending.pendingAtCoder.map(p=>p.key),[problem.key]);
  assert.equal(pending.queue.length,0);
  assert.equal(pending.stats.volume[0].total,0);
  assert.equal(pending.listProgress[0].done,0);
  assert.equal(pending.listProgress[0].items[0].pendingAtCoder,true);

  s.submissions.push({problem:problem.key,stamp:stamp('2026-11-19T12:00:00Z'),verdict:'AC'});
  const confirmed=resolve(s,now);
  assert.equal(confirmed.pendingAtCoder.length,0);
  assert.equal(confirmed.queue.length,0);
  assert.equal(confirmed.stats.volume[0].total,1);
  assert.equal(confirmed.listProgress[0].done,1);
  assert.equal(confirmed.stats.timeline[0].source,'synced');

  s.atcoderClaims=[];
  s.submissions=[];
  assert.equal(resolve(s,now).queue[0].key,problem.key);
});

test('manual URL variants collapse, and Gym and regular Codeforces stay distinct',()=>{
  const gym=normalizeLink('https://www.codeforces.com/gym/101480/problem/a?locale=en#top');
  const regular=normalizeLink('https://codeforces.com/problemset/problem/101480/A');
  assert.equal(gym.key,'gym:101480:A');
  assert.equal(gym.judge,'Codeforces');
  assert.equal(regular.key,normalizeLink('http://codeforces.com/contest/101480/problem/A/').key);
  assert.notEqual(gym.key,regular.key);
  assert.equal(normalizeLink('javascript:alert(1)'),null);
  assert.equal(normalizeLink('https://qoj.ac/contest/8/problem/2').key,'qoj:2');
});

test('public page parsers recognize the section and language markers',()=>{
  assert.equal(parseCses('<h2>Graphs</h2><li class="task"><a href="/problemset/task/1192">Counting Rooms</a>')[0].section,'Graphs');
  assert.equal(parseEnglish('<div id="task-statement"><span class="lang-en">Task</span></div>'),true);
  assert.equal(parseEnglish('<div id="task-statement"><span class="lang-ja">問題文</span></div>'),false);
  assert.throws(()=>parseEnglish('<title>Sign in</title>'));
});

test('CSES uses the solved count and compares against the whole catalog, including solved tasks',()=>{
  const problems=parseCses(
    '<h2>Intro</h2><a href="/problemset/task/1068">Weird Algorithm</a><span class="detail">50 / 60</span>'+
    '<h2>Graphs</h2><a href="/problemset/task/1192">Counting Rooms</a><span class="detail">0 / 10</span>'+
    '<a href="/problemset/task/1193">Labyrinth</a>'
  );
  assert.deepEqual(problems.map(p=>p.solvers),[50,0,undefined]);
  const source=base(problems);
  source.settings.cses={enabled:true,weights:{Graphs:1}};
  source.manual=[{problem:'cses:1068',day:null}];
  const result=resolve(source,now);
  assert.equal(result.csesTopSolvers,50);
  assert.equal(result.queue.find(p=>p.key==='cses:1192').solvers,0);
});

test('USACO reads the official division from the contest heading',()=>{
  assert.equal(parseUsacoDivision('<h2> USACO 2015 December Contest, <b>Bronze</b> </h2><h2>Problem 1. Fence Painting</h2>'),'Bronze');
  assert.equal(parseUsacoDivision('<h2>Problem 2. Gold Rush</h2><p>Silver division</p>'),null);
});

test('browser-assisted CSES extraction accepts full marks and detects signed-out or changed pages',()=>{
  const fixture=(href, markers)=>({
    querySelector:()=>({getAttribute:()=>href}),
    querySelectorAll:()=>markers.map((classes,i)=>({querySelector:selector=>selector.startsWith('a')?
      {getAttribute:()=>'/problemset/task/'+(1068+i)}:{classList:Object.assign(['task-score','icon',...classes],{contains:(value)=>classes.includes(value)})}}))
  });
  const url='https://cses.fi/problemset/list';
  const good=extractCses(fixture('/user/1',[['full'],['partial'],[],['zero']]),url);
  assert.deepEqual(good.solves,[{id:'1068',day:null}]);
  assert.match(extractCses(fixture('/login',[]),url).error,/sign in/i);
  assert.match(extractCses(fixture('/user/1',[['new-class']]),url).error,/score markers/i);
});

test('reopening a populated demo profile preserves settings after judge sync is cleared',databaseTest,async t=>{
  const {db}=await testDatabase(t);
  await seedDemo(db,now);
  const settings=await settingsFor(db,'demo');
  settings.handles.AtCoder='';
  await saveSettings(db,'demo',settings);
  await db.query("DELETE FROM sync WHERE profile='demo' AND judge='AtCoder'");
  const count=async()=>(await one(db,"SELECT count(*) AS total FROM solves WHERE profile='demo'")).total;
  const previous=await count();
  await seedDemo(db,now);
  assert.equal((await settingsFor(db,'demo')).handles.AtCoder,'');
  assert.equal(await count(),previous);
});
