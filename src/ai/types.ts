import type { Card, GameAction, PlayerObservation, Seat } from '../engine/types';

export type PolicyId = 'baseline' | 'coop-v2';
export interface PolicyStamp { id: PolicyId; version: string; configHash: string }
export interface AiBudget { maxNodes: number; maxCandidates: number; maxSubsetChecks: number }
export interface AiObservation extends PlayerObservation {
  /** Optional exported public snapshot. Never inferred from hidden ownership.
   * Live play normally supplies the complete history instead. */
  publicCardLedger?: { stateVersion: number; playedCards: Card[]; source: 'public-history' | 'public-snapshot' };
  /** Retains invalid-history evidence across the runtime allowlist. */
  publicHistoryInvalid?: boolean;
  partner: Seat;
  pendingResponders: Seat[];
  mode: 'practice' | 'classic' | 'legacy';
  matchContext: null | { teamLevels: [number, number]; levelOwnerTeamId: 0 | 1 | null; handNumber: number };
  publicTransfers: Array<{ from: Seat; to: Seat; card: Card; type: 'tribute' | 'return' }>;
  antiTributeEvidence: Array<{ player: Seat; card: Card }>;
  finishOutcome: { place: 1 | 2 | 3 | 4; handEnds: boolean; winningTeam: 0 | 1 | null; doubleUp: boolean; nominalAdvance: number | null; passesAce: boolean };
  passOutcome: { endsRound: boolean; nextLeader: Seat | null };
}
export interface AiCandidateDiagnostic {
  action: GameAction;
  score: number;
  reasonCodes: string[];
  features: Record<string, number | boolean | string | null>;
}
export interface AiDecision {
  action: GameAction;
  policyVersion: PolicyId;
  configVersion: string;
  configHash: string;
  reasonCodes: string[];
  explanation: string;
  topCandidates: AiCandidateDiagnostic[];
  stats: { nodes: number; subsetChecks: number; candidateCount: number; evaluatedCandidates: number; approximate: boolean; budgetExhausted: boolean; fallbackReason?: string };
}
