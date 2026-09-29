import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeck, createRng, isWild, shuffleDeck } from '../engine/cards';
import { resolvePlays } from '../engine/patterns';
import { makeRules } from '../engine/rules';
import type { Card, Suit } from '../engine/types';
import { cleanGroups, DEFAULT_HAND_VIEW, findStraightFlushes, groupSelected, HAND_VIEW_KEY, orderGroupedHand, readHandView, restoreGroups, sortHand, suggestGroups, ungroupSelected, writeHandView, type HandGroup } from '../hand/arrangement';

const card = (rank: number, suit: Suit = 'S', deck = 0): Card => ({ id: `${deck}-${suit}-${rank}`, deck, rank, suit });
const sameRank = (rank: number, length: number) => createDeck().filter(value => value.rank === rank).slice(0, length);
const ids = (cards: readonly Card[]) => cards.map(value => value.id).sort();

afterEach(() => vi.unstubAllGlobals());

describe('hand arrangement physical-card invariants', () => {
  it('retains all 27 distinct physical cards, immutable inputs and selection at every level', () => {
    for (let level = 2; level <= 14; level++) for (let seed = 0; seed < 40; seed++) {
      const hand = shuffleDeck(createDeck(), createRng(seed * 31 + level)).slice(0, 27);
      const before = structuredClone(hand);
      const selected = Object.freeze([hand[0]!.id, hand[26]!.id]);
      const groups = suggestGroups(hand, makeRules(level));
      const groupedIds = groups.flatMap(group => group.cardIds);
      expect(new Set(groupedIds).size).toBe(groupedIds.length);
      for (const sort of ['rank', 'suit'] as const) {
        const ordered = orderGroupedHand(hand, groups, sort, level);
        expect(ordered).toHaveLength(27);
        expect(ids(ordered)).toEqual(ids(hand));
        expect(ordered.filter(value => selected.includes(value.id))).toHaveLength(2);
      }
      expect(hand).toEqual(before);
      expect(selected).toEqual([hand[0]!.id, hand[26]!.id]);
    }
  });

  it('protects a natural bomb before extracting an overlapping straight flush', () => {
    const bomb = sameRank(7, 4);
    const hand = [...bomb, card(6), card(8), card(9), card(10), card(2, 'H')];
    const groups = suggestGroups(hand, makeRules(2));
    expect(groups.find(group => group.kind === 'bomb')?.cardIds.sort()).toEqual(ids(bomb));
    expect(groups.some(group => group.kind === 'straightFlush')).toBe(false);
    expect(groups.flatMap(group => group.cardIds)).not.toContain(card(2, 'H').id);
  });

  it('recognizes four jokers, natural flushes, pairs and reserves both wildcards', () => {
    const jokers = createDeck().filter(value => value.rank > 14);
    const flush = [9, 10, 11, 12, 13].map(rank => card(rank));
    const wilds = [card(2, 'H'), card(2, 'H', 1)];
    const hand = [...jokers, ...flush, ...sameRank(5, 2), ...wilds];
    const groups = suggestGroups(hand, makeRules(2));
    expect(groups.map(group => group.kind)).toEqual(['jokerBomb', 'straightFlush', 'pair', 'wild']);
    expect(groups.find(group => group.kind === 'wild')?.cardIds.sort()).toEqual(ids(wilds));
    for (const group of groups.filter(value => value.kind !== 'wild')) {
      const cards = hand.filter(value => group.cardIds.includes(value.id));
      expect(cards.some(value => isWild(value, makeRules(2)))).toBe(false);
      expect(resolvePlays(cards, makeRules(2)).some(play => play.kind === group.kind)).toBe(true);
    }
  });

  it('returns only valid five-card straight-flush candidates, including explicit wildcard candidates', () => {
    const rules = makeRules(2);
    const hand = [...[10, 11, 12, 13].map(rank => card(rank)), card(2, 'H'), card(2, 'H', 1), card(8, 'D')];
    const candidates = findStraightFlushes(hand, rules);
    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(new Set(candidate.cardIds).size).toBe(5);
      const selected = hand.filter(value => candidate.cardIds.includes(value.id));
      expect(resolvePlays(selected, rules).some(play => play.kind === 'straightFlush')).toBe(true);
      expect(resolvePlays(selected, rules).find(play => play.key === candidate.playKey)?.kind).toBe('straightFlush');
      expect(candidate.wildCount).toBe(selected.filter(value => isWild(value, rules)).length);
    }
    expect(findStraightFlushes(hand, rules, false)).toEqual([]);
    expect(findStraightFlushes([14, 2, 3, 4, 5].map(rank => card(rank)), makeRules(7))).toHaveLength(1);
  });

  it('can group arbitrary selected cards while leaving unaffected groups intact', () => {
    const bomb = sameRank(8, 4); const hand = [...bomb, card(3), card(14)];
    const initial = suggestGroups(hand, makeRules(2)); const before = structuredClone(initial);
    const manual = groupSelected(initial, hand, [card(3).id, card(14).id, 'not-in-hand']);
    expect(manual[0]).toEqual(initial[0]);
    expect(manual.at(-1)?.kind).toBe('manual');
    expect(manual.at(-1)?.cardIds).toHaveLength(2);
    expect(initial).toEqual(before);
    const mixed = groupSelected(manual, hand, [bomb[0]!.id, card(3).id]);
    expect(new Set(mixed.flatMap(group => group.cardIds)).size).toBe(mixed.flatMap(group => group.cardIds).length);
    expect(mixed[0]?.label).toBe('保留分组');
    expect(ids(orderGroupedHand(hand, mixed, 'rank', 2))).toEqual(ids(hand));
  });

  it('cleans played IDs, deduplicates corrupt groups and never revives cards when undoing', () => {
    const hand = sameRank(8, 4); const original = suggestGroups(hand, makeRules(2));
    const corrupt: HandGroup[] = [...original, { id: 'duplicate', kind: 'manual', label: 'duplicate', cardIds: [hand[0]!.id, hand[1]!.id, 'gone'] }];
    expect(cleanGroups(corrupt, hand)).toEqual(original);
    const remaining = hand.slice(1);
    const restored = restoreGroups([[], original], remaining)!;
    expect(restored.groups[0]?.cardIds.sort()).toEqual(ids(remaining));
    expect(restored.groups[0]?.kind).toBe('manual');
    expect(restored.history).toEqual([[]]);
    expect(restoreGroups(restored.history, remaining)?.groups).toEqual([]);
    expect(restoreGroups([], remaining)).toBeNull();
    expect(cleanGroups(original, hand.slice(3))).toEqual([]);
    expect(ungroupSelected(original, hand, [hand[2]!.id])).toEqual([]);
  });

  it('sorts the level above aces, below jokers, without changing the original array', () => {
    const hand = [card(14), card(7), card(15, 'J'), card(16, 'J'), card(10, 'D')];
    const before = [...hand];
    expect(sortHand(hand, 'rank', 7).map(value => value.rank)).toEqual([16, 15, 7, 14, 10]);
    expect(sortHand(hand, 'suit', 7).map(value => value.suit)).toEqual(['S', 'S', 'D', 'J', 'J']);
    expect(hand).toEqual(before);
  });
});

