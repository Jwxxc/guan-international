import { isWild } from '../engine/cards';
import { getPlayTemplates, resolvePlays, resolveTemplate } from '../engine/patterns';
import type { Card, PlayKind, ResolvedPlay, RuleConfig } from '../engine/types';

export interface GroupRecognition { exact?: ResolvedPlay; contained?: ResolvedPlay }
// Subsets of one/two/three cards are too common to describe a mixed column usefully.
const containedKinds = new Set<PlayKind>(['straight','straightFlush','pairs','plate','fullHouse','bomb','jokerBomb']);
const kindOrder: Partial<Record<PlayKind, number>> = { jokerBomb:7, straightFlush:6, bomb:5, plate:4, pairs:3, straight:2, fullHouse:1 };

export function groupPlayLabel(play: ResolvedPlay): string {
  return play.kind === 'bomb' && play.size === 4 ? play.label.replace(/^4\s*张炸弹/, '炸弹') : play.label;
}

/** Only the supplied column, never neighbouring cards or hidden hands. Bounded by rank templates. */
export function recognizeGroup(cards: readonly Card[], rules: RuleConfig, preferred?: { kind?: string; label?: string }): GroupRecognition {
  if (!cards.length || cards.length > 27 || new Set(cards.map(card=>card.id)).size !== cards.length) return {};
  const plays = resolvePlays([...cards], rules);
  const exact = plays.find(play=>play.label===preferred?.label)
    ?? plays.find(play=>play.kind===preferred?.kind)
    ?? plays.find(play=>play.kind==='straightFlush') ?? plays[0];
  if (exact) return { exact };
  if (cards.length < 5) return {};

  const ordered = [...cards].sort((a,b)=>a.id.localeCompare(b.id));
  const wilds = ordered.filter(card=>isWild(card,rules));
  if (wilds.length > 2) return {};
  const naturals = ordered.filter(card=>!isWild(card,rules));
  const ranks = new Map<number, Card[]>();
  for (const card of naturals) ranks.set(card.rank,[...(ranks.get(card.rank) ?? []),card]);
  const candidates: ResolvedPlay[] = [];
  for (const template of getPlayTemplates()) {
    if (!containedKinds.has(template.kind) || template.size >= cards.length) continue;
    const selected: Card[] = [];
    let missing = 0;
    for (const [rank,count] of template.counts) {
      const available = (ranks.get(rank) ?? []).filter(card=>!template.suit || card.suit===template.suit);
      const take = Math.min(available.length,count);
      // Jokers are fixed identities. A heart-level card can never replace one.
      if (rank > 14 && take < count) { missing = 3; break; }
      selected.push(...available.slice(0,take));missing += count-take;
      if (missing > wilds.length) break;
    }
    if (missing > wilds.length) continue;
    if (template.kind === 'straight' && missing === 0 && selected.every(card=>card.suit===selected[0]!.suit)) {
      const replace = selected.findIndex(card=>ranks.get(card.rank)?.some(other=>other.suit!==card.suit));
      if (replace < 0) continue; // Its straight-flush template covers this realization.
      selected[replace] = ranks.get(selected[replace]!.rank)!.find(card=>card.suit!==selected[replace]!.suit)!;
    }
    selected.push(...wilds.slice(0,missing));
    const play = resolveTemplate(selected,template,rules)[0];
    if (play) candidates.push(play);
  }
  // A display description, not a play recommendation: most cards, least wilds,
  // then a stable kind/rank/physical-ID order. Exact whole-column plays always win.
  candidates.sort((a,b)=>b.size-a.size || a.wildcards.length-b.wildcards.length
    || (kindOrder[b.kind] ?? 0)-(kindOrder[a.kind] ?? 0) || b.value-a.value || a.key.localeCompare(b.key));
  return candidates[0] ? { contained:candidates[0] } : {};
}
