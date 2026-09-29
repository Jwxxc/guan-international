import { isWild, rankStrength } from '../engine/cards';
import { getPlayTemplates, resolveTemplate } from '../engine/patterns';
import { makeRules, rankName } from '../engine/rules';
import type { Card, RuleConfig } from '../engine/types';

export type SortMode = 'rank' | 'suit';
export type HandLayout = 'single' | 'double' | 'vertical';
export type GroupKind = 'manual' | 'bomb' | 'straightFlush' | 'jokerBomb' | 'triple' | 'pair' | 'straight' | 'wild' | 'loose';
export interface HandGroup { id: string; cardIds: string[]; kind: GroupKind; label: string; keepSingle?: boolean }
export interface HandView { sort: SortMode; layout: HandLayout }
export interface RunCandidate { cardIds: string[]; label: string; wildCount: number; playKey: string }
export type FlushCandidate = RunCandidate;

const suitOrder = { S: 0, H: 1, C: 2, D: 3, J: 4 };
export function sortHand(cards: readonly Card[], mode: SortMode, level: number): Card[] {
  const rules = makeRules(level);
  return [...cards].sort((a, b) => mode === 'rank'
    ? rankStrength(b.rank, rules) - rankStrength(a.rank, rules) || suitOrder[a.suit] - suitOrder[b.suit] || a.id.localeCompare(b.id)
    : suitOrder[a.suit] - suitOrder[b.suit] || rankStrength(b.rank, rules) - rankStrength(a.rank, rules) || a.id.localeCompare(b.id));
}

/** Keep physical identities once, and turn partially played groups into neutral groups. */
export function cleanGroups(groups: readonly HandGroup[], cards: readonly Card[]): HandGroup[] {
  const available = new Set(cards.map(card => card.id));
  const used = new Set<string>();
  const identities = new Set<string>();
  return groups.flatMap(group => {
    const cardIds = group.cardIds.filter(id => {
      if (!available.has(id) || used.has(id)) return false;
      used.add(id); return true;
    });
    if (cardIds.length < (group.keepSingle ? 1 : 2)) return [];
    let id = group.id;
    while (identities.has(id)) id = `${id}:${[...cardIds].sort().join('|')}`;
    identities.add(id);
    return [{ ...group, id, cardIds, ...(cardIds.length !== group.cardIds.length ? { kind: 'manual' as const, label: '保留分组' } : {}) }];
  });
}

export function groupSelected(groups: readonly HandGroup[], cards: readonly Card[], selected: readonly string[]): HandGroup[] {
  const selectedSet = new Set(selected);
  const ids = cards.filter(card => selectedSet.has(card.id)).map(card => card.id);
  if (ids.length < 2) return cleanGroups(groups, cards);
  const kept = cleanGroups(groups.map(group => {
    const cardIds = group.cardIds.filter(id => !selectedSet.has(id));
    return cardIds.length === group.cardIds.length ? group : { ...group, cardIds, kind: 'manual' as const, label: '保留分组' };
  }), cards);
  return [...kept, { id: `manual:${[...ids].sort().join('|')}`, cardIds: ids, kind: 'manual', label: '自选分组' }];
}

export function ungroupSelected(groups: readonly HandGroup[], cards: readonly Card[], selected: readonly string[]): HandGroup[] {
  const selectedSet = new Set(selected);
  return cleanGroups(groups.filter(group => !group.cardIds.some(id => selectedSet.has(id))), cards);
}

/** Display order is a permutation only: it never updates the authoritative hand or selection. */
export function orderGroupedHand(cards: readonly Card[], groups: readonly HandGroup[], sort: SortMode, level: number): Card[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const valid = cleanGroups(groups, cards);
  const grouped = new Set(valid.flatMap(group => group.cardIds));
  return [
    ...valid.flatMap(group => sortHand(group.cardIds.map(id => byId.get(id)!), sort, level)),
    ...sortHand(cards.filter(card => !grouped.has(card.id)), sort, level),
  ];
}

/** Ordinary five-card runs; keep different strengths when the same wildcard cards can form both. */
export function findStraights(cards: readonly Card[], rules: RuleConfig): RunCandidate[] {
  const naturals = sortHand(cards.filter(card => !isWild(card, rules)), 'suit', rules.levelRank);
  const wilds = cards.filter(card => isWild(card, rules)).sort((a, b) => a.id.localeCompare(b.id));
  const result: Array<RunCandidate & { value: number }> = [];
  for (const template of getPlayTemplates(5)) {
    if (template.kind !== 'straight') continue;
    const selected: Card[] = []; let missing = 0;
    for (const [rank] of template.counts) {
      const natural = naturals.find(card => card.rank === rank);
      if (natural) selected.push(natural); else missing++;
    }
    if (missing > wilds.length) continue;
    if (!missing && selected.every(card => card.suit === selected[0]!.suit)) {
      // Do not mistake a canonical same-suit selection for absence of an ordinary run.
      const suit = selected[0]!.suit;
      const index = selected.findIndex(card => naturals.some(other => other.rank === card.rank && other.suit !== suit));
      if (index >= 0) selected[index] = naturals.find(card => card.rank === selected[index]!.rank && card.suit !== suit)!;
      else if (wilds.length) { selected.pop(); missing = 1; }
      else continue;
    }
    selected.push(...wilds.slice(0, missing));
    const play = resolveTemplate(selected, template, rules)[0];
    if (play) result.push({ cardIds: play.cards.map(card => card.id), label: play.label, wildCount: missing, playKey: play.key, value: play.value });
  }
  return result.sort((a, b) => a.wildCount - b.wildCount || b.value - a.value || a.playKey.localeCompare(b.playKey))
    .map(({ value: _value, ...candidate }) => candidate);
}

