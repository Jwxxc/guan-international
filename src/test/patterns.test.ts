import { describe, expect, it } from 'vitest';
import { createDeck, createRng, isWild, rankStrength, shuffleDeck } from '../engine/cards';
import { canBeat } from '../engine/compare';
import { getLegalMoves } from '../engine/legalMoves';
import { resolvePlays } from '../engine/patterns';
import { makeRules } from '../engine/rules';
import type { Card, PlayKind, PlayerObservation, ResolvedPlay, RuleConfig, Suit } from '../engine/types';

const rules = makeRules(2);
const card = (rank: number, suit: Suit = rank >= 15 ? 'J' : 'S', deck = 0): Card => ({ id: `${deck}-${suit}-${rank}`, rank, suit, deck });
const wild = (deck = 0) => card(2, 'H', deck);
const copies = (rank: number, count: number): Card[] => createDeck().filter((c) => c.rank === rank).slice(0, count);
const sequence = (ranks: number[], count = 1): Card[] => ranks.flatMap((rank, index) => {
  const suits: Suit[] = ['S', 'C', 'D'];
  return Array.from({ length: count }, (_, i) => card(rank, suits[(index + i) % suits.length]!));
});
function play(cards: Card[], kind?: PlayKind, ruleConfig = rules): ResolvedPlay {
  const result = resolvePlays(cards, ruleConfig).find((candidate) => !kind || candidate.kind === kind);
  expect(result, `${cards.map((c) => c.id)} should have ${kind}`).toBeDefined();
  return result!;
}
function observation(hand: Card[], currentPlay: ResolvedPlay | null = null, ruleConfig = rules): PlayerObservation {
  return {
    sessionId: 'test', handId: 'test-1', stateVersion: 0, player: 0, team: 0, hand, rules: ruleConfig,
    remainingCounts: [hand.length, 10, 10, 10], currentPlayer: 0, currentPlay, currentOwner: currentPlay ? 1 : null,
    finished: [], history: [], isOver: false,
  };
}

describe('physical deck and randomness', () => {
  it('has exactly two 54-card decks and 108 distinct physical IDs', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    for (let index = 0; index < 2; index += 1) {
      expect(deck.filter((c) => c.deck === index)).toHaveLength(54);
      for (const suit of ['S', 'H', 'C', 'D']) expect(deck.filter((c) => c.deck === index && c.suit === suit)).toHaveLength(13);
      expect(deck.filter((c) => c.deck === index && c.suit === 'J').map((c) => c.rank)).toEqual([15, 16]);
    }
  });
  it('uses a reproducible Fisher-Yates permutation without modifying its input', () => {
    const original = createDeck();
    const before = original.map((c) => c.id);
    const shuffled = shuffleDeck(original, createRng(42));
    expect(shuffled).toEqual(shuffleDeck(original, createRng(42)));
    expect(shuffled).not.toEqual(shuffleDeck(original, createRng(43)));
    expect(shuffled.map((c) => c.id).sort()).toEqual([...before].sort());
    expect(original.map((c) => c.id)).toEqual(before);
  });
  it('rejects a broken random source rather than losing a physical card', () => {
    expect(() => shuffleDeck(createDeck(), () => 1)).toThrow();
  });
});

