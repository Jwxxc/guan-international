import type { Seat } from '../engine/types';
import { decodeSavedGame, STORAGE_KEYS, type SavedGame } from '../game/persistence';
import { getMatchHistory } from '../match/replay';
import { decodeMatchSession } from '../match/session';
import type { MatchSession } from '../match/sessionTypes';
import { MATCH_STORAGE } from '../match/storage';
import type { OnlineObservation, PlayerSession, RoomSnapshot } from '../online/protocol';
import type { HandEntry, MatchEntry, StatisticsEntry, StatisticsMode } from './model';
import { saveStatistics } from './storage';
import { handDifficulty, matchDifficulty } from './difficulty';

const base = (mode: StatisticsMode, sessionId: string, viewerSeat: Seat, completedAt: number | null, recordedAt: number) => ({ schemaVersion: 1 as const, mode, sessionId, viewerSeat, completedAt, recordedAt });
export function practiceEntries(saved: SavedGame, completedAt: number | null, now = Date.now()): HandEntry[] {
  const state = saved.state;
  return state.result ? [{ ...base('practice', state.sessionId, 0, completedAt, now), kind: 'hand', handId: state.handId,
    handNumber: 1, levelRank: state.rules.levelRank, result: structuredClone(state.result), aiDifficulty: handDifficulty(saved) }] : [];
}
/** The live path reads only the already accepted result, never replays during a move. */
export function currentMatchEntries(match: MatchSession, completedAt: number | null, now = Date.now()): StatisticsEntry[] {
  const mode = match.journal.rulesVersion === 'guan-classic-house-v1' ? 'classic' : 'legacy';
  const common = base(mode, match.journal.matchId, 0, completedAt, now), state = match.saved.state;
  const entries: StatisticsEntry[] = state.result ? [{ ...common, kind: 'hand', handId: state.handId,
    handNumber: match.progress.handNumber, levelRank: state.rules.levelRank, result: structuredClone(state.result), aiDifficulty: handDifficulty(match.saved) }] : [];
  if (match.phase === 'complete' && match.progress.winner !== null) entries.push({ ...common, kind: 'match', winningTeam: match.progress.winner, handCount: match.progress.settledHandIds.length, aiDifficulty: matchDifficulty(match) });
  return entries;
}
export function restoredMatchEntries(match: MatchSession, now = Date.now()): StatisticsEntry[] {
  const mode = match.journal.rulesVersion === 'guan-classic-house-v1' ? 'classic' : 'legacy';
  const records = new Map(match.journal.records.map(record => [record.config.handId, record]));
  const hands: HandEntry[] = getMatchHistory(match).flatMap(hand => hand.result ? [{ ...base(mode, match.journal.matchId, 0, null, now),
    kind: 'hand' as const, handId: hand.handId, handNumber: hand.handNumber, levelRank: hand.levelRank, result: structuredClone(hand.result),
    ...(records.has(hand.handId) ? { aiDifficulty: handDifficulty(records.get(hand.handId)!) } : {}) }] : []);
  return [...hands, ...currentMatchEntries(match, null, now).filter((entry): entry is MatchEntry => entry.kind === 'match')];
}
export function onlineEntries(room: RoomSnapshot, packet: OnlineObservation, session: PlayerSession, now = Date.now(), liveHandId?: string): StatisticsEntry[] {
  if (!room.matchId || room.matchId !== packet.game.sessionId || room.roomCode !== packet.roomCode || session.roomCode !== room.roomCode
    || room.stateVersion !== packet.stateVersion || packet.game.player !== session.seat
    || !room.seats.some(seat => seat.seat === session.seat && seat.kind === 'human' && seat.playerId === session.playerId)) return [];
  const common = base('online', room.matchId, session.seat, null, now);
  const entries: StatisticsEntry[] = (packet.completedHands ?? []).map(hand => ({ ...common, kind: 'hand', handId: hand.handId,
    handNumber: hand.handNumber, levelRank: hand.levelRank, result: structuredClone(hand.result),
    completedAt: hand.handId === packet.game.handId && hand.handId === liveHandId && packet.result ? now : null }));
  // Also works with older hosts that do not yet send the public catch-up list.
  if (packet.result && !entries.some(entry => entry.kind === 'hand' && entry.handId === packet.game.handId)) entries.push({ ...common, kind: 'hand',
    handId: packet.game.handId, handNumber: packet.progress.handNumber, levelRank: packet.game.rules.levelRank, result: structuredClone(packet.result), completedAt: packet.game.handId === liveHandId ? now : null });
  if (packet.phase === 'complete' && packet.progress.winner !== null) entries.push({ ...common, kind: 'match', winningTeam: packet.progress.winner,
    handCount: packet.progress.settledHandIds.length, completedAt: packet.game.handId === liveHandId ? now : null });
  return entries;
}
/** Only verified local save slots are migration sources. Imported/viewed replay files aren't. */
export function importAvailableHistory(): string | null {
  const keys = [MATCH_STORAGE.classic, MATCH_STORAGE.legacy, MATCH_STORAGE.practice, MATCH_STORAGE.replay, MATCH_STORAGE.practiceReplay, STORAGE_KEYS.current, STORAGE_KEYS.replay];
  const entries: StatisticsEntry[] = [];
  for (const key of keys) {
    let raw: string | null;
    try { raw = localStorage.getItem(key); } catch { return '暂时无法补录旧战绩：浏览器存储不可用。'; }
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      entries.push(...(parsed && typeof parsed === 'object' && 'kind' in parsed && parsed.kind === 'match'
        ? restoredMatchEntries(decodeMatchSession(raw)) : practiceEntries(decodeSavedGame(raw), null)));
    } catch { /* Corrupt source saves are preserved and reported by their existing loader. */ }
  }
  return saveStatistics(entries);
}
