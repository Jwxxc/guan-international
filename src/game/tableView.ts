import type { Card, GameAction, GameState, Seat, ValidationResult } from '../engine/types';
import { SEATS } from '../engine/rules';
import { validateAction } from '../engine/reducer';

export type SeatNames = Partial<Record<Seat, string>>;
export interface TableSeatInfo {
  name: string;
  kind: 'human' | 'ai';
  connected?: boolean;
  controlMode?: 'human' | 'ai' | 'offline' | 'takeover';
}
export type PublicTableState = Pick<GameState, 'sessionId' | 'handId' | 'stateVersion' | 'rules' | 'currentPlayer' | 'currentOwner' | 'currentPlay' | 'pendingResponders' | 'finished' | 'events' | 'result' | 'firstPlayer'>;
/** A renderer receives exactly one private hand; every other field is public. */
export interface TableView extends PublicTableState {
  myHand: Card[];
  remainingCounts: number[];
  viewerSeat: Seat;
  seats: Record<Seat, TableSeatInfo>;
}
export type ResultView = Pick<PublicTableState, 'handId' | 'rules' | 'result'>;

export const defaultSeatInfo = (): Record<Seat, TableSeatInfo> => ({
  0: { name: SEATS[0].name, kind: 'human' },
  1: { name: SEATS[1].name, kind: 'ai' },
  2: { name: SEATS[2].name, kind: 'ai' },
  3: { name: SEATS[3].name, kind: 'ai' },
});
export const seatName = (seat: Seat, names?: SeatNames): string => names?.[seat] ?? SEATS[seat].name;
export const relativeSeat = (seat: Seat, viewer: Seat): Seat => ((seat - viewer + 4) % 4) as Seat;
export const seatPosition = (seat: Seat, viewer: Seat) => SEATS[relativeSeat(seat, viewer)].position;
export const tableActionStamp = (view: TableView) => ({ sessionId: view.sessionId, handId: view.handId, stateVersion: view.stateVersion, player: view.viewerSeat });

/** Local adapter only. Explicit fields prevent future private state from leaking. */
export function toTableView(state: GameState, viewerSeat: Seat = 0, seats = defaultSeatInfo()): TableView {
  return structuredClone({
    sessionId: state.sessionId, handId: state.handId, stateVersion: state.stateVersion,
    rules: state.rules, currentPlayer: state.currentPlayer, firstPlayer: state.firstPlayer,
    currentOwner: state.currentOwner, currentPlay: state.currentPlay,
    pendingResponders: state.pendingResponders, finished: state.finished,
    events: state.events, result: state.result,
    myHand: state.hands[viewerSeat], remainingCounts: state.hands.map(hand => hand.length), viewerSeat, seats,
  });
}

/** UI preview only; only validateAction sees this short-lived compatibility input.
 * It must never be returned, advanced, rendered, or used for AI observations.
 * Authority still validates the same action against the complete real state.
 */
export function previewValidation(view: TableView, action: GameAction): ValidationResult {
  if (action.player !== view.viewerSeat) return { ok: false, error: '只能操作自己的手牌' };
  const hands: Card[][] = [[], [], [], []];
  hands[view.viewerSeat] = view.myHand;
  return validateAction({
    sessionId: view.sessionId, handId: view.handId, stateVersion: view.stateVersion,
    rules: view.rules, currentPlayer: view.currentPlayer, firstPlayer: view.firstPlayer,
    currentOwner: view.currentOwner, currentPlay: view.currentPlay,
    pendingResponders: view.pendingResponders, finished: view.finished,
    events: view.events, result: view.result, played: [], hands,
  }, action);
}
