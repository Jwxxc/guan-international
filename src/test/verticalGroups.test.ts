import { describe, expect, it } from 'vitest';
import { createDeck } from '../engine/cards';
import { makeRules } from '../engine/rules';
import { groupSelected, suggestGroups, type HandGroup } from '../hand/arrangement';
import { stackOffset, verticalGroupSizing, toggleGroupSelection, verticalGroups } from '../hand/verticalGroups';
import { verticalFixture } from '../../e2e/verticalHandFixtures';
const deck=createDeck(), rules=makeRules(2);
const pick=(rank:number,count:number)=>deck.filter(c=>c.rank===rank).slice(0,count);
describe('vertical display groups',()=>{
 it('preserves every physical identity and input across all fixtures/sorts',()=>{
  for(const name of ['A','B','C','D','E','F','G','H'])for(const sort of ['rank','suit'] as const){
   const cards=verticalFixture(name).hands[0]!,groups=suggestGroups(cards,rules),before=JSON.stringify({cards,groups});
   const result=verticalGroups(cards,groups,sort,rules);
   expect(result.flatMap(g=>g.stacks.flat()).map(c=>c.id).sort()).toEqual(cards.map(c=>c.id).sort());
   expect(new Set(result.map(g=>g.id)).size).toBe(result.length);
   expect(JSON.stringify({cards,groups})).toBe(before);
  }
 });
 it('keeps five-card flush in one natural sequence with a level in its middle',()=>{
  const cards=[3,4,5,6,7].map(rank=>deck.find(c=>c.rank===rank&&c.suit==='D')!);
  const group:HandGroup={id:'flush',cardIds:cards.map(c=>c.id),kind:'straightFlush',label:'同花顺 · 3–7'};
  const [result]=verticalGroups(cards,[group],'rank',makeRules(5));
  expect(result!.stacks).toHaveLength(1);expect(result!.cards.map(c=>c.rank)).toEqual([7,6,5,4,3]);expect(result!.label).toBe('同花顺 · 3–7');
 });
 it('bounds steps for 5–10 card bombs and never splits a legal bomb',()=>{
  for(let n=5;n<=10;n++){
   const cards=[...pick(8,Math.min(8,n)),...deck.filter(c=>c.rank===2&&c.suit==='H').slice(0,Math.max(0,n-8))];
   const groups=groupSelected([],cards,cards.map(c=>c.id));const [group]=verticalGroups(cards,groups,'rank',rules);
   expect(group!.stacks).toHaveLength(1);expect(group!.label).toBe(`${n} 张炸弹 · 8`);expect(stackOffset(n)).toBeGreaterThanOrEqual(22);expect(81+(n-1)*stackOffset(n)).toBeLessThanOrEqual(297);
  }
 });
 it('does not mislabel a level-rank bomb with its strength instead of physical rank',()=>{
  const cards=pick(7,4);expect(verticalGroups(cards,groupSelected([],cards,cards.map(c=>c.id)),'rank',makeRules(7))[0]!.label).toBe('炸弹 · 7');
 });
 it('downgrades a partly played bomb into a truthful remaining pair',()=>{
  const cards=pick(8,4),groups=suggestGroups(cards,rules);
  expect(verticalGroups(cards.slice(0,2),groups,'rank',rules)[0]!.label).toBe('对子 · 8');
 });
 it('keeps arbitrary manual groups neutral and loose singles under one title',()=>{
  const cards=[3,6,9,12].map(rank=>pick(rank,1)[0]!);
  expect(verticalGroups(cards,groupSelected([],cards,cards.map(c=>c.id)),'rank',rules)[0]!.label).toBe('自选分组');
  const loose=verticalGroups(cards,[],'rank',rules);expect(loose).toHaveLength(1);expect(loose[0]!.label).toBe('散牌 · 4');
 });
 it('full/partial toggles preserve selection from other groups',()=>{
  expect(toggleGroupSelection(['x'],['a','b'])).toEqual(['x','a','b']);
  expect(toggleGroupSelection(['x','a'],['a','b'])).toEqual(['x','a','b']);
  expect(toggleGroupSelection(['x','a','b'],['a','b'])).toEqual(['x']);
 });
 it('preserves four-joker physical labels and canonical suit order',()=>{
  const cards=[...deck.filter(c=>c.suit==='J'),...pick(8,4)];const groups=verticalGroups(cards,suggestGroups(cards,rules),'rank',rules);
  expect(groups[0]!.label).toBe('四王炸');expect(groups[0]!.cards.map(c=>c.rank)).toEqual([16,16,15,15]);
  expect(groups[1]!.cards.map(c=>c.suit)).toEqual(['S','H','C','D']);
 });
});

it('uses spare column padding for dense hands without shrinking the 54px faces',()=>{expect(verticalGroupSizing(13,968)).toEqual({width:67,gap:6,compact:true});expect(verticalGroupSizing(10,1198)).toEqual({width:76,gap:10,compact:false});expect(verticalGroupSizing(14,968)).toEqual({width:66,gap:6,compact:true});});
