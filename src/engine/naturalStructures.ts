import type { Card, Suit } from './types';

const suits: readonly Suit[] = ['S', 'H', 'C', 'D'];
const naturalRanks = [14, ...Array.from({ length: 13 }, (_, index) => index + 2)];
const keyOf = (card: Pick<Card, 'suit' | 'rank'>) => `${card.suit}:${card.rank}`;

function naturalWindows(cards: readonly Card[]): { count: number; reserves: Map<string, number> } {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.rank < 2 || card.rank > 14 || card.suit === 'J') continue;
    const key = keyOf(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let count = 0;
  const reserves = new Map<string, number>();
  for (const suit of suits) {
    for (let start = 0; start + 5 <= naturalRanks.length; start++) {
      const keys = naturalRanks.slice(start, start + 5).map((rank) => `${suit}:${rank}`);
      const copies = Math.min(...keys.map((key) => counts.get(key) ?? 0));
      if (!copies) continue;
      count += copies;
      for (const key of keys) reserves.set(key, Math.max(reserves.get(key) ?? 0, copies));
    }
  }
  return { count, reserves };
}

/** Original ranks/suits, including a heart level card acting as itself; no wildcard substitution. */
export function countNaturalStraightFlushes(cards: readonly Card[]): number {
  return naturalWindows(cards).count;
}

/**
 * Identify the physical copies needed to retain existing natural straight flushes.
 * Reserve only the necessary copies of each suit/rank, so a duplicate can still
 * be spent without taking the last card required by a five-rank window.
 */
export function naturalStraightFlushReservedIds(cards: readonly Card[]): ReadonlySet<string> {
  const ordered = [...cards].sort((a, b) => a.id.localeCompare(b.id));
  const { reserves } = naturalWindows(cards);
  const protectedIds = new Set<string>();
  for (let index = ordered.length - 1; index >= 0; index--) {
    const card = ordered[index];
    const key = keyOf(card);
    const remaining = reserves.get(key) ?? 0;
    if (!remaining) continue;
    protectedIds.add(card.id);
    reserves.set(key, remaining - 1);
  }
  return protectedIds;
}

/** One stable order: spend surplus physical copies before reserved copies. */
export function preferNaturalStraightFlushSurplus(cards: readonly Card[], protectedIds = naturalStraightFlushReservedIds(cards)): Card[] {
  return [...cards].sort((a, b) => Number(protectedIds.has(a.id)) - Number(protectedIds.has(b.id)) || a.id.localeCompare(b.id));
}

const disjointWindows = Array.from({ length: naturalRanks.length - 4 }, (_, start) => {
  const shifts = naturalRanks.slice(start, start + 5).map((rank) => (rank - 2) * 2);
  return { shifts, encoded: shifts.reduce((sum, shift) => sum + 2 ** shift, 0) };
});

/**
 * Exact count of simultaneously playable natural straight flushes. A physical
 * card belongs to at most one set, even where windows overlap or share an Ace.
 * The two-deck hand has at most two copies per original suit/rank. The memo is
 * private to this invocation and carries no state between players or decisions.
 */
export function maxDisjointNaturalStraightFlushes(cards: readonly Card[]): number {
  const suitCounts = new Map<Suit, number[]>();
  for (const card of cards) {
    if (card.rank < 2 || card.rank > 14 || card.suit === 'J') continue;
    const counts = suitCounts.get(card.suit) ?? Array<number>(13).fill(0);
    counts[card.rank - 2]++;
    suitCounts.set(card.suit, counts);
  }
  const memo = new Map<number, number>();
  function search(encoded: number, windowIndex: number, remainingCards: number): number {
    if (windowIndex === disjointWindows.length || remainingCards < 5) return 0;
    const key = encoded * 16 + windowIndex;
    const saved = memo.get(key);
    if (saved !== undefined) return saved;
    const window = disjointWindows[windowIndex];
    const copies = Math.min(...window.shifts.map((shift) => (encoded >>> shift) & 3));
    const upperBound = Math.floor(remainingCards / 5);
    let best = 0;
    for (let take = copies; take >= 0; take--) {
      best = Math.max(best, take + search(encoded - window.encoded * take, windowIndex + 1, remainingCards - 5 * take));
      if (best === upperBound) break;
    }
    memo.set(key, best);
    return best;
  }
  let result = 0;
  for (const counts of suitCounts.values()) {
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total < 5) continue;
    const encoded = counts.reduce((sum, count, index) => sum + count * 2 ** (index * 2), 0);
    result += search(encoded, 0, total);
  }
  return result;
}
