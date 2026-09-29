import type { GameAction } from '../../engine/types';
import type { EndgameAnalysis, EndgameOutcome } from '../endgame/types';
import type { JWXXC_BOUNDARY_OBJECTIVE, JWXXC_BOUNDARY_SCOPE } from './objectives';

export interface JwxxcEndgameBudget {
  maxNodes: number;
  maxActionWork: number;
  maxActionsPerNode: number;
  maxMillis: number;
  useTwoPlay: boolean;
}
export interface JwxxcEndgameCertificate {
  version: string;
  reusedPublicProofVersion: string;
  workBudget: JwxxcEndgameBudget;
  objectiveId: typeof JWXXC_BOUNDARY_OBJECTIVE;
  scope: typeof JWXXC_BOUNDARY_SCOPE;
  rulesVersion: string;
  publicInputFingerprint: string;
  status: 'exact' | 'unknown' | 'not-applicable';
  method: 'single-play' | 'two-play' | 'alpha-beta' | 'none';
  reason: string;
  eligibleOverride: boolean;
  lowerBound: number | null;
  upperBound: number | null;
  nodes: number;
  actionWork: number;
  elapsedMs: number;
  transpositions: { exact: number; lower: number; upper: number; hits: number };
  rootActionsComplete: boolean;
  checkedReplyCount: number;
  outcomes?: { selfThird: EndgameOutcome; opponentThird: EndgameOutcome };
  action?: GameAction;
}
export interface JwxxcEndgameResult {
  action: GameAction | null;
  certificate: JwxxcEndgameCertificate;
  tactical: EndgameAnalysis;
}

/** A status string alone cannot grant an override; bounds, scope and chosen action must agree. */
export function isJwxxcExactOverride(result: JwxxcEndgameResult): boolean {
  const certificate = result.certificate;
  return certificate.version === 'jwxxc-public-two-active-minimax-v1' && certificate.status === 'exact' && certificate.eligibleOverride && result.action !== null &&
    certificate.action !== undefined && JSON.stringify(result.action) === JSON.stringify(certificate.action) &&
    certificate.lowerBound !== null && Number.isFinite(certificate.lowerBound) &&
    certificate.lowerBound === certificate.upperBound && certificate.objectiveId === 'actual-level-transition-v1' &&
    certificate.scope === 'actual_level_transition';
}
