import { tx } from '../i18n';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardDetailForWidth } from '../game/cardAppearance';
import { moveColumns, movePreviewLabel, movingCardIds } from '../hand/cardMove';
import { useCardMove } from '../hand/useCardMove';
import type { Card, RuleConfig } from '../engine/types';
import { cleanGroups, orderGroupedHand, type HandGroup, type HandLayout, type SortMode } from '../hand/arrangement';
import { PlayingCard } from './PlayingCard';
import { CardGroup } from './CardGroup';
import { verticalGroups, verticalHandSizing, type VerticalGroup } from '../hand/verticalGroups';
import '../styles/vertical-hand.css';
import { useDragSelection } from '../hand/useDragSelection';

export { sortHand } from '../hand/arrangement';
export type { SortMode } from '../hand/arrangement';
const HAND_SCALE = .75;

export function Hand({ cards, rules, selected, sort, layout = 'single', groups = [], onToggle, onRank, onSelect, readOnly = false, onMoveCards, onExtractGroup, interactionKey = '' }: {
  cards: Card[]; rules: RuleConfig; selected: string[]; sort: SortMode; layout?: HandLayout; groups?: HandGroup[];
  onToggle: (cardId: string) => void; onRank: (rank: number) => void; onSelect: (ids: string[], preferredPlayKey?: string) => void; readOnly?: boolean; onMoveCards?: (cardIds:string[],targetKey:string|null)=>boolean; onExtractGroup?: (groupId:string,playKey:string)=>boolean; interactionKey?: string | number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1100 : Math.max(280, window.innerWidth - 100));
  const [viewportHeight,setViewportHeight]=useState(()=>typeof window==='undefined'?720:window.innerHeight);
  useLayoutEffect(() => {
    const element = host.current; if (!element) return;
    const update = () => { setWidth(element.clientWidth);setViewportHeight(window.innerHeight); };
    update(); const observer = new ResizeObserver(update); observer.observe(element);window.addEventListener('resize',update);
    return () => {observer.disconnect();window.removeEventListener('resize',update);};
  }, []);
  const validGroups = useMemo(() => cleanGroups(groups, cards), [groups, cards]);
  const ordered = useMemo(() => orderGroupedHand(cards, validGroups, sort, rules.levelRank), [cards, validGroups, sort, rules.levelRank]);
  const groupById = useMemo(() => new Map(validGroups.flatMap((group, index) => group.cardIds.map(id => [id, { group, index }] as const))), [validGroups]);
  const baseFaceWidth = layout === 'single' ? width < 1050 ? 100 : width < 1200 ? 108 : 116 : layout === 'double' ? 82 : 72;
  const rowFaceWidth = baseFaceWidth * HAND_SCALE;
  const maxPerRow = Math.max(1, Math.floor((width - baseFaceWidth) / 32) + 1);
  const rowSize = Math.min(layout === 'double' ? Math.ceil(cards.length / 2) : cards.length, maxPerRow) || 1;
  const rows: Card[][] = [];
  for (let index = 0; index < ordered.length; index += rowSize) rows.push(ordered.slice(index, index + rowSize));
  const columns = useMemo(() => layout === 'vertical' ? verticalGroups(cards, validGroups, sort, rules) : [], [cards, validGroups, sort, rules, layout]);
  const columnCount = columns.reduce((count, group) => count + group.stacks.length, 0);
  const preferredFace=viewportHeight>=1000?84:viewportHeight>=880?72:viewportHeight>=780?64:54;
  const sizing = verticalHandSizing(columns, width,preferredFace);
  const faceWidth=layout==='vertical'?sizing.faceWidth:rowFaceWidth;
  const faceHeight=Math.round(faceWidth*1.5);
  const movementColumns = useMemo(() => layout === 'vertical' ? moveColumns(cards,validGroups,sort,rules) : [],[cards,validGroups,sort,rules,layout]);
  const layoutKey = `${interactionKey}:${layout}:${sort}:${width}:${viewportHeight}:${faceWidth}:${ordered.map(card=>card.id).join(',')}:${validGroups.map(group=>group.cardIds.join(',')).join('|')}`;
  const { dragMode, cancelGesture, ...dragEvents } = useDragSelection({
    host, selected, cardIds: cards.map(card => card.id), onSelect, disabled: readOnly,
    layoutKey,
  });
  const movement = useCardMove({host,columns:movementColumns,selected,layoutKey,enabled:layout==='vertical'&&!readOnly&&!!onMoveCards,cancelPaint:cancelGesture,onMove:(ids,key)=>onMoveCards?.(ids,key)??false});
  const previewCards = movement.preview?.cardIds.slice(0,3).flatMap(id=>cards.filter(card=>card.id===id)) ?? [];
  const dropLabel = useMemo(()=>movement.preview ? movePreviewLabel(cards,rules,movement.preview.cardIds,movement.preview.targetKey===null?null:movementColumns.find(column=>column.key===movement.preview!.targetKey)) : '',[cards,rules,movementColumns,movement.preview?.cardIds,movement.preview?.targetKey]);
  const keyboardMove = (id:string,direction:number) => {
    const index=movementColumns.findIndex(column=>column.cardIds.includes(id));const target=movementColumns[index+direction];
    if(!readOnly&&target&&onMoveCards?.(movingCardIds(movementColumns,selected,id),target.key))requestAnimationFrame(()=>host.current?.querySelector<HTMLButtonElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus());
  };
  const extractGroup = (group:VerticalGroup) => {
    if (readOnly || !group.contained || !onExtractGroup?.(group.id,group.contained.key)) return;
    const id=group.contained.cards[0]!.id;
    requestAnimationFrame(()=>host.current?.querySelector(`[data-card-id="${CSS.escape(id)}"]`)?.closest('.card-group')?.querySelector<HTMLButtonElement>('.card-group-header')?.focus());
  };
  const renderCard = (card: Card, covered: boolean, step: number) => <PlayingCard key={card.id} card={card} rules={rules} detail={cardDetailForWidth(faceWidth)} jokerExposure={covered ? 'left' : 'full'} jokerStrip={step} interactive selected={selected.includes(card.id)} onClick={() => { if (!readOnly) onToggle(card.id); }} onDoubleClick={() => { if (!readOnly) onRank(card.rank); }}/>;
  return <div ref={host} {...dragEvents}
    onPointerDown={event=>{if(!movement.onPointerDown(event))dragEvents.onPointerDown(event);}}
    onClickCapture={event=>{movement.onClickCapture(event);if(!event.isPropagationStopped())dragEvents.onClickCapture(event);}}
    onDoubleClickCapture={event=>{movement.onDoubleClickCapture(event);if(!event.isPropagationStopped())dragEvents.onDoubleClickCapture(event);}}
    onLostPointerCapture={event=>{movement.onLostPointerCapture(event);dragEvents.onLostPointerCapture(event);}}
    data-moving={movement.preview?.cardId} onDragStart={event => event.preventDefault()} onClick={event => { if (!readOnly && event.target instanceof Element && !event.target.closest('[data-card-id], .card-group-header')) onSelect([]); }} className={`hand hand-display-${layout} ${layout !== 'vertical' && rows.length > 1 ? 'hand-two-rows' : ''}`} style={{ '--hand-card-width': `${faceWidth}px`, ...(layout === 'vertical' ? { '--vertical-face-height': `${faceHeight}px`, '--card-group-width': `${sizing.width}px`, '--card-group-gap': `${sizing.gap}px` } : {}) } as React.CSSProperties} data-testid="hand" data-layout={layout} data-dragging={dragMode ?? undefined} data-column-count={layout === 'vertical' ? columnCount : undefined} data-density={layout === 'vertical' ? sizing.compact ? 'compact' : 'normal' : undefined} data-automatic-rows={layout === 'single' && rows.length > 1 ? rows.length : undefined} aria-label={tx(`你的手牌，共 ${cards.length} 张，按住鼠标划过可连续选牌`)}>
    {tx(layout === 'vertical' ? <div className="hand-columns card-groups" aria-label={tx(validGroups.length ? '已整理的分组' : '手牌分列')}>
      {tx(columns.map(group => <CardGroup key={group.id} faceWidth={faceWidth} baseFaceWidth={sizing.baseFaceWidth} stackHeight={sizing.stackHeight} group={group} rules={rules} selected={selected} onToggle={onToggle} onRank={onRank} onSelect={onSelect} readOnly={readOnly} movingIds={movement.preview?.cardIds} targetKey={movement.preview?.targetKey} onMoveKeyboard={keyboardMove} onExtract={onExtractGroup ? extractGroup : undefined}/>))}
    </div> : rows.map((row, index) => {
      const step = row.length < 2 ? faceWidth : Math.min(rows.length > 1 ? 64 : 49, Math.floor((width - baseFaceWidth) / (row.length - 1))) * HAND_SCALE;
      return <div className="hand-row" key={index} style={{ '--card-count': row.length, '--card-step': `${step}px` } as React.CSSProperties}>
        {tx(row.map((card, cardIndex) => {
          const membership = groupById.get(card.id);
          const startsGroup = membership && membership.group.id !== groupById.get(row[cardIndex - 1]?.id ?? '')?.group.id;
          return <div key={card.id} className={`hand-card-slot ${membership ? 'has-hand-group' : ''} ${startsGroup ? 'starts-hand-group' : ''}`} data-group-id={membership?.group.id} style={membership ? { '--group-color': `var(--group-color-${membership.index % 3})` } as React.CSSProperties : undefined}>
            {tx(renderCard(card, cardIndex < row.length - 1 && step < faceWidth, step))}{tx(membership && <span className="hand-group-line" aria-hidden="true"/>)}
          </div>;
        }))}
      </div>;
    }))}
    {tx(movement.preview && createPortal(<div className="card-move-preview" data-testid="card-move-preview" data-move-count={movement.preview.cardIds.length} style={{left:Math.max(8,Math.min(movement.preview.x+14,window.innerWidth-210)),top:Math.max(8,Math.min(movement.preview.y-20,window.innerHeight-165))}}>
      <div className="card-move-preview-cards" aria-hidden="true">{tx(previewCards.map((card,index)=><PlayingCard key={card.id} card={card} rules={rules} detail="small" style={{left:index*26,top:index*4}}/>))}</div>
      <span role="status"><strong>{tx("移动")}{tx(movement.preview.cardIds.length)} {tx("张")}</strong>{tx(dropLabel)}</span>
    </div>,document.body))}
    {tx(cards.length === 0 && <div className="hand-finished">{tx("已出完全部手牌，静候对家。")}</div>)}
  </div>;
}
