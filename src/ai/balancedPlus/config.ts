import type { BalancedWorkBudget } from '../balanced/config';
import type { ProEndgameBudget } from '../pro/certificate';
import {BALANCED_PLUS_ENDGAME_BUDGET,BALANCED_PLUS_ENDGAME_VERSION} from './endgame';

export interface BalancedPlusWorkBudget {
  version: 'balanced-plus-work-v1';
  base: BalancedWorkBudget;
  endgame: ProEndgameBudget;
  samples: number;
  controlSamples: number;
  roots: number;
  rolloutSamples: number;
  rolloutRoots: number;
  rolloutPlies: number;
  rolloutCardLimit: number;
}

/** Deterministic work limits, independent of wall time and machine speed. */
export const BALANCED_PLUS_WORK: Readonly<BalancedPlusWorkBudget> = Object.freeze({
  version: 'balanced-plus-work-v1',
  base: {
    version: 'balanced-plus-residual-work-v1',
    candidates: {maxVariantChecks:384,maxAdditionalCandidates:192,maxChoiceNodes:8192},
    planner: {maxNodes:24,maxSubsetChecks:1023,maxCatalogChecks:128,branchesPerNode:5,alternatives:4,exactHandLimit:8},
    maxEvaluatedCandidates:16,
  },
  endgame:{...BALANCED_PLUS_ENDGAME_BUDGET},
  samples:12,controlSamples:8, roots:16, rolloutSamples:4, rolloutRoots:4, rolloutPlies:96, rolloutCardLimit:48,
});

export const BALANCED_PLUS_CONFIG = Object.freeze({
  version:'balanced-plus-config-v1',
  objective:'team-actual-hand-transition-v1',
  endgameVersion:BALANCED_PLUS_ENDGAME_VERSION,
  strengthEvidence:'separate-frozen-evaluation',
  controlWeight:12, opponentFinishWeight:90, partnerFinishWeight:45,
  leadControlWeight:3, followControlWeight:12,
  rolloutMinGain:0.18,
});
