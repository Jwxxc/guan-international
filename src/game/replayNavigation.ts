import type { GameState, Seat } from '../engine/types';

export function clampReplayIndex(index: number, frameCount: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.max(0, frameCount - 1), Math.trunc(index)));
}

export function initialReplayHandIndex(history: readonly { handId: string }[], handId?: string): number {
  return handId ? Math.max(0, history.findIndex(hand => hand.handId === handId)) : 0;
}

/** Seek strictly forward to the position before the viewer actually plays cards.
 * Adjacent exchange snapshots may name a currentPlayer without recording a turn;
 * require the following snapshot to contain the corresponding new play event.
 */
export function nextReplayPlayIndex(states: readonly GameState[], index: number, viewerSeat: Seat): number | null {
  for (let candidate = clampReplayIndex(index, states.length) + 1; candidate < states.length - 1; candidate++) {
    const before = states[candidate], after = states[candidate + 1];
    const action = after.events.at(-1);
    if (!before.result && before.currentPlayer === viewerSeat
      && before.sessionId === after.sessionId && before.handId === after.handId
      && after.events.length === before.events.length + 1
      && action?.type === 'play' && action.player === viewerSeat) return candidate;
  }
  return null;
}
