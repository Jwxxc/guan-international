import { tx } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import type { Card, RuleConfig } from '../engine/types';
import { cleanGroups, findStraights, findStraightFlushes, groupSelected, readHandView, restoreGroups, suggestGroups, ungroupSelected, writeHandView, type HandGroup, type HandView } from '../hand/arrangement';
import { extractContainedGroup, moveCardsToColumn } from '../hand/cardMove';
import { Hand } from './Hand';
import { HandLayoutPicker } from './HandLayoutPicker';
import { Modal } from './Modal';
import { needsGestureHelp, rememberGestureHelp } from '../hand/gestureHelp';
import '../styles/hand.css';
import '../styles/hand-organizer.css';
import '../styles/readability.css';

interface HandPanelProps {
  cards: Card[]; rules: RuleConfig; selected: string[]; onToggle: (id: string) => void; tutorialEnabled?: boolean;
  onRank: (rank: number) => void; onSelect: (ids: string[], preferredPlayKey?: string) => void; handId: string; finished: boolean; readOnly?: boolean; toolbarTarget?: HTMLElement | null; interactionKey?: string | number;
}

/** Re-mounting by handId prevents arrangement/undo from leaking into a new deal. */
export function HandPanel(props: HandPanelProps) { return <HandPanelContent key={props.handId} {...props}/>; }

