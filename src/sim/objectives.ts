/** Suivi des objectifs facultatifs et des rangs. */
import { OBJECTIVES, RANKS, type ObjectiveDef } from '../data/objectives';
import { earn } from './economy';
import { marketShare } from './market';
import { cameraViews } from './security';
import type { GameState } from './state';

export function statValue(st: GameState, key: string): number {
  switch (key) {
    case 'reputation':
      return st.reputation.overall;
    case 'expansion':
      return st.store.stage;
    case 'staff':
      return st.employees.length;
    case 'cameras':
      return cameraViews(st).length;
    case 'marketShare':
      return marketShare(st) * 100;
    default:
      return st.stats[key] ?? 0;
  }
}

/** Vérifie les objectifs ; renvoie ceux nouvellement accomplis (récompense versée). */
export function checkObjectives(st: GameState): ObjectiveDef[] {
  const done: ObjectiveDef[] = [];
  for (const o of OBJECTIVES) {
    if (st.objectivesDone.includes(o.id)) continue;
    if (statValue(st, o.stat) >= o.target) {
      st.objectivesDone.push(o.id);
      earn(st, 'recompenses', o.reward);
      done.push(o);
    }
  }
  return done;
}

export function rank(st: GameState): { name: string; next: number | null; progress: number } {
  const v = st.stats.totalRevenue;
  let i = 0;
  while (i + 1 < RANKS.length && v >= RANKS[i + 1].min) i++;
  const next = i + 1 < RANKS.length ? RANKS[i + 1].min : null;
  return { name: RANKS[i].name, next, progress: next ? (v - RANKS[i].min) / (next - RANKS[i].min) : 1 };
}
