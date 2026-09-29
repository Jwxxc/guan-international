import type { GameAction } from '../../engine/types';
import type { EndgameAnalysis, EndgameOutcome } from '../endgame/types';
import type { PRO_TRANSITION_OBJECTIVE, PRO_TRANSITION_SCOPE } from './objectives';

export interface ProEndgameBudget {
  maxNodes: number;
  maxActionWork: number;
  maxActionsPerNode: number;
  /** false forces the general solver for regression/ablation; never changes rules. */
  useTwoPlay: boolean;
}
export interface ProEndgameCertificate {
  version: string;
  workBudget: ProEndgameBudget;
  objectiveId: typeof PRO_TRANSITION_OBJECTIVE;
  scope: typeof PRO_TRANSITION_SCOPE;
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
  transpositions: { exact: number; lower: number; upper: number; hits: number };
  rootActionsComplete: boolean;
  checkedReplyCount: number;
  outcomes?: { selfThird: EndgameOutcome; opponentThird: EndgameOutcome };
  action?: GameAction;
}
export interface ProEndgameResult {
  action: GameAction | null;
  certificate: ProEndgameCertificate;
  tactical: EndgameAnalysis;
}
