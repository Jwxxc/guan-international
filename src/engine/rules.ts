import type { Rank, RuleConfig, Seat } from './types';
export const RULES_VERSION = 'guan-practice-v1' as const;
export const RNG_VERSION = 'mulberry32-v1' as const;
export const RANKS = Array.from({ length: 13 }, (_, i) => i + 2);
export const SEATS = [
  { id: 0, name: '你', position: 'bottom', team: 0, role: '真人' },
  { id: 1, name: '南山', position: 'right', team: 1, role: '电脑 · 下家' },
  { id: 2, name: '青禾', position: 'top', team: 0, role: '电脑 · 对家' },
  { id: 3, name: '松风', position: 'left', team: 1, role: '电脑 · 上家' },
] as const;
export const teamOf = (seat: Seat): 0 | 1 => (seat % 2) as 0 | 1;
export const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;
/** Shared with table positions: 0 bottom → 1 right → 2 top → 3 left. */
export const nextSeatOf = (seat: Seat): Seat => SEATS[(seat + 1) % SEATS.length].id;
export const previousSeatOf = (seat: Seat): Seat => SEATS[(seat + SEATS.length - 1) % SEATS.length].id;
export const rankName = (rank: Rank): string => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '小王', 16: '大王' }[rank] ?? String(rank));
export function makeRules(levelRank = 2): RuleConfig {
  if (!RANKS.includes(levelRank)) throw new Error('级牌必须为 2 到 A');
  return { version: RULES_VERSION, levelRank };
}
