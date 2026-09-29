import type { Card, ResolvedPlay, RuleConfig } from '../engine/types';
import { rankStrength } from '../engine/cards';

/** Only arrange the visual pile: the canonical submitted play is left intact. */
export function displayPlayCards(play: ResolvedPlay, rules: RuleConfig): Card[] {
  const ranks = new Map(play.wildcards.map(mapping => [mapping.cardId, mapping.rank]));
  const rankOf = (card: Card) => ranks.get(card.id) ?? card.rank;
  const counts = new Map<number, number>();
  for (const card of play.cards) counts.set(rankOf(card), (counts.get(rankOf(card)) ?? 0) + 1);
  const continuous = ['straight', 'straightFlush', 'pairs', 'plate'].includes(play.kind);
  const score = (card: Card) => {
    const rank = rankOf(card);
    if (continuous) return rank === 14 && play.value < 14 ? 1 : rank;
    if (play.kind === 'fullHouse') return counts.get(rank) === 3 ? 0 : 1;
    return -rankStrength(rank, rules);
  };
  return [...play.cards].sort((a,b) => score(a)-score(b) || a.id.localeCompare(b.id));
}
