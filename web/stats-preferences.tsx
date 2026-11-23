import { Fragment, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button, Field, Modal, Notice, Toggle } from './ui';
import { judges, type Judge } from './types';

const cardNames = {
  lifetime: 'All-time solves',
  streak: 'Solve streak',
  weekly: 'Weekly volume',
  activity: 'Solve activity',
  consistency: 'Consistency',
  volume: 'Solve volume by period',
  progression: 'Difficulty progression',
  focus: 'Training focus',
  atcoder: 'AtCoder difficulty',
  codeforces: 'Codeforces training',
  cses: 'CSES completion',
  lists: 'Practice lists',
};
export type StatsCard = keyof typeof cardNames;
type ToggleableCard = Exclude<StatsCard, 'volume'>;
const cards = Object.keys(cardNames) as StatsCard[];
const defaultCards: ToggleableCard[] = ['lifetime', 'streak', 'weekly', 'activity'];

type Preferences = {
  order: StatsCard[];
  visible: ToggleableCard[];
  windows: string[];
  judges: Judge[];
  lists: string[];
  sections: string[];
  solveGoal: number;
  dayGoal: number;
};

function defaults(): Preferences {
  return { order: cards, visible: defaultCards, windows: [], judges: [], lists: [], sections: [], solveGoal: 0, dayGoal: 0 };
}

const storageKey = (profile: string) => 'ut-stats-' + profile;
const maxSolveGoal = 9999;
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string'))] : [];
const goal = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : 0;
const isCard = (key: string): key is StatsCard => Object.hasOwn(cardNames, key);
const isToggleableCard = (key: string): key is ToggleableCard => key !== 'volume' && isCard(key);

export function loadStatsPreferences(profile: string, windows: string[]): Preferences {
  const fallback = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(profile)) ?? 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    const order = strings(raw.order).filter(isCard);
    return {
      order: [...new Set([...order, ...cards])],
      visible: Array.isArray(raw.visible) ? strings(raw.visible).filter(isToggleableCard) : fallback.visible,
      windows: strings(raw.windows).filter(name => windows.includes(name)),
      judges: strings(raw.judges).filter((name): name is Judge => (judges as readonly string[]).includes(name)),
      lists: strings(raw.lists),
      sections: strings(raw.sections),
      solveGoal: goal(raw.solveGoal, maxSolveGoal),
      dayGoal: goal(raw.dayGoal, 7),
    };
  } catch {
    return fallback;
  }
}

function toggle<T>(values: T[], key: T, selected: boolean) {
  return selected ? [...values, key] : values.filter(value => value !== key);
}

export function CustomizeStats({ onColors, profile, preferences, windows, lists, sections, onSave, close }: {
  onColors: () => void;
  profile: string;
  preferences: Preferences;
  windows: string[];
  lists: {id: string; name: string}[];
  sections: string[];
  onSave: (value: Preferences) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [error, setError] = useState('');

  function move(index: number, shift: number) {
    const order = [...draft.order];
    [order[index], order[index + shift]] = [order[index + shift], order[index]];
    setDraft({ ...draft, order });
  }

  return <Modal title="Customize stats" description="Choose the cards, goals and training progress you want to see." close={close}>
    <form onSubmit={event => {
      event.preventDefault();
      try {
        localStorage.setItem(storageKey(profile), JSON.stringify(draft));
        onSave(draft);
      } catch {
        setError('Stats preferences could not be saved on this device.');
      }
    }}>
      <div className="dialog-body form-stack"><Button onClick={onColors}>Judge colors</Button>
        {error && <Notice type="error">{error}</Notice>}
        <fieldset className="stats-settings-group">
          <legend>Cards</legend>
          {draft.order.map((key, index) => <Fragment key={key}>
            <div className="stats-settings-row">
              {key === 'volume' ? <span className="stats-volume-label">{cardNames[key]}</span>
                : <Toggle checked={draft.visible.includes(key)} onChange={value => setDraft({ ...draft, visible: toggle(draft.visible, key, value) })}>{cardNames[key]}</Toggle>}
              <div className="stats-reorder">
                <Button aria-label={'Move ' + cardNames[key] + ' up'} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15}/></Button>
                <Button aria-label={'Move ' + cardNames[key] + ' down'} disabled={index === draft.order.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15}/></Button>
              </div>
            </div>
            {key === 'volume' && <fieldset className="stats-settings-group stats-periods">
              <legend>Periods to show</legend>
              {windows.map(name => <Toggle key={name} checked={draft.windows.includes(name)} onChange={value => setDraft({ ...draft, windows: toggle(draft.windows, name, value) })}>{name}</Toggle>)}
            </fieldset>}
          </Fragment>)}
        </fieldset>
        <fieldset className="stats-settings-group stats-settings-goals">
          <legend>Weekly goals</legend>
          <Field label="Solves per week"><input type="number" min={0} max={maxSolveGoal} value={draft.solveGoal || ''} placeholder="Off" onChange={event => setDraft({ ...draft, solveGoal: Number(event.target.value) })}/></Field>
          <Field label="Active days per week"><input type="number" min={0} max={7} value={draft.dayGoal || ''} placeholder="Off" onChange={event => setDraft({ ...draft, dayGoal: Number(event.target.value) })}/></Field>
        </fieldset>
        <fieldset className="stats-settings-group">
          <legend>Pinned judges</legend>
          {judges.map(name => <Toggle key={name} checked={draft.judges.includes(name)} onChange={value => setDraft({ ...draft, judges: toggle(draft.judges, name, value) })}>{name}</Toggle>)}
        </fieldset>
        {lists.length > 0 && <fieldset className="stats-settings-group">
          <legend>Pinned practice lists for Training focus</legend>
          {lists.map(({id, name}) => <Toggle key={id} checked={draft.lists.includes(id)} onChange={value => setDraft({ ...draft, lists: toggle(draft.lists, id, value) })}>{name}</Toggle>)}
        </fieldset>}
        {sections.length > 0 && <details className="rule-details">
          <summary>Pinned CSES sections for Training focus</summary>
          <div className="form-stack">
            {sections.map(name => <Toggle key={name} checked={draft.sections.includes(name)} onChange={value => setDraft({ ...draft, sections: toggle(draft.sections, name, value) })}>{name}</Toggle>)}
          </div>
        </details>}
      </div>
      <div className="dialog-actions stats-settings-actions">
        <Button variant="ghost" onClick={() => setDraft(defaults())}>Reset defaults</Button>
        <Button onClick={close}>Cancel</Button>
        <Button variant="main" type="submit">Save</Button>
      </div>
    </form>
  </Modal>;
}
