import { tx } from '../i18n';
import { Brand, BRAND_MOTTO } from '../components/Brand';
import { BrandMotto } from '../components/BrandMotto';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameAction, GameState } from '../engine/types';
import { partnerOf, rankName } from '../engine/rules';
import { resolvePlays } from '../engine/patterns';
import { canBeat } from '../engine/compare';
import { DanlmHintButton } from '../components/DanlmHintButton';
import { useContinuousHint } from '../game/useContinuousHint';
import { HintExplanation } from '../components/HintExplanation';
import { explainPlayHint, type HintExplanation as Explanation } from '../game/hintExplanation';
import type { AiTask } from '../game/aiTask';
import { previewValidation, tableActionStamp as actionStamp, toTableView, type TableView } from '../game/tableView';
import { HandPanel } from '../components/HandPanel';
import { RoundPlays } from '../components/RoundPlays';
import { ArrowUp, BarChart3, Lightbulb, Music2, Settings2, VolumeX, X } from 'lucide-react';
import { PlayerSeat } from '../components/PlayerSeat';
import { PlayInterpretation } from '../components/PlayInterpretation';
import { VictoryCelebration } from '../components/VictoryCelebration';
import type { VictoryMoment } from '../game/victory';
import '../styles/table-chrome.css';
import '../styles/decision-hand-tools.css';
import '../styles/table-material.css';