describe('independent hand view preferences', () => {
  it('saves display settings and normalizes legacy suit sorting while preserving layout', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    expect(readHandView()).toEqual(DEFAULT_HAND_VIEW);
    storage.set(HAND_VIEW_KEY, JSON.stringify({ sort: 'suit', layout: 'double' }));
    expect(readHandView()).toEqual({ sort: 'rank', layout: 'double' });
    writeHandView({ sort: 'suit', layout: 'vertical' });
    expect(readHandView()).toEqual({ sort: 'rank', layout: 'vertical' });
    expect([...storage.keys()]).toEqual([HAND_VIEW_KEY]);
    expect(JSON.parse(storage.get(HAND_VIEW_KEY)!)).toEqual({ sort: 'rank', layout: 'vertical' });
  });

  it('recovers from corrupt or unavailable local storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{broken', setItem: () => { throw new Error('blocked'); } });
    expect(readHandView()).toEqual(DEFAULT_HAND_VIEW);
    expect(() => writeHandView({ sort: 'rank', layout: 'double' })).not.toThrow();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readHandView()).toEqual(DEFAULT_HAND_VIEW);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ sort: 'invalid', layout: 'invalid' }) });
    expect(readHandView()).toEqual(DEFAULT_HAND_VIEW);
  });
});
