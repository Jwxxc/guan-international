import type { Card, Rank, Rng, RuleConfig, Suit } from './types';

const SUITS: Suit[] = ['S', 'H', 'C', 'D'];

export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (let deck = 0; deck < 2; deck += 1) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank += 1) cards.push({ id: `${deck}-${suit}-${rank}`, deck, suit, rank });
    }
    for (const rank of [15, 16]) cards.push({ id: `${deck}-J-${rank}`, deck, suit: 'J', rank });
  }
  return cards;
}

/** mulberry32-v1. Deal and policy callers each own a separate generator. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleDeck(deck: Card[], rng: Rng): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const sample = rng();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('随机源必须返回 [0, 1)');
    const j = Math.floor(sample * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function isWild(card: Card, rules: RuleConfig): boolean {
  return card.suit === 'H' && card.rank === rules.levelRank;
}

export function rankStrength(rank: Rank, rules: RuleConfig): number {
  if (rank === 16) return 17;
  if (rank === 15) return 16;
  if (rank === rules.levelRank) return 15;
  return rank;
}
