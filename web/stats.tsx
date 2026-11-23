import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { BarChart3, CalendarDays, Layers3, ListChecks, SlidersHorizontal, Target } from 'lucide-react';
import { Button, Empty, Heading, JudgeLabel, ProblemLink } from './ui';
import { judges, type Judge, type Problem, type State } from './types';
import { dayMs, difficultyHistory, solveMetrics, toDate, toDay } from './stats-metrics';
import { DifficultyProgression, WeeklyVolume } from './stats-charts';
import { CustomizeStats, loadStatsPreferences, type StatsCard } from './stats-preferences';

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const intensity = [0, 38, 55, 72, 88];
const series = ['ABC', 'ARC', 'AGC'] as const;
const arrows: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };

function activityStrength(count: number) {
  return intensity[Math.min(intensity.length - 1, count)];
}

function activityTint(color: string, count: number) {
  if (!count) return 'var(--activity-empty)';
  return `color-mix(in srgb, ${color} ${activityStrength(count)}%, var(--activity-empty))`;
}

function ProgressRow({ label, detail, done, total }: { label: string; detail?: string; done: number; total: number }) {
  return <div className="stats-progress-row">
    <span>{label}{detail && <small>{detail}</small>}</span>
    <div className="stats-progress-value">
      <span className="stats-meter" aria-hidden="true"><i style={{ width: (total ? Math.min(100, done / total * 100) : 0) + '%' }}/></span>
      <strong>{done} / {total}</strong>
    </div>
  </div>;
}