describe('level rank and ordinary combinations', () => {
  it.each([2, 7, 14])('places level %i above A and below both jokers', (level) => {
    const config = makeRules(level);
    const ordered = [...Array.from({ length: 13 }, (_, i) => i + 2).filter((rank) => rank !== level), level, 15, 16];
    expect([...ordered].sort((a, b) => rankStrength(a, config) - rankStrength(b, config))).toEqual(ordered);
    expect(createDeck().filter((c) => isWild(c, config))).toHaveLength(2);
    for (const count of [1, 2, 3, 4]) {
      expect(canBeat(play(copies(level, count), undefined, config), play(copies(level === 14 ? 13 : 14, count), undefined, config), config)).toBe(true);
    }
  });
  it('recognizes all ordinary patterns', () => {
    const samples: Array<[PlayKind, Card[]]> = [
      ['single', [card(7)]], ['pair', copies(7, 2)], ['triple', copies(7, 3)],
      ['fullHouse', [...copies(7, 3), ...copies(8, 2)]], ['straight', sequence([3, 4, 5, 6, 7])],
      ['pairs', sequence([3, 4, 5], 2)], ['plate', sequence([3, 4], 3)],
    ];
    for (const [kind, cards] of samples) expect(play(cards, kind).kind).toBe(kind);
  });
  it('rejects three-with-one, four-with-two, long pairs, and mixed jokers', () => {
    const illegal = [
      [...copies(7, 3), card(8)], [...copies(7, 4), ...copies(8, 2)], sequence([3, 4, 5, 6], 2),
      [...sequence([3, 4], 3), ...copies(8, 2), ...copies(9, 2)], [card(15), card(16)],
    ];
    for (const cards of illegal) expect(resolvePlays(cards, rules)).toEqual([]);
  });
  it('supports true matching joker pairs including the pair in a full house', () => {
    expect(play(copies(15, 2), 'pair').value).toBe(16);
    expect(play(copies(16, 2), 'pair').value).toBe(17);
    expect(play([...copies(7, 3), ...copies(16, 2)], 'fullHouse').value).toBe(7);
    expect(resolvePlays([...copies(7, 3), card(15), card(16)], rules)).toEqual([]);
  });
  it('compares full houses only by the triple and ignores the carried pair', () => {
    const lowPair = play([...copies(7, 3), ...copies(3, 2)], 'fullHouse');
    const highPair = play([...copies(7, 3), ...copies(16, 2)], 'fullHouse');
    expect(canBeat(highPair, lowPair, rules)).toBe(false);
    expect(canBeat(lowPair, highPair, rules)).toBe(false);
    expect(canBeat(play([...copies(8, 3), ...copies(3, 2)], 'fullHouse'), highPair, rules)).toBe(true);
  });
  it('requires the same ordinary type and length; equal rank and different suits cannot beat', () => {
    expect(canBeat(play([card(7, 'C')]), play([card(7, 'S')]), rules)).toBe(false);
    expect(canBeat(play(copies(8, 2)), play([card(7)]), rules)).toBe(false);
    expect(canBeat(play(sequence([4, 5], 3), 'plate'), play(sequence([3, 4, 5], 2), 'pairs'), rules)).toBe(false);
  });
});

describe('natural sequences and ace endpoints', () => {
  it.each([
    ['straight', [14, 2, 3, 4, 5], 1, 5], ['straight', [10, 11, 12, 13, 14], 1, 14],
    ['pairs', [14, 2, 3], 2, 3], ['pairs', [12, 13, 14], 2, 14],
    ['plate', [14, 2], 3, 2], ['plate', [13, 14], 3, 14],
  ] as const)('%s accepts %j with natural high %i', (kind, ranks, count, value) => {
    expect(play(sequence([...ranks], count), kind).value).toBe(value);
  });
  it.each([[11, 12, 13, 14, 2], [12, 13, 14, 2, 3], [13, 14, 2, 3, 4]])('rejects wrapped straight %j', (...ranks) => {
    expect(resolvePlays(sequence(ranks), rules)).toEqual([]);
  });
  it('rejects wrapped pairs and jokers inside consecutive patterns', () => {
    expect(resolvePlays(sequence([13, 14, 2], 2), rules)).toEqual([]);
    expect(resolvePlays([...sequence([11, 12, 13, 14]), card(15)], rules)).toEqual([]);
  });
  it('puts the level rank back in its natural position in sequences', () => {
    const config = makeRules(7);
    expect(play(sequence([5, 6, 7, 8, 9]), 'straight', config).value).toBe(9);
    expect(canBeat(play(sequence([6, 7, 8, 9, 10]), 'straight', config), play(sequence([5, 6, 7, 8, 9]), 'straight', config), config)).toBe(true);
  });
  it('does not downgrade an entirely natural straight flush', () => {
    const cards = [3, 4, 5, 6, 7].map((rank) => card(rank, 'C'));
    expect(resolvePlays(cards, rules).map((p) => p.kind)).toEqual(['straightFlush']);
  });
});

