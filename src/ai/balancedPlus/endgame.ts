import { ownAiInput } from '../input';
import type { AiObservation } from '../types';
import type { ProEndgameBudget, ProEndgameCertificate, ProEndgameResult } from '../pro/certificate';
import { proveProEndgame } from '../pro/endgame';
import { transitionUtility } from '../pro/objectives';

export const BALANCED_PLUS_ENDGAME_VERSION = 'balanced-plus-public-two-active-v1';
export const BALANCED_PLUS_ENDGAME_BUDGET: Readonly<ProEndgameBudget> = Object.freeze({
  maxNodes: 2_000,
  maxActionWork: 100_000,
  maxActionsPerNode: 40_000,
  useTwoPlay: true,
});

export interface BalancedPlusEndgameResult extends ProEndgameResult {
  certificate: ProEndgameCertificate & {
    strategyId: 'balanced-plus-v1';
    solverVersion: string;
  };
}

/** Exact extension beyond the balanced two-play certificate. With two opposed
 * active players, the complete public card ledger determines the other hand's
 * faces. The existing solver validates that ledger and the full action history
 * before searching; it never receives authoritative hidden ownership.
 *
 * The result proves only this hand's actual level / pass-A boundary, not a whole
 * match win probability. Incomplete work and equal capped outcomes retain the
 * ordinary policy's choice. Three- and four-player worlds remain uncertain and
 * belong to the separate sampled forward search, never this exact certificate.
 */
export function solveBalancedPlusEndgame(
  input: AiObservation,
  limits: Partial<ProEndgameBudget> = {},
): BalancedPlusEndgameResult {
  const obs = ownAiInput(input);
  const budget = { ...BALANCED_PLUS_ENDGAME_BUDGET, ...limits };
  // An explicitly disabled budget must not still certify the shortcut route.
  if (!budget.maxNodes || !budget.maxActionWork || !budget.maxActionsPerNode) budget.useTwoPlay = false;
  const proof = proveProEndgame(obs, budget);
  const certificate: BalancedPlusEndgameResult['certificate'] = {
    ...proof.certificate,
    version: BALANCED_PLUS_ENDGAME_VERSION,
    strategyId: 'balanced-plus-v1',
    solverVersion: proof.certificate.version,
  };
  const outcomes = certificate.outcomes;
  const lower = certificate.lowerBound;
  const hasStrictBenefit = outcomes !== undefined && lower !== null
    && lower > Math.min(
      transitionUtility(outcomes.selfThird, obs.team),
      transitionUtility(outcomes.opponentThird, obs.team),
    );
  const eligible = proof.action !== null && certificate.status === 'exact'
    && certificate.eligibleOverride && lower === certificate.upperBound && hasStrictBenefit;
  certificate.eligibleOverride = eligible;
  if (!eligible) delete certificate.action;
  return { action: eligible ? proof.action : null, certificate, tactical: proof.tactical };
}
