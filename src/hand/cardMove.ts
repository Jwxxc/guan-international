import type { Card, RuleConfig } from '../engine/types';
import { cleanGroups, type HandGroup, type SortMode } from './arrangement';
import { groupPlayLabel, recognizeGroup } from './groupRecognition';
import { verticalGroups, type VerticalGroup } from './verticalGroups';

export interface MoveColumn { key: string; cardIds: string[]; group: HandGroup }
export const stackMoveKey = (group: VerticalGroup, stack: readonly Card[]): string =>
  group.loose && !group.explicit ? `column:${group.id}:${stack[0]!.id}` : group.id;

/** Freeze currently visible loose columns so moving a card cannot spill 9 into another stack. */
export function moveColumns(cards: readonly Card[], groups: readonly HandGroup[], sort: SortMode, rules: RuleConfig): MoveColumn[] {
  const originals = new Map(cleanGroups(groups, cards).map(group => [group.id, group]));
  const reserved = new Set(originals.keys());
  return verticalGroups(cards, groups, sort, rules).flatMap(visible => {
    const parts = visible.loose && !visible.explicit ? visible.stacks : [visible.cards];
    return parts.map(part => {
      const key = stackMoveKey(visible, part), cardIds = part.map(card => card.id);
      let original = originals.get(key);
      if (!original) {
        let id = `pinned:${key}`;
        while (reserved.has(id)) id += ':next';
        reserved.add(id);
        original = { id, cardIds, kind: visible.loose ? 'loose' : 'manual', label: visible.label };
      }
      return { key, cardIds, group: { ...original, cardIds, keepSingle: true } };
    });
  });
}
function classify(id: string, cardIds: string[], cards: readonly Card[], rules: RuleConfig): HandGroup {
  const members = cards.filter(card => cardIds.includes(card.id));
  const { exact:play, contained } = recognizeGroup(members,rules);
  const supported = ['bomb','straightFlush','jokerBomb','triple','pair','straight'];
  return { id, cardIds, keepSingle: true, kind: play && supported.includes(play.kind) ? play.kind as HandGroup['kind'] : 'manual', label: play?.label ?? (contained ? `含${groupPlayLabel(contained)}` : '自选分组') };
}
/** Use visual order, independent of the order in which cards were selected. */
export function movingCardIds(columns: readonly MoveColumn[], selected: readonly string[], grabbedId: string): string[] {
  const ids = columns.flatMap(column => column.cardIds);
  return ids.filter(id => selected.includes(grabbedId) ? selected.includes(id) : id === grabbedId);
}
export function movePreviewLabel(cards: readonly Card[], rules: RuleConfig, cardIds: readonly string[], target?: MoveColumn | null): string {
  if (target && cardIds.every(id => target.cardIds.includes(id))) return '已在此列';
  if (target === undefined) return '拖到目标列，松开后合并';
  if (target === null) return '松开后单独放成一列';
  const ids = [...new Set([...target.cardIds, ...cardIds])];
  const group = classify('preview', ids, cards, rules);
  if (group.label.startsWith('含')) return `放入此列 · ${group.label}，可拆出`;
  return group.label === '自选分组' ? `放入自选分组 · ${ids.length} 张` : `松开组成${group.label}`;
}
/** Explicitly extract a recognized subset; one undoable display edit with fresh ID/key checks. */
export function extractContainedGroup(groups: readonly HandGroup[], cards: readonly Card[], rules: RuleConfig, groupId: string, playKey: string): HandGroup[] | null {
  const valid = cleanGroups(groups,cards);
  const source = valid.find(group=>group.id===groupId);
  if (!source) return null;
  const play = recognizeGroup(cards.filter(card=>source.cardIds.includes(card.id)),rules,source).contained;
  if (!play || play.key !== playKey) return null;
  const ids = play.cards.map(card=>card.id);
  const remaining = source.cardIds.filter(id=>!ids.includes(id));
  const residual = classify(source.id,remaining,cards,rules);
  if (residual.label === '自选分组') { residual.kind='loose';residual.label=`散牌 · ${remaining.length}`; }
  let extractedId = `extracted:${ids.join('|')}`;
  while (valid.some(group=>group.id===extractedId)) extractedId += ':next';
  const extracted = classify(extractedId,ids,cards,rules);
  // Retain the resolved interpretation when these same wildcards admit several runs.
  extracted.label = play.label;
  const supported = ['bomb','straightFlush','jokerBomb','triple','pair','straight'];
  extracted.kind = supported.includes(play.kind) ? play.kind as HandGroup['kind'] : 'manual';
  return cleanGroups(valid.flatMap(group=>group===source ? [residual,extracted] : [group]),cards);
}
/** One immutable display transaction. No GameState, engine action or hidden hand is involved. */
export function moveCardToColumn(groups: readonly HandGroup[], cards: readonly Card[], sort: SortMode, rules: RuleConfig, cardId: string, targetKey: string | null): HandGroup[] | null {
  return moveCardsToColumn(groups, cards, sort, rules, [cardId], targetKey);
}
export function moveCardsToColumn(groups: readonly HandGroup[], cards: readonly Card[], sort: SortMode, rules: RuleConfig, cardIds: readonly string[], targetKey: string | null): HandGroup[] | null {
  const moving = new Set(cardIds);
  // Reject the whole stale transaction rather than moving only a surviving subset.
  if (!moving.size || [...moving].some(id => !cards.some(card => card.id === id))) return null;
  const columns = moveColumns(cards, groups, sort, rules);
  const orderedIds = columns.flatMap(column => column.cardIds).filter(id => moving.has(id));
  const target = targetKey === null ? null : columns.find(column => column.key === targetKey);
  if (orderedIds.length !== moving.size || target === undefined || (target && orderedIds.every(id => target.cardIds.includes(id)))) return null;
  const last = columns.at(-1);
  if (target === null && last?.cardIds.length === moving.size && last.cardIds.every(id => moving.has(id))) return null;
  const result = columns.flatMap(column => {
    if (column === target) return [classify(column.group.id, [...column.cardIds, ...orderedIds.filter(id => !column.cardIds.includes(id))], cards, rules)];
    const remaining = column.cardIds.filter(id => !moving.has(id));
    if (remaining.length === column.cardIds.length) return [{ ...column.group, cardIds: [...column.cardIds] }];
    if (!remaining.length) return [];
    return [column.group.kind === 'loose' && remaining.length > 1
      ? { ...column.group, cardIds: remaining, label: `散牌 · ${remaining.length}` }
      : classify(column.group.id, remaining, cards, rules)];
  });
  if (target === null) {
    let id = `moved:${orderedIds.join('|')}`;
    while (result.some(group => group.id === id)) id += ':next';
    result.push(classify(id, orderedIds, cards, rules));
  }
  return cleanGroups(result, cards);
}
