import { PRO_ACTION_BUDGET, type ProActionBudget } from '../pro/actions';
import type { JwxxcEndgameBudget } from './certificates';

export const JWXXC_WORK_VERSION = 'jwxxc-work-v1' as const;
export const JWXXC_ENDGAME_BUDGET: Readonly<JwxxcEndgameBudget> = Object.freeze({
  maxNodes: 1200, maxActionWork: 150000, maxActionsPerNode: 40000, maxMillis: 450, useTwoPlay: true,
});
export interface JwxxcSearchBudget {
  enabled: boolean;
  sampleCount: number;
  confirmationCount: number;
  maxRootActions: number;
  maxPlies: number;
  maxTransitions: number;
  maxMillis: number;
  confidenceAlpha: number;
  minImprovement: number;
}
/** Search remains opt-in until its own independent model/search comparison justifies promotion. */
export const JWXXC_SEARCH_BUDGET: Readonly<JwxxcSearchBudget> = Object.freeze({
  enabled: false, sampleCount: 4, confirmationCount: 16, maxRootActions: 4,
  maxPlies: 160, maxTransitions: 6000, maxMillis: 1000, confidenceAlpha: 0.05, minImprovement: 0.1,
});
export interface JwxxcWorkBudget {
  version: typeof JWXXC_WORK_VERSION;
  actions: ProActionBudget;
  proof: JwxxcEndgameBudget;
  search: JwxxcSearchBudget;
  searchMaxRemaining: number;
}
export const JWXXC_WORK: Readonly<JwxxcWorkBudget> = Object.freeze({
  version: JWXXC_WORK_VERSION, actions: { ...PRO_ACTION_BUDGET }, proof: { ...JWXXC_ENDGAME_BUDGET },
  search: { ...JWXXC_SEARCH_BUDGET }, searchMaxRemaining: 24,
});
