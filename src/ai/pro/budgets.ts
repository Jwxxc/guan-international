import {PRO_ACTION_BUDGET,type ProActionBudget} from './actions';
import {PRO_ENDGAME_BUDGET} from './endgame';
import type {ProEndgameBudget} from './certificate';
import {ROLLOUT_SMOKE_OPTIONS} from './rollout';
export const PRO_WORK_VERSION='pro-work-v1';
export interface ProWorkBudget {version:typeof PRO_WORK_VERSION;actions:ProActionBudget;proof:ProEndgameBudget;search:typeof ROLLOUT_SMOKE_OPTIONS;searchMaxRemaining:number}
export const PRO_WORK:ProWorkBudget={version:PRO_WORK_VERSION,actions:{...PRO_ACTION_BUDGET},proof:{...PRO_ENDGAME_BUDGET},search:{...ROLLOUT_SMOKE_OPTIONS},searchMaxRemaining:24};
