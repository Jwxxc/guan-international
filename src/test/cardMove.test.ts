import {describe,it,expect} from 'vitest';
import {verticalFixture} from '../../e2e/verticalHandFixtures';
import {cleanGroups,restoreGroups,suggestGroups,groupSelected,ungroupSelected,type HandGroup} from '../hand/arrangement';
import {moveCardToColumn,moveCardsToColumn,moveColumns,movingCardIds,movePreviewLabel} from '../hand/cardMove';
import {verticalGroups} from '../hand/verticalGroups';
const members=(groups:HandGroup[])=>groups.flatMap(g=>g.cardIds).sort();
describe('moving selected cards together',()=>{
 const s=verticalFixture('M'),cards=s.hands[0]!,groups=suggestGroups(cards,s.rules);
 const columns=moveColumns(cards,groups,'rank',s.rules);
 it('takes selected physical cards in visible order only when grabbing a selected card',()=>{
  const selected=['0-C-10','0-H-10','0-S-10','missing'];
  expect(movingCardIds(columns,selected,'0-S-10')).toEqual(columns.flatMap(c=>c.cardIds).filter(id=>selected.includes(id)));
  expect(movingCardIds(columns,selected,'0-S-13')).toEqual(['0-S-13']);
 });
 it('merges cards from several columns atomically, including selected cards already in the target',()=>{
  const target=columns.find(c=>c.cardIds.includes('0-S-13'))!;
  const selected=['0-S-13','0-H-10','0-S-10'],before=JSON.stringify({s,groups});
  const next=moveCardsToColumn(groups,cards,'rank',s.rules,selected,target.key)!;
  expect(next.find(g=>g.id===target.group.id)!.cardIds.slice().sort()).toEqual([...new Set([...target.cardIds,...selected])].sort());
  expect(members(next)).toEqual(cards.map(c=>c.id).sort());
  expect(JSON.stringify({s,groups})).toBe(before);
  expect(movePreviewLabel(cards,s.rules,selected,target)).not.toBe('已在此列');
  const originalRun=columns.find(c=>c.cardIds.includes('0-C-6'))!;
  expect(next.find(g=>g.id===originalRun.group.id)!.cardIds).toEqual(originalRun.cardIds.filter(id=>!selected.includes(id)));
 });
 it('makes one new column for a multi-card move and restores it in one undo without reviving played cards',()=>{
  const selected=['0-H-10','0-S-10','0-C-10'];
  const next=moveCardsToColumn(groups,cards,'rank',s.rules,selected,null)!;
  expect(next.at(-1)!.cardIds.slice().sort()).toEqual(selected.slice().sort());
  expect(members(next)).toEqual(cards.map(c=>c.id).sort());
  expect(restoreGroups([groups],cards)!.groups).toEqual(groups);
  expect(members(restoreGroups([next],cards.filter(c=>c.id!=='0-H-10'))!.groups)).not.toContain('0-H-10');
 });
 it('rejects empty, stale and no-op batches and deduplicates repeated IDs',()=>{
  const target=columns.find(c=>c.cardIds.includes('0-S-13'))!;
  for(const ids of [[],['0-H-10','absent'],target.cardIds])expect(moveCardsToColumn(groups,cards,'rank',s.rules,ids,target.key)).toBeNull();
  expect(moveCardsToColumn(groups,cards,'rank',s.rules,['0-H-10','0-S-10'],'stale-column')).toBeNull();
  const next=moveCardsToColumn(groups,cards,'rank',s.rules,['0-H-10','0-S-10','0-H-10'],target.key)!;
  expect(members(next)).toEqual(cards.map(c=>c.id).sort());
 });
 it('can move all 27 cards without losing IDs or leaving empty source groups',()=>{
  const next=moveCardsToColumn(groups,cards,'rank',s.rules,cards.map(c=>c.id),null)!;
  expect(next).toHaveLength(1);expect(members(next)).toEqual(cards.map(c=>c.id).sort());
  expect(moveCardsToColumn(next,cards,'rank',s.rules,cards.map(c=>c.id),null)).toBeNull();
 });
});
describe('display-only physical card moves',()=>{
 it('moves the real heart 3 into three 4s and preserves every other physical ID',()=>{
  const s=verticalFixture('R'),cards=s.hands[0]!,groups=suggestGroups(cards,s.rules),before=JSON.stringify({s,groups});
  const target=moveColumns(cards,groups,'rank',s.rules).find(c=>c.cardIds.includes('0-S-4'))!;
  const next=moveCardToColumn(groups,cards,'rank',s.rules,'0-H-3',target.key)!;
  expect(members(next)).toEqual(cards.map(c=>c.id).sort());expect(JSON.stringify({s,groups})).toBe(before);
  const bomb=verticalGroups(cards,next,'rank',s.rules).find(g=>g.cards.some(c=>c.id==='0-H-3'))!;
  expect(bomb.label).toBe('炸弹 · 4');expect(bomb.cards.find(c=>c.id==='0-H-3')).toMatchObject({rank:3,suit:'H'});
 });
 it('preserves 6789 as a column after extracting a wildcard, then splits one physical ten from its pair',()=>{
  const s=verticalFixture('M'),cards=s.hands[0]!;let groups=suggestGroups(cards,s.rules);
  const kings=moveColumns(cards,groups,'rank',s.rules).find(c=>c.cardIds.includes('0-S-13'))!;
  groups=moveCardToColumn(groups,cards,'rank',s.rules,'0-H-10',kings.key)!;
  const run=moveColumns(cards,groups,'rank',s.rules).find(c=>c.cardIds.includes('0-C-6'))!;
  expect(run.cardIds).toEqual(['0-S-9','0-H-8','0-C-7','0-C-6']);
  groups=moveCardToColumn(groups,cards,'rank',s.rules,'0-S-10',run.key)!;
  const visible=verticalGroups(cards,groups,'rank',s.rules);
  expect(visible.find(g=>g.cards.some(c=>c.id==='0-H-10'))!.label).toBe('炸弹 · K');
  expect(visible.find(g=>g.cards.some(c=>c.id==='0-C-6'))!.label).toBe('顺子 · 6–10');
  const lone=visible.find(g=>g.cards.some(c=>c.id==='0-C-10'))!;expect(lone.label).toBe('单张 · 10');expect(lone.cards).toHaveLength(1);
  expect(members(groups)).toEqual(cards.map(c=>c.id).sort());
 });
 it('refuses missing/stale IDs and same-column drops without touching groups',()=>{
  const s=verticalFixture('M'),cards=s.hands[0]!,groups=suggestGroups(cards,s.rules),columns=moveColumns(cards,groups,'rank',s.rules);const c=columns[0]!;
  expect(moveCardToColumn(groups,cards,'rank',s.rules,'absent',c.key)).toBeNull();expect(moveCardToColumn(groups,cards,'rank',s.rules,c.cardIds[0]!,'stale-column')).toBeNull();expect(moveCardToColumn(groups,cards,'rank',s.rules,c.cardIds[0]!,c.key)).toBeNull();
 });
 it('supports new single columns, arbitrary groups and undo without reviving played cards',()=>{
  const s=verticalFixture('R'),cards=s.hands[0]!,groups=suggestGroups(cards,s.rules);
  const moved=moveCardToColumn(groups,cards,'rank',s.rules,'0-S-10',null)!;expect(moved.at(-1)!.cardIds).toEqual(['0-S-10']);
  const target=moveColumns(cards,moved,'rank',s.rules).find(c=>c.cardIds.includes('0-S-14'))!;
  const arbitrary=moveCardToColumn(moved,cards,'rank',s.rules,'0-S-10',target.key)!;expect(arbitrary.find(g=>g.id===target.key)!.cardIds).toHaveLength(3);
  const remaining=cards.filter(c=>c.id!=='0-S-10');expect(members(cleanGroups(arbitrary,remaining))).not.toContain('0-S-10');
  expect(members(restoreGroups([moved],remaining)!.groups)).not.toContain('0-S-10');
 });
 it('keeps preexisting cleanGroups semantics unless a manually moved column requests a singleton',()=>{
  const card=verticalFixture('R').hands[0]![0]!;const group:HandGroup={id:'test',kind:'manual',label:'test',cardIds:[card.id]};
  expect(cleanGroups([group],[card])).toEqual([]);expect(cleanGroups([{...group,keepSingle:true}],[card])).toHaveLength(1);
 });
});

it('keeps column identities distinct after moving, regrouping and releasing cards of the same rank',()=>{
 const s=verticalFixture('M'),cards=s.hands[0]!;
 const king=moveColumns(cards,[],'rank',s.rules).find(c=>c.cardIds.includes('0-S-13'))!;
 let groups=moveCardToColumn([],cards,'rank',s.rules,'0-H-10',king.key)!;
 groups=groupSelected(groups,cards,['0-S-13','0-H-13']);groups=ungroupSelected(groups,cards,['0-S-13']);
 const visible=verticalGroups(cards,groups,'rank',s.rules);
 expect(new Set(visible.map(c=>c.id)).size).toBe(visible.length);
 const columns=moveColumns(cards,groups,'rank',s.rules);expect(new Set(columns.map(c=>c.key)).size).toBe(columns.length);
 const target=columns.find(c=>c.cardIds.includes('0-S-13'))!;
 const next=moveCardToColumn(groups,cards,'rank',s.rules,'0-C-10',target.key)!;
 expect(members(next)).toEqual(cards.map(c=>c.id).sort());expect(new Set(next.map(g=>g.id)).size).toBe(next.length);
});
