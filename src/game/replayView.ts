import { SEATS, teamOf } from '../engine/rules';
import type { Seat } from '../engine/types';
import type { MatchReplayFrame } from '../match/replay';
import { defaultSeatInfo, seatName, type SeatNames } from './tableView';

export type ReplaySeatKinds = Partial<Record<Seat, 'human' | 'ai'>>;
export function replaySeatInfo(names?: SeatNames, kinds?: ReplaySeatKinds) {
  const seats = defaultSeatInfo();
  for (const seat of [0, 1, 2, 3] as const) { seats[seat].name = seatName(seat, names); seats[seat].kind = kinds?.[seat] ?? seats[seat].kind; }
  return seats;
}
export const otherReplaySeats = (viewer: Seat): Seat[] => [2, 3, 1].map(offset => ((viewer + offset) % 4) as Seat);
/** Replace only original tokens in one pass: nicknames containing other names or 我方 are not rewritten again. */
export function replayLabelForViewer(label: string, viewer: Seat = 0, names?: SeatNames): string {
  const replacements: Record<string, string> = { 我方: teamOf(viewer) === 0 ? '我方' : '对方', 对方: teamOf(viewer) === 0 ? '对方' : '我方' };
  for (const seat of [0, 1, 2, 3] as const) replacements[SEATS[seat].name] = seatName(seat, names);
  return label.replace(/我方|对方|南山|青禾|松风|你/g, token => replacements[token]);
}

/** Read-only reconstruction from this frame's actual public transfers; no candidate/rule recomputation. */
export function replayExchangeForViewer(frame: MatchReplayFrame, viewer: Seat, classic: boolean) {
  if (!frame.exchange) return null;
  let hand = [...frame.state.hands[viewer]];
  if (!classic && frame.exchange.phase !== 'done') for (const transfer of frame.exchange.publicTransfers ?? []) {
    if (transfer.from === viewer) hand = hand.filter(card => card.id !== transfer.card.id);
    if (transfer.to === viewer) hand.push(transfer.card);
  }
  return { ...frame.exchange, player: viewer, hand, eligibleCardIds: [], destination: null, returnRule: null };
}
