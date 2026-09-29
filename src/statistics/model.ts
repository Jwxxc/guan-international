import type { GameResult, Seat } from '../engine/types';
import { teamOf } from '../engine/rules';

export const MODE_LABELS = { classic: '经典升级', practice: '单副练习', online: '私人联机', legacy: '旧版升级' } as const;
export type StatisticsMode = keyof typeof MODE_LABELS;
export const DIFFICULTY_LABELS = { casual: '休闲', balanced: '均衡', 'balanced-plus': '均衡 Plus', 'balanced-pro': '均衡 Pro', jwxxc: 'Jwxxc Beta', danlm: 'DanLM', pro: '旧试验记录', legacy: '旧版配置', mixed: '难度混用', unknown: '未记录难度', online: '联机对局' } as const;
export type LocalDifficulty = 'casual' | 'balanced' | 'balanced-plus' | 'balanced-pro' | 'jwxxc' | 'danlm' | 'pro' | 'legacy' | 'mixed';
interface EntryBase {
  schemaVersion: 1; mode: StatisticsMode; sessionId: string; viewerSeat: Seat;
  /** Older journals have no clock. Never invent a completion date for them. */
  completedAt: number | null; recordedAt: number;
  /** Omitted in older ledger entries; never infer from today's settings. */
  aiDifficulty?: LocalDifficulty;
}
export interface HandEntry extends EntryBase {
  kind: 'hand'; handId: string; handNumber: number; levelRank: number; result: GameResult;
}
export interface MatchEntry extends EntryBase {
  kind: 'match'; winningTeam: 0 | 1; handCount: number;
}
export type StatisticsEntry = HandEntry | MatchEntry;
export type StatisticsFilter = { mode: StatisticsMode | 'all'; days: 0 | 7 | 30; kind: 'hand' | 'match'; difficulty?: 'all' | 'casual' | 'balanced' | 'balanced-plus' | 'balanced-pro' | 'jwxxc' | 'danlm' | 'pro' };
export const entryDifficulty = (entry: StatisticsEntry): keyof typeof DIFFICULTY_LABELS => entry.mode === 'online' ? 'online' : entry.aiDifficulty ?? 'unknown';
export function entryId(entry: StatisticsEntry): string {
  return JSON.stringify([entry.mode, entry.sessionId, entry.viewerSeat, entry.kind, entry.kind === 'hand' ? entry.handId : '']);
}
export const isWin = (entry: StatisticsEntry): boolean => (entry.kind === 'hand' ? entry.result.winningTeam : entry.winningTeam) === teamOf(entry.viewerSeat);
export function placeLabel(entry: HandEntry): string {
  if (entry.result.doubleDown.includes(entry.viewerSeat)) return '双下';
  if (entry.result.last === entry.viewerSeat) return '末游';
  return ['头游', '二游', '三游', '末游'][entry.result.order.indexOf(entry.viewerSeat)] ?? '—';
}
export function filterEntries(entries: StatisticsEntry[], filter: StatisticsFilter, now = Date.now()): StatisticsEntry[] {
  const since = now - filter.days * 86_400_000;
  return entries.filter(entry => entry.kind === filter.kind && (filter.mode === 'all' || entry.mode === filter.mode)
    && (!filter.difficulty || filter.difficulty === 'all' || entryDifficulty(entry) === filter.difficulty)
    && (!filter.days || entry.completedAt !== null && entry.completedAt >= since && entry.completedAt <= now))
    .sort((a, b) => (b.completedAt ?? -1) - (a.completedAt ?? -1) || b.recordedAt - a.recordedAt
      || (a.kind === 'hand' && b.kind === 'hand' && a.sessionId === b.sessionId ? b.handNumber - a.handNumber : entryId(a).localeCompare(entryId(b))));
}
export function summarize(entries: StatisticsEntry[]) {
  const total = entries.length, wins = entries.filter(isWin).length;
  const hands = entries.filter((entry): entry is HandEntry => entry.kind === 'hand');
  const firsts = hands.filter(entry => entry.result.order[0] === entry.viewerSeat).length;
  const doubleUps = hands.filter(entry => isWin(entry) && entry.result.doubleUp).length;
  // Unknown historical dates cannot establish the ordering of a streak.
  const dated = entries.filter(entry => entry.completedAt !== null).sort((a, b) => a.completedAt! - b.completedAt! || a.recordedAt - b.recordedAt
    || (a.kind === 'hand' && b.kind === 'hand' && a.sessionId === b.sessionId ? a.handNumber - b.handNumber : 0));
  let streak = 0, bestStreak = 0;
  for (const entry of dated) { streak = isWin(entry) ? streak + 1 : 0; bestStreak = Math.max(bestStreak, streak); }
  return { total, wins, losses: total - wins, winRate: total ? wins / total : null, firsts, firstRate: hands.length ? firsts / hands.length : null,
    doubleUps, streak, bestStreak, dated: dated.length };
}
export const formatRate = (value: number | null): string => value === null ? '—' : `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
