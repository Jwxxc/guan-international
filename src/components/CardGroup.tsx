import { tx } from '../i18n';
import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cardDetailForWidth } from '../game/cardAppearance';
import type { RuleConfig } from '../engine/types';
import { rankName } from '../engine/rules';
import { groupPlayLabel } from '../hand/groupRecognition';
import { stackOffset, verticalStackHeight, toggleGroupSelection, type VerticalGroup } from '../hand/verticalGroups';
import { stackMoveKey } from '../hand/cardMove';
import { PlayingCard } from './PlayingCard';

/** A display group is never a rule boundary: every card remains independently selectable. */
export function CardGroup({ group, rules, selected, onToggle, onRank, onSelect, readOnly, movingIds, targetKey, onMoveKeyboard, onExtract, faceWidth = 54, baseFaceWidth = faceWidth, stackHeight = Infinity }: {
  group: VerticalGroup; faceWidth?:number; baseFaceWidth?:number; stackHeight?:number; rules: RuleConfig; selected: string[]; onToggle: (id: string)=>void;
  onRank: (rank: number)=>void; onSelect: (ids: string[], preferredPlayKey?: string)=>void; readOnly: boolean; movingIds?: readonly string[]; targetKey?: string | null; onMoveKeyboard?: (id:string,direction:number)=>void; onExtract?: (group:VerticalGroup)=>void;
}) {
  const [focusedId, setFocusedId] = useState(group.cards[0]?.id);
  const focusId = group.cards.some(card=>card.id===focusedId) ? focusedId : group.cards[0]?.id;
  const ids = group.cards.map(card=>card.id);
  const count = ids.filter(id=>selected.includes(id)).length;
  const selection = count === 0 ? 'none' : count === ids.length ? 'all' : 'partial';
  const contained = group.contained;
  const extractLabel = contained ? `拆出${groupPlayLabel(contained)}，${contained.size} 张，原列保留 ${ids.length-contained.size} 张` : '';
  const wildExplanation = contained?.wildcards.map(wild=>`红心 ${rankName(rules.levelRank)} 作 ${rankName(wild.rank)}`).join('；');
  const keyboardCard = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!readOnly && event.altKey && ['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if(!event.repeat)onMoveKeyboard?.(id,event.key==='ArrowLeft'?-1:1); return; }
    const index = ids.indexOf(id);
    const next = event.key === 'ArrowDown' ? Math.min(index+1,ids.length-1) : event.key === 'ArrowUp' ? Math.max(0,index-1) : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length-1 : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation();
    const nodes = event.currentTarget.closest('.card-group')!.querySelectorAll<HTMLButtonElement>('[data-card-id]');
    nodes[next]?.focus();
  };
  return <section className={`card-group ${group.loose ? 'card-group-loose' : ''}`} data-group-id={group.id} data-selection-state={selection} data-explicit-group={group.explicit} data-contained-play={contained?.kind} style={{'--group-columns':group.stacks.length} as CSSProperties} aria-label={tx(group.label)}>
    <button type="button" className="card-group-header" data-testid="card-group-header" disabled={readOnly}
      aria-label={tx(`选择分组：${group.label}，${ids.length} 张${group.hasWild ? '，含逢人配' : ''}，${selection === 'all' ? '全部选中' : selection === 'partial' ? `已选 ${count} 张` : '未选中'}`)}
      aria-pressed={selection === 'partial' ? 'mixed' : selection === 'all'}
      title={tx(contained ? `${group.label}；本列共 ${ids.length} 张。标题选择整列；拆出后可单独选择这手牌。${wildExplanation ? `\n${wildExplanation}` : ''}` : undefined)}
      onClick={event=>{ event.stopPropagation(); if(event.detail <= 1 && !readOnly) { const next=toggleGroupSelection(selected,ids);onSelect(next,next.length===ids.length && ids.every(id=>next.includes(id)) ? group.play?.key : undefined); } }}
      onDoubleClick={event=>{event.preventDefault();event.stopPropagation();}}
      onKeyDown={event=>{ if(event.repeat && (event.key==='Enter'||event.key===' '))event.preventDefault(); }}>
      <span>{tx(group.label)}</span><i className="card-group-selection" aria-hidden="true">{tx(selection === 'all' ? '✓' : selection === 'partial' ? '·' : '')}</i>
    </button>
    {tx(contained && onExtract && !readOnly && <button type="button" className="card-group-extract" data-testid="extract-contained-group"
      aria-label={tx(extractLabel)} title={tx(`${extractLabel}${wildExplanation ? `；${wildExplanation}` : ''}。仅整理，不选牌或出牌。`)}
      onClick={event=>{event.stopPropagation();if(event.detail<=1)onExtract(group);}}
      onDoubleClick={event=>{event.preventDefault();event.stopPropagation();}}
      onKeyDown={event=>{if(event.repeat&&(event.key==='Enter'||event.key===' '))event.preventDefault();}}>
      {tx("拆出")}{tx(contained.size)} {tx("张")}<span aria-hidden="true">↗</span>
    </button>)}
    <div className="card-group-stacks">{tx(group.stacks.map(stack=>{
      const heightBudget = contained ? verticalStackHeight(stack.length,baseFaceWidth) : stackHeight;
      const offset = stackOffset(stack.length,faceWidth,heightBudget);
      return <div key={stack[0]!.id} className="hand-column hand-column-cards" data-move-target={stackMoveKey(group,stack)} data-drop-active={targetKey===stackMoveKey(group,stack)||undefined} style={{'--stack-offset':`${offset}px`,'--hand-rank-size':`${Math.min(offset-7,Math.round(16*faceWidth/54))}px`} as CSSProperties}>
      {tx(stack.map((card,index)=><PlayingCard key={card.id} card={card} rules={rules} detail={cardDetailForWidth(faceWidth)} jokerExposure={index < stack.length - 1 ? 'top' : 'full'} jokerStrip={offset} interactive title={tx(!readOnly ? '按住片刻后拖动移牌；拖动已选牌会一起移动全部选中牌。快速划过选牌，Alt＋拖动可直接移牌。' : undefined)} style={movingIds?.includes(card.id) ? {opacity:.28} : undefined} selected={selected.includes(card.id)} tabIndex={readOnly ? -1 : card.id===focusId ? 0 : -1} onFocus={()=>setFocusedId(card.id)} onKeyDown={event=>keyboardCard(event,card.id)} onClick={()=>{if(!readOnly)onToggle(card.id);}} onDoubleClick={()=>{if(!readOnly)onRank(card.rank);}}/>))}
    </div>;}))}</div>
  </section>;
}