describe('bomb hierarchy', () => {
  it('orders 4 < 5 < straight flush < 6 < 7 < 8 < 9 < 10 < four jokers', () => {
    const ordered = [
      play(copies(14, 4), 'bomb'), play(copies(3, 5), 'bomb'),
      play([3, 4, 5, 6, 7].map((rank) => card(rank, 'C')), 'straightFlush'),
      ...[6, 7, 8].map((count) => play(copies(3, count), 'bomb')),
      play([...copies(3, 8), wild()], 'bomb'), play([...copies(3, 8), wild(), wild(1)], 'bomb'),
      play([...copies(15, 2), ...copies(16, 2)], 'jokerBomb'),
    ];
    for (let i = 0; i < ordered.length; i += 1) for (let j = 0; j < ordered.length; j += 1) expect(canBeat(ordered[i]!, ordered[j]!, rules)).toBe(i > j);
    expect(canBeat(ordered[0]!, play([card(16)]), rules)).toBe(true);
  });
  it('compares equal-sized bombs by level strength', () => {
    expect(canBeat(play(copies(2, 4), 'bomb'), play(copies(14, 4), 'bomb'), rules)).toBe(true);
  });
  it('straight-flush suits tie while natural endpoints decide strength', () => {
    const clubs = play([3, 4, 5, 6, 7].map((rank) => card(rank, 'C')), 'straightFlush');
    const spades = play([3, 4, 5, 6, 7].map((rank) => card(rank, 'S')), 'straightFlush');
    expect(canBeat(spades, clubs, rules)).toBe(false);
    expect(canBeat(play([4, 5, 6, 7, 8].map((rank) => card(rank, 'D')), 'straightFlush'), clubs, rules)).toBe(true);
  });
  it('level bombs max out at eight entities and physical cards cannot be counted twice', () => {
    expect(play(copies(2, 8), 'bomb').size).toBe(8);
    expect(resolvePlays([...copies(2, 8), wild()], rules)).toEqual([]);
    expect(resolvePlays([card(7), card(7)], rules)).toEqual([]);
  });
  it('two jokers are no rocket and wilds cannot create four-joker bombs', () => {
    expect(canBeat(play(copies(16, 2)), play(copies(3, 4), 'bomb'), rules)).toBe(false);
    expect(resolvePlays([card(15), card(16), wild(), wild(1)], rules)).toEqual([]);
  });
});

describe('explicit wildcard interpretations', () => {
  it('single wilds and the pure-wild pair retain their original level', () => {
    expect(resolvePlays([wild()], rules)).toHaveLength(1);
    expect(play([wild()]).value).toBe(15);
    const pair = resolvePlays([wild(), wild(1)], rules);
    expect(pair).toHaveLength(1);
    expect(pair[0]?.value).toBe(15);
    expect(pair[0]?.wildcards.map((w) => w.rank)).toEqual([2, 2]);
  });
  it('forms ordinary pairs, triples, full houses, and bombs with one or two wilds', () => {
    expect(play([card(9), wild()], 'pair').wildcards).toEqual([{ cardId: wild().id, rank: 9, suit: 'H' }]);
    expect(play([card(9), wild(), wild(1)], 'triple').value).toBe(9);
    expect(play([...copies(9, 2), ...copies(10, 2), wild()], 'fullHouse').kind).toBe('fullHouse');
    expect(play([...copies(9, 2), wild(), wild(1)], 'bomb').size).toBe(4);
  });
  it('cannot simulate jokers or fill a joker pair', () => {
    expect(resolvePlays([card(15), wild()], rules)).toEqual([]);
    expect(resolvePlays([card(16), wild(), wild(1)], rules)).toEqual([]);
    expect(resolvePlays([...copies(9, 3), card(16), wild()], rules)).toEqual([]);
  });
  it('retains different full-house triple choices and all relevant wildcard allocations', () => {
    const plays = resolvePlays([...copies(7, 2), ...copies(8, 2), wild()], rules).filter((p) => p.kind === 'fullHouse');
    expect(plays.map((p) => p.value).sort()).toEqual([7, 8]);
    const double = resolvePlays([card(7), card(7, 'C'), card(8), wild(), wild(1)], rules).filter((p) => p.kind === 'fullHouse');
    expect(double.filter((p) => p.value === 7)).toHaveLength(2);
    expect(new Set(double.map((p) => p.key)).size).toBe(double.length);
  });
  it('retains 3–7 and 4–8 straight interpretations with clear rank replacements', () => {
    const plays = resolvePlays([...sequence([4, 5, 6, 7]), wild()], rules).filter((p) => p.kind === 'straight');
    expect(plays.map((p) => p.value)).toEqual([7, 8]);
    expect(plays.map((p) => p.wildcards[0]!.rank)).toEqual([3, 8]);
  });
  it('uses wildcard suit replacement in straight flushes and keeps actual non-flush interpretations', () => {
    const cards = [...[3, 4, 5, 6].map((rank) => card(rank, 'C')), wild()];
    const plays = resolvePlays(cards, rules);
    expect(plays.filter((p) => p.kind === 'straightFlush').map((p) => p.value)).toEqual([6, 7]);
    expect(plays.filter((p) => p.kind === 'straightFlush').every((p) => p.wildcards[0]?.suit === 'C')).toBe(true);
    expect(plays.filter((p) => p.kind === 'straight')).toHaveLength(2);
    const hearts = resolvePlays([...cards.slice(0, 4).map((c) => card(c.rank, 'H')), wild()], rules);
    expect(hearts.filter((p) => p.kind === 'straight').every((p) => p.wildcards[0]?.suit === 'S')).toBe(true);
  });
  it('preserves both physical wildcard-to-rank assignments and stable keys across display sorting', () => {
    const cards = [...sequence([4, 5, 6]), wild(), wild(1)];
    const plays = resolvePlays(cards, rules).filter((p) => p.kind === 'straight' && p.value === 7);
    expect(plays).toHaveLength(2);
    expect(plays.map((p) => p.wildcards.map((w) => w.rank))).toEqual([[3, 7], [7, 3]]);
    expect(resolvePlays([...cards].reverse(), rules).map((p) => p.key)).toEqual(resolvePlays(cards, rules).map((p) => p.key));
  });
});

