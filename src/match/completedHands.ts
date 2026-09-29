import type { GameResult } from '../engine/types';
import { getMatchHistory } from './replay';
import type { MatchSession } from './sessionTypes';

/** Public settlement facts only; no hands, actions, seeds or exchange choices. */
export interface CompletedHand { handId: string; handNumber: number; levelRank: number; result: GameResult }
const cache = new WeakMap<string[], CompletedHand[]>();
export function getCompletedHands(match: MatchSession): CompletedHand[] {
  const settled = match.progress.settledHandIds;
  if (!settled.length) return [];
  let rows = cache.get(settled);
  if (!rows) {
    rows = getMatchHistory(match).flatMap(hand => hand.result ? [{ handId: hand.handId, handNumber: hand.handNumber,
      levelRank: hand.levelRank, result: structuredClone(hand.result) }] : []);
    cache.set(settled, rows);
  }
  return structuredClone(rows);
}
