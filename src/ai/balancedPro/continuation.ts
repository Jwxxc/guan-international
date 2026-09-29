import { isWild, rankStrength } from '../../engine/cards';
import { bombTier } from '../../engine/compare';
import { getLegalMoves } from '../../engine/legalMoves';
import { maxDisjointNaturalStraightFlushes } from '../../engine/naturalStructures';
import { partnerOf, teamOf } from '../../engine/rules';
import type { Card, GameAction, PlayerObservation, ResolvedPlay, Seat } from '../../engine/types';

export type ProContinuationStyle = 'balanced' | 'pressure';
export const PRO_CONTINUATION_VERSION = 'pro-cheap-public-continuation-v1';
const seats: Seat[] = [0, 1, 2, 3];
const natural = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const sequences = ([['plate', 2, 3], ['pairs', 3, 2], ['straight', 5, 1]] as const).flatMap(([kind, length, copies]) =>
  Array.from({ length: natural.length - length + 1 }, (_, start) => ({ kind, ranks: natural.slice(start, start + length), copies, size: length * copies })));

interface Cover { groups: number; weakSingles: number }
/** Two bounded greedy rank covers, not a minimum-hand or win certificate. Uses
 * actual residual counts, so exchanging equal physical copies cannot invalidate
 * a catalog built for a previous hand. Natural suits are protected separately.
 * There is no tree, opponent hand, persistent memo, or call to any full policy. */
function rankCover(cards: readonly Card[], obs: PlayerObservation): Cover {
  const initial = Array<number>(17).fill(0);
  let initialWilds = 0;
  for (const card of cards) if (isWild(card, obs.rules)) initialWilds++; else initial[card.rank]++;
  const cover = (bombsFirst: boolean): Cover => {
    const counts = [...initial]; let wilds = initialWilds, groups = 0, weakSingles = 0;
    if (counts[15] === 2 && counts[16] === 2) { counts[15] = 0; counts[16] = 0; groups++; }
    const bombs = () => { for (let rank = 2; rank <= 14; rank++) if (counts[rank]! >= 4) { groups++; counts[rank] = 0; } };
    if (bombsFirst) bombs();
    // Each accepted group consumes at least five cards, so at most five rounds
    // fit a standard hand. Prefer natural groups before spending a wildcard.
    for (let round = 0; round < 5; round++) {
      let chosen: typeof sequences[number] | undefined, bestMissing = 3;
      for (const pattern of sequences) {
        let missing = 0;
        for (const rank of pattern.ranks) missing += Math.max(0, pattern.copies - counts[rank]!);
        if (missing > wilds) continue;
        if (missing < bestMissing || missing === bestMissing && pattern.size > (chosen?.size ?? 0)) { chosen = pattern; bestMissing = missing; }
      }
      if (!chosen) break;
      for (const rank of chosen.ranks) counts[rank] = Math.max(0, counts[rank]! - chosen.copies);
      wilds -= bestMissing; groups++;
    }
    bombs();
    for (let main = 2; main <= 14; main++) {
      if (counts[main]! < 2) continue;
      const needed = Math.max(0, 3 - counts[main]!);
      if (needed > wilds) continue;
      // Keep joker pairs as independent control resources in this cheap cover.
      const pair = counts.findIndex((count, rank) => rank >= 2 && rank <= 14 && rank !== main && count >= 2);
      if (pair < 0) continue;
      counts[main] = Math.max(0, counts[main]! - 3); counts[pair] -= 2; wilds -= needed; groups++;
    }
    for (let rank = 2; rank <= 16; rank++) {
      const count = counts[rank]!;
      if (!count) continue;
      // Any residual non-joker rank has at most three cards after bombs().
      groups++;
      if (count === 1 && rank <= 14 && wilds) wilds--;
      else if (count === 1 && rankStrength(rank, obs.rules) <= 10) weakSingles++;
    }
    if (wilds) groups++; // Two remaining heart-level cards form a legal pair.
    return { groups, weakSingles };
  };
  const a = cover(true), b = cover(false);
  return a.groups < b.groups || a.groups === b.groups && a.weakSingles <= b.weakSingles ? a : b;
}