describe('legal candidate generation', () => {
  it('keeps every candidate legal and responsive to the current play', () => {
    const hand = shuffleDeck(createDeck(), createRng(115)).slice(0, 27);
    const current = play(copies(7, 2));
    const moves = getLegalMoves(observation(hand, current));
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) {
      expect(canBeat(move, current, rules)).toBe(true);
      expect(resolvePlays(move.cards, rules).some((p) => p.key === move.key)).toBe(true);
      expect(move.cards.every((c) => hand.some((owned) => owned.id === c.id))).toBe(true);
    }
  });
  it('finds ordinary straight alternatives even when canonical natural cards form a flush', () => {
    const hand = [...[3, 4, 5, 6, 7].map((rank) => card(rank)), card(5, 'C')];
    expect(getLegalMoves(observation(hand)).some((p) => p.kind === 'straight' && p.value === 7)).toBe(true);
    expect(getLegalMoves(observation(hand)).some((p) => p.kind === 'straightFlush' && p.value === 7)).toBe(true);
    const withWild = [...[3, 4, 5, 6, 7].map((rank) => card(rank)), wild()];
    expect(getLegalMoves(observation(withWild)).some((p) => p.kind === 'straight' && p.value === 7)).toBe(true);
  });
  it('finds 9/10 bombs, four jokers, pure-wild pairs, and joker-backed full houses', () => {
    expect(getLegalMoves(observation([...copies(3, 8), wild(), wild(1)])).filter((p) => p.kind === 'bomb').map((p) => p.size)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(getLegalMoves(observation([...copies(15, 2), ...copies(16, 2)])).some((p) => p.kind === 'jokerBomb')).toBe(true);
    expect(getLegalMoves(observation([wild(), wild(1)])).filter((p) => p.kind === 'pair')).toHaveLength(1);
    expect(getLegalMoves(observation([...copies(7, 3), ...copies(16, 2)])).some((p) => p.kind === 'fullHouse')).toBe(true);
  });
  it('matches exhaustive small-hand subset availability for every semantic rank template', () => {
    const samples = [
      [...sequence([3, 4, 5, 6]), wild(), wild(1)],
      [card(7), card(7, 'C'), card(8), card(8, 'C'), wild(), wild(1)],
      [...[3, 4, 5, 6, 7].map((rank) => card(rank)), card(5, 'C'), wild()],
      [...copies(15, 2), ...copies(16, 2), wild(), wild(1)],
    ];
    const signature = (p: ResolvedPlay) => `${p.kind}/${p.size}/${p.value}`;
    for (const hand of samples) {
      const reference = new Set<string>();
      for (let mask = 1; mask < 2 ** hand.length; mask += 1) {
        const subset = hand.filter((_, index) => (mask & (1 << index)) !== 0);
        for (const p of resolvePlays(subset, rules)) reference.add(signature(p));
      }
      expect(new Set(getLegalMoves(observation(hand)).map(signature))).toEqual(reference);
    }
  });
  it('reports no moves only when no template can actually beat the table', () => {
    expect(getLegalMoves(observation([card(3), card(4)], play([card(16)])))).toEqual([]);
    expect(getLegalMoves({ ...observation(copies(3, 4)), isOver: true })).toEqual([]);
  });
});
