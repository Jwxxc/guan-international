import { rankStrength } from '../../engine/cards';
import { getLegalMoves } from '../../engine/legalMoves';
import { resolvePlays } from '../../engine/patterns';
import type { Card, PlayerObservation, ResolvedPlay } from '../../engine/types';
import type { AiBudget } from '../types';
import type { CoopConfig } from './config';

export interface OwnHandPlan {
  groups: ResolvedPlay[]; groupCount: number; weakSingles: number;
  exact: boolean; approximate: boolean;
}
export interface PlanningStats { nodes: number; subsetChecks: number; exhausted: boolean }
const countBits = (mask: number): number => { let count = 0; for (; mask; mask &= mask - 1) count++; return count; };

/** A per-decision planner. Every mask indexes ONLY this player's physical cards.
 * Exact means minimum legal groups for this hand, never minimum future turns or a game solution.
 */
export function createOwnHandPlanner(observation: PlayerObservation, config: CoopConfig, budget: AiBudget) {
  const cards = observation.hand.map(card => ({ ...card })).sort((a, b) => a.id.localeCompare(b.id));
  if (cards.length > 27 || new Set(cards.map(card => card.id)).size !== cards.length) throw Error('自己的手牌实体无效');
  const fullMask = (1 << cards.length) - 1;
  const bits = new Map(cards.map((card, index) => [card.id, 1 << index]));
  const groups = new Map<number, ResolvedPlay>();
  const memo = new Map<number, OwnHandPlan>();
  const checked = new Set<number>(), exhaustive = new Set<number>();
  const stats: PlanningStats = { nodes: 0, subsetChecks: 0, exhausted: false };
  const maskFor = (subset: readonly Card[]) => subset.reduce((mask, card) => {
    const bit = bits.get(card.id); if (bit === undefined) throw Error('规划不能访问自身之外的牌'); return mask | bit;
  }, 0);
  const cardsFor = (mask: number) => cards.filter((_, index) => mask & (1 << index));
  const register = (play: ResolvedPlay) => {
    const mask = maskFor(play.cards);
    const old = groups.get(mask);
    if (!old || play.key < old.key) groups.set(mask, play);
  };
  // Template candidates give an inexpensive feasible cover at any budget, including zero.
  // Their physical representative compression means this catalog alone is NOT exhaustive.
  for (const play of getLegalMoves({ ...observation, hand: cards, currentPlay: null, currentOwner: null, isOver: false })) register(play);
  for (const card of cards) register(resolvePlays([card], observation.rules)[0]);
  const ordered = (mask: number) => [...groups.entries()].filter(([group]) => (group & mask) === group)
    .sort((a, b) => countBits(b[0]) - countBits(a[0]) || a[1].wildcards.length - b[1].wildcards.length || a[1].key.localeCompare(b[1].key));
  const summarize = (partition: ResolvedPlay[], exact = false): OwnHandPlan => ({ groups: partition, groupCount: partition.length,
    weakSingles: partition.filter(play => play.kind === 'single' && rankStrength(play.cards[0].rank, observation.rules) <= 10).length,
    exact, approximate: !exact });
  function quick(mask: number): OwnHandPlan {
    const partition: ResolvedPlay[] = [];
    while (mask) {
      const next = ordered(mask)[0];
      if (!next) throw Error('自身分组缺少合法单牌兜底');
      partition.push(next[1]); mask ^= next[0];
    }
    return summarize(partition);
  }
  function enumerateSmall(mask: number): boolean {
    if (exhaustive.has(mask)) return true;
    // The threshold is capped regardless of caller config: never enumerate a 27-card powerset.
    if (countBits(mask) > Math.min(10, config.exactHandLimit)) return false;
    for (let subset = mask; subset; subset = (subset - 1) & mask) {
      if (checked.has(subset)) continue;
      if (stats.subsetChecks >= budget.maxSubsetChecks) { stats.exhausted = true; return false; }
      stats.subsetChecks++; checked.add(subset);
      const plays = resolvePlays(cardsFor(subset), observation.rules);
      if (plays.length) register(plays[0]);
    }
    exhaustive.add(mask); return true;
  }
  function analyze(mask: number, callStart: number, localLimit: number): OwnHandPlan {
    if (!mask) return summarize([], true);
    const cached = memo.get(mask); if (cached?.exact) return cached;
    const completeCatalog = enumerateSmall(mask);
    let best = cached ?? quick(mask);
    if (best.groupCount === 1) { const solved = { ...best, exact: true, approximate: false }; memo.set(mask, solved); return solved; }
    if (stats.nodes >= budget.maxNodes || stats.nodes - callStart >= localLimit) { stats.exhausted = true; return best; }
    stats.nodes++;
    const first = mask & -mask;
    const all = ordered(mask).filter(([group]) => (group & first) !== 0);
    const branches = completeCatalog ? all : all.slice(0, config.branchesPerNode);
    let exact = completeCatalog && branches.length === all.length;
    const maximum = Math.max(...ordered(mask).map(([group]) => countBits(group)), 1);
    const lowerBound = Math.ceil(countBits(mask) / maximum);
    for (const [group, play] of branches) {
      if (stats.nodes >= budget.maxNodes || stats.nodes - callStart >= localLimit) { stats.exhausted = true; exact = false; break; }
      const rest = analyze(mask ^ group, callStart, localLimit);
      if (!rest.exact) exact = false;
      const next = summarize([play, ...rest.groups]);
      if (next.groupCount < best.groupCount || (next.groupCount === best.groupCount && next.weakSingles < best.weakSingles)) best = next;
      if (completeCatalog && best.groupCount === lowerBound) { exact = true; break; }
    }
    const result = { ...best, exact, approximate: !exact }; memo.set(mask, result); return result;
  }
  return {
    cards, fullMask, maskFor, remainingMask: (play: ResolvedPlay) => fullMask ^ maskFor(play.cards), stats,
    quick: (mask: number) => quick(mask),
    analyze: (mask = fullMask) => analyze(mask, stats.nodes, cards.length <= config.exactHandLimit ? budget.maxNodes : config.nodesPerLargePlan),
  };
}
