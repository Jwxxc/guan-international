import type { PlayerObservation, ResolvedPlay } from '../../engine/types';
import type { AiObservation } from '../types';

export type CandidateObservation = PlayerObservation & Partial<Pick<AiObservation, 'publicTransfers' | 'antiTributeEvidence'>>;
export interface CandidateBudget { maxVariantChecks: number; maxAdditionalCandidates: number; maxChoiceNodes: number }
export interface CandidateStats {
  version: string; baseCandidates: number; addedCandidates: number; variantChecks: number; choiceNodes: number;
  truncatedCandidates: boolean; allPhysicalPlaysEnumerated: false;
}
export interface CandidateBatch { moves: ResolvedPlay[]; legalPass: boolean; stats: CandidateStats }
export type CandidateProvider = (observation: CandidateObservation, budget?: CandidateBudget) => CandidateBatch;
