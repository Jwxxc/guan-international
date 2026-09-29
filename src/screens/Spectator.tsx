import { tx, dateLocale } from '../i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Eye, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { Card, GameAction, GameState, RuleConfig, Seat } from '../engine/types';
import { rankName, teamOf } from '../engine/rules';
import { validateAction } from '../engine/reducer';
import { isWild } from '../engine/cards';
import { sortHand } from '../hand/arrangement';
import { PlayingCard, cardName, suitSymbol } from '../components/PlayingCard';
import { StudyRound } from '../spectator/StudyRound';
import { Brand } from '../components/Brand';
import { RoomAtmosphere } from '../components/RoomAtmosphere';
import { wildcardDescription } from '../components/PlayInterpretation';
import { nativeDanlmEnabled } from '../ai/pro/nativeInfo';
import { randomId } from '../game/randomId';
import { StudyController, type StudySnapshot } from '../spectator/controller';
import { createStudy, studyKey, studyLabel, STUDY_NAMES, STUDY_SEATS, type StudySpeed } from '../spectator/model';
import { listStudies, loadStudy, saveStudy, type StudySummary } from '../spectator/storage';
import '../styles/spectator.css';

function StudyCards({ cards, rules, large = false, highlighted = [] }: { cards: Card[]; rules: RuleConfig; large?: boolean; highlighted?: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const resize = () => setWidth(element.clientWidth);
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const ordered = useMemo(() => sortHand(cards, 'rank', rules.levelRank), [cards, rules.levelRank]);
  const face = large ? 68 : 48, exposure = large ? 28 : 24;
  const count = Math.max(1, Math.min(ordered.length, Math.floor((width - face) / exposure) + 1));
  const step = count === 1 ? face : Math.min(large ? 45 : 30, (width - face) / (count - 1));
  const rows: Card[][] = [];
  for (let i = 0; i < ordered.length; i += count) rows.push(ordered.slice(i, i + count));
  return <div ref={host} className={`study-cards ${large ? 'study-cards-large' : ''}`} style={{ '--study-face': `${face}px`, '--study-step': `${step}px` } as CSSProperties}>
    {tx(!cards.length && <span className="study-empty-hand">{tx("已出完")}</span>)}
    {tx(rows.map((row, index) => <div className="study-card-row" key={index}>{tx(row.map((card, i) => <div className={`study-card-slot ${highlighted.includes(card.id) ? 'study-card-highlight' : ''}`} key={card.id} data-study-card-id={card.id} title={tx(cardName(card))}>
      <PlayingCard card={card} rules={rules} detail={large ? 'medium' : 'tiny'} jokerExposure={i < row.length - 1 ? 'left' : 'full'} jokerStrip={step}/>
    </div>))}</div>))}
  </div>;
}

function StudyHand({ seat, state, focused, hidden, relative, onFocus, highlighted }: {
  seat: Seat; state: GameState; focused?: boolean; hidden?: boolean; relative: string; onFocus: () => void; highlighted?: string[];
}) {
  const active = !state.result && state.currentPlayer === seat;
  return <section className={`study-hand ${focused ? 'study-focus-hand' : ''} ${active ? 'study-hand-active' : ''}`} data-testid={`study-hand-${seat}`} data-focused={!!focused} aria-label={tx(`${STUDY_NAMES[seat]}手牌`)}>
    <button className="study-hand-title" type="button" onClick={onFocus} aria-label={tx(`关注${STUDY_NAMES[seat]}`)} aria-pressed={!!focused}>
      <span className={`study-seat-badge team-${teamOf(seat)}`}>{tx(STUDY_NAMES[seat][0])}</span>
      <strong>{tx(STUDY_NAMES[seat])}</strong><span>{tx(relative)} · {tx(teamOf(seat) === 0 ? 'A' : 'B')} {tx("队")}</span>
      <span className="study-hand-count">{tx(state.hands[seat].length)} {tx("张")}</span>{tx(active && <em>{tx("待行动")}</em>)}
    </button>
    {tx(hidden ? <div className="study-concealed">{tx("已隐藏手牌 · 点击座位切换视角")}</div>
      : focused ? <StudyCards cards={state.hands[seat]} rules={state.rules} large highlighted={highlighted}/>
        : <div className="study-overview" aria-label={tx(`${STUDY_NAMES[seat]}明牌概览`)}>{tx(sortHand(state.hands[seat], 'rank', state.rules.levelRank).map(card => <div key={card.id} data-study-card-id={card.id} className={`study-overview-card ${card.suit === 'H' || card.suit === 'D' || card.rank === 16 ? 'is-red' : ''} ${card.rank > 14 ? 'is-joker' : ''}`} title={tx(cardName(card))} aria-label={tx(`${cardName(card)}${isWild(card, state.rules) ? '，逢人配' : ''}`)}><strong>{tx(rankName(card.rank))}{tx(isWild(card, state.rules) && <i>{tx("配")}</i>)}</strong><span>{tx(card.rank > 14 ? '王' : suitSymbol(card.suit))}</span></div>))}{tx(!state.hands[seat].length && <span className="study-empty-hand">{tx("已出完")}</span>)}</div>)}
  </section>;
}

const playable = (frame: StudySnapshot['frames'][number], hand: number) => frame.phase === 'playing' || hand === 0 && frame.phase === 'deal';
function analysisAt(snapshot: StudySnapshot) {
  const { document, frames, pending } = snapshot;
  const frame = frames[document.cursor.frame], state = frame.state;
  const upcoming = playable(frame, document.cursor.hand) && !state.result
    ? document.decisions.find(record => studyKey(record) === studyKey(state)) ?? (pending && studyKey(pending) === studyKey(state) ? pending : null) : null;
  const decision = upcoming ?? (playable(frame, document.cursor.hand) || !!state.result
    ? document.decisions.find(record => record.handId === state.handId && record.stateVersion === state.stateVersion - 1) : null);
  if (!decision) return null;
  const index = frames.findIndex(item => playable(item, document.cursor.hand) && item.state.handId === decision.handId && item.state.stateVersion === decision.stateVersion);
  return index < 0 ? null : { decision, before: frames[index].state, index, upcoming: !!upcoming,
    recorded: document.decisions.some(item => studyKey(item) === studyKey(decision)) };
}
function actionDescription(state: GameState, action: GameAction) {
  if (action.type === 'pass') return { label: '不出', cards: [] as Card[], wildcards: '' };
  const validation = validateAction(state, action);
  return { label: validation.ok ? validation.play?.label ?? '出牌' : '记录不可用', cards: state.hands[action.player].filter(card => action.cardIds.includes(card.id)),
    wildcards: validation.ok && validation.play?.wildcards.length ? wildcardDescription(validation.play) : '' };
}

function DecisionPanel({ controller, snapshot, candidate, onPreview }: { controller: StudyController; snapshot: StudySnapshot; candidate: number; onPreview: (index: number) => void }) {
  const analysis = useMemo(() => analysisAt(snapshot), [snapshot.document, snapshot.frames, snapshot.pending]);
  const { document } = snapshot;
  const frame = snapshot.frames[document.cursor.frame];
  const canReveal = playable(frame, document.cursor.hand) && !frame.state.result;
  const hidden = document.preferences.thinkFirst && !snapshot.revealed && canReveal;
  const decision = hidden ? null : analysis?.decision;
  const selected = decision?.candidates[Math.min(candidate, decision.candidates.length - 1)];
  const description = selected && analysis ? actionDescription(analysis.before, selected.action) : null;
  const remaining = description && analysis ? analysis.before.hands[analysis.decision.player].filter(card => !description.cards.some(played => played.id === card.id)) : [];
  return <aside className="study-analysis" aria-label={tx("DanLM 决策对比")}>
    <div className="study-panel-heading"><div><span className="study-eyebrow">DECISION STUDY</span><h2>{tx("看它怎样选择")}</h2></div><Eye size={20}/></div>
    <label className="study-check"><input type="checkbox" checked={document.preferences.thinkFirst} onChange={event => controller.setPreferences({ thinkFirst: event.target.checked })}/>{tx("先想，再看答案")}</label>
    {tx(canReveal && (hidden || controller.live && !snapshot.pending) && <div className="study-think-prompt">
      <strong>{tx("轮到")}{tx(STUDY_NAMES[frame.state.currentPlayer])}</strong>
      <p>{tx("如果是你，会怎样处理这手牌？")}</p>
      <button className="secondary-button" disabled={snapshot.thinking || controller.live && !nativeDanlmEnabled()} onClick={() => void controller.reveal()}>{tx(snapshot.thinking ? 'DanLM 计算中…' : '看本回合选择')}</button>
      <small>{tx("只展示建议，牌局保持在原地。")}</small>
    </div>)}
    {tx(decision && analysis && <>
      <div className="study-decision-title"><strong>{tx(STUDY_NAMES[decision.player])} · {tx(analysis.upcoming ? '本回合候选' : '刚才的选择')}</strong><span>{tx(analysis.recorded ? '当时的原始决策' : '已计算，尚未出牌')}</span></div>
      {tx(!analysis.upcoming && <button className="text-button study-before" onClick={() => controller.seek({ hand: document.cursor.hand, frame: analysis.index })}><RotateCcw size={13}/>{tx("回到这一步出牌前")}</button>)}
      <ol className="study-candidates" aria-label={tx("DanLM 候选出法")}>{tx(decision.candidates.map((row, index) => {
        const info = actionDescription(analysis.before, row.action);
        return <li key={index}><button type="button" aria-pressed={candidate === index} onClick={() => onPreview(index)} data-testid={`study-candidate-${index}`}>
          <span className="study-candidate-rank">{tx(String(index + 1).padStart(2, '0'))}</span><span><strong>{tx(info.label)}</strong><small>{tx(index === 0 ? 'DanLM 首选' : decision.candidates[0].score === row.score ? '与首选同分' : `低于首选 ${(decision.candidates[0].score - row.score).toFixed(4)}`)}</small></span><b>{tx(row.score.toFixed(4))}</b>
        </button></li>;
      }))}</ol>
      {tx(selected && description && <div className="study-candidate-preview" data-testid="study-candidate-preview">
        <h3>{tx("候选预览 ·")}{tx(description.label)}</h3>
        <p>{tx(selected.action.type === 'pass' ? '保留全部手牌，让过这一轮回应。' : `打出 ${description.cards.length} 张，余 ${remaining.length} 张。`)}</p>
        {tx(!!description.cards.length && <StudyCards cards={description.cards} rules={analysis.before.rules}/>)}
        {tx(!!description.wildcards && <p>{tx(description.wildcards)}</p>)}
        <details><summary>{tx("看看余下的")}{tx(remaining.length)} {tx("张牌")}</summary><StudyCards cards={remaining} rules={analysis.before.rules}/></details>
      </div>)}
      <p className="study-score-note">{tx("评分用于比较同一回合的候选，数值越高越优先；它不是胜率，也不是模型的文字推理。")}</p>
      <details className="study-provenance"><summary>{tx("本次决策记录")}</summary><p>{tx("DanLM · 经典升级 · 单副回报评价")}</p><p>{tx("模型")}{tx(decision.modelHash.slice(0, 12))} {tx("· 计算")}{tx(Math.round(decision.computeMs))} ms</p><p>{tx("该电脑只收到自己的手牌和当时公开信息。")}</p></details>
    </>)}
    {tx(!decision && !hidden && <p className="study-panel-empty">{tx(['tribute', 'return', 'ready'].includes(frame.phase) ? '贡还牌由现有交换策略处理；进入出牌阶段后展示 DanLM 候选。' : '点击“看本回合选择”研究起手，也可以直接单步或播放。')}</p>)}
    <div className="study-bookmarks"><div className="study-section-title"><h3>{tx("收藏的局面")}</h3><span>{tx(document.bookmarks.length)}</span></div>
      {tx(!document.bookmarks.length ? <p>{tx("遇到值得琢磨的一手，点击“收藏此刻”。")}</p> : <ul>{tx(document.bookmarks.map(bookmark => <li key={`${bookmark.hand}:${bookmark.frame}:${bookmark.viewer}`}><button type="button" onClick={() => controller.openBookmark(bookmark)}>{tx("第")}{tx(bookmark.hand + 1)} {tx("副 · 第")}{tx(bookmark.frame)} {tx("步")}<span>{tx(STUDY_NAMES[bookmark.viewer])}</span></button></li>))}</ul>)}
    </div>
  </aside>;
}

function StudyTable({ controller, onExit }: { controller: StudyController; onExit: () => void }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { document, frames } = snapshot;
  const { cursor, preferences } = document;
  const frame = frames[cursor.frame], state = frame.state;
  const [preview, setPreview] = useState<{ key: string; index: number } | null>(null);
  const analysis = analysisAt(snapshot);
  const candidate = analysis && preview?.key === studyKey(analysis.decision) ? preview.index : 0;
  const previewAction = analysis?.decision.candidates[candidate]?.action;
  const currentHighlight = analysis?.upcoming && analysis.decision.player === preferences.viewer
    && (!preferences.thinkFirst || snapshot.revealed) && previewAction?.type === 'play' ? previewAction.cardIds : [];
  useEffect(() => {
    const hide = () => { if (window.document.hidden) controller.pause(); };
    window.document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', controller.pause);
    return () => { controller.pause(); window.document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', controller.pause); };
  }, [controller]);
  const exit = async () => { controller.pause(); if (await controller.persist()) onExit(); };
  const others = [3, 2, 1].map(offset => ((preferences.viewer + offset) % 4) as Seat);
  const bookmarked = document.bookmarks.some(bookmark => bookmark.hand === cursor.hand && bookmark.frame === cursor.frame && bookmark.viewer === preferences.viewer);
  const canCompute = !controller.live || nativeDanlmEnabled();
  const result = state.result;
  return <main className="study-screen" data-testid="study-screen" data-hand={cursor.hand} data-frame={cursor.frame} data-live={controller.live} data-thinking={snapshot.thinking} data-running={snapshot.running}>
    <header className="study-header"><button className="text-button" onClick={() => void exit()}><ArrowLeft size={16}/>{tx("观战记录")}</button><Brand compact/><div><span className="study-eyebrow">DANLM · SPECTATOR</span><h1>{tx("观战研习")}</h1></div><div className="study-match-progress"><span>{tx("第")}{tx(cursor.hand + 1)} {tx("副 · 打")}<b>{tx(rankName(state.rules.levelRank))}</b></span><span>{tx("A 队")}<b>{tx(rankName(frame.progress.teamLevels[0]))}</b><i/>{tx("B 队")}<b>{tx(rankName(frame.progress.teamLevels[1]))}</b></span></div></header>
    <section className="study-transport" aria-label={tx("观战播放控制")}>
      <div className="study-playback">
        <button className="secondary-button" disabled={cursor.frame === 0} onClick={() => controller.seek({ ...cursor, frame: cursor.frame - 1 })}><ChevronLeft size={16}/>{tx("上一步")}</button>
        <button className="primary-button study-play-button" disabled={!snapshot.running && (!controller.canStep || !canCompute || !!snapshot.saveError)} onClick={() => snapshot.running ? controller.pause() : controller.play()}>{tx(snapshot.running ? <Pause size={16}/> : <Play size={16}/>)} {tx(snapshot.running ? '暂停' : '播放')}</button>
        <button className="secondary-button" disabled={!controller.canStep || snapshot.thinking || !canCompute || !!snapshot.saveError} onClick={() => void controller.step()}>{tx("下一步")}<ChevronRight size={16}/></button>
        {tx(snapshot.thinking && !snapshot.running && <button className="text-button" onClick={controller.pause}>{tx("取消计算")}</button>)}
        <label className="study-speed">{tx("节奏")}<select aria-label={tx("观战速度")} value={preferences.speed} onChange={event => controller.setPreferences({ speed: event.target.value as StudySpeed })}><option value="slow">{tx("慢速")}</option><option value="normal">{tx("正常")}</option><option value="fast">{tx("快速")}</option></select></label>
        <button className="text-button" disabled={!controller.canStep || !canCompute || !state.result && playable(frame, cursor.hand) && state.currentPlayer === preferences.viewer} onClick={() => controller.play(preferences.viewer)}><SkipForward size={15}/>{tx("到关注席位回合")}</button>
        <button className="text-button study-bookmark-button" aria-pressed={bookmarked} disabled={!bookmarked && document.bookmarks.length >= 500} title={tx("每场最多收藏 500 个局面，再次点击可取消收藏")} onClick={controller.toggleBookmark}><Bookmark size={15} fill={bookmarked ? 'currentColor' : 'none'}/>{tx(bookmarked ? '已收藏' : '收藏此刻')}</button>
      </div>
      <div className="study-timeline"><label>{tx("副数")}<select aria-label={tx("选择观战副数")} value={cursor.hand} onChange={event => controller.seek({ hand: Number(event.target.value), frame: 0 })}>{tx(document.match.journal.records.map((record, index) => <option key={record.config.handId} value={index}>{tx(`第 ${index + 1} 副`)}</option>))}</select></label><input aria-label={tx("观战时间轴")} type="range" min={0} max={frames.length - 1} value={cursor.frame} disabled={frames.length < 2} onChange={event => controller.seek({ ...cursor, frame: Number(event.target.value) })}/><span data-testid="study-position">{tx(cursor.frame)} / {tx(frames.length - 1)}</span><button className="text-button" disabled={controller.live} onClick={controller.latest}>{tx("回到最新")}</button></div>
    </section>
    {tx((snapshot.error || snapshot.saveError) && <div className="study-error" role="alert"><strong>{tx(snapshot.saveError ? '进度保存已暂停' : 'DanLM 计算已暂停')}</strong><span>{tx(snapshot.saveError ?? snapshot.error)}</span><button className="secondary-button" onClick={() => snapshot.saveError ? void controller.persist() : controller.retry()}>{tx(snapshot.saveError ? '重试保存' : '重试 DanLM')}</button></div>)}
    {tx(!nativeDanlmEnabled() && <p className="study-unavailable">{tx("当前版本未连接本机 DanLM。已保存的观战可以回看；继续计算请用本机 GUAN 启动器。")}</p>)}
    <div className="study-content"><div className="study-table-column">
      <section className="study-view-controls" aria-label={tx("切换观战视角")}><div className="study-seat-switch">{tx(STUDY_SEATS.map(seat => <button type="button" key={seat} aria-pressed={preferences.viewer === seat} onClick={() => controller.setViewer(seat)}>{tx(STUDY_NAMES[seat])}<small>{tx(teamOf(seat) === 0 ? 'A' : 'B')} {tx("队")}</small></button>))}</div><div className="study-view-options"><label className="study-check"><input type="checkbox" checked={preferences.allHands} onChange={event => controller.setPreferences({ allHands: event.target.checked })}/>{tx("四家明牌")}</label><label className="study-check"><input type="checkbox" checked={preferences.follow} onChange={event => controller.setPreferences({ follow: event.target.checked })}/>{tx("跟随行动者")}</label></div></section>
      <div className="study-table-felt">
        <div className="study-other-hands">{tx(others.map((seat, index) => <StudyHand key={seat} seat={seat} state={state} relative={['上家', '对家', '下家'][index]} hidden={!preferences.allHands} onFocus={() => controller.setViewer(seat)}/>))}</div>
        <div className="study-arena">
          {tx(['tribute', 'return', 'ready'].includes(frame.phase) ? <div className="study-exchange"><span className="study-eyebrow">{tx("经典升级 · 交换阶段")}</span><h2>{tx(frame.phase === 'tribute' ? '进贡' : frame.phase === 'return' ? '还贡' : frame.antiTribute ? '抗贡' : '交换完成')}</h2><p>{tx(studyLabel(frame.label))}</p><p>{tx("使用现有交换策略；单步查看每次确认。")}</p><div>{tx(frame.exchange?.publicTransfers?.map(transfer => <span key={`${transfer.type}:${transfer.from}`}>{tx(STUDY_NAMES[transfer.from])} → {tx(STUDY_NAMES[transfer.to])} · {tx(cardName(transfer.card))}<br/></span>))}</div></div>
            : <StudyRound state={state} viewer={preferences.viewer} onInspect={controller.pause}/>)}
        </div>
        <div className="study-event" role="status"><span className={`study-status-dot ${snapshot.running ? 'is-running' : ''}`}/><strong>{tx(snapshot.thinking ? 'DanLM 思考中' : snapshot.running ? snapshot.targetSeat !== null ? `前往${STUDY_NAMES[snapshot.targetSeat]}回合` : '自动播放' : '已暂停')}</strong><span>{tx(studyLabel(frame.label))}</span></div>
        <StudyHand seat={preferences.viewer} state={state} focused relative="当前关注" onFocus={() => {}} highlighted={currentHighlight}/>
      </div>
      <p className="study-information-note">{tx("四个座位均由 DanLM 出牌。明牌只供你观察，电脑只看自己的手牌和公开信息。")}</p>
      {tx(result && <section className="study-result" data-testid="study-result"><div><span className="study-eyebrow">{tx("本副结算")}</span><h2>{tx(result.winningTeam === 0 ? 'A' : 'B')} {tx("队获胜")}{tx(result.doubleUp ? ' · 双上' : '')}</h2><p>{tx(result.order.map((seat, index) => `${['头游', '二游', '三游', '末游'][index]} ${STUDY_NAMES[seat]}`).join(' · '))}{tx(result.doubleDown.length ? ` · 双下 ${result.doubleDown.map(seat => STUDY_NAMES[seat]).join('、')}` : '')}</p></div>{tx(document.match.phase === 'complete' && cursor.hand === document.match.journal.records.length - 1 ? <strong>{tx("已过 A，本场结束")}</strong> : <button className="primary-button" disabled={!canCompute} onClick={() => void controller.nextHand()}>{tx("开始下一副")}<ChevronRight size={16}/></button>)}</section>)}
    </div><DecisionPanel controller={controller} snapshot={snapshot} candidate={candidate} onPreview={index => { if (analysis) setPreview({ key: studyKey(analysis.decision), index }); }}/></div>
  </main>;
}

export function Spectator({ onExit }: { onExit: () => void }) {
  const [controller, setController] = useState<StudyController | null>(null);
  const [sessions, setSessions] = useState<StudySummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refresh = async () => {
    setBusy(true);
    try { const rows = await listStudies(); if (mounted.current) { setSessions(rows); setError(''); } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '无法读取观战记录'); }
    finally { if (mounted.current) setBusy(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const open = async (id?: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!id && !nativeDanlmEnabled()) throw Error('本机 DanLM 未连接，请用 GUAN 启动器打开游戏');
      const document = id ? await loadStudy(id) : createStudy(randomId(), randomId(), crypto.getRandomValues(new Uint32Array(1))[0]);
      if (!id) await saveStudy(document);
      if (mounted.current) setController(new StudyController(document));
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '无法打开观战'); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (controller) return <StudyTable controller={controller} onExit={() => { controller.dispose(); setController(null); void refresh(); }}/>;
  return <main className="study-lobby room-home" data-testid="study-lobby"><RoomAtmosphere/><header className="study-header"><button className="text-button" onClick={onExit}><ArrowLeft size={16}/>{tx("返回首页")}</button><Brand compact/></header><section className="study-lobby-content"><span className="study-eyebrow">FOUR MINDS · ONE TABLE</span><h1>{tx("看一桌，想一步。")}</h1><p className="study-lobby-intro">{tx("四个 DanLM 同桌对弈。明牌观战，随时换座，停下来比较它的选择。")}</p><div className="study-lobby-features"><span>{tx("四家明牌")}</span><span>{tx("逐步研习")}</span><span>{tx("候选对比")}</span><span>{tx("局面收藏")}</span></div>
    <button className="primary-button study-new" disabled={busy || !nativeDanlmEnabled()} onClick={() => void open()}><Play size={18}/>{tx("开始新的观战")}<span>{tx("经典升级 · 发牌后暂停")}</span></button>
    {tx(!nativeDanlmEnabled() && <p className="study-unavailable">{tx("本机 DanLM 未连接，请用 GUAN 启动器打开游戏。已有记录仍可回看。")}</p>)}
    {tx(error && <div className="study-error" role="alert"><span>{tx(error)}</span><button className="text-button" disabled={busy} onClick={() => void refresh()}>{tx("重试读取")}</button></div>)}
    <div className="study-library"><div className="study-section-title"><h2>{tx("我的观战记录")}</h2><span>{tx("独立保存 · 不计入个人战绩")}</span></div>{tx(busy && <p role="status">{tx("正在读取…")}</p>)}{tx(!sessions.length && !busy && <p>{tx("第一场观战会保存在这里，下次从停下的位置继续。")}</p>)}<div className="study-session-list">{tx(sessions.map(session => <button key={session.id} className="study-session" disabled={busy} onClick={() => void open(session.id)}><span><strong>{tx(new Date(session.createdAt).toLocaleString(dateLocale(), { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</strong><small>{tx(session.hands)} {tx("副 ·")}{tx(session.actions)} {tx("次出牌决策 ·")}{tx(session.bookmarks)} {tx("个收藏")}{tx(session.complete ? ' · 已结束' : '')}</small></span><span>{tx("继续研习")}<ChevronRight size={16}/></span></button>))}</div></div>
  </section></main>;
}
