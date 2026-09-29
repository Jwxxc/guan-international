import type { CandidateBudget } from '../candidates/types';
export interface BalancedPlannerBudget { maxNodes: number; maxSubsetChecks: number; maxCatalogChecks: number; branchesPerNode: number; alternatives: number; exactHandLimit: number }
export interface BalancedWorkBudget { version: string; candidates: CandidateBudget; planner: BalancedPlannerBudget; maxEvaluatedCandidates: number }
export const BALANCED_CONFIG = Object.freeze({
  version:'balanced-config-v1', planningWeight:12, weakSingleWeight:2, controlResourceWeight:1.5,
  partnerPass:26, relayBonus:24, shortOpponentLead:32, urgentFollow:34, urgentRank:1.5,
  acceptWind:44, denyWind:72, opponentHeadPressure:24, provenTypeControlWeight:3,
});
export const BALANCED_WORK: Readonly<BalancedWorkBudget> = Object.freeze({
  version:'balanced-work-v1',
  candidates:Object.freeze({maxVariantChecks:384,maxAdditionalCandidates:192,maxChoiceNodes:8192}),
  planner:Object.freeze({maxNodes:16,maxSubsetChecks:1023,maxCatalogChecks:96,branchesPerNode:4,alternatives:3,exactHandLimit:8}),
  maxEvaluatedCandidates:12,
});
