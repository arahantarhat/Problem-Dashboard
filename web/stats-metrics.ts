import type { Judge, Stats } from './types';

export const dayMs = 86400000;
export const toDate = (day: string) => new Date(day + 'T00:00:00Z');
export const toDay = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
const weekMs = 7 * dayMs;

export function solveMetrics(timeline: Stats['timeline'], today: string) {
  const end = +toDate(today);
  const monday = end - ((new Date(end).getUTCDay() + 6) % 7) * dayMs;
  const weeks = Array.from({ length: 12 }, (_, i) => ({ start: monday - (11 - i) * weekMs, solves: 0, days: 0 }));
  const daily = new Map<string, number>();
  const split = new Map<Judge, number>();
  let undated = 0;
  for (const solve of timeline) {
    split.set(solve.judge, (split.get(solve.judge) ?? 0) + 1);
    if (!solve.day) undated++;
    else if (solve.day <= today) daily.set(solve.day, (daily.get(solve.day) ?? 0) + 1);
  }

  let longest = 0;
  let run = 0;
  let previous = -Infinity;
  let recentSolves = 0;
  let recentDays = 0;
  const recentStart = toDay(end - 29 * dayMs);
  for (const day of [...daily.keys()].sort()) {
    const count = daily.get(day)!;
    const stamp = +toDate(day);
    run = stamp - previous === dayMs ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = stamp;
    if (day >= recentStart) {
      recentSolves += count;
      recentDays++;
    }
    const week = weeks[Math.floor((stamp - weeks[0].start) / weekMs)];
    if (week) {
      week.solves += count;
      week.days++;
    }
  }

  return {
    total: timeline.length, undated, split, recentSolves, recentDays, weeks,
    streak: { current: previous >= end - dayMs ? run : 0, longest },
  };
}

export function difficultyHistory(timeline: Stats['timeline'], today: string) {
  const end = toDate(today);
  const start = new Date(end);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 11);
  const cutoff = toDay(+start);
  const history = new Map<Judge, Map<string, number[]>>();
  for (const solve of timeline) {
    if (!solve.day || solve.day < cutoff || solve.day > today || solve.difficulty == null || !Number.isFinite(solve.difficulty)) continue;
    const months = history.get(solve.judge) ?? new Map<string, number[]>();
    const month = solve.day.slice(0, 7);
    const ratings = months.get(month) ?? [];
    ratings.push(solve.difficulty);
    months.set(month, ratings);
    history.set(solve.judge, months);
  }
  return history;
}
