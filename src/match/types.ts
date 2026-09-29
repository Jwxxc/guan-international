import type { ActionStamp, Card, GameResult, GameState, RuleConfig, Seat } from '../engine/types';

export type Team = 0 | 1;
export const CLASSIC_RULES_VERSION = 'guan-classic-house-v1' as const;
export type MatchRulesVersion = 'guan-match-v1' | typeof CLASSIC_RULES_VERSION;
export interface MatchAdvance {
  handId: string; team: Team; steps: number; from: number; to: number; passedAce: boolean;
}
export interface MatchProgress {
  version: MatchRulesVersion; teamLevels: [number, number]; activeTeam: Team | null;
  handNumber: number; winner: Team | null; settledHandIds: string[];
  lastResult: GameResult | null; lastAdvance: MatchAdvance | null;
}
export type ExchangeAction = ActionStamp & { type: 'tribute' | 'return'; cardId: string };
export interface CardTransfer { from: Seat; to: Seat; card: Card; type: 'tribute' | 'return' }
export interface ExchangeState {
  /** Absent only in the frozen legacy guan-match-v1 journal format. */
  rulesVersion?: MatchRulesVersion;
  sessionId: string; handId: string; stateVersion: number; rules: RuleConfig;
  hands: Card[][]; previous: GameResult; phase: 'tribute' | 'return' | 'done';
  currentPlayer: Seat | null; donors: Seat[]; recipients: Seat[];
  offers: Array<{ player: Seat; card: Card }>;
  returnOffers: Array<{ player: Seat; card: Card }>;
  transfers: CardTransfer[]; firstPlayer: Seat; antiTribute: boolean;
  tributePairs?: CardTransfer[];
  antiTributeEvidence?: Array<{ player: Seat; card: Card }>;
}
export interface HandSetup { version: 'guan-tribute-v1' | typeof CLASSIC_RULES_VERSION; previous: GameResult; actions: ExchangeAction[] }
export type ExchangeResult = { ok: true; exchange: ExchangeState } | { ok: false; error: string };
export type ProgressResult = { ok: true; progress: MatchProgress } | { ok: false; error: string };
export interface ExchangeObservation {
  sessionId: string; handId: string; stateVersion: number; rules: RuleConfig;
  player: Seat; hand: Card[]; phase: 'tribute' | 'return' | 'done';
  eligibleCardIds: string[]; destination: Seat | null;
  rulesVersion?: MatchRulesVersion;
  previous?: GameResult; currentPlayer?: Seat | null; firstPlayer?: Seat;
  publicTransfers?: CardTransfer[];
  antiTributeEvidence?: Array<{ player: Seat; card: Card }>;
  returnRule?: 'normal' | 'fallback' | null;
}
export interface PreparedHand { game: GameState; exchange: ExchangeState }
