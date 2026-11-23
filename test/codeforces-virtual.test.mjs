import test from 'node:test';
import assert from 'node:assert/strict';
import { importCodeforcesVirtual, replayCodeforcesHistory, scoreVirtualSession, selectCodeforcesHistory } from '../server/codeforces-virtual.mjs';

const start = 1700000000;
const contest = {name:'Round 10',type:'ICPC',durationSeconds:7200,phase:'FINISHED'};
const problems = [{index:'A'},{index:'B'}];
const submission = (id, elapsed, verdict, extra = {}) => ({
  id,contestId:10,creationTimeSeconds:start+elapsed,relativeTimeSeconds:elapsed,verdict,
  author:{participantType:'VIRTUAL'},problem:{index:'A'},...extra
});

test('imports the first eligible virtual attempt against the visible rated field and reuses its cache',async()=>{
  const rows = [
    submission(4,60,'OK',{creationTimeSeconds:start+10860}),
    submission(3,1500,'OK'),
    submission(2,300,'WRONG_ANSWER'),
    submission(1,60,'OK',{author:{participantType:'PRACTICE'}}),
  ];
  const standingsRow = (handle, points, penalty, problemResults) => ({
    party:{participantType:'CONTESTANT',members:[{handle}]},points,penalty,problemResults
  });
  const ratings = [
    {handle:'a',oldRating:1800},{handle:'b',oldRating:1700},{handle:'c',oldRating:1400},
    {handle:'absent',oldRating:1600},
  ];
  const standings = {contest,problems,rows:[
    standingsRow('a',2,50),
    standingsRow('b',1,35,[{points:1,bestSubmissionTimeSeconds:1500,rejectedAttemptCount:1}]),
    standingsRow('c',1,45),
    standingsRow('unrated',2,20),
  ]};
  const official = [
    {contestId:8,contestName:'First official',ratingUpdateTimeSeconds:start-7200,oldRating:0,newRating:1450,rank:30},
    {contestId:9,contestName:'Second official',ratingUpdateTimeSeconds:start+14400,oldRating:1450,newRating:1500,rank:20},
  ];
  const cache = new Map();
  const checks = [];
  const apiCalls = [];
  const sources = {
    async api(method) {
      apiCalls.push(method);
      return {'user.rating':official,'contest.ratingChanges':ratings,'contest.standings':standings}[method];
    },
    async *pages() { yield rows; yield [rows[1]]; },
    read: id => cache.get(id),
    write: (id,signature,result) => cache.set(id,{signature,result}),
    progress: (...args) => checks.push(args),
  };
  const {history,rating} = await importCodeforcesVirtual('handle',sources);
  assert.equal(rating,1500);
  assert.deepEqual(history.points.map(point => point.kind),['official','virtual','official']);
  const virtual = history.points[1];
  assert.deepEqual(
    [virtual.stamp,virtual.score,virtual.rank,virtual.tied,virtual.fieldSize,virtual.originalFieldSize],
    [start,1,2,1,4,5]
  );
  assert.equal(history.rating,virtual.training+50);
  assert.deepEqual(checks,[[0,1],[1,1]]);
  assert.deepEqual(apiCalls,['user.rating','contest.ratingChanges','contest.standings']);
  apiCalls.length=0;
  const refreshed = await importCodeforcesVirtual('handle',sources);
  assert.deepEqual(refreshed.history.points,history.points);
  assert.deepEqual(apiCalls,['user.rating']);
});

test('Codeforces scoring accounts for time decay and rejects outside the virtual window',()=>{
  const course = {contest:{...contest,type:'CF',durationSeconds:9000},problems:[{index:'A',points:500},{index:'B',points:1000}]};
  const session = {start,submissions:[
    {stamp:start+300,index:'A',verdict:'COMPILATION_ERROR'},
    {stamp:start+600,index:'A',verdict:'WRONG_ANSWER',tests:2,testset:'PRETESTS'},
    {stamp:start+1800,index:'A',verdict:'OK'},
    {stamp:start+9000,index:'B',verdict:'OK'},
  ]};
  assert.deepEqual(scoreVirtualSession(session,course,undefined,start+9000),{points:402,penalty:0});
  assert.equal(scoreVirtualSession(session,course,undefined,start+8999).retry,true);
});

test('training history applies the first published rating without counting the baseline twice',()=>{
  const earlier = {contestId:10,name:'Earlier virtual',stamp:start,rank:1,tied:0,field:[[1500,9]]};
  const official = [{contestId:9,contestName:'First official',ratingUpdateTimeSeconds:start+1000,oldRating:0,newRating:1200,rank:20}];
  const history = replayCodeforcesHistory(official,[earlier]);
  assert.equal(history.points[1].training,1200+history.points[0].delta);
  assert.equal(replayCodeforcesHistory(official,[]).rating,null);
});

test('Codeforces history selection replays saved rounds and keeps all rounds available',()=>{
  const official = [{contestId:2,contestName:'Official',ratingUpdateTimeSeconds:start-200,oldRating:0,newRating:1400,rank:20}];
  const round = (contestId, stamp, rank) => ({contestId,name:String(contestId),stamp,rank,tied:0,field:[[1500,20]]});
  const rounds = [round(4,start,1),round(5,start+600,20)];
  const original = replayCodeforcesHistory(official,rounds);
  original.points = original.points.map(({oldRating,...point})=>point); // existing persisted format
  const read = id => ({result:rounds.find(round=>round.contestId===id)});
  const selected = selectCodeforcesHistory(original,{mode:'selected',ids:['4']},read);
  assert.equal(selected.rating,replayCodeforcesHistory(official,[rounds[0]]).rating);
  assert.deepEqual(selected.eligible.map(round=>round.contestId),[4,5]);
  assert.equal(selectCodeforcesHistory(original,{mode:'selected',ids:[]},read).rating,1400);
  assert.equal(selectCodeforcesHistory(original,{mode:'selected',ids:['4','5']},read).rating,original.rating);
});
