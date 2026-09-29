import { isWild, rankStrength } from './cards';
import { rankName } from './rules';
import type { Card, PlayKind, ResolvedPlay, RuleConfig, Suit, WildMapping } from './types';

export interface PlayTemplate {
  kind: PlayKind;
  counts: ReadonlyArray<readonly [number, number]>;
  size: number;
  rank: number;
  suit?: Suit;
}

const NATURAL = [14, ...Array.from({ length: 13 }, (_, i) => i + 2)];
const templates: PlayTemplate[] = [];
for (let rank = 2; rank <= 16; rank += 1) {
  templates.push({ kind: 'pair', counts: [[rank, 2]], size: 2, rank });
  if (rank > 14) continue;
  templates.push({ kind: 'triple', counts: [[rank, 3]], size: 3, rank });
  for (let size = 4; size <= 10; size += 1) templates.push({ kind: 'bomb', counts: [[rank, size]], size, rank });
  for (let pair = 2; pair <= 16; pair += 1) {
    if (pair !== rank) templates.push({ kind: 'fullHouse', counts: [[rank, 3], [pair, 2]], size: 5, rank });
  }
}
for (const [kind, length, copies] of [['straight', 5, 1], ['pairs', 3, 2], ['plate', 2, 3]] as const) {
  for (let start = 0; start + length <= NATURAL.length; start += 1) {
    const ranks = NATURAL.slice(start, start + length);
    const counts = ranks.map((rank) => [rank, copies] as const);
    const template: PlayTemplate = { kind, counts, size: length * copies, rank: ranks.at(-1)! };
    templates.push(template);
    if (kind === 'straight') {
      for (const suit of ['S', 'H', 'C', 'D'] as const) templates.push({ ...template, kind: 'straightFlush', suit });
    }
  }
}
templates.push({ kind: 'jokerBomb', counts: [[15, 2], [16, 2]], size: 4, rank: 16 });
const bySize = new Map<number, PlayTemplate[]>();
for (const template of templates) {
  const list = bySize.get(template.size) ?? [];
  list.push(template);
  bySize.set(template.size, list);
}

/** Finite rank/count templates, shared by exact selection resolution and hand search. */
export function getPlayTemplates(size?: number): readonly PlayTemplate[] {
  return size === undefined ? templates : (bySize.get(size) ?? []);
}

export function templateValue(template: PlayTemplate, rules: RuleConfig): number {
  return ['straight', 'straightFlush', 'pairs', 'plate'].includes(template.kind)
    ? template.rank : rankStrength(template.rank, rules);
}

function playLabel(template: PlayTemplate): string {
  const rank = rankName(template.rank);
  if (template.kind === 'jokerBomb') return '四王炸';
  if (template.kind === 'bomb') return `${template.size} 张炸弹 · ${rank}`;
  if (template.kind === 'fullHouse') return `三带二 · ${rank} 带 ${rankName(template.counts[1]![0])}`;
  const names: Record<PlayKind, string> = {
    single: '单张', pair: '对子', triple: '三张', fullHouse: '三带二', straight: '顺子',
    pairs: '三连对', plate: '钢板', bomb: '炸弹', straightFlush: '同花顺', jokerBomb: '四王炸',
  };
  const consecutive = ['straight', 'straightFlush', 'pairs', 'plate'].includes(template.kind);
  return `${names[template.kind]} · ${consecutive ? `${rankName(template.counts[0]![0])}–` : ''}${rank}`;
}

/** All keys retain physical card identity and the declared substitution. */
export function makeResolvedPlay(cards: Card[], template: PlayTemplate, wildcards: WildMapping[], rules: RuleConfig): ResolvedPlay {
  const orderedCards = [...cards].sort((a, b) => a.id.localeCompare(b.id));
  const mappings = [...wildcards].sort((a, b) => a.cardId.localeCompare(b.cardId));
  const value = templateValue(template, rules);
  return {
    key: `${template.kind}:${value}:${orderedCards.map((card) => card.id).join(',')}:${mappings.map((wild) => `${wild.cardId}=${wild.rank}${wild.suit}`).join(',')}`,
    cards: orderedCards, kind: template.kind, size: cards.length, value, label: playLabel(template), wildcards: mappings,
  };
}

/** Exact selected-card matching: at most two wildcard permutations, never all hand subsets. */
export function resolveTemplate(cards: Card[], template: PlayTemplate, rules: RuleConfig): ResolvedPlay[] {
  if (cards.length !== template.size) return [];
  const wilds = cards.filter((card) => isWild(card, rules)).sort((a, b) => a.id.localeCompare(b.id));
  if (wilds.length > 2) return [];
  if (cards.length === 2 && wilds.length === 2 && (template.kind !== 'pair' || template.rank !== rules.levelRank)) return [];
  const fixed = cards.filter((card) => !isWild(card, rules));
  const required = new Map(template.counts);
  for (const card of fixed) {
    if (template.suit && card.suit !== template.suit) return [];
    const remaining = required.get(card.rank) ?? 0;
    if (remaining <= 0) return [];
    required.set(card.rank, remaining - 1);
  }
  const deficits: number[] = [];
  for (const [rank, remaining] of required) {
    if (rank >= 15 && remaining > 0) return [];
    for (let i = 0; i < remaining; i += 1) deficits.push(rank);
  }
  if (deficits.length !== wilds.length) return [];
  if (template.kind === 'straight' && !wilds.length && fixed.every((card) => card.suit === fixed[0]?.suit)) return [];
  const assignments = [deficits];
  if (deficits.length === 2 && deficits[0] !== deficits[1]) assignments.push([deficits[1]!, deficits[0]!]);
  return assignments.map((assignment) => {
    const mappings: WildMapping[] = wilds.map((card, index) => ({ cardId: card.id, rank: assignment[index]!, suit: template.suit ?? 'H' }));
    // A normal straight must have at least two effective suits. Use one explicit,
    // canonical non-heart substitution when all fixed cards are hearts.
    if (template.kind === 'straight' && mappings.length && fixed.every((card) => card.suit === 'H')) mappings[0]!.suit = 'S';
    return makeResolvedPlay(cards, template, mappings, rules);
  });
}

export function resolvePlays(cards: Card[], rules: RuleConfig): ResolvedPlay[] {
  if (cards.length < 1 || cards.length > 10 || new Set(cards.map((card) => card.id)).size !== cards.length) return [];
  if (cards.some((card) => !Number.isInteger(card.rank) || card.rank < 2 || card.rank > 16 || (card.rank > 14 ? card.suit !== 'J' : !['S', 'H', 'C', 'D'].includes(card.suit)))) return [];
  if (cards.length === 1) {
    const card = cards[0]!;
    const template: PlayTemplate = { kind: 'single', counts: [[card.rank, 1]], rank: card.rank, size: 1 };
    return [makeResolvedPlay(cards, template, isWild(card, rules) ? [{ cardId: card.id, rank: card.rank, suit: 'H' }] : [], rules)];
  }
  return getPlayTemplates(cards.length).flatMap((template) => resolveTemplate(cards, template, rules));
}
