import type { GameAction, GameResult, PracticeConfig } from '../engine/types';
import type { SavedGame } from '../game/persistence';
import type { StrategyStamp as PolicyStamp, SeatPolicies } from '../ai/strategyTypes';
import type { ExchangeAction, ExchangeState, MatchProgress, MatchRulesVersion, Team } from './types';

export interface MatchHandRecord {
  seed: number; config: PracticeConfig; exchangeActions: ExchangeAction[];
  actions: GameAction[]; started: boolean;
  policy?: PolicyStamp;
  seatPolicies?: SeatPolicies;
}
export interface MatchJournal {
  kind: 'match'; schemaVersion: 1 | 2; rulesVersion: MatchRulesVersion;
  matchId: string; tributeEnabled: boolean; records: MatchHandRecord[];
}
export interface MatchSession {
  journal: MatchJournal; progress: MatchProgress; saved: SavedGame;
  exchange: ExchangeState | null;
  currentLevelRank: number; levelOwnerTeamId: Team | null; previousHandResult: GameResult | null;
  phase: 'playing' | 'exchange' | 'ready' | 'between' | 'complete';
}
export type MatchSessionResult = { ok: true; match: MatchSession } | { ok: false; error: string };
