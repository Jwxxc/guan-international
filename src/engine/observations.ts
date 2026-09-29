import { teamOf } from './rules';
import type { GameState, PlayerObservation, Seat } from './types';

/** Explicit allowlist plus deep detachment; no state reference, hidden hands, or deal seed. */
export function getObservation(state: GameState, player: Seat): PlayerObservation {
  return structuredClone({
    sessionId: state.sessionId, handId: state.handId, stateVersion: state.stateVersion,
    player, team: teamOf(player), hand: state.hands[player], rules: state.rules,
    remainingCounts: state.hands.map((hand) => hand.length), currentPlayer: state.currentPlayer,
    currentPlay: state.currentPlay, currentOwner: state.currentOwner,
    finished: state.finished, history: state.events, isOver: state.result !== null,
  });
}
