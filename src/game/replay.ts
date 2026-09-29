import { applyAction } from '../engine/reducer';
import type { GameState } from '../engine/types';
import { initialGame, type SavedGame } from './persistence';

export function getReplayStates(saved: SavedGame): GameState[] {
  const states = [initialGame(saved.config, saved.seed, saved.setup)];
  for (const action of saved.actions) {
    const next = applyAction(states[states.length - 1], action);
    if (!next.ok) throw new Error(`回放动作无效：${next.error}`);
    states.push(next.state);
  }
  return states;
}
