import { partnerOf, teamOf } from '../engine/rules';
import type { GameResult, GameState, Seat } from '../engine/types';
import type { MatchProgress, MatchRulesVersion, ProgressResult } from './types';

const seats: Seat[] = [0, 1, 2, 3];

/** Result shape is checked before it can affect either score or the next deal. */
export function isValidMatchResult(result: GameResult | null): result is GameResult {
  if (!result || ![0, 1].includes(result.winningTeam) || !Array.isArray(result.order)
    || !Array.isArray(result.doubleDown) || new Set(result.order).size !== result.order.length
    || result.order.some(seat => !seats.includes(seat))
    || teamOf(result.order[0]) !== result.winningTeam) return false;
  if (result.doubleUp === true) {
    return result.order.length === 2 && partnerOf(result.order[0]) === result.order[1]
      && result.last === null && result.doubleDown.length === 2
      && new Set(result.doubleDown).size === 2
      && result.doubleDown.every(seat => seats.includes(seat) && !result.order.includes(seat));
  }
  return result.doubleUp === false && result.order.length === 4
    && teamOf(result.order[1]) !== result.winningTeam
    && result.last === result.order[3] && result.doubleDown.length === 0;
}

export function createMatchProgress(version: MatchRulesVersion = 'guan-match-v1'): MatchProgress {
  if (version !== 'guan-match-v1' && version !== 'guan-classic-house-v1') throw new Error('升级规则版本无效');
  return { version, teamLevels: [2, 2], activeTeam: null, handNumber: 1,
    winner: null, settledHandIds: [], lastResult: null, lastAdvance: null };
}

export function getMatchLevel(progress: MatchProgress): number {
  return progress.activeTeam === null ? 2 : progress.teamLevels[progress.activeTeam];
}

/** Settling never starts another hand; the caller advances handNumber on dealing. */
export function settleMatchProgress(progress: MatchProgress, game: GameState): ProgressResult {
  if (!['guan-match-v1', 'guan-classic-house-v1'].includes(progress.version) || progress.teamLevels.length !== 2
    || progress.teamLevels.some(level => !Number.isInteger(level) || level < 2 || level > 14)
    || (progress.activeTeam !== null && ![0, 1].includes(progress.activeTeam))
    || !Number.isInteger(progress.handNumber) || progress.handNumber < 1) {
    return { ok: false, error: '升级进度无效' };
  }
  if (progress.winner !== null) return { ok: false, error: '本场已经通关，请开始新一场' };
  if (progress.settledHandIds.includes(game.handId)) return { ok: false, error: '本副已经结算，不能重复升级' };
  if (game.rules.levelRank !== getMatchLevel(progress)) return { ok: false, error: '本副级牌与升级进度不一致' };
  if (!isValidMatchResult(game.result)) return { ok: false, error: '本副尚未结束或名次无效' };
  const result = game.result;
  const team = result.winningTeam;
  const partnerPlace = result.order.indexOf(partnerOf(result.order[0]));
  const steps = 4 - partnerPlace;
  const from = progress.teamLevels[team];
  const passedAce = from === 14 && game.rules.levelRank === 14 && partnerPlace < 3;
  const to = Math.min(14, from + steps);
  const next = structuredClone(progress);
  next.teamLevels[team] = to;
  next.activeTeam = team;
  next.winner = passedAce ? team : null;
  next.settledHandIds.push(game.handId);
  next.lastResult = structuredClone(result);
  next.lastAdvance = { handId: game.handId, team, steps, from, to, passedAce };
  return { ok: true, progress: next };
}
