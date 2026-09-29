import type { EndgameOutcome } from '../endgame/types';
import type { GameState, Seat } from '../../engine/types';
import { getResult } from '../../engine/reducer';
import { createMatchProgress, settleMatchProgress } from '../../match/progression';
import type { AiObservation } from '../types';

export const PRO_TRANSITION_OBJECTIVE = 'actual-level-transition-v1' as const;
export const PRO_TRANSITION_SCOPE = 'actual_level_transition' as const;

/** Explicit finite lexicographic objective. Passing A outranks any possible level
 * movement. Otherwise use actual capped level movement, never nominal award.
 * This is an ordering of this hand's boundary, not an estimated match-win value. */
export function transitionUtility(outcome: EndgameOutcome, team: 0 | 1): number {
  if (outcome.matchWinner !== null) return outcome.matchWinner === team ? 100 : -100;
  const other = team === 0 ? 1 : 0;
  return outcome.teamLevelsAfter[team] - outcome.teamLevelsBefore[team]
    - (outcome.teamLevelsAfter[other] - outcome.teamLevelsBefore[other]);
}

/** Used with a replay-validated public synthetic world, never authoritative hidden
 * ownership. The frozen progression function remains the only settlement rule. */
export function evaluatePublicFinishOutcome(obs: AiObservation, model: GameState, third: Seat): EndgameOutcome | null {
  const context = obs.matchContext;
  if (!context || obs.mode === 'practice') return null;
  const result = getResult([...obs.finished, third]);
  if (!result || result.doubleUp || result.last === null) return null;
  const progress = { ...createMatchProgress(obs.mode === 'classic' ? 'guan-classic-house-v1' : 'guan-match-v1'),
    teamLevels: [...context.teamLevels] as [number, number], activeTeam: context.levelOwnerTeamId, handNumber: context.handNumber };
  const settled = settleMatchProgress(progress, { ...model, result });
  if (!settled.ok || !settled.progress.lastAdvance) return null;
  const advance = settled.progress.lastAdvance, head = result.order[0]!, last = result.last;
  return { place: third === obs.player ? 3 : 4, winningTeam: result.winningTeam, order: [...result.order],
    nominalAdvance: advance.steps, actualAdvance: advance.to - advance.from, teamLevelsBefore: [...context.teamLevels],
    teamLevelsAfter: [...settled.progress.teamLevels], passesAce: advance.passedAce, matchWinner: settled.progress.winner,
    nextExchange: settled.progress.winner !== null ? null : { kind: 'single', tributeFrom: last, tributeTo: head,
      returnFrom: head, returnTo: last, firstLeaderIfNoAnti: last, firstLeaderIfAnti: head } };
}
