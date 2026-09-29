import type { Seat } from '../engine/types';
import type { SeatNames } from '../game/tableView';
import type { ReplaySeatKinds } from '../game/replayView';
import type { MatchJournal } from '../match/sessionTypes';
import type { ReplaySource } from '../match/replay';
import { restoreMatchJournal } from '../match/session';

export const ONLINE_REPLAY_FORMAT = 'guan-online-replay-v1' as const;
export const MAX_ONLINE_REPLAY_BYTES = 8_000_000;
export interface OnlineReplayImport {
  source: Extract<ReplaySource, { kind: 'match' }>;
  seatNames: Record<Seat, string>;
  viewerSeat: Seat;
  seatKinds?: Record<Seat, 'human' | 'ai'>;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const seats = [0, 1, 2, 3] as const;
function viewer(value: unknown): Seat { if (!Number.isInteger(value) || !seats.includes(value as Seat)) throw Error('回放中的本人座位无效。'); return value as Seat; }
function names(value: unknown): Record<Seat, string> {
  if (!object(value) || Object.keys(value).length !== 4 || Object.keys(value).some(key => !['0','1','2','3'].includes(key))) throw Error('回放必须包含四个有效座位昵称。');
  const result = {} as Record<Seat, string>;
  for (const seat of seats) {
    const name = value[seat];
    if (typeof name !== 'string' || !name.trim() || name.trim() !== name || [...name].length > 16 || /[\p{Cc}\p{Cf}]/u.test(name)) throw Error('回放中的昵称无效。');
    result[seat] = name.normalize('NFC');
  }
  return result;
}
function kinds(value: unknown): Record<Seat, 'human' | 'ai'> | undefined {
  if (value === undefined) return;
  if (!object(value) || Object.keys(value).length !== 4 || Object.keys(value).some(key => !['0','1','2','3'].includes(key))) throw Error('回放中的座位类型无效。');
  const result = {} as Record<Seat, 'human' | 'ai'>;
  for (const seat of seats) { if (value[seat] !== 'human' && value[seat] !== 'ai') throw Error('回放中的座位类型无效。'); result[seat] = value[seat]; }
  return result;
}
function complete(journal: unknown) {
  const match = restoreMatchJournal(journal);
  if (match.phase !== 'complete' || match.progress.winner === null) throw Error('只可导入或导出已经整场结束的回放。');
  return match;
}
function checkSize(raw: string): void {
  if (raw.length > MAX_ONLINE_REPLAY_BYTES || new TextEncoder().encode(raw).byteLength > MAX_ONLINE_REPLAY_BYTES) throw Error('回放文件超过 8 MB 限制。');
}
/** Produces a detached public replay file; never writes any current/replay storage key. */
export function encodeOnlineReplay(journal: MatchJournal, seatNames: SeatNames, viewerSeat: Seat, seatKinds?: ReplaySeatKinds): string {
  const metadata = { seatNames: names(seatNames), viewerSeat: viewer(viewerSeat), ...(seatKinds ? { seatKinds: kinds(seatKinds) } : {}) };
  checkSize(JSON.stringify(journal));
  const match = complete(journal);
  const raw = JSON.stringify({ format: ONLINE_REPLAY_FORMAT, ...metadata, journal: match.journal });
  checkSize(raw); return raw;
}
/** The decoder reconstructs all outcomes, preserving the journal's own rules version. */
export function decodeOnlineReplay(raw: string): OnlineReplayImport {
  if (typeof raw !== 'string') throw Error('回放文件格式无效。'); checkSize(raw);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw Error('回放文件不是有效 JSON。'); }
  if (!object(data) || data.format !== ONLINE_REPLAY_FORMAT || Object.keys(data).some(key => !['format','seatNames','viewerSeat','seatKinds','journal'].includes(key))) throw Error('回放文件格式或版本无效。');
  const seatNames = names(data.seatNames), viewerSeat = viewer(data.viewerSeat), seatKinds = kinds(data.seatKinds);
  return { source: { kind: 'match', match: complete(data.journal) }, seatNames, viewerSeat, ...(seatKinds ? { seatKinds } : {}) };
}