/** One canonical physical realization per distinct candidate; duplicates are interchangeable. */
export function findStraightFlushes(cards: readonly Card[], rules: RuleConfig, allowWild = true): FlushCandidate[] {
  const naturals = sortHand(cards.filter(card => !isWild(card, rules)), 'suit', rules.levelRank);
  const wilds = allowWild ? cards.filter(card => isWild(card, rules)) : [];
  const seen = new Set<string>();
  const result: Array<FlushCandidate & { value: number }> = [];
  for (const template of getPlayTemplates(5)) {
    if (template.kind !== 'straightFlush') continue;
    const selected: Card[] = []; let missing = 0;
    for (const [rank] of template.counts) {
      const natural = naturals.find(card => card.rank === rank && card.suit === template.suit);
      if (natural) selected.push(natural); else missing += 1;
    }
    if (missing > wilds.length) continue;
    selected.push(...wilds.slice(0, missing));
    const play = resolveTemplate(selected, template, rules)[0];
    if (!play) continue;
    const key = [...selected.map(card => card.id)].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ cardIds: selected.map(card => card.id), label: play.label, wildCount: missing, playKey: play.key, value: play.value });
  }
  return result.sort((a, b) => a.wildCount - b.wildCount || b.value - a.value || a.cardIds.join().localeCompare(b.cardIds.join()))
    .map(({ value: _value, ...candidate }) => candidate);
}

/** A conservative suggestion, not a solver: protect natural bombs, then flushes, triples/pairs. */
export function suggestGroups(cards: readonly Card[], rules: RuleConfig): HandGroup[] {
  let remaining = sortHand(cards.filter(card => !isWild(card, rules)), 'rank', rules.levelRank);
  const groups: HandGroup[] = [];
  const take = (picked: Card[], kind: GroupKind, label: string) => {
    const ids = picked.map(card => card.id); const set = new Set(ids);
    groups.push({ id: `${kind}:${[...ids].sort().join('|')}`, cardIds: ids, kind, label });
    remaining = remaining.filter(card => !set.has(card.id));
  };
  const jokers = remaining.filter(card => card.rank > 14);
  if (jokers.length === 4) take(jokers, 'jokerBomb', '四王炸');
  for (const rank of [...new Set(remaining.map(card => card.rank))]) {
    const same = remaining.filter(card => card.rank === rank);
    if (same.length >= 4) take(same, 'bomb', `${same.length} 张炸弹 · ${rankName(rank)}`);
  }
  let flush = findStraightFlushes(remaining, rules, false)[0];
  while (flush) {
    take(flush.cardIds.map(id => remaining.find(card => card.id === id)!), 'straightFlush', flush.label);
    flush = findStraightFlushes(remaining, rules, false)[0];
  }
  for (const rank of [...new Set(remaining.map(card => card.rank))]) {
    const same = remaining.filter(card => card.rank === rank);
    if (same.length === 3) take(same, 'triple', `三张 · ${rankName(rank)}`);
    else if (same.length === 2) take(same, 'pair', `对子 · ${rankName(rank)}`);
  }
  // Find natural straights only after retaining existing same-rank combinations.
  for (const template of [...getPlayTemplates(5)].reverse()) {
    if (template.kind !== 'straight') continue;
    const picked = template.counts.map(([rank]) => remaining.find(card => card.rank === rank));
    if (picked.some(card => !card)) continue;
    const play = resolveTemplate(picked as Card[], template, rules)[0];
    if (play) take(picked as Card[], 'straight', play.label);
  }
  const wilds = cards.filter(card => isWild(card, rules));
  if (wilds.length > 1) groups.push({ id: 'wild', cardIds: wilds.map(card => card.id), kind: 'wild', label: '逢人配 · 待用' });
  return groups;
}

export function restoreGroups(history: readonly HandGroup[][], cards: readonly Card[]): { groups: HandGroup[]; history: HandGroup[][] } | null {
  if (!history.length) return null;
  return { groups: cleanGroups(history[history.length - 1]!, cards), history: history.slice(0, -1) };
}

export const HAND_VIEW_KEY = 'guan.hand-view.v1';
export const DEFAULT_HAND_VIEW: HandView = { sort: 'rank', layout: 'single' };
export function readHandView(): HandView {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HAND_VIEW_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_HAND_VIEW };
    const candidate = value as Partial<HandView>;
    return {
      // Hand display now always uses ranks; retain legacy layout preferences.
      sort: 'rank',
      layout: candidate.layout === 'double' || candidate.layout === 'vertical' ? candidate.layout : 'single',
    };
  } catch { return { ...DEFAULT_HAND_VIEW }; }
}
export function writeHandView(view: HandView): void {
  try { localStorage.setItem(HAND_VIEW_KEY, JSON.stringify({ ...view, sort: 'rank' })); } catch { /* Arrangement remains usable without storage. */ }
}