/** Current owner and the current trick's publicly accepted actions determine the
 * responder list. With a missing/truncated play event we decline to infer wind,
 * unless the public live-seat counts already leave only this actor responding. */
function leaderAfterPass(obs: PlayerObservation): Seat | null {
  if (!obs.currentPlay || obs.currentOwner === null) return null;
  const pending = new Set(seats.filter(seat => seat !== obs.currentOwner && obs.remainingCounts[seat]! > 0));
  let found = pending.size === 1 && pending.has(obs.player);
  const passed: Seat[] = [];
  for (let index = obs.history.length - 1; index >= Math.max(0, obs.history.length - 4); index--) {
    const event = obs.history[index]!;
    if (event.index >= obs.stateVersion) continue;
    if (event.type === 'play') {
      if (event.player === obs.currentOwner && event.play?.key === obs.currentPlay.key) {
        found = true; for (const seat of passed) pending.delete(seat);
      }
      break;
    }
    passed.push(event.player);
  }
  if (!found || pending.size !== 1 || !pending.has(obs.player)) return null;
  return obs.remainingCounts[obs.currentOwner]! > 0 ? obs.currentOwner : partnerOf(obs.currentOwner);
}

/** Cheap observation-only continuation for simulations. The style is fixed by
 * the caller across a whole search batch, never selected from a hidden world.
 * Stronger reasoning here is still heuristic; performance/strength require eval.
 */
