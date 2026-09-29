import { decodeSavedGame, STORAGE_KEYS, type SavedGame } from '../game/persistence';
import { MATCH_STORAGE } from '../match/storage';
import { advanceMatchExchange, advanceMatchPlay, beginMatchHand, createMatchSession, decodeMatchSession, nextMatchHand } from '../match/session';
import type { MatchSession, MatchSessionResult } from '../match/sessionTypes';
import { archiveCheckpoint } from './storage';

const unwrap = (result: MatchSessionResult) => { if (!result.ok) throw Error(result.error); return result.match; };
/** One forward replay. Never run today's AI to invent historical diagnostics. */
export function archiveRecoveredSession(saved: SavedGame, match?: MatchSession | null) {
  if (!match) { archiveCheckpoint(saved, null, 'recovered'); return; }
  let session: MatchSession | undefined;
  for (const record of match.journal.records) {
    session = session ? unwrap(nextMatchHand(session, record.seed, record.config.handId!, record.policy, record.seatPolicies))
      : createMatchSession(match.journal.matchId, record.config.handId!, record.seed, match.journal.tributeEnabled, match.journal.rulesVersion, record.policy, record.seatPolicies);
    for (const action of record.exchangeActions) session = unwrap(advanceMatchExchange(session, action));
    if (record.started && session.phase === 'ready') session = unwrap(beginMatchHand(session));
    for (const action of record.actions) session = unwrap(advanceMatchPlay(session, action));
    archiveCheckpoint(session.saved, session, 'recovered', false, record === match.journal.records.at(-1));
  }
}
export function importAnalysisHistory(): string | null {
  const keys = [MATCH_STORAGE.classic, MATCH_STORAGE.legacy, MATCH_STORAGE.practice, MATCH_STORAGE.replay, MATCH_STORAGE.practiceReplay, STORAGE_KEYS.current, STORAGE_KEYS.replay];
  let damaged = 0;
  for (const key of keys) {
    let raw: string | null;
    try { raw = localStorage.getItem(key); } catch { return '分析档案无法补录：浏览器旧存档暂时不可读取。'; }
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      if (data?.kind === 'match') { const match = decodeMatchSession(raw); archiveRecoveredSession(match.saved, match); }
      else archiveRecoveredSession(decodeSavedGame(raw));
    } catch { damaged++; }
  }
  return damaged ? `${damaged} 份旧存档无法验证，未补录分析档案；原始数据已保留。` : null;
}
