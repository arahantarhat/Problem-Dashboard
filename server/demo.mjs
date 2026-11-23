import { defaultSettings, localDay, normalizeLink } from './domain.mjs';
import { putProblems, putSubmissions, saveSettings, saveSync, transaction, one } from './db.mjs';
const cf = (id, title, rating, date, division, index) => ({
  ...normalizeLink('https://codeforces.com/contest/'+id+'/problem/'+index),title,difficulty:rating,date,division,contestName:'Codeforces '+id
});
const ac = (contest, id, title, rating, date, index) => ({
  ...normalizeLink('https://atcoder.jp/contests/'+contest+'/tasks/'+id),title,difficulty:rating,date, index,
  series:contest.slice(0,3).toUpperCase(),english:true
});

export async function seedDemo(db, time = new Date()) {
  const samples=[
    ac('abc159','abc159_f','Knapsack for All Segments',1660,'2020-03-22','F'),
    ac('abc155','abc155_e','Payment',1740,'2020-02-16','E'),
    ac('abc216','abc216_d','Pair of Balls',1750,'2021-08-28','D'),
    ac('abc203','abc203_d','Pond',1765,'2021-05-29','D'),
    ac('abc165','abc165_c','Many Requirements',1780,'2020-05-02','C'),
    ac('abc212','abc212_d','Querying Multiset',1730,'2021-07-31','D'),
    ac('abc213','abc213_e','Stronger Takahashi',1770,'2021-08-07','E'),
    ac('abc214','abc214_d','Sum of Maximum Weights',1700,'2021-08-14','D'),
    ac('abc217','abc217_d','Cutting Woods',1720,'2021-09-04','D'),
    ac('abc218','abc218_d','Rectangles',1640,'2021-09-11','D'),
    ac('abc219','abc219_d','Strange Lunchbox',1790,'2021-09-18','D'),
    ac('abc220','abc220_e','Distance on Large Perfect Binary Tree',1800,'2021-09-26','E'),
    ac('abc222','abc222_e','Red and Blue Tree',1690,'2021-10-09','E'),
    ac('abc223','abc223_e','Placing Rectangles',1685,'2021-10-16','E'),
    ac('arc078','arc078_d','Mole and Abandoned Mine',1520,'2017-07-15','F'),
    ac('arc060','arc060_a','Tak and Cards',1460,'2016-08-21','C'),
    ac('arc092','arc092_c','Both Sides Merger',1550,'2018-03-17','E'),
    ac('arc100','arc100_a','Linear Approximation',1480,'2018-07-07','C'),
    cf(1777,'Score of a Tree',1900,'2023-01-16',2,'D'),
    cf(1777,'The Human Equation',1500,'2023-01-16',2,'C'),
    cf(1777,'Emordnilap',900,'2023-01-16',2,'B'),
    cf(1777,'Everybody Likes Good Arrays!',800,'2023-01-16',2,'A'),
    cf(1462,'The Treasure of the Segments',1700,'2020-12-21',3,'F'),
    cf(1462,'Add to Neighbour and Remove',1400,'2020-12-21',3,'D'),
    cf(1462,'Unique Number',900,'2020-12-21',3,'C'),
    cf(1462,'Last Year’s Substring',800,'2020-12-21',3,'B'),
    cf(1462,'Favorite Sequence',800,'2020-12-21',3,'A'),
    cf(1296,'Yet Another Walking Robot',1400,'2020-01-28',3,'C'),
    cf(1296,'Food Buying',800,'2020-01-28',3,'B'),
    cf(1296,'Array with Odd Sum',800,'2020-01-28',3,'A'),
  ];
  const sections=[
    ['Introductory Problems',[[1068,'Weird Algorithm',184632],[1083,'Missing Number',159260],[1069,'Repetitions',138259],[1094,'Increasing Array',130457],[1070,'Permutations',113937],[1071,'Number Spiral',81105],[1072,'Two Knights',62611]]],
    ['Sorting and Searching',[[1621,'Distinct Numbers',91904],[1084,'Apartments',68947],[1090,'Ferris Wheel',66643],[1091,'Concert Tickets',53404],[1619,'Restaurant Customers',54227]]],
    ['Dynamic Programming',[[1633,'Dice Combinations',96484],[1634,'Minimizing Coins',83335],[1635,'Coin Combinations I',76083],[1636,'Coin Combinations II',64536],[1637,'Removing Digits',71790],[1638,'Grid Paths I',67334],[1158,'Book Shop',60845]]],
    ['Graph Algorithms',[[1192,'Counting Rooms',67118],[1193,'Labyrinth',47816],[1666,'Building Roads',58777],[1667,'Message Route',51048],[1668,'Building Teams',48132],[1669,'Round Trip',38176],[1194,'Monsters',27335]]],
  ];
  const tasks=sections.flatMap(([section,rows])=>rows.map(([id,title,solvers],order)=>({...normalizeLink('https://cses.fi/problemset/task/'+id),title,section,order,solvers})));
  const manual=[
    {...normalizeLink('https://qoj.ac/problem/2'),title:'Boat'},
    {...normalizeLink('https://qoj.ac/problem/3'),title:'Fireworks'},
    {...normalizeLink('https://qoj.ac/problem/4'),title:'Gap'},
    normalizeLink('https://codeforces.com/gym/101480/problem/A')
  ];
  const extra=[
    ac('abc211','abc211_d','Number of Shortest Paths',1620,'2021-07-24','D'),
    ac('abc210','abc210_d','National Railway',1700,'2021-07-17','D'),
    ac('abc209','abc209_d','Collision',1480,'2021-07-10','D'),
    ac('abc208','abc208_d','Shortest Path Queries 2',1450,'2021-07-04','D'),
    ac('abc207','abc207_d','Congruence Points',1680,'2021-06-26','D'),
    ac('arc128','arc128_b','Balls of Three Colors',1520,'2021-10-30','B'),
    ac('arc129','arc129_a','Smaller XOR',1450,'2021-11-07','A'),
    ac('arc130','arc130_a','Remove One Character',1500,'2021-11-13','A'),
  ];
  const settings=defaultSettings();
  settings.cses={enabled:true,weights:{'Graph Algorithms':2,'Dynamic Programming':1}};
  settings.shares={atcoder:60,upsolve:20,rounds:10,grind:0,cses:15,guide:0,manual:5};
  settings.handles={AtCoder:'training_user',Codeforces:'training_user'};
  const stamp=(offset)=> Math.floor(+time/1000)-offset*86400;
  const round=(problem,offset,verdict)=>({id:problem+':'+offset,problem,stamp:stamp(offset),verdict,participation:'CONTESTANT',inRound:true});
  const cfs=[
    round('cf:1777:D',31,'WRONG_ANSWER'),round('cf:1777:A',38,'OK'),round('cf:1777:B',19,'OK'),
    round('cf:1462:A',91,'OK'),round('cf:1462:B',83,'OK'),round('cf:1462:F',75,'WRONG_ANSWER'),
    round('cf:1296:A',130,'OK'),round('cf:1296:B',120,'OK'),round('cf:1296:C',125,'WRONG_ANSWER'),
  ];
  await transaction(db,async db=>{
    if (await one(db,"SELECT 1 FROM catalog WHERE profile='demo' LIMIT 1")) {
      for (const {key,solvers} of tasks) await db.query(
        "UPDATE catalog SET data=jsonb_set(data,'{solvers}',to_jsonb($1::integer)) WHERE profile='demo' AND key=$2 AND NOT (data ? 'solvers')",
        [solvers,key]
      );
      return;
    }
    await saveSettings(db,'demo',settings);
    await putProblems(db,'demo',[...samples,...tasks,...manual,...extra]);
    await saveSync(db,'demo','Codeforces',{lastSuccess:+time,rating:1500});
    await saveSync(db,'demo','AtCoder',{lastSuccess:+time,rating:1400});
    await saveSync(db,'demo','CSES',{lastSuccess:+time});
    await putSubmissions(db,'demo','Codeforces',cfs);
    await putSubmissions(db,'demo','AtCoder',extra.map((p,i)=>({id:i,problem:p.key,stamp:stamp([0,0,2,7,11,15,27,44][i]),verdict:'AC'})));
    for(const [i,p] of [...tasks.slice(0,16),manual[0]].entries()) await db.query(
      "INSERT INTO solves (profile,problem,day) VALUES ('demo',$1,$2)",
      [p.key,localDay(new Date(stamp((i*17)%103)*1000),settings.zone)]
    );
    const list={id:'training',name:'ICPC & olympiad upsolves',cap:8,enabled:true,keys:manual.map(p=>p.key)};
    await db.query("INSERT INTO lists (profile,id,data) VALUES ('demo',$1,$2)",[list.id,list]);
  }, {profile:'demo'});
}
