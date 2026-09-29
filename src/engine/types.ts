export type Suit = 'S' | 'H' | 'C' | 'D' | 'J';
export type Rank = number; // 2..14=A, 15=small joker, 16=big joker
export type Seat = 0 | 1 | 2 | 3;
export interface Card { id: string; deck: number; suit: Suit; rank: Rank }
export interface RuleConfig { version: 'guan-practice-v1'; levelRank: Rank }
export type PlayKind = 'single' | 'pair' | 'triple' | 'fullHouse' | 'straight' | 'pairs' | 'plate' | 'bomb' | 'straightFlush' | 'jokerBomb';
export interface WildMapping { cardId: string; rank: Rank; suit: Suit }
export interface ResolvedPlay { key: string; cards: Card[]; kind: PlayKind; size: number; value: number; label: string; wildcards: WildMapping[] }
export interface ActionStamp { sessionId: string; handId: string; stateVersion: number; player: Seat }
export type GameAction = ActionStamp & ({ type: 'play'; cardIds: string[]; playKey: string } | { type: 'pass' });
export interface GameEvent { index: number; player: Seat; type: 'play' | 'pass'; play?: ResolvedPlay; roundEnded: boolean; nextPlayer: Seat | null; finished?: Seat; message: string }
export interface GameResult { winningTeam: 0 | 1; doubleUp: boolean; order: Seat[]; last: Seat | null; doubleDown: Seat[] }
export interface GameState {
  sessionId: string; handId: string; stateVersion: number; rules: RuleConfig;
  hands: Card[][]; currentPlayer: Seat; firstPlayer: Seat;
  currentPlay: ResolvedPlay | null; currentOwner: Seat | null; pendingResponders: Seat[];
  finished: Seat[]; played: Card[]; events: GameEvent[]; result: GameResult | null;
}
export interface PlayerObservation {
  sessionId: string; handId: string; stateVersion: number; player: Seat; team: 0 | 1;
  hand: Card[]; rules: RuleConfig; remainingCounts: number[]; currentPlayer: Seat;
  currentPlay: ResolvedPlay | null; currentOwner: Seat | null; finished: Seat[];
  history: GameEvent[]; isOver: boolean;
}
export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string };
export type ValidationResult = { ok: true; play?: ResolvedPlay } | { ok: false; error: string };
export interface PracticeConfig { levelRank?: Rank; sessionId?: string; handId?: string; firstPlayer?: Seat }
export type Rng = () => number;
