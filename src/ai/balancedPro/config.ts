import type {BalancedWorkBudget} from '../balanced/config';
import {BALANCED_CONFIG} from '../balanced/config';
import type {ProEndgameBudget} from '../pro/certificate';
import {BALANCED_PLUS_ENDGAME_BUDGET,BALANCED_PLUS_ENDGAME_VERSION} from '../balancedPlus/endgame';
import {PRO_CONTINUATION_VERSION} from './continuation';
import {PLANNED_PRO_CONTINUATION_VERSION,PLANNED_PRO_QUERY_BUDGET} from './plannedContinuation';

export interface BalancedProWorkBudget {
  version:'balanced-pro-work-v1';
  base:BalancedWorkBudget;
  endgame:ProEndgameBudget;
  controlSamples:number;
  pilotSamples:number;
  refineSamples:number;
  confirmationSamples:number;
  rootCandidates:number;
  refinedCandidates:number;
  maxPlies:number;
  maxTransitions:number;
  cardLimit:number;
}

export const BALANCED_PRO_WORK:Readonly<BalancedProWorkBudget>=Object.freeze({
  version:'balanced-pro-work-v1',
  base:{version:'balanced-pro-residual-v1',candidates:{maxVariantChecks:512,maxAdditionalCandidates:256,maxChoiceNodes:8192},
    planner:{maxNodes:24,maxSubsetChecks:1023,maxCatalogChecks:128,branchesPerNode:5,alternatives:4,exactHandLimit:8},maxEvaluatedCandidates:24},
  endgame:{...BALANCED_PLUS_ENDGAME_BUDGET,maxNodes:4000,maxActionWork:200000},
  controlSamples:16,pilotSamples:4,refineSamples:4,confirmationSamples:8,
  rootCandidates:12,refinedCandidates:4,maxPlies:160,maxTransitions:16000,cardLimit:72,
});

export const BALANCED_PRO_CONFIG=Object.freeze({
  version:'balanced-pro-config-v1',objective:'team-actual-hand-transition-v1',
  strengthEvidence:'separate-frozen-evaluation',
  endgameVersion:BALANCED_PLUS_ENDGAME_VERSION,
  continuationVersion:PRO_CONTINUATION_VERSION,rolloutStyle:'balanced' as const,
  plannedContinuationVersion:PLANNED_PRO_CONTINUATION_VERSION,plannedContinuationBudget:{...PLANNED_PRO_QUERY_BUDGET},plannedContinuationHandLimit:12,
  scoring:{...BALANCED_CONFIG},
  opponentFinishWeight:90,partnerFinishWeight:45,leadControlWeight:3,followControlWeight:12,
  minGain:.12,clearPilotGap:1.5,maxConfirmationLossFraction:.25,
  maxPracticeConfirmationLossFraction:.5,
  practiceUpgradeWeight:.05,
});

// The frozen v1 constants above are also used by historical saved hands.
// Only the new descriptor opts into these revisions; there is no global switch.
export const BALANCED_PRO_PUBLIC_FINISH_REVISION = 'balanced-pro-public-finish-v1';
export const BALANCED_PRO_RELAY_REVISION = 'balanced-pro-seat-aware-relay-v1';
