import type { Problem, Ranked, UsacoDivision } from './types';

const atcoderColors = ['#808080','#804000','#008000','#00c0c0','#0000ff','#c0c000','#ff8000','#ff0000'];
const atcoderMedals = [
  {borderColor:'#965c2c',background:'linear-gradient(90deg,#965c2c,#ffdabd,#965c2c)'},
  {borderColor:'#808080',background:'linear-gradient(90deg,#808080,white,#808080)'},
  {borderColor:'#d9a900',background:'linear-gradient(90deg,#ffd700,white,#ffd700)'},
];
const codeforcesBands = [
  [3000,'linear-gradient(90deg,#161616 50%,#e00000 50%)'],
  [2400,'#e00000'],[2100,'#ff8c00'],[1900,'#aa00aa'],[1600,'#0000ff'],
  [1400,'#00b8c5'],[1200,'#008000'],[0,'#808080'],
] as const;

function atcoderCircle(rating: number) {
  const band = Math.floor(rating / 400);
  if (band >= atcoderColors.length) return atcoderMedals[Math.min(band - atcoderColors.length, 2)];
  const color = atcoderColors[band];
  const fill = (rating % 400) / 4;
  return {borderColor:color,background:`linear-gradient(to top,${color} ${fill}%,transparent ${fill}%)`};
}

const unavailable = <span><span aria-hidden="true">—</span><span className="sr-only">Difficulty unavailable</span></span>;

export function ProblemDifficulty({ problem, csesTopSolvers, usacoDivision }: {
  problem: Problem & Pick<Ranked,'guideEntries'>;
  csesTopSolvers: number;
  usacoDivision?: UsacoDivision|null;
}) {
  const {judge,difficulty,solvers,guideEntries=[]} = problem;
  if (judge==='AtCoder' && difficulty!=null) {
    return <span className="problem-difficulty mono" title="AtCoder Problems estimated difficulty">
      <span aria-hidden="true" className="difficulty-circle" style={atcoderCircle(difficulty)}/>{difficulty}
    </span>;
  }
  if (judge==='Codeforces' && difficulty!=null) {
    const background = codeforcesBands.find(([minimum])=>difficulty>=minimum)?.[1];
    return <span className="problem-difficulty mono" title="Codeforces problem rating">
      <span aria-hidden="true" className="difficulty-square" style={{background}}/>{difficulty}
    </span>;
  }
  if (judge==='CSES' && solvers!=null && csesTopSolvers>0) {
    const percent = 100 * solvers / csesTopSolvers;
    const label = percent>0 && percent<1 ? '<1%' : Math.round(percent)+'%';
    const counts = solvers.toLocaleString()+' solvers · '+csesTopSolvers.toLocaleString()+' for the most-solved CSES task';
    return <span className="problem-difficulty difficulty-cses" title={counts}>
      <span className="difficulty-meter" aria-hidden="true"><span style={{width:percent+'%'}}/></span>
      <span><span className="mono">{label}</span> of top solver count</span>
      <span className="sr-only">. {counts}.</span>
    </span>;
  }
  if (judge==='Timus' && difficulty!=null) {
    return <span className="difficulty-badge mono" title="Timus difficulty score">{difficulty}</span>;
  }
  if (judge==='USACO') {
    const division = problem.usacoDivision ?? usacoDivision;
    const labels = [...new Set(guideEntries.map(entry=>entry.difficulty))];
    const modules = guideEntries.map(entry=>entry.moduleTitle+' · '+entry.difficulty);
    const badge = division && <span className={'difficulty-badge usaco-'+division.toLowerCase()} title="USACO contest division">{division}</span>;
    if (labels.length>1) {
      return <details className="difficulty-details">
        <summary aria-label={(division ? 'USACO '+division+' · ' : '')+'USACO Guide difficulties'}>{badge || 'Guide difficulties'}</summary>
        <ul>{modules.map((module,i)=><li key={guideEntries[i].moduleId+'-'+guideEntries[i].difficulty}>{module}</li>)}</ul>
      </details>;
    }
    const label = labels[0];
    if (division || label) {
      return <span className="problem-difficulty">
        {badge}{division && label && <span aria-hidden="true">·</span>}
        {label && <span title={modules.join('\n')}><span className="sr-only">USACO Guide difficulty </span>{label}</span>}
      </span>;
    }
  }
  return unavailable;
}
