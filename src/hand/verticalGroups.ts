import { isWild } from '../engine/cards';
import { rankName } from '../engine/rules';
import type { Card, ResolvedPlay, RuleConfig } from '../engine/types';
import { cleanGroups, sortHand, type HandGroup, type SortMode } from './arrangement';
import { groupPlayLabel, recognizeGroup } from './groupRecognition';

export interface VerticalGroup {
  id: string; label: string; cards: Card[]; stacks: Card[][]; explicit: boolean; loose: boolean; hasWild: boolean; play?: ResolvedPlay; contained?: ResolvedPlay;
}
export function stackOffset(size: number, faceWidth = 54, heightBudget = Infinity): number {
  const preferred = (size <= 4 ? 30 : size <= 6 ? 28 : 24) + (size <= 6 ? Math.round((faceWidth - 54) / 2) : 0);
  return size < 2 ? preferred : Math.max(24, Math.min(preferred, Math.floor((heightBudget - Math.round(faceWidth * 1.5)) / (size - 1))));
}
export function verticalStackHeight(size: number, faceWidth: number): number {
  return Math.round(faceWidth * 1.5) + Math.max(0, size - 1) * stackOffset(size, faceWidth);
}
/** Use column padding before asking the user to scroll; card faces never shrink. */
export function verticalGroupSizing(columns: number, available: number, preferredFace = 54): { width: number; gap: number; compact: boolean } {
  const preferredColumn = preferredFace + 22;
  const preferredGap = available < 1050 ? 8 : available < 1230 ? 10 : 12;
  if (!columns || columns * preferredColumn + (columns - 1) * preferredGap + 14 <= available) return { width: preferredColumn, gap: preferredGap, compact: false };
  const gap = 6;
  const width = Math.max(66, Math.min(preferredColumn, Math.floor((available - 14 - (columns - 1) * gap) / columns)));
  return { width, gap, compact: true };
}
/** Reinvest one third of face-to-face whitespace without increasing the shelf footprint. */
export function verticalHandSizing(groups: readonly VerticalGroup[], available: number, preferredFace: number) {
  const stacks = groups.flatMap(group => group.stacks);
  const sizing = verticalGroupSizing(stacks.length, available, preferredFace);
  const baseFaceWidth = Math.max(54, Math.min(preferredFace, sizing.width - 12));
  const tallest = Math.max(1, ...stacks.map(stack => stack.length));
  const stackHeight = verticalStackHeight(tallest, baseFaceWidth);
  let heightLimit = Math.floor((stackHeight - (tallest - 1) * 24) / 1.5);
  // A contained play has an extra control above its cards: keep that group's own height.
  for (const group of groups.filter(group => group.contained)) {
    const size = Math.max(...group.stacks.map(stack => stack.length));
    heightLimit = Math.min(heightLimit, Math.floor((verticalStackHeight(size, baseFaceWidth) - (size - 1) * 24) / 1.5));
  }
  const whitespace = sizing.width + sizing.gap - baseFaceWidth;
  const faceWidth = Math.max(baseFaceWidth, Math.min(baseFaceWidth + Math.round(whitespace / 3), sizing.width - 8, heightLimit));
  return { ...sizing, baseFaceWidth, faceWidth, stackHeight };
}
function chunks(cards: Card[], max: number): Card[][] {
  const result: Card[][] = [];
  for (let i = 0; i < cards.length; i += max) result.push(cards.slice(i, i + max));
  return result;
}
/** Own-hand presentation only. Neither grouping metadata nor resolved labels are submitted as actions. */
export function verticalGroups(cards: readonly Card[], groups: readonly HandGroup[], sort: SortMode, rules: RuleConfig): VerticalGroup[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const valid = cleanGroups(groups, cards);
  const assigned = new Set(valid.flatMap(group => group.cardIds));
  const make = (id: string, values: Card[], explicit: boolean, fallback: string, loose = false, kind?: HandGroup['kind']): VerticalGroup => {
    const { exact:play, contained } = !loose && kind !== 'wild' ? recognizeGroup(values,rules,{kind,label:fallback}) : {};
    let ordered = sortHand(values, sort, rules.levelRank);
    if (play && ['straight', 'straightFlush', 'pairs', 'plate'].includes(play.kind)) {
      // Runs follow their resolved natural sequence, even when the level is in its middle.
      // Wildcards keep their real face/ID; the mapping only determines display position.
      const ranks = new Map(play.wildcards.map(mapping => [mapping.cardId, mapping.rank]));
      const sequenceRank = (card: Card) => { const rank = ranks.get(card.id) ?? card.rank; return rank === 14 && play.value <= 5 ? 1 : rank; };
      ordered = sortHand(values, 'rank', rules.levelRank).sort((a,b) => sequenceRank(b) - sequenceRank(a));
    }
    return { id, label: play ? groupPlayLabel(play) : contained ? `含${groupPlayLabel(contained)}` : fallback.startsWith('含') ? '自选分组' : fallback, cards: ordered, stacks: chunks(ordered, loose ? 4 : 10), explicit, loose, hasWild: values.some(card => isWild(card, rules)), play, contained };
  };
  const result = valid.map(group => make(group.id, group.cardIds.map(id => byId.get(id)!), true, group.kind === 'loose' ? `散牌 · ${group.cardIds.length}` : group.label, group.kind === 'loose', group.kind));
  const remaining = sortHand(cards.filter(card => !assigned.has(card.id)), sort, rules.levelRank);
  const buckets = new Map<string, Card[]>();
  for (const card of remaining) {
    const key = sort === 'suit' ? `suit:${card.suit}` : `rank:${card.rank}`;
    buckets.set(key, [...(buckets.get(key) ?? []), card]);
  }
  const singles: Card[] = [];
  for (const [id, values] of buckets) {
    if (values.length === 1) { singles.push(...values); continue; }
    result.push(make(`natural:${id}:${values.map(card=>card.id).join('|')}`, values, false, `散牌 · ${values.length}`, sort === 'suit'));
  }
  if (singles.length === 1) result.push(make(`single:${singles[0]!.id}`, singles, false, `单张 · ${rankName(singles[0]!.rank)}`));
  else if (singles.length) result.push(make(`loose:${singles.map(card=>card.id).join('|')}`, singles, false, `散牌 · ${singles.length}`, true));
  return result;
}
export function toggleGroupSelection(selected: readonly string[], ids: readonly string[]): string[] {
  const members = new Set(ids);
  return ids.every(id => selected.includes(id)) ? selected.filter(id => !members.has(id)) : [...new Set([...selected, ...ids])];
}
