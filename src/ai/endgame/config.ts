import type {EndgameProofBudget} from './types';
export const ENDGAME_TACTICAL_VERSION='two-active-public-finish-v1';
export const ENDGAME_PROOF_BUDGET:Readonly<EndgameProofBudget>=Object.freeze({maxOwnCards:12,maxOpponentCards:8,maxHistoryEvents:512,maxReplySubsets:255,maxFirstCandidates:128});