function HandPanelContent({ cards, rules, selected, onToggle, onRank, onSelect, finished, readOnly = false, tutorialEnabled = true, toolbarTarget, interactionKey }: HandPanelProps) {
  const [view, setView] = useState<HandView>(readHandView);
  const [arrangement, setArrangement] = useState<{ groups: HandGroup[]; history: HandGroup[][] }>({ groups: [], history: [] });
  const [smartRestore, setSmartRestore] = useState<HandGroup[] | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (view.layout !== 'vertical' || !notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice, view.layout, arrangement]);
  const [flushIndex, setFlushIndex] = useState(0);
  const [straightIndex, setStraightIndex] = useState(0);
  const quickRunCursor = useRef({ handKey: '', index: 0 });
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [gestureHelp, setGestureHelp] = useState(false);
  const gestureHelpRef = useRef<HTMLElement>(null);
  const dismissGestureHelp = useCallback(() => {
    const tip = gestureHelpRef.current;
    if (tip?.contains(document.activeElement)) tip.closest<HTMLElement>('.play-area')?.focus();
    rememberGestureHelp(); setGestureHelp(false);
  }, []);
  useEffect(() => {
    if (!readOnly && tutorialEnabled && !finished && cards.length && view.layout === 'vertical' && needsGestureHelp()) setGestureHelp(true);
  }, [readOnly, tutorialEnabled, finished, cards.length, view.layout]);
  const showGestureHelp = gestureHelp && !readOnly && tutorialEnabled && !organizerOpen && !finished;
  useEffect(() => {
    if (!showGestureHelp) return;
    const timer = window.setTimeout(dismissGestureHelp, 14000);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissGestureHelp(); } };
    document.addEventListener('keydown', escape, true);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', escape, true); };
  }, [showGestureHelp, dismissGestureHelp]);
  const closeOrganizer = useCallback(() => setOrganizerOpen(false), []);
  const openOrganizer = (event: MouseEvent<HTMLButtonElement>) => {
    // Safari does not always focus a clicked button. Give Modal a stable return target.
    event.currentTarget.focus();
    setOrganizerOpen(true);
  };
  const groups = useMemo(() => cleanGroups(arrangement.groups, cards), [arrangement.groups, cards]);
  const flushes = useMemo(() => findStraightFlushes(cards, rules), [cards, rules]);
  const straights = useMemo(() => findStraights(cards, rules), [cards, rules]);
  // Ordinary runs first; keep a straight flush's actual interpretation and ID.
  const quickRuns = useMemo(() => [...straights, ...flushes], [straights, flushes]);
  const validSelected = selected.filter(id => cards.some(card => card.id === id));
  const hasSelectedGroup = groups.some(group => group.cardIds.some(id => selected.includes(id)));
  const updateView = (next: HandView) => { if (next.layout !== 'vertical') setGestureHelp(false); setView(next); writeHandView(next); setNotice(''); };
  const changeGroups = (next: HandGroup[], message: string) => {
    setSmartRestore(null);
    setArrangement(previous => ({ groups: next, history: [...previous.history, cleanGroups(previous.groups, cards)].slice(-20) }));
    setNotice(message);
  };
  const extractGroup = (groupId:string,playKey:string) => {
    if (readOnly || organizerOpen) return false;
    const next=extractContainedGroup(groups,cards,rules,groupId,playKey);
    if (!next) return false;
    changeGroups(next,'已拆成独立牌组，其余牌留在原列；选牌保持不变。');
    return true;
  };
  const smartArrange = () => {
    if (smartRestore !== null) { changeGroups(cleanGroups(smartRestore, cards), '已恢复理牌前的分组。'); return; }
    const previous = cleanGroups(groups, cards);
    changeGroups(suggestGroups(cards, rules), '已按推荐方案整理');
    setSmartRestore(previous);
  };
  const undo = () => {
    setSmartRestore(null);
    setArrangement(previous => restoreGroups(previous.history, cards) ?? previous);
    setNotice('已撤销上次理牌，选中的牌保持不变。');
  };
  const findFlush = () => {
    if (!flushes.length) { setNotice('当前手牌没有可组成的同花顺。'); return; }
    const index = flushIndex % flushes.length; const candidate = flushes[index]!;
    onSelect(candidate.cardIds, candidate.playKey); setFlushIndex(index + 1);
    setNotice(`同花顺 ${index + 1}/${flushes.length} · ${candidate.label}${candidate.wildCount ? ` · 使用 ${candidate.wildCount} 张逢人配` : ''}，请确认后出牌。`);
  };
  const findStraight = () => {
    if (!straights.length) { setNotice('当前手牌没有可组成的普通顺子，可试试找同花顺。'); return; }
    const index = straightIndex % straights.length; const candidate = straights[index]!;
    onSelect(candidate.cardIds, candidate.playKey); setStraightIndex(index + 1);
    setNotice(`顺子 ${index + 1}/${straights.length} · ${candidate.label}${candidate.wildCount ? ` · 使用 ${candidate.wildCount} 张逢人配` : ''}，请确认后出牌。`);
  };
  const findQuickRun = () => {
    if (readOnly || !cards.length) return;
    if (!quickRuns.length) { setNotice('当前手牌没有可组成的顺子。'); return; }
    const handKey = `${rules.levelRank}:${cards.map(card => card.id).sort().join('|')}`;
    const index = (quickRunCursor.current.handKey === handKey ? quickRunCursor.current.index : 0) % quickRuns.length;
    const candidate = quickRuns[index]!;
    quickRunCursor.current = { handKey, index: index + 1 };
    onSelect(candidate.cardIds, candidate.playKey);
    setNotice(`${index + 1}/${quickRuns.length} · ${candidate.label}${candidate.wildCount ? ` · 使用 ${candidate.wildCount} 张逢人配` : ''}；再点“顺子”切换。`);
  };
  const runAndClose = (action: () => void) => { action(); closeOrganizer(); };
  const toolbar =     <div className="hand-toolbar hand-toolbar-compact">
      <div className="hand-owner"><span className="hand-owner-dot"/><strong>{tx("我的手牌")}</strong><span><b>{tx(cards.length)}</b> {tx("张")}</span>{tx(!readOnly && <button type="button" className="hand-more-button" onClick={openOrganizer} aria-label={tx("更多理牌")} title={tx("分组、同花顺与撤销整理")} aria-haspopup="dialog" aria-expanded={organizerOpen} data-testid="hand-organize-trigger"><MoreHorizontal size={13}/></button>)}{tx(finished && <em>{tx("已出完")}</em>)}</div>
      {tx(!readOnly && <div className="hand-tools" role="group" aria-label={tx("理牌工具")}>
        <button type="button" className="hand-smart-button" data-testid="smart-arrange" disabled={!cards.length} aria-pressed={smartRestore !== null} onClick={smartArrange} title={tx(smartRestore !== null ? '恢复点击一键理牌前的分组；已出掉的牌不会恢复' : '建议分组，再次点击恢复理牌前；不自动出牌')}><span aria-hidden="true">✦</span> {tx(smartRestore !== null ? '恢复理牌前' : '一键理牌')}</button>

        <button type="button" onClick={findQuickRun} disabled={!cards.length} data-testid="hand-straight-trigger" title={tx("预选手里的顺子，包含逢人配；再次点击切换，同花顺单独标明")}>{tx("顺子")}</button>
      </div>)}
      {tx(view.layout === 'vertical' && notice && <p className="vertical-hand-notice" data-testid="hand-notice" role="status" title={tx(notice)}>{tx(notice)}</p>)}
      <HandLayoutPicker layout={view.layout} onChange={layout => updateView({ ...view, layout })}/>
    </div>;
  return <div className={`hand-workspace ${view.layout === 'vertical' ? 'vertical-workspace' : ''}`} data-testid="hand-workspace">
    {tx(showGestureHelp && <aside ref={gestureHelpRef} className="hand-gesture-help" aria-label={tx("竖排操作提示")} data-testid="hand-gesture-help" onKeyDown={event => event.stopPropagation()}>
      <strong>{tx("竖排小技巧")}</strong><p role="status">{tx("快速划过选牌，按住片刻再拖动移牌。")}</p>
      <span>{tx("先选多张，再按住其中一张拖动，可一起移牌。出牌仍由你确认。")}</span><button type="button" onClick={dismissGestureHelp}>{tx("知道了")}</button>
    </aside>)}
    {tx(toolbarTarget ? createPortal(<div className="hand-toolbar-dock" data-layout={view.layout}>{tx(toolbar)}</div>, toolbarTarget) : toolbar)}
    {tx(view.layout !== 'vertical' && (groups.length > 0 || notice) && <div className="hand-context-row">
      {tx(groups.length > 0 && <div className="hand-group-strip" aria-label={tx("已整理的分组")}>
        <span className="hand-group-summary">{tx(groups.length)} {tx("组")}</span>
        {tx(groups.map((group, index) => <button type="button" key={group.id} className={`hand-group-chip group-${group.kind}`} style={{ '--group-color': `var(--group-color-${index % 3})` } as React.CSSProperties} onClick={() => { if (!readOnly) { onSelect(group.cardIds); setNotice(`已预选${group.label}，请确认牌型后出牌。`); } }} aria-label={tx(`选择分组：${group.label}，${group.cardIds.length} 张`)} title={tx("仅预选这一组，不自动出牌")}><span/>{tx(group.label)}<small>{tx(group.cardIds.length)}</small></button>))}
      </div>)}
      {tx(notice && <p className="hand-notice" data-testid="hand-notice" aria-live="polite" title={tx(notice)}>{tx(notice)}</p>)}
    </div>)}
    <Hand interactionKey={interactionKey} onExtractGroup={extractGroup} onMoveCards={(cardIds,targetKey)=>{
      if(readOnly||organizerOpen)return false;
      const next=moveCardsToColumn(groups,cards,view.sort,rules,cardIds,targetKey);
      if(!next)return false;
      dismissGestureHelp();changeGroups(next,`已移动 ${cardIds.length} 张到新位置；选牌保持不变。`);return true;
    }} cards={cards} rules={rules} selected={selected} sort={view.sort} layout={view.layout} groups={groups} onToggle={onToggle} onRank={onRank} onSelect={onSelect} readOnly={readOnly}/>
    {tx(!readOnly && organizerOpen && createPortal(<Modal title={tx("整理手牌")} onClose={closeOrganizer}>
      <div className="hand-organizer-panel" data-testid="hand-organizer">
        {tx(!readOnly && <section className="hand-organizer-section hand-organizer-selection" aria-label={tx("选择与分组")}>
          <h3>{tx("已选")}<strong>{tx(validSelected.length)}</strong> {tx("张")}<span>{tx("选牌保持原样")}</span></h3>
          <div className="hand-organizer-options"><button type="button" onClick={() => runAndClose(() => changeGroups(groupSelected(groups, cards, selected), '已将选中的牌放在一起；自选分组不等于合法牌型。'))} disabled={validSelected.length < 2}>{tx("选中成组")}</button><button type="button" onClick={() => runAndClose(() => changeGroups(ungroupSelected(groups, cards, selected), '已拆开选中牌所在的分组。'))} disabled={!hasSelectedGroup}>{tx("拆组")}</button></div>
          <p>{tx("至少选两张可成组；拆组只影响选中牌所在的分组。")}</p>
          <p>{tx("竖排先选多张，再按住其中一张片刻后拖动，可一起移动全部选中牌；拖动未选牌只移动该张。放到目标列可合并，放到空白处可另成一列；快速划动仍然选牌。也可按住 Alt 直接拖动，或聚焦牌后用 Alt＋左右方向键移到相邻列。")}</p>
          <button type="button" className="text-button gesture-help-again" onClick={() => { closeOrganizer(); setGestureHelp(true); }}>{tx("再看一次操作提示")}</button>
        </section>)}
        {tx(!readOnly && <section className="hand-organizer-section hand-organizer-secondary" aria-label={tx("其他整理操作")}><div className="hand-organizer-options"><button type="button" onClick={() => runAndClose(findStraight)} title={tx("循环预选普通顺子候选，包含可使用逢人配的组合")}>{tx("找顺子")}{tx(straights.length > 0 && <small>{tx(straights.length)}</small>)}</button><button type="button" onClick={() => runAndClose(findFlush)} title={tx("循环预选同花顺候选，包含可使用逢人配的组合")}>{tx("找同花顺")}{tx(flushes.length > 0 && <small>{tx(flushes.length)}</small>)}</button><button type="button" onClick={() => runAndClose(() => changeGroups([], '已恢复散牌展示，排序和选牌保持不变。'))} disabled={!groups.length}>{tx("重置分组")}</button></div><p>{tx("找顺子和找同花顺仅预选，不会自动出牌；重置分组保留排序、布局和所选牌。")}</p></section>)}
        <p className="hand-organizer-footnote">{tx(arrangement.history.length > 0 && <><button type="button" className="text-button" onClick={() => runAndClose(undo)} title={tx("撤销上次整理；已出掉的牌不会恢复")}>{tx("撤销上次整理")}</button><br/></>)}{tx("点击一项即返回牌桌。也可按 Esc 关闭。")}</p>
      </div>
    </Modal>, document.body))}
  </div>;
}
