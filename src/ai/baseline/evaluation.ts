import { isWild } from '../../engine/cards';
import { maxDisjointNaturalStraightFlushes } from '../../engine/naturalStructures';
import { teamOf } from '../../engine/rules';
import type { Card, PlayerObservation, ResolvedPlay } from '../../engine/types';

/** All scores are gains/costs relative to keeping the current hand (pass = 0). */
export const AI_WEIGHTS = Object.freeze({
  finish: 10000, cardShed: 8, remainingGroups: 3, wildUse: 11,
  splitPair: 5, splitTriple: 8, splitBomb: 29, splitStraightFlush: 29,
  spendBomb: 35, bombCardCost: 3, rankCost: .25,
  followingCardCost: 6, followControl: 9, sequenceRestructure: .25,
  opponentClose: 45, urgentRank: 1.5, partnerTakeover: 12,
  partnerPass: 18, normalPass: 0,
});
export interface ScoreBreakdown {
  shed: number; groupGain: number; structureCost: number; wildcardCost: number;
  rankCost: number; bombCost: number; follow: number; pressure: number; partnerCost: number;
}
export interface ScoredMove { play: ResolvedPlay; score: number; reason: string; breakdown?: ScoreBreakdown }
const bombKinds = new Set(['bomb', 'straightFlush', 'jokerBomb']);
const sequenceKinds = new Set(['straight', 'pairs', 'plate']);
const counts = (cards: readonly Card[]): Map<number, number> => {
  const result = new Map<number, number>();
  for (const card of cards) result.set(card.rank, (result.get(card.rank) ?? 0) + 1);
  return result;
};
interface HandContext { counts: Map<number, number>; distinct: number; flushes: number; fourJokers: boolean }
function handContext(observation: PlayerObservation): HandContext {
  return {
    counts: counts(observation.hand),
    distinct: counts(observation.hand.filter(card => !isWild(card, observation.rules))).size,
    flushes: maxDisjointNaturalStraightFlushes(observation.hand),
    fourJokers: observation.hand.filter(card => card.rank >= 15).length === 4,
  };
}

export function scoreAiMove(observation: PlayerObservation, play: ResolvedPlay, context = handContext(observation)): ScoredMove {
  if (play.cards.length === observation.hand.length) return { play, score: AI_WEIGHTS.finish, reason: '这手牌可以直接出完' };
  const ids = new Set(play.cards.map(card => card.id));
  const remaining = observation.hand.filter(card => !ids.has(card.id));
  const after = counts(remaining);
  let smallStructureCost = 0, bombStructureCost = 0;
  for (const [rank, count] of context.counts) {
    const left = after.get(rank) ?? 0;
    if (left === 0 || left === count) continue;
    if (count >= 4) bombStructureCost += AI_WEIGHTS.splitBomb;
    else if (count === 3) smallStructureCost += AI_WEIGHTS.splitTriple;
    else if (count === 2) smallStructureCost += AI_WEIGHTS.splitPair;
  }
  if (context.fourJokers && remaining.some(card => card.rank >= 15) && play.cards.some(card => card.rank >= 15)) bombStructureCost += AI_WEIGHTS.splitBomb;
  // A legal run itself forms a useful group; don't count every consumed pair as
  // a full loss when those cards are reorganized into a five/six-card sequence.
  if (sequenceKinds.has(play.kind)) smallStructureCost *= AI_WEIGHTS.sequenceRestructure;
  const losesFlush = play.kind !== 'straightFlush' && context.flushes > 0 && maxDisjointNaturalStraightFlushes(remaining) < context.flushes;
  const wildUse = play.cards.filter(card => isWild(card, observation.rules)).length;
  const bomb = bombKinds.has(play.kind);
  const owner = observation.currentOwner;
  const partnerLeading = owner !== null && teamOf(owner) === observation.team;
  // Either opponent can finish on the next response, even if the other one
  // owns the current trick. Zero means finished, not an imminent responder.
  const shortOpponents = observation.remainingCounts.filter((count, seat) => seat % 2 !== observation.team && count > 0 && count <= 2);
  const opponentClose = !partnerLeading && shortOpponents.length > 0;
  const canFinishSameType = play.kind === 'single' ? shortOpponents.includes(1) : play.kind === 'pair' && shortOpponents.includes(2);
  const rankPressure = opponentClose && canFinishSameType && play.kind === observation.currentPlay?.kind ? play.value * AI_WEIGHTS.urgentRank : 0;
  const remainingDistinct = counts(remaining.filter(card => !isWild(card, observation.rules))).size;
  const breakdown: ScoreBreakdown = {
    shed: play.size * AI_WEIGHTS.cardShed,
    // Marginal change: unrelated ranks cancel out against the unchanged hand.
    groupGain: (context.distinct - remainingDistinct) * AI_WEIGHTS.remainingGroups,
    structureCost: smallStructureCost + bombStructureCost + (losesFlush ? AI_WEIGHTS.splitStraightFlush : 0),
    wildcardCost: wildUse * AI_WEIGHTS.wildUse,
    rankCost: play.value * AI_WEIGHTS.rankCost,
    bombCost: bomb ? AI_WEIGHTS.spendBomb + play.size * AI_WEIGHTS.bombCardCost : 0,
    follow: observation.currentPlay ? AI_WEIGHTS.followControl - play.size * AI_WEIGHTS.followingCardCost : 0,
    pressure: observation.currentPlay && opponentClose ? AI_WEIGHTS.opponentClose + rankPressure : 0,
    partnerCost: observation.currentPlay && partnerLeading ? AI_WEIGHTS.partnerTakeover : 0,
  };
  const score = breakdown.shed + breakdown.groupGain + breakdown.follow + breakdown.pressure
    - breakdown.structureCost - breakdown.wildcardCost - breakdown.rankCost - breakdown.bombCost - breakdown.partnerCost;
  const reason = partnerLeading ? '对家当前领先，这手牌作为接手备选'
    : opponentClose ? '对手余牌较少，优先争取控制权'
      : observation.currentPlay && !breakdown.structureCost && !wildUse ? '优先用不拆组合、不用逢人配的牌跟进'
        : observation.currentPlay ? '权衡本次跟牌与保留组合的代价'
          : !breakdown.structureCost && !wildUse ? '优先成组出牌，并保留其他组合'
            : '比较出牌后手牌的简化程度与组合代价';
  return { play, score, reason, breakdown };
}

export function rankAiMoves(observation: PlayerObservation, legalMoves: ResolvedPlay[]): ScoredMove[] {
  const context = handContext(observation);
  return legalMoves.map(play => scoreAiMove(observation, play, context)).sort((a, b) => b.score - a.score || a.play.key.localeCompare(b.play.key));
}