export function Table({ state: localState, view, submissionPending = false, controllerMessage, presentationEpoch = 0, presentationLive = true, pausedLabel = '对局已暂停', pausedDescription = '对局已暂停，选牌会保留。', muted, paused, dealing, replayMode = false, onMute, onSettings, onCommit, onHint, onDanlmHint, danlmHintUnavailableReason, continuousHints = false, onContinuousHintsChange, onSound, replayControls, musicEnabled, onMusicToggle, matchStatus, matchLabel = '旧版连续升级', replayLabel = '最近一副回放', victory, onStatistics }: {
  state?: GameState; view?: TableView; submissionPending?: boolean; controllerMessage?: string; presentationEpoch?: string | number; presentationLive?: boolean; pausedLabel?: string; pausedDescription?: string; muted: boolean; paused: boolean; dealing: boolean; replayMode?: boolean;
  onMute: () => void; onSettings: () => void; onCommit: (action: GameAction) => boolean; onSound: () => void; replayControls?: React.ReactNode; musicEnabled?: boolean; onMusicToggle?: () => void; matchStatus?: React.ReactNode; matchLabel?: string; replayLabel?: string;
  victory?: VictoryMoment | null; onStatistics?: () => void;
  onHint?: () => AiTask;
  onDanlmHint?: () => AiTask;
  danlmHintUnavailableReason?: string;
  continuousHints?: boolean; onContinuousHintsChange?: (enabled: boolean) => void;
}) {
  const state = useMemo(() => { if (view) return view; if (localState) return toTableView(localState); throw Error('牌桌缺少公开视图'); }, [view, localState]);
  const viewerSeat = state.viewerSeat;
  const playerName = (seat: typeof viewerSeat) => state.seats[seat].name;
  const [selected, setSelected] = useState<string[]>([]); const [playKey, setPlayKey] = useState(''); const [hint, setHintText] = useState('');
  const [hintExplanation, setHintExplanation] = useState<Explanation | null>(null);
  const [hintActionType, setHintActionType] = useState<GameAction['type'] | null>(null);
  const setHint = (text: string, explanation?: Explanation, actionType?: GameAction['type']) => { setHintText(text); setHintExplanation(explanation ?? null); setHintActionType(actionType ?? null); };
  const [hintBusy, setHintBusy] = useState<'current' | 'danlm' | null>(null);
  const hintTask = useRef<AiTask | null>(null), hintGeneration = useRef(0);
  const cancelHint = () => { hintGeneration.current++; hintTask.current?.cancel(); hintTask.current=null; setHintBusy(null); };
  useEffect(() => { cancelHint(); setHint(''); return () => { hintGeneration.current++; hintTask.current?.cancel(); }; }, [state.sessionId, state.handId, state.stateVersion, viewerSeat, replayMode, paused, dealing, submissionPending, presentationEpoch]);
  const playArea = useRef<HTMLElement>(null);
  const [handToolbarTarget, setHandToolbarTarget] = useState<HTMLDivElement | null>(null);
  const hand = state.myHand;
  useEffect(() => { setSelected(previous => previous.filter(id => hand.some(card => card.id === id))); }, [hand]);
  useEffect(() => { setSelected([]); setHint(''); setPlayKey(''); if (!replayMode) playArea.current?.focus(); }, [state.sessionId, state.handId, viewerSeat, replayMode]);
  useEffect(() => { setHint(''); }, [state.stateVersion]);
  const picked = useMemo(() => hand.filter(card => selected.includes(card.id)), [hand, selected]);
  const interpretations = useMemo(() => resolvePlays(picked, state.rules), [picked, state.rules]);
  const chosen = interpretations.find(play => play.key === playKey) ?? interpretations.find(play => canBeat(play, state.currentPlay, state.rules)) ?? interpretations[0];
  const isTurn = state.currentPlayer === viewerSeat && !state.result && !paused && !dealing && !replayMode && !submissionPending;
  const beats = chosen ? canBeat(chosen, state.currentPlay, state.rules) : false;
  const playAction: GameAction = { ...actionStamp(state), player: viewerSeat, type: 'play', cardIds: picked.map(c => c.id), playKey: chosen?.key ?? '' };
  const validation = useMemo(() => previewValidation(state, { ...actionStamp(state), player: viewerSeat, type: 'play', cardIds: picked.map(c => c.id), playKey: chosen?.key ?? '' }), [state, picked, chosen]);
  const passValidation = useMemo(() => previewValidation(state, { ...actionStamp(state), player: viewerSeat, type: 'pass' }), [state]);
  const canPlay = isTurn && validation.ok; const canPass = isTurn && passValidation.ok;
  const cancelManualHint = () => { skipAutomaticHint(); cancelHint(); };
  const select = (id: string) => { cancelManualHint(); setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); setPlayKey(''); setHint(''); onSound(); };
  const selectRank = (rank: number) => { cancelManualHint(); setSelected(previous => [...new Set([...previous, ...hand.filter(c => c.rank === rank).map(c => c.id)])]); setPlayKey(''); setHint('同点数全选仅用于选牌，请确认识别的牌型。'); };
  const clear = () => { cancelManualHint(); setSelected([]); setPlayKey(''); setHint(''); };
  const submit = () => { if (canPlay && onCommit(playAction)) clear(); };
  const pass = () => { if (canPass) { onCommit({ ...actionStamp(state), type: 'pass' }); setHint(''); } };
  const getHint = (source: 'current' | 'danlm' = onDanlmHint ? 'danlm' : 'current') => {
    const request = source === 'danlm' ? onDanlmHint : onHint;
    if (!isTurn || !request || hintBusy || source === 'danlm' && danlmHintUnavailableReason) return;
    skipAutomaticHint(); cancelHint(); const generation=hintGeneration.current;
    const task=request(); hintTask.current=task; setHint(''); setHintBusy(source);
    void task.promise.then(result=>{
      if(generation!==hintGeneration.current)return;
      setHintBusy(null);hintTask.current=null;
      if(!result||result.identity.fallbackReason||!previewValidation(state,result.decision.action).ok)return;
      const action=result.decision.action;
      setSelected(action.type==='play'?action.cardIds:[]);setPlayKey(action.type==='play'?action.playKey:'');
      const label=action.type==='play'?resolvePlays(hand.filter(card=>action.cardIds.includes(card.id)),state.rules).find(play=>play.key===action.playKey)?.label:'';
      setHint(source==='danlm'?action.type==='pass'?'DanLM 建议：本轮不出。请自行确认不出。':`DanLM 建议：${label}。已高亮建议手牌，确认后出牌。`:`提示：${result.decision.explanation}${action.type==='pass'?' 请自行确认不出。':' 请确认后出牌。'}`,source==='danlm'?explainPlayHint(state,result.decision):undefined,action.type);
    }).catch(()=>{
      if(generation!==hintGeneration.current)return;
      setHintBusy(null);hintTask.current=null;
      setHint(`${source==='danlm'?'DanLM 提示':'提示'}暂时失败，请重试；选牌已保留。`);
    });
    return task;
  };
  const skipAutomaticHint = useContinuousHint({
    enabled: continuousHints, ready: isTurn && !!onDanlmHint && !danlmHintUnavailableReason,
    positionKey: `${state.sessionId}:${state.handId}:${state.stateVersion}:${viewerSeat}`,
    request: () => getHint('danlm'), cancel: cancelHint,
  });
  const toggleContinuousHints = (enabled: boolean) => { cancelHint(); onContinuousHintsChange?.(enabled); };
  const status = submissionPending ? '提交中，请等待牌桌确认。' : controllerMessage ? controllerMessage : paused ? pausedDescription : dealing ? '发牌完成后可操作。' : !picked.length ? state.currentPlay ? '选择同类更大的牌，或使用炸弹；也可以不出。' : state.currentPlayer === viewerSeat ? '本轮由你领出，不能不出。' : `等待${playerName(state.currentPlayer)}领出。` : !validation.ok ? `${validation.error}${chosen && state.currentPlay && !beats ? `（已选${chosen.label}；待压${state.currentPlay.label}）` : ''}` : !isTurn ? '选择已保留，轮到你时可以出牌。' : '可以出牌';
  const turnText = state.result ? '本副已结束' : replayMode ? `记录中的行动者：${playerName(state.currentPlayer)}` : paused ? pausedLabel : dealing ? '正在发牌' : state.currentPlayer === viewerSeat ? hand.length ? '轮到你出牌' : '等待对家' : state.seats[state.currentPlayer].controlMode === 'offline' ? `等待${playerName(state.currentPlayer)}重连` : `${playerName(state.currentPlayer)}${state.seats[state.currentPlayer].kind === 'ai' || state.seats[state.currentPlayer].controlMode === 'takeover' ? '正在思考' : '正在出牌'}`;
  const showMotto = !replayMode && !!matchStatus && matchLabel === BRAND_MOTTO;
  return <main className={`table-screen ${dealing ? 'is-dealing' : ''}`} data-testid="table">
    {tx(replayControls)}
    <div className="table-arena"><div className="table-felt"><div className="felt-inner"/><div className="table-watermark"><Brand symbolOnly/><span>GUAN · PRIVATE ROOM</span></div></div>
      <div className="table-chrome-brand">
        <div className="table-brand">
          <span className="brand with-image"><Brand compact/></span>
          <span className={`practice-label ${showMotto ? 'brand-motto' : ''}`}>
            {tx(showMotto ? <BrandMotto/> : replayMode ? replayLabel : matchStatus ? matchLabel : '单副练习')}
          </span>
        </div>
        {tx(matchStatus && <div className="table-match-status">{tx(matchStatus)}</div>)}
      </div>
      <div className="table-chrome-controls">
        <div className="header-actions">{tx(!replayMode && onStatistics && <button className="quiet-button" onClick={onStatistics} aria-label={tx("个人战绩")}><BarChart3 size={16}/>{tx("战绩")}</button>)}<button className={`quiet-button music-toggle ${musicEnabled ? 'is-on' : ''}`} onClick={onMusicToggle ?? onMute} aria-label={tx(musicEnabled ? '关闭背景音乐' : '开启背景音乐')}>{tx(musicEnabled ? <Music2 size={16}/> : <VolumeX size={16}/>)}<span>{tx("音乐")}</span><i className="music-status-light"/></button>{tx(!replayMode && <button className="quiet-button" onClick={onSettings} aria-label={tx("暂停与设置")}><Settings2 size={17}/>{tx("设置")}</button>)}</div>
        <div className="table-level"><span className="level-caption">{tx("本副级牌")}</span><strong>{tx(rankName(state.rules.levelRank))}</strong><span>♥{tx(rankName(state.rules.levelRank))} {tx("逢人配")}</span></div>
      </div>
      {tx(([0, 1, 2, 3] as const).filter(seat => seat !== viewerSeat).map(seat => <PlayerSeat key={seat} seat={seat} view={state}/>))}
      <RoundPlays key={presentationEpoch} state={state} viewerSeat={viewerSeat} seatNames={Object.fromEntries(Object.entries(state.seats).map(([seat, info]) => [seat, info.name]))} effectsEnabled={!replayMode && presentationLive}/>
      {tx(!replayMode && victory?.kind==='first' && <VictoryCelebration moment={victory}/>)}
    </div>
    <section className="play-area" tabIndex={0} ref={playArea} aria-label={tx("你的手牌与出牌操作")} data-selection={picked.length ? chosen && beats ? 'valid' : 'invalid' : 'empty'} onKeyDown={e => {
      if (paused || replayMode || submissionPending || e.repeat || e.defaultPrevented || (e.target instanceof HTMLElement && (e.target.closest('[role="dialog"]') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)))) return;
      if (e.key === 'Escape') { e.preventDefault(); clear(); }
      if (e.key === 'Enter') { if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return; e.preventDefault(); submit(); }
      if (e.key.toLowerCase() === 'h') { e.preventDefault(); getHint(); }
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); pass(); }
    }}>
      <div className={`action-zone decision-zone ${replayMode ? 'decision-replay' : ''}`}>
        <div className="decision-copy">
          <div className={`turn-indicator ${isTurn ? 'your-turn' : ''}`} data-testid="current-turn"><span className="turn-dot"/><strong>{tx(turnText)}</strong><span className="follow-context">{tx(state.currentPlay ? <>{tx(playerName(state.currentOwner!))}{tx(state.currentOwner === partnerOf(viewerSeat) ? '（对家）' : state.currentOwner === viewerSeat ? '（你）' : '（对手）')} · {tx(state.currentPlay.label)}</> : '本轮领出')}</span></div>
          {tx(!replayMode && <div className="selection-info" data-testid="selected-info" aria-live="polite"><div className="selection-title"><span>{tx("已选")}<strong>{tx(picked.length)}</strong> {tx("张")}</span></div><PlayInterpretation plays={interpretations} selectedKey={chosen?.key ?? ''} onSelect={key => { cancelManualHint(); setPlayKey(key); setHint(''); }}/><p id="selection-status" className={`selection-status ${picked.length && (!chosen || !beats) ? 'invalid' : ''}`}>{tx(submissionPending || controllerMessage ? status : hint && (!picked.length || validation.ok) ? <><HintExplanation summary={tx(hint)} explanation={hintExplanation}/><button className="text-button hint-dismiss" aria-label={tx("收起建议")} onClick={()=>{cancelManualHint();setHint('');}}>×</button></> : hintBusy ? hintBusy==='danlm'?'DanLM 正在分析你的手牌…':'正在分析你的手牌…' : status)}</p></div>)}
        </div>
        <div className="decision-hand-tools" ref={setHandToolbarTarget} aria-label={tx("手牌整理与布局")}/>
        {tx(!replayMode && <div className="action-buttons"><button className="secondary-button clear-selection-button" onClick={clear} disabled={submissionPending || (!picked.length&&!hint&&!hintBusy)} aria-label={tx("取消选择")}><X size={15}/>{tx("取消选择")}</button>{tx(!onDanlmHint && <button className="secondary-button" onClick={()=>getHint()} disabled={!isTurn||!!hintBusy||!onHint}><Lightbulb size={16}/>{tx("提示")}<kbd>H</kbd></button>)}{tx(onDanlmHint && <DanlmHintButton continuous={continuousHints} onContinuousChange={toggleContinuousHints} onHint={()=>getHint('danlm')} canHint={isTurn} busy={!!hintBusy} blocked={paused || dealing || replayMode || submissionPending} unavailableReason={tx(danlmHintUnavailableReason)} interactionKey={`${state.sessionId}:${state.handId}`} shortcut/>)}<button className={`secondary-button pass-button ${isTurn && hintActionType === 'pass' ? 'is-recommended' : ''}`} data-recommended={isTurn && hintActionType === 'pass' || undefined} onClick={pass} disabled={!canPass} title={tx(!passValidation.ok ? passValidation.error : '本轮可主动不出')}>{tx(isTurn && hintActionType === 'pass' && <span className="pass-suggestion-dot" aria-hidden="true"/>)}{tx("不出")}<kbd>P</kbd></button><button className="primary-button play-button" onClick={submit} disabled={!canPlay} aria-describedby="selection-status" data-testid="play-button">{tx(submissionPending ? '提交中' : '出牌')} <ArrowUp size={19}/></button></div>)}
      </div>
      <HandPanel tutorialEnabled={!paused && !dealing && !replayMode && !submissionPending} interactionKey={`${presentationEpoch}:${paused}:${dealing}`} toolbarTarget={handToolbarTarget} cards={hand} rules={state.rules} selected={selected} onToggle={select} onRank={selectRank} onSelect={(ids, preferredPlayKey) => { cancelManualHint(); setSelected(ids); setPlayKey(preferredPlayKey ?? ''); setHint(''); }} handId={state.handId} finished={state.finished.includes(viewerSeat)} readOnly={replayMode || submissionPending}/>
    </section>
  </main>;
}
