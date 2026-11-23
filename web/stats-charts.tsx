import { useState, type CSSProperties } from 'react';
import { BarChart3, CalendarDays } from 'lucide-react';
import { difficultyHistory, solveMetrics, toDate } from './stats-metrics';
import { ProblemLink } from './ui';
import type { Judge, Stats } from './types';

const weekFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function WeeklyVolume({ timeline, weeks, solveGoal, dayGoal }: {
  timeline: Stats['timeline']; weeks: ReturnType<typeof solveMetrics>['weeks']; solveGoal: number; dayGoal: number;
}) {
  const [inspectedWeek, setInspectedWeek] = useState<number>();
  const [hoveredWeek, setHoveredWeek] = useState<number>();
  const current = weeks[weeks.length - 1];
  const inspected = weeks.find(week => week.start === (hoveredWeek ?? inspectedWeek)) ?? current;
  const goals = [
    { label: 'Weekly solve goal', value: current.solves, goal: solveGoal },
    { label: 'Weekly active day goal', value: current.days, goal: dayGoal },
  ].filter(row => row.goal > 0);
  const halfPeak = Math.max(1, ...weeks.map(week => week.solves)) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, halfPeak)));
  const step = Math.ceil(magnitude * ([1, 2, 2.5, 5, 10].find(n => n * magnitude >= halfPeak) ?? 10));
  const ceiling = step * 2;
  const points = weeks.map((week, index) => ({
    x: (index + 0.5) / weeks.length * 100,
    y: 100 - week.solves / ceiling * 100,
  }));
  const coordinates = points.map(({ x, y }) => `${x},${y}`);

  return <section className="card breakdown stats-wide" aria-labelledby="weekly-volume-title">
    <div className="stats-panel-head">
      <span className="stats-icon" aria-hidden="true"><CalendarDays size={17}/></span>
      <div><h2 id="weekly-volume-title">Weekly volume</h2><p className="secondary">First solves by week · Monday to Sunday</p></div>
    </div>
    <div className="stats-week-layout">
      <div className="stats-week-summary">
        <h3>This week</h3>
        <div className="stats-week-totals">
          <div><strong>{numberFormat.format(current.solves)}</strong><span>{current.solves === 1 ? 'Solve' : 'Solves'}</span></div>
          <div><strong>{current.days}</strong><span>Active {current.days === 1 ? 'day' : 'days'}</span></div>
        </div>
        {current.solves>0&&<details><summary>View this week’s problems</summary><ul>{timeline.filter(p=>p.day&&toDate(p.day).getTime()>=current.start&&toDate(p.day).getTime()<current.start+7*86400000).map(p=><li key={p.key}><ProblemLink problem={p}/></li>)}</ul></details>}
        {goals.length > 0 && <div className="stats-week-goals">
          {goals.map(row => <label key={row.label}>
            <span>{row.label}<strong>{numberFormat.format(row.value)} / {numberFormat.format(row.goal)}</strong></span>
            <progress value={Math.min(row.value, row.goal)} max={row.goal}/>
          </label>)}
        </div>}
      </div>
      <div className="stats-week-chart">
        <div className="stats-week-chart-head">
          <h3 id="weekly-trend-title">{weeks.length}-week trend</h3>
          <p>{inspected === current ? 'This week' : weekFormat.format(inspected.start)} · <strong>{numberFormat.format(inspected.solves)} {inspected.solves === 1 ? 'solve' : 'solves'}</strong></p>
        </div>
        <div className="stats-week-chart-body">
          <div className="stats-week-scale" aria-hidden="true">
            {[ceiling, step, 0].map(value => <span key={value}>{numberFormat.format(value)}</span>)}
          </div>
          <div className="stats-week-plot" role="group" aria-labelledby="weekly-trend-title" onPointerLeave={() => setHoveredWeek(undefined)}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {[0, 50, 100].map(y => <line className="stats-week-guide" key={y} x1="0" x2="100" y1={y} y2={y}/>)}
              <polyline className="stats-week-line" points={coordinates.slice(0, -1).join(' ')}/>
              <polyline className="stats-week-line pending" points={coordinates.slice(-2).join(' ')}/>
            </svg>
            {weeks.map((week, index) => <button type="button" key={week.start}
              className={'stats-week-point' + (week === current ? ' current' : '') + (week === inspected ? ' inspected' : '')}
              style={{ '--point-y': `${points[index].y}%` } as CSSProperties}
              aria-label={`${week === current ? 'This week, starting' : 'Week of'} ${weekFormat.format(week.start)}, ${numberFormat.format(week.solves)} ${week.solves === 1 ? 'solve' : 'solves'}`}
              onPointerEnter={event => { if (event.pointerType !== 'touch') setHoveredWeek(week.start); }}
              onFocus={() => { setHoveredWeek(undefined); setInspectedWeek(week.start); }}
              onClick={() => setInspectedWeek(week.start)}>
              <span aria-hidden="true"/>
            </button>)}
          </div>
          <div className="stats-week-dates" aria-hidden="true">
            <span>{weekFormat.format(weeks[0].start)}</span>
            <span style={{ left: `${points[Math.floor(weeks.length / 2)].x}%` }}>{weekFormat.format(weeks[Math.floor(weeks.length / 2)].start)}</span>
            <span>This week</span>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

export function DifficultyProgression({ history, judgeOrder }: {
  history: ReturnType<typeof difficultyHistory>; judgeOrder: Judge[];
}) {
  const [selected, setSelected] = useState<Judge>();
  const available = judgeOrder.filter(judge => history.has(judge));
  const judge = selected && history.has(selected) ? selected : available[0];
  const months = history.get(judge);
  return <section className="card breakdown">
    <div className="stats-panel-head">
      <span className="stats-icon"><BarChart3 size={17}/></span>
      <div><h2>Difficulty progression</h2><p className="secondary">Rated first solves by month · last 12 months</p></div>
      {available.length > 0 && <select aria-label="Difficulty judge" value={judge} onChange={event => setSelected(event.target.value as Judge)}>
        {available.map(name => <option key={name}>{name}</option>)}
      </select>}
    </div>
    {months ? <table className="stats-history">
      <thead><tr><th scope="col">Month</th><th scope="col">Solves</th><th scope="col">Median</th><th scope="col">Hardest</th></tr></thead>
      <tbody>
        {[...months].sort(([a], [b]) => b.localeCompare(a)).map(([month, ratings]) => {
          const sorted = [...ratings].sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
          return <tr key={month}>
            <th scope="row">{monthFormat.format(toDate(month + '-01'))}</th>
            <td>{sorted.length}</td><td>{numberFormat.format(median)}</td><td>{numberFormat.format(sorted[sorted.length - 1])}</td>
          </tr>;
        })}
      </tbody>
    </table> : <p className="stats-empty">Solve a problem with a known difficulty to start tracking progression.</p>}
  </section>;
}