export function chooseProContinuation(observation: PlayerObservation, style: ProContinuationStyle = 'balanced'): GameAction {
  if (style !== 'balanced' && style !== 'pressure') throw Error('Unknown Pro continuation style');
  // Explicit field reads: no spread/clone of an input carrying extra authority.
  const obs: PlayerObservation = {
    sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion,
    player: observation.player, team: observation.team, hand: observation.hand, rules: observation.rules,
    remainingCounts: observation.remainingCounts, currentPlayer: observation.currentPlayer,
    currentPlay: observation.currentPlay, currentOwner: observation.currentOwner, finished: observation.finished,
    history: observation.history, isOver: observation.isOver,
  };
  if (obs.isOver || obs.currentPlayer !== obs.player || !obs.hand.length || obs.team !== teamOf(obs.player)) throw Error('Pro continuation requires its own active turn');
  const stamp = { sessionId: obs.sessionId, handId: obs.handId, stateVersion: obs.stateVersion, player: obs.player };
  const asAction = (play: ResolvedPlay): GameAction => ({ ...stamp, type: 'play', cardIds: play.cards.map(card => card.id), playKey: play.key });
  const pass: GameAction = { ...stamp, type: 'pass' };
  const legal = getLegalMoves(obs);
  const finish = legal.filter(play => play.size === obs.hand.length).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))[0];
  if (finish) return asAction(finish);
  if (!legal.length) { if (obs.currentPlay) return pass; throw Error('Pro continuation has no legal opening'); }

  const partner = partnerOf(obs.player), partnerLeading = obs.currentOwner === partner;
  const opponents = seats.filter(seat => teamOf(seat) !== obs.team && obs.remainingCounts[seat]! > 0);
  const short = opponents.filter(seat => obs.remainingCounts[seat]! <= 3);
  const opponentSingle = short.some(seat => obs.remainingCounts[seat] === 1);
  const shapeThreat = !!obs.currentPlay && short.some(seat => obs.remainingCounts[seat] === obs.currentPlay!.size)
    && !(obs.currentPlay.value === 17 && (obs.currentPlay.kind === 'single' || obs.currentPlay.kind === 'pair'));
  const urgent = !partnerLeading && shapeThreat;
  const leader = leaderAfterPass(obs), acceptWind = leader === obs.player;
  const denyWind = leader !== null && teamOf(leader) !== obs.team && obs.remainingCounts[leader]! <= 2;
  const before = rankCover(obs.hand, obs), flushes = maxDisjointNaturalStraightFlushes(obs.hand);
  const originalCounts = Array<number>(17).fill(0);
  for (const card of obs.hand) originalCounts[card.rank]++;
  const fourJokers = originalCounts[15] === 2 && originalCounts[16] === 2;
  let bestScore = obs.currentPlay ? (partnerLeading ? 22 : 0) + (acceptWind ? 44 : 0) - (denyWind ? 42 : 0) : -Infinity;
  let best: GameAction = pass, bestKey = '~pass';
  const covers = new Map<string, Cover>();
  for (const play of legal) {
    const used = new Set(play.cards.map(card => card.id)), remaining = obs.hand.filter(card => !used.has(card.id));
    // Scope is one invocation only; no cross-seat or sampled-world cache exists.
    const residualKey = remaining.map(card => card.id).sort().join(',');
    let after = covers.get(residualKey); if (!after) { after = rankCover(remaining, obs); covers.set(residualKey, after); }
    const left = [...originalCounts]; for (const card of play.cards) left[card.rank]--;
    let structure = 0;
    for (let rank = 2; rank <= 16; rank++) if (left[rank]! > 0 && left[rank] !== originalCounts[rank]) {
      structure += originalCounts[rank]! >= 4 ? 30 : originalCounts[rank] === 3 ? 8 : 5;
    }
    const sequence = play.kind === 'straight' || play.kind === 'pairs' || play.kind === 'plate';
    if (sequence) structure *= .45;
    if (fourJokers && play.cards.some(card => card.rank >= 15) && remaining.some(card => card.rank >= 15)) structure += 40;
    if (flushes && play.kind !== 'straightFlush' && maxDisjointNaturalStraightFlushes(remaining) < flushes) structure += 34;
    const bomb = bombTier(play.kind, play.size) > 0;
    const pressureFactor = urgent || denyWind ? style === 'pressure' ? .4 : .6 : 1;
    let spend = bomb ? (32 + 2.5 * play.size) * pressureFactor * (after.groups <= 1 ? .45 : 1) : 0;
    if (play.kind === 'fullHouse' && !fourJokers) {
      const jokerPair = play.cards.filter(card => card.rank >= 15);
      if (jokerPair.length === 2 && jokerPair[0]!.rank === jokerPair[1]!.rank) {
        spend += (jokerPair[0]!.rank === 16 ? 38 : 30) * Math.min(1, remaining.length / 8) * pressureFactor;
      }
    }
    let score = play.size * 8 + (before.groups - after.groups) * 11 + (before.weakSingles - after.weakSingles) * 2.5
      - structure - spend - play.cards.filter(card => isWild(card, obs.rules)).length * 10 - play.value * .28;
    if (obs.currentPlay) score += 9 - play.size * 6 - (partnerLeading ? 24 : 0);
    if (urgent) score += (style === 'pressure' ? 62 : 48) + (play.kind === obs.currentPlay?.kind ? play.value * (style === 'pressure' ? 1.8 : 1.25) : 0);
    if (denyWind) score += 24;
    if (acceptWind) score -= 20;
    if (!obs.currentPlay) {
      if (obs.remainingCounts[partner] === 1 && !opponentSingle && play.kind === 'single' && play.value <= 10) score += 31 - play.value * 1.6;
      if (!bomb && short.some(seat => obs.remainingCounts[seat]! < play.size)) score += 13;
      if (opponentSingle && play.kind === 'single') score += play.value * (style === 'pressure' ? 2.5 : 1.8);
    }
    if (score > bestScore + 1e-9 || Math.abs(score - bestScore) <= 1e-9 && play.key.localeCompare(bestKey) < 0) {
      bestScore = score; bestKey = play.key; best = asAction(play);
    }
  }
  return best;
}
