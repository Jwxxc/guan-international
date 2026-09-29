import type { TableView, TableSeatInfo } from '../game/tableView';
import type { Seat } from '../engine/types';
import type { OnlineObservation, RoomSnapshot } from './protocol';

export function onlineTableView(packet: OnlineObservation, room: RoomSnapshot): TableView {
  const own = packet.game;
  const seats = Object.fromEntries(room.seats.map(seat => [seat.seat, {
    name: seat.nickname || `座位 ${seat.seat}`, kind: seat.kind === 'ai' ? 'ai' : 'human', connected: seat.connected,
    controlMode: seat.control === 'reconnecting' ? 'offline' : seat.control,
  }])) as Record<Seat, TableSeatInfo>;
  return {
    sessionId: own.sessionId, handId: own.handId, stateVersion: own.stateVersion, rules: own.rules,
    currentPlayer: own.currentPlayer, currentOwner: own.currentOwner, currentPlay: own.currentPlay,
    pendingResponders: own.pendingResponders, finished: own.finished, events: own.history, result: packet.result,
    firstPlayer: packet.firstPlayer, myHand: own.hand, remainingCounts: own.remainingCounts, viewerSeat: own.player, seats,
  };
}