function Activity({ state, judgeOrder, onSolve }: { state: State; judgeOrder: Judge[]; onSolve: (p: Problem) => void }) {
  const { stats, settings: { colors } } = state;
  const [source, setSource] = useState<Judge | ''>('');
  const [selected, setSelected] = useState(state.today);
  const scroll = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { byDay, activeJudges } = useMemo(() => {
    const byDay: Record<string, typeof stats.timeline> = Object.create(null);
    const seen = new Set<Judge>();
    for (const solve of stats.timeline) {
      if (!solve.day || solve.day < stats.heatStart || solve.day > state.today) continue;
      seen.add(solve.judge);
      if (!source || solve.judge === source) (byDay[solve.day] ??= []).push(solve);
    }
    return { byDay, activeJudges: judgeOrder.filter(judge => seen.has(judge)) };
  }, [source, stats.timeline, stats.heatStart, state.today, judgeOrder]);

  const start = +toDate(stats.heatStart);
  const offset = (new Date(start).getUTCDay() + 6) % 7;
  const first = start - offset * dayMs;
  const today = +toDate(state.today);
  const weeks = Math.ceil(((today - first) / dayMs + 1) / 7);
  const selectedDay = selected < stats.heatStart || selected > state.today ? state.today : selected;
  const details = byDay[selectedDay] ?? [];
  useEffect(() => {
    if (scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [stats.heatStart, state.today]);

  function onKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const shift = arrows[event.key];
    if (!shift) return;
    event.preventDefault();
    const next = toDay(+toDate(date) + dayMs * shift);
    dayRefs.current[next]?.focus();
  }

  return <section className="card activity stats-wide" aria-labelledby="activity-title">
    <div className="stats-panel-head">
      <span className="stats-icon"><CalendarDays size={17}/></span>
      <div><h2 id="activity-title">Solve activity</h2><p className="secondary">First solves by day · last 12 months</p></div>
      <select aria-label="Activity judge" value={source} onChange={e => setSource(e.target.value as Judge | '')}>
        <option value="">All judges</option>
        {judgeOrder.map(judge => <option key={judge}>{judge}</option>)}
      </select>
    </div>
    <div className="calendar-layout" style={{ '--weeks': weeks } as CSSProperties}>
      <div className="weekday-labels" aria-hidden="true"><span>Mon</span><span>Wed</span><span>Fri</span></div>
      <div className="calendar-scroll" ref={scroll}>
        <div className="calendar-weeks">
          {Array.from({ length: weeks }, (_, week) => {
            const weekStart = first + week * 7 * dayMs;
            const visibleStart = new Date(Math.max(weekStart, start));
            const visibleEnd = new Date(Math.min(weekStart + 6 * dayMs, today));
            const crossesMonth = visibleStart.getUTCMonth() !== visibleEnd.getUTCMonth();
            const startsMonth = visibleStart.getUTCDate() === 1;
            const firstMonthHasRoom = week === 0 && new Date(weekStart + 13 * dayMs).getUTCMonth() === visibleStart.getUTCMonth();
            const showMonth = crossesMonth || startsMonth || firstMonthHasRoom;
            return <div className="calendar-week" key={week}>
              <span className="month-label" aria-hidden="true">{showMonth && monthFormat.format(crossesMonth ? visibleEnd : visibleStart)}</span>
              {Array.from({ length: 7 }, (_, day) => {
                const stamp = weekStart + day * dayMs;
                const date = toDay(stamp);
                if (stamp < start || stamp > today) return <span aria-hidden="true" key={date}/>;
                const records = byDay[date] ?? [];
                const split = new Map<Judge, number>();
                for (const record of records) split.set(record.judge, (split.get(record.judge) ?? 0) + 1);
                const active = judgeOrder.filter(judge => split.has(judge));
                const label = [
                  dayFormat.format(stamp),
                  `${records.length} ${records.length === 1 ? 'solve' : 'solves'}`,
                  ...active.map(judge => `${judge} ${split.get(judge)}`)
                ].join(' · ');
                return <button type="button" key={date} ref={element => { dayRefs.current[date] = element; }}
                  className="day-cell" aria-label={label} title={label} aria-pressed={selectedDay === date}
                  tabIndex={selectedDay === date ? 0 : -1} onFocus={() => setSelected(date)}
                  onClick={() => setSelected(date)} onKeyDown={event => onKey(event, date)}>
                  {active.map(judge => <span aria-hidden="true" className="day-filter" key={judge}
                    style={{ backgroundColor: colors[judge], opacity: activityStrength(split.get(judge) ?? 0) / 100 }}/>)}
                </button>;
              })}
            </div>;
          })}
        </div>
      </div>
    </div>
    <div className="activity-key">
      <div className="legend">{(source ? [source] : activeJudges).map(judge => <JudgeLabel key={judge} name={judge} colors={colors}/>)}</div>
      <div className="intensity-key" aria-label="Intensity scale from 0 to 4 or more solves per judge per day">
        <span>{source ? 'Solves per day' : 'Solves per judge per day'}</span><span>0</span>
        {intensity.map((strength, n) => <i key={n} aria-hidden="true">
          <span className="day-filter" style={{ backgroundColor: source ? colors[source] : '#536177', opacity: strength / 100 }}/>
        </i>)}
        <span>4+</span>
      </div>
    </div>
    <details className="day-detail" key={selectedDay} open={details.length > 0}>
      <summary><strong>{dayFormat.format(toDate(selectedDay))}</strong><span>{details.length} {details.length === 1 ? 'problem' : 'problems'} solved</span></summary>
      {details.length ? details.map(p => <div className="day-result" key={p.key}>
        <ProblemLink problem={p}/><JudgeLabel name={p.judge} colors={colors}/>
        {p.source === 'manual' && <button type="button" className="text-button" onClick={() => onSolve({ ...p, solve: { day: p.day, source: p.source } })}>Edit date</button>}
      </div>) : <p className="secondary">No solves recorded for this day.</p>}
    </details>
  </section>;
}

const numberFormat = new Intl.NumberFormat();

export function StatsPage({ state, profile, onColors, onSolve }: {
  state: State; profile: string; onColors: () => void; onSolve: (p: Problem) => void;
}) {
  const { stats, settings: { colors, cses } } = state;
  const windows = stats.volume.map(row => row.label);
  const [preferences, setPreferences] = useState(() => loadStatsPreferences(profile, windows));
  const [customizing, setCustomizing] = useState(false);
  const [upsolveLimit, setUpsolveLimit] = useState(7);
  const { total, undated, split, streak, weeks, recentSolves, recentDays } = useMemo(
    () => solveMetrics(stats.timeline, state.today), [stats.timeline, state.today]
  );
  const history = useMemo(() => difficultyHistory(stats.timeline, state.today), [stats.timeline, state.today]);
  const judgeOrder = useMemo(() => [...new Set([...preferences.judges, ...judges])], [preferences.judges]);
  const lists = [...state.listProgress, ...state.guideRules];
  const pinnedLists = lists.filter(list => preferences.lists.includes(list.id));
  const pinnedSections = state.csesProgress.filter(section => preferences.sections.includes(section.name));
  const listOrder = [...pinnedLists, ...lists.filter(list => !preferences.lists.includes(list.id))];
  const sectionOrder = [...pinnedSections, ...state.csesProgress.filter(section => !preferences.sections.includes(section.name))];
  const focusLists = pinnedLists.length ? pinnedLists : lists.filter(list => list.enabled).slice(0, 5);
  const focusSections = pinnedSections.length ? pinnedSections : state.csesProgress.filter(section => cses.enabled && cses.weights[section.name] > 0);
  const lifetimeJudges = judgeOrder.filter(judge => split.has(judge) || preferences.judges.includes(judge));
  const visible = preferences.order.filter(key => key === 'volume' ? preferences.windows.length > 0 : preferences.visible.includes(key));

  const panels: Record<StatsCard, () => ReactNode> = {
    lifetime: () => <section className="card volume">
      <h2>All-time solves</h2>
      <strong>{numberFormat.format(total)}</strong>
      <p className="volume-average">Unique problems solved{undated > 0 && ` · ${numberFormat.format(undated)} undated`}</p>
      {lifetimeJudges.length > 0 && <div className="volume-sources">
        {lifetimeJudges.map(judge => <span key={judge}><i style={{ backgroundColor: colors[judge] }}/>{numberFormat.format(split.get(judge) ?? 0)} {judge}</span>)}
      </div>}
    </section>,
    streak: () => <section className="card volume">
      <h2>Solve streak</h2>
      <div className="stats-streak">
        <div><strong>{numberFormat.format(streak.current)}</strong><span>Current · days</span></div>
        <div><strong>{numberFormat.format(streak.longest)}</strong><span>Longest · days</span></div>
      </div>
      <p className="volume-average">At least one first solve on each consecutive day</p>
    </section>,
    weekly: () => <WeeklyVolume timeline={stats.timeline} weeks={weeks} solveGoal={preferences.solveGoal} dayGoal={preferences.dayGoal}/>,
    activity: () => <Activity state={state} judgeOrder={judgeOrder} onSolve={onSolve}/>,
    consistency: () => <section className="card volume">
      <h2>Consistency · last 30 days</h2>
      <div className="stats-streak">
        <div><strong>{recentDays} / 30</strong><span>Active days</span></div>
        <div><strong>{numberFormat.format(recentDays ? Math.round(recentSolves / recentDays * 100) / 100 : 0)}</strong><span>Solves per active day</span></div>
      </div>
      <p className="volume-average">{numberFormat.format(recentSolves)} first {recentSolves === 1 ? 'solve' : 'solves'} in this period</p>
    </section>,
    progression: () => <DifficultyProgression history={history} judgeOrder={judgeOrder}/>,
    focus: () => <section className="card breakdown">
      <div className="stats-panel-head">
        <span className="stats-icon"><Target size={17}/></span>
        <div><h2>Training focus</h2><p className="secondary">Target bands and practice progress</p></div>
      </div>
      <h3 className="stats-subhead">Solves in current target bands · last 30 days</h3>
      {stats.trainingFocus.length ? <div className="stats-rows">
        {judgeOrder.flatMap(judge => stats.trainingFocus.filter(row => row.judge === judge)).map(row => <ProgressRow
          key={row.label} label={row.label} done={row.done} total={row.total}
          detail={row.intervals.map(([lo, hi]) => lo === hi ? String(lo) : `${lo}–${hi}`).join(', ') + ' · rated solves'}/>)}
      </div> : <p className="stats-empty">Enable an AtCoder or Codeforces rule with a difficulty target to see matches.</p>}
      <h3 className="stats-subhead">Practice progress</h3>
      {focusLists.length || focusSections.length ? <div className="stats-rows">
        {focusLists.map(list => <ProgressRow key={list.id} label={list.name} done={list.done} total={list.total}/>)}
        {focusSections.map(section => <ProgressRow key={'cses:' + section.name} label={section.name} detail="CSES" done={section.done} total={section.total}/>)}
      </div> : <p className="stats-empty">Pin practice lists or CSES sections in Customize stats.</p>}
    </section>,
    volume: () => <section className="volume-grid stats-wide" aria-label="Solve volume">
      {stats.volume.filter(v => preferences.windows.includes(v.label)).map(v => {
        const sources = judgeOrder.filter(judge => v.split[judge] > 0);
        return <article className="card volume" key={v.label}>
          <h2>{v.label}</h2>
          <strong>{v.total}</strong>
          <p className="volume-average">{v.average.toFixed(2)}/day · {v.active} active {v.active === 1 ? 'day' : 'days'}</p>
          <div className="volume-track" aria-hidden="true">
            {sources.map(judge => <i key={judge} style={{ flexGrow: v.split[judge], backgroundColor: colors[judge] }}/>)}
          </div>
          {sources.length > 0 && <div className="volume-sources">
            {sources.map(judge => <span key={judge}><i style={{ backgroundColor: colors[judge] }}/>{v.split[judge]} {judge}</span>)}
          </div>}
        </article>;
      })}
    </section>,
    atcoder: () => {
      const difficulty = Object.entries(stats.atcoderDifficulty).map(([band, counts]) => ({
        band, counts, total: series.reduce((sum, name) => sum + counts[name], 0)
      }));
      const maxDifficulty = Math.max(1, ...difficulty.map(row => row.total));
      const seriesColors = [colors.AtCoder, activityTint(colors.AtCoder, 2), activityTint(colors.AtCoder, 1)];
      return <section className="card breakdown" style={{ '--panel-color': colors.AtCoder } as CSSProperties}>
        <div className="stats-panel-head">
          <span className="stats-icon"><BarChart3 size={17}/></span>
          <div><h2>AtCoder difficulty</h2><p className="secondary">Last 90 days · first accepts</p></div>
        </div>
        {difficulty.length ? <>
          <div className="legend">{series.map((name, index) => <span key={name}><i style={{ background: seriesColors[index] }}/>{name}</span>)}</div>
          <div className="difficulty-chart">
            {difficulty.map(({ band, counts, total }) => <div className="difficulty-bar" key={band}>
              <span>{band}</span>
              <div className="allocation-track" title={series.map(name => name + ' ' + counts[name]).join(', ')} role="img" aria-label={series.map(name => name + ' ' + counts[name]).join(', ')}>
                {series.map((name, index) => counts[name] > 0 && <span key={name} style={{ width: (counts[name] / maxDifficulty * 100) + '%', background: seriesColors[index] }}/>)}
              </div>
              <span>{total}</span>
            </div>)}
          </div>
        </> : <p className="stats-empty">Connect an AtCoder handle and refresh to see recent first accepts.</p>}
      </section>;
    },
    codeforces: () => <section className="card breakdown" style={{ '--panel-color': colors.Codeforces } as CSSProperties}>
        <div className="stats-panel-head">
          <span className="stats-icon"><Target size={17}/></span>
          <div><h2>Codeforces training</h2><p className="secondary">Progress through your division cutoffs</p></div>
        </div>
        <div className="stats-grind"><span>Solves matching rating grind</span><strong>{stats.grindMatches}</strong></div>
        {stats.upsolves.length ? <div className="stats-rows">
          {stats.upsolves.slice(0, upsolveLimit).map(r => <ProgressRow key={r.rule + ':' + r.contest} label={r.name}
            detail={`Div. ${r.division} · through ${r.cutoff}${r.done === r.total ? ' · Complete' : ''}`} done={r.done} total={r.total}/>)}
          {stats.upsolves.length>7&&<div className="button-wrap">
            {upsolveLimit<stats.upsolves.length&&<Button onClick={()=>setUpsolveLimit(limit=>limit+25)}>Show older rounds</Button>}
            {upsolveLimit>7&&<Button variant="ghost" onClick={()=>setUpsolveLimit(7)}>Show fewer</Button>}
          </div>}
        </div> : <p className="stats-empty">Refresh Codeforces to load rounds and solve progress.</p>}
      </section>,
    cses: () => {
      const undatedCses = stats.timeline.filter(p => p.judge === 'CSES' && !p.day);
      return <section className="card breakdown" style={{ '--panel-color': colors.CSES } as CSSProperties}>
        <div className="stats-panel-head">
          <span className="stats-icon"><Layers3 size={17}/></span>
          <div><h2>CSES completion</h2><p className="secondary">Solved problems by section</p></div>
        </div>
        {sectionOrder.length ? <div className="stats-rows">
          {sectionOrder.map(r => <ProgressRow key={r.name} label={r.name} done={r.done} total={r.total}/>)}
        </div> : <p className="stats-empty">Refresh or import CSES progress to get started.</p>}
        {undatedCses.length > 0 && <details className="undated">
          <summary>Review undated CSES solves ({undatedCses.length})</summary>
          {undatedCses.map(p => <div className="summary-line" key={p.key}>
            <ProblemLink problem={p}/><Button onClick={() => onSolve({ ...p, solve: { day: null, source: p.source } })}>Add date</Button>
          </div>)}
        </details>}
      </section>;
    },
    lists: () => <section className="card breakdown">
        <div className="stats-panel-head">
          <span className="stats-icon"><ListChecks size={17}/></span>
          <div><h2>Practice lists</h2><p className="secondary">Completion across your saved queues</p></div>
        </div>
        {listOrder.length ? <div className="stats-rows">
          {listOrder.map(l => <ProgressRow key={l.id} label={l.name} done={l.done} total={l.total}/>)}
        </div> : <p className="stats-empty">Add problem links or create a Guide rule.</p>}
      </section>,
  };

  return <div className="stats-page">
    <Heading title="Stats" description="Your training activity across all judges." action={<div className="stats-actions">

      <Button onClick={() => setCustomizing(true)}><SlidersHorizontal size={16}/>Customize stats</Button>
    </div>}/>
    {visible.length ? <div className="stats-dashboard">
      {visible.map(key => <Fragment key={key}>{panels[key]()}</Fragment>)}
    </div> : <Empty title="No stats cards selected" description="Choose the cards you want to see in Customize stats."/>}
    {customizing && <CustomizeStats onColors={onColors} profile={profile} preferences={preferences} windows={windows} lists={lists}
      sections={state.csesProgress.map(section => section.name)}
      onSave={value => { setPreferences(value); setCustomizing(false); }} close={() => setCustomizing(false)}/>}
  </div>;
}
