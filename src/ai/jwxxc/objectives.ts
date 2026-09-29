import { partnerOf, teamOf } from '../../engine/rules';
import type { GameState, Seat } from '../../engine/types';
import { transitionUtility, evaluatePublicFinishOutcome } from '../pro/objectives';

/** The independently trained model's signed nominal single-hand return; never match-win probability. */
export const JWXXC_ROUND_OBJECTIVE = 'jwxxc-round-return-v1' as const;
/** Proofs deliberately report the actual capped boundary objective separately from model Q. */
export const JWXXC_BOUNDARY_OBJECTIVE = 'actual-level-transition-v1' as const;
export const JWXXC_BOUNDARY_SCOPE = 'actual_level_transition' as const;
export const jwxxcTransitionUtility = transitionUtility;
export const evaluateJwxxcPublicFinishOutcome = evaluatePublicFinishOutcome;

export function jwxxcTerminalReturn(state: GameState, actor: Seat): number | null {
  if (!state.result) return null;
  const partnerPlace = state.result.order.indexOf(partnerOf(state.result.order[0]!));
  if (partnerPlace < 1 || partnerPlace > 3) throw Error('Terminal result does not have a valid winning-team partner place');
  return (state.result.winningTeam === teamOf(actor) ? 1 : -1) * (4 - partnerPlace);
}
