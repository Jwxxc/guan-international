import { isWild } from './cards';
import { bombTier, canBeat } from './compare';
import { naturalStraightFlushReservedIds, preferNaturalStraightFlushSurplus } from './naturalStructures';
import { getPlayTemplates, resolvePlays, resolveTemplate, templateValue, type PlayTemplate } from './patterns';
import type { Card, PlayerObservation, ResolvedPlay, RuleConfig } from './types';

function templateCanBeat(template: PlayTemplate, current: ResolvedPlay | null, rules: RuleConfig): boolean {
  if (!current) return true;
  const tier = bombTier(template.kind, template.size);
  const otherTier = bombTier(current.kind, current.size);
  if (tier !== otherTier) return tier > otherTier;
  if (tier) return templateValue(template, rules) > current.value;
  return template.kind === current.kind && template.size === current.size && templateValue(template, rules) > current.value;
}

/**
 * Enumerates every achievable rank/count/suit template. Keeps the canonical
 * low-wildcard realization plus one that preserves natural straight flushes.
 * Physical copies with identical rank and suit remain interchangeable.
 * Human submissions use resolvePlays instead, and are never limited by this list.
 */
export function getLegalMoves(observation: PlayerObservation, rules: RuleConfig = observation.rules): ResolvedPlay[] {
  if (observation.isOver || observation.hand.length === 0) return [];
  const hand = [...observation.hand].sort((a, b) => a.id.localeCompare(b.id));
  const protectedIds = naturalStraightFlushReservedIds(hand);
  const moves = movesForOrder(hand, observation, rules);
  if (!protectedIds.size) return moves;
  const alternatives = preferNaturalStraightFlushSurplus(hand, protectedIds);
  moves.push(...movesForOrder(alternatives, observation, rules, protectedIds));
  return [...new Map(moves.map((move) => [move.key, move])).values()];
}

function movesForOrder(hand: Card[], observation: PlayerObservation, rules: RuleConfig, protectedIds: ReadonlySet<string> = new Set()): ResolvedPlay[] {
  const wilds = hand.filter((card) => isWild(card, rules));
  const groups = new Map<number, Card[]>();
  for (const card of hand) {
    if (isWild(card, rules)) continue;
    const list = groups.get(card.rank) ?? [];
    list.push(card);
    groups.set(card.rank, list);
  }
  const moves: ResolvedPlay[] = [];
  if (!observation.currentPlay || observation.currentPlay.kind === 'single') {
    for (const cards of groups.values()) {
      const play = resolvePlays([cards[0]!], rules)[0]!;
      if (canBeat(play, observation.currentPlay, rules)) moves.push(play);
    }
    const levelCard = groups.get(rules.levelRank)?.[0];
    if (wilds.length && (!levelCard || (protectedIds.has(levelCard.id) && !protectedIds.has(wilds[0].id)))) {
      const play = resolvePlays([wilds[0]!], rules)[0]!;
      if (canBeat(play, observation.currentPlay, rules)) moves.push(play);
    }
  }
  for (const template of getPlayTemplates()) {
    if (template.size > hand.length || !templateCanBeat(template, observation.currentPlay, rules)) continue;
    if (protectedIds.size && (template.kind === 'straightFlush' || template.kind === 'jokerBomb')) continue;
    const selected: Card[] = [];
    let missing = 0;
    let impossible = false;
    const deferred: Array<{ cards: Card[]; needed: number }> = [];
    for (const [rank, count] of template.counts) {
      const available = template.suit ? (groups.get(rank) ?? []).filter((card) => card.suit === template.suit) : (groups.get(rank) ?? []);
      // The extra representative may spend a spare wildcard to keep a natural
      // straight flush intact. Canonical candidates still minimize wildcard use.
      const free = protectedIds.size ? available.filter((card) => !protectedIds.has(card.id)) : available;
      const take = Math.min(count, free.length);
      if (rank >= 15 && take !== count) { impossible = true; break; }
      missing += count - take;
      if (!protectedIds.size && missing > wilds.length) { impossible = true; break; }
      selected.push(...free.slice(0, take));
      if (protectedIds.size) deferred.push({ cards: available.filter((card) => protectedIds.has(card.id)), needed: count - take });
    }
    if (impossible) continue;
    for (const entry of deferred) {
      const take = Math.min(entry.needed, entry.cards.length, Math.max(0, missing - wilds.length));
      selected.push(...entry.cards.slice(0, take));
      missing -= take;
    }
    if (missing > wilds.length) continue;
    // A canonical all-one-suit selection may hide a legal ordinary straight.
    // Prefer a natural off-suit card, or use one spare wild with an explicit suit.
    if (template.kind === 'straight' && missing === 0 && selected.every((card) => card.suit === selected[0]!.suit)) {
      let replaced = false;
      for (let i = 0; i < selected.length; i += 1) {
        const alternative = groups.get(selected[i]!.rank)?.find((card) => card.suit !== selected[0]!.suit);
        if (alternative) { selected[i] = alternative; replaced = true; break; }
      }
      if (!replaced && wilds.length) { selected.pop(); missing = 1; }
      else if (!replaced) continue;
    }
    selected.push(...wilds.slice(0, missing));
    // Resolve against only this template; checking every other template for every
    // candidate would turn full-house generation into unnecessary quadratic work.
    moves.push(...resolveTemplate(selected, template, rules));
  }
  return moves;
}
