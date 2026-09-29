import type { GameEvent, GameState, ResolvedPlay, Seat } from '../engine/types';

/** Public table history only: never inspect hands to infer who owns a play. */
type RoundState = Pick<GameState, 'events' | 'currentOwner' | 'currentPlay'>;

export interface RoundSeatView {
  seat: Seat;
  /** Latest cards this seat actually played in this round, even after passing. */
  play: ResolvedPlay | null;
  playEventIndex: number | null;
  lastAction: GameEvent | null;
  isCurrent: boolean;
}

export interface RoundView {
  seats: RoundSeatView[];
  events: readonly GameEvent[];
  lastEvent: GameEvent | null;
  /** Index of the closing event, or -1 before the first completed round. */
  afterEventIndex: number;
}

/**
 * Derive four stable table slots without changing the engine state. A closing
 * pass belongs to the completed round and must disappear with its card piles.
 */
export function getRoundView(state: RoundState): RoundView {
  let afterPosition = -1;
  for (let index = state.events.length - 1; index >= 0; index--) {
    if (state.events[index].roundEnded) { afterPosition = index; break; }
  }
  const events = state.events.slice(afterPosition + 1);
  const seats: RoundSeatView[] = ([0, 1, 2, 3] as const).map(seat => ({
    seat, play: null, playEventIndex: null, lastAction: null, isCurrent: false,
  }));
  for (const event of events) {
    const slot = seats[event.player];
    slot.lastAction = event;
    if (event.type === 'play' && event.play) {
      slot.play = event.play;
      slot.playEventIndex = event.index;
    }
  }
  // Authority comes from currentOwner/currentPlay, not the next turn, hand
  // length, or a finisher's seat. The final play remains visible at settlement.
  if (state.currentOwner !== null && state.currentPlay) {
    const current = seats[state.currentOwner];
    current.play = state.currentPlay;
    current.isCurrent = true;
  }
  return {
    seats, events, lastEvent: events.at(-1) ?? null,
    afterEventIndex: afterPosition < 0 ? -1 : state.events[afterPosition].index,
  };
}
