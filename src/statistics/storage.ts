import type { GameResult } from '../engine/types';
import { entryId, MODE_LABELS, type StatisticsEntry } from './model';

// One outcome per key; verified migration may only fill its missing difficulty.
export const STATISTICS_PREFIX = 'guan.statistics.v1.';
export const STATISTICS_CHANGED = 'guan:statistics-changed';
const unavailable = '战绩暂时无法保存：浏览器存储不可用或空间不足。对局仍可继续，请稍后重试保存。';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const seat = (value: unknown): boolean => integer(value, 0, 3);
const id = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length < 200;
function validResult(value: unknown): value is GameResult {
  if (!object(value) || !integer(value.winningTeam, 0, 1) || typeof value.doubleUp !== 'boolean' || !Array.isArray(value.order)
    || !Array.isArray(value.doubleDown) || !value.order.every(seat) || !value.doubleDown.every(seat) || !(value.last === null || seat(value.last))) return false;
  const order = value.order as number[], down = value.doubleDown as number[];
  if (new Set([...order, ...down]).size !== order.length + down.length || order[0] % 2 !== value.winningTeam) return false;
  if (value.doubleUp) return order.length === 2 && down.length === 2 && value.last === null && order.every(player => player % 2 === value.winningTeam) && down.every(player => player % 2 !== value.winningTeam);
  return order.length === 4 && down.length === 0 && value.last === order[3] && order[0] % 2 !== order[1] % 2;
}
export function validEntry(value: unknown): value is StatisticsEntry {
  if (!object(value) || value.schemaVersion !== 1 || typeof value.mode !== 'string' || !Object.hasOwn(MODE_LABELS, value.mode) || !id(value.sessionId)
    || !seat(value.viewerSeat) || !(value.completedAt === null || integer(value.completedAt, 0, 8_640_000_000_000_000)) || !integer(value.recordedAt, 0, 8_640_000_000_000_000)
    || value.aiDifficulty !== undefined && (value.mode === 'online' || typeof value.aiDifficulty !== 'string' || !['casual', 'balanced', 'balanced-plus', 'balanced-pro', 'jwxxc', 'danlm', 'pro', 'legacy', 'mixed'].includes(value.aiDifficulty))) return false;
  return value.kind === 'hand' ? id(value.handId) && integer(value.handNumber, 1, 512) && integer(value.levelRank, 2, 14) && validResult(value.result)
    : value.kind === 'match' && value.mode !== 'practice' && integer(value.winningTeam, 0, 1) && integer(value.handCount, 1, 512);
}
export function loadStatistics(): { entries: StatisticsEntry[]; error?: string } {
  const entries: StatisticsEntry[] = []; let damaged = 0;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index); if (!key?.startsWith(STATISTICS_PREFIX)) continue;
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key)!);
        if (!validEntry(value) || key !== STATISTICS_PREFIX + entryId(value)) throw Error('invalid');
        entries.push(value);
      } catch { damaged++; }
    }
    return { entries, ...(damaged ? { error: `${damaged} 条战绩暂时无法读取，原始记录已保留；下方仅统计有效记录。` } : {}) };
  } catch { return { entries, error: '暂时无法读取战绩：浏览器存储不可用。' }; }
}
export function saveStatistics(entries: StatisticsEntry[]): string | null {
  let changed = false;
  try {
    for (const entry of entries) {
      if (!validEntry(entry)) return '这条结算记录无法验证，未计入战绩。';
      const key = STATISTICS_PREFIX + entryId(entry), existing = localStorage.getItem(key);
      if (existing !== null) {
        // Enrich only missing metadata after exact result matching; dates and outcomes stay intact.
        let previous: unknown;
        try { previous = JSON.parse(existing); }
        catch { return '已有战绩记录损坏，原始数据已保留。'; }
        if (!validEntry(previous) || entryId(previous) !== entryId(entry)) return '已有战绩记录损坏，原始数据已保留。';
        if (previous.aiDifficulty === undefined && entry.aiDifficulty !== undefined) {
          if (!sameOutcome(previous, entry)) return '已有战绩与补录结果不一致，原始记录已保留。';
          localStorage.setItem(key, JSON.stringify({ ...previous, aiDifficulty: entry.aiDifficulty })); changed = true;
        }
        continue;
      }
      localStorage.setItem(key, JSON.stringify(entry)); changed = true;
    }
    return null;
  } catch { return unavailable; }
  finally { if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(STATISTICS_CHANGED)); }
}

function sameOutcome(a: StatisticsEntry, b: StatisticsEntry): boolean {
  if (a.kind === 'match' && b.kind === 'match') return a.winningTeam === b.winningTeam && a.handCount === b.handCount;
  if (a.kind !== 'hand' || b.kind !== 'hand') return false;
  return a.handNumber === b.handNumber && a.levelRank === b.levelRank && a.result.winningTeam === b.result.winningTeam
    && a.result.doubleUp === b.result.doubleUp && a.result.last === b.result.last
    && JSON.stringify(a.result.order) === JSON.stringify(b.result.order) && JSON.stringify(a.result.doubleDown) === JSON.stringify(b.result.doubleDown);
}
