import { tx } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Settings2 } from 'lucide-react';
import { Brand } from '../components/Brand';
import { MatchScoreboard } from '../components/MatchScoreboard';
import { PlayingCard, cardName } from '../components/PlayingCard';
import { rankStrength } from '../engine/cards';
import { rankName } from '../engine/rules';
import { seatName, type SeatNames } from '../game/tableView';
import type { MatchSession } from '../match/sessionTypes';
import type { ExchangeAction, ExchangeObservation } from '../match/types';
import { DanlmHintButton } from '../components/DanlmHintButton';
import { useContinuousHint } from '../game/useContinuousHint';
import { HintExplanation } from '../components/HintExplanation';
import { explainExchangeHint, type HintExplanation as Explanation } from '../game/hintExplanation';
import { nativeDanlmEnabled } from '../ai/pro/nativeInfo';
import { requestDanlmExchangeHint } from '../game/danlmExchangeHint';

/** Receives only the player's hand and information already published by the exchange. */
export function ExchangeDetails({ observation, selected = null, onSelect, readOnly = false, ready = false, classic = true, antiTribute = false, seatNames }: {
  observation: ExchangeObservation; selected?: string | null; onSelect?: (id: string) => void;
  readOnly?: boolean; ready?: boolean; classic?: boolean; antiTribute?: boolean; seatNames?: SeatNames;
}) {
  const eligible = new Set(observation.eligibleCardIds);
  const returning = observation.phase === 'return';
  const myTurn = !ready && eligible.size > 0;
  const previous = observation.previous;
  const transfers = observation.publicTransfers ?? [];
  const evidence = observation.antiTributeEvidence ?? [];
  const destination = observation.destination;
  const target = destination !== null ? seatName(destination, seatNames) : null;
  const hand = [...observation.hand].sort((a, b) => rankStrength(b.rank, observation.rules) - rankStrength(a.rank, observation.rules) || a.suit.localeCompare(b.suit) || a.id.localeCompare(b.id));
  let reason: ReactNode;
  if (ready) {
    reason = evidence.length || antiTribute ? <>{tx("两张真实大王满足")}{tx(previous?.doubleUp ? '双贡' : '单贡')}{tx("抗贡条件，本副取消全部贡还，由上一副头游")}<strong>{tx(seatName(observation.firstPlayer ?? 0, seatNames))}</strong> {tx("先出。")}</>
      : <>{tx("贡还牌已统一交换，每人仍为 27 张。")}<strong>{tx(seatName(observation.firstPlayer ?? 0, seatNames))}</strong> {tx("先出。")}</>;
  } else if (myTurn && returning) {
    reason = <>{tx("请向")}<strong>{tx(target ?? '向你进贡的玩家')}</strong> {tx("还一张牌。")}{tx(classic
      ? observation.returnRule === 'fallback' ? '无 2–10 的非级牌，按本版规则还最小非级普通牌。' : '从原始手牌中选择自然点数 2–10 的非级牌；不能退回刚收到的贡牌。'
      : '按旧版规则选择一张合法还牌。')}</>;
  } else if (myTurn) {
    reason = previous?.doubleUp ? <>{tx("上一副双下，请进贡最大的非逢人配牌。两位贡方都确认后，再确定你向头游还是二游进贡。")}</>
      : <>{tx("上一副末游，请向头游")}<strong>{tx(target ?? (previous ? seatName(previous.order[0], seatNames) : '受贡者'))}</strong> {tx("进贡最大的非逢人配牌。")}</>;
  } else {
    const player = observation.currentPlayer;
    reason = <>{tx(player === null || player === undefined ? '电脑' : seatName(player, seatNames))}{tx("正在")}{tx(returning ? '还贡' : '进贡')}{tx("。未完成确认的选择不会公开，你的整手牌保留在下方。")}</>;
  }
  return <>
    <p className="exchange-description" role="status" data-testid="exchange-reason">{tx(reason)}</p>
    {tx((transfers.length > 0 || evidence.length > 0) && <section className="exchange-public" aria-label={tx("公开贡还与抗贡证据")}>
      {tx(evidence.length > 0 && <div className="exchange-evidence" data-testid="anti-tribute-evidence"><span className="exchange-public-title">{tx("抗贡证据")}</span>{tx(evidence.map(({ player, card }) => <div key={card.id}><PlayingCard card={card} rules={observation.rules} detail="tiny"/><span>{tx(seatName(player, seatNames))}{tx("持有")}</span></div>))}<p>{tx("仅公开这两张大王，其余手牌保持隐藏。")}</p></div>)}
      {tx(transfers.length > 0 && <div className="exchange-history" aria-label={tx("公开交换记录")}><h2>{tx(ready ? '本副已完成的交换' : classic ? '已确认进贡 · 待统一交换' : '已完成进贡 · 等待还贡')}</h2><div>{tx(transfers.map((transfer, index) => <p key={`${transfer.type}-${transfer.from}-${index}`}><span>{tx(seatName(transfer.from, seatNames))}</span><i>{tx(transfer.type === 'tribute' ? '进贡' : '还贡')}</i><strong className={transfer.card.suit === 'H' || transfer.card.suit === 'D' || transfer.card.rank === 16 ? 'transfer-red' : ''}>{tx(cardName(transfer.card))}</strong><ArrowRight size={13}/><span>{tx(seatName(transfer.to, seatNames))}</span></p>))}</div></div>)}
    </section>)}
    <section className="exchange-hand-shelf" aria-label={tx(`你的完整手牌，共 ${hand.length} 张`)}>
      <div className="exchange-hand-heading"><strong>{tx("我的手牌")}<b>{tx(hand.length)}</b> {tx("张")}</strong><span>{tx(readOnly ? '回放中的手牌 · 不可操作' : myTurn ? `${eligible.size} 张可选 · 金色边框可提交` : ready ? '交换后手牌' : '等待本阶段完成')}</span></div>
      <div className="exchange-candidates exchange-full-hand" data-readonly={readOnly ? 'true' : undefined} role="group" aria-label={tx(readOnly ? '回放中的交换手牌' : returning ? '可还贡的牌' : '可进贡的牌')}>
        {tx(hand.map(card => <div className={`exchange-hand-card ${eligible.has(card.id) && !ready ? 'is-eligible' : ''} ${selected === card.id ? 'exchange-card-selected' : ''}`} key={card.id} data-testid="exchange-hand-card" data-card-id={card.id} data-eligible={eligible.has(card.id) && !ready ? 'true' : 'false'}>
          <PlayingCard card={card} rules={observation.rules} detail="small" interactive={!readOnly && !ready && eligible.has(card.id)} selected={card.id === selected} onClick={() => onSelect?.(card.id)}/>
        </div>))}
      </div>
    </section>
    <p className="exchange-rule-note">{tx(ready ? '先手由上一副名次和本副贡牌关系确定。' : returning ? classic ? '还牌排除全部本副级牌与大小王；A 不作为 1。所有还牌确认后，统一交换并公开。' : '本场沿用创建时的旧版还贡规则。' : '本副红心级牌不参与进贡；其他花色级牌照常比较。同点数、不同花色的实体牌等大。')}</p>
  </>;
}

export function MatchExchange({ match, observation, paused = false, continuousHints = false, onContinuousHintsChange, onCommit, onBegin, onHome, onSettings }: {
  match: MatchSession; observation: ExchangeObservation | null;
  paused?: boolean; continuousHints?: boolean; onContinuousHintsChange?: (enabled: boolean) => void;
  onCommit: (action: ExchangeAction) => boolean; onBegin: () => void; onHome: () => void; onSettings: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hint, setHintText] = useState('');
  const [hintExplanation, setHintExplanation] = useState<Explanation | null>(null);
  const setHint = (text: string, explanation?: Explanation) => { setHintText(text); setHintExplanation(explanation ?? null); };
  const [hintBusy, setHintBusy] = useState(false);
  const hintRequest = useRef<AbortController | null>(null), hintGeneration = useRef(0);
  const cancelHint = () => { hintGeneration.current++; hintRequest.current?.abort(); hintRequest.current = null; setHintBusy(false); };
  const submittedStamp = useRef<string | null>(null);
  const beginRequested = useRef(false);
  const exchange = match.exchange;
  const ready = match.phase === 'ready';
  const classic = match.journal.rulesVersion === 'guan-classic-house-v1';
  const visible = observation ? { ...observation, previous: observation.previous ?? exchange?.previous,
    currentPlayer: observation.currentPlayer ?? exchange?.currentPlayer,
    firstPlayer: observation.firstPlayer ?? exchange?.firstPlayer,
    publicTransfers: observation.publicTransfers ?? exchange?.transfers ?? [] } : null;
  const selectionKey = `${observation?.sessionId}:${observation?.handId}:${observation?.stateVersion}:${observation?.player}:${observation?.phase}`;
  useEffect(() => { setSelected(null); submittedStamp.current = null; beginRequested.current = false; }, [selectionKey]);
  useEffect(() => {
    cancelHint(); setHint('');
    return () => { hintGeneration.current++; hintRequest.current?.abort(); };
  }, [selectionKey, paused]);
  const chosen = observation?.hand.find(card => card.id === selected && observation.eligibleCardIds.includes(card.id));
  const returning = observation?.phase === 'return';
  const myTurn = !ready && !!observation?.eligibleCardIds.length;
  const getHint = () => {
    if (!observation || !myTurn || paused || hintBusy || !classic || !nativeDanlmEnabled()) return;
    skipAutomaticHint(); cancelHint(); const generation = hintGeneration.current;
    const controller = new AbortController(); hintRequest.current = controller;
    setHint(''); setHintBusy(true);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 3500);
    const pending = requestDanlmExchangeHint(observation, controller.signal).then(action => {
      if (generation !== hintGeneration.current || controller.signal.aborted) return;
      const card = observation.hand.find(card => card.id === action.cardId && observation.eligibleCardIds.includes(card.id));
      if (!card) throw Error('建议牌不在本阶段合法候选中');
      setSelected(card.id);
      setHint(`DanLM 建议${returning ? '还贡' : '进贡'}：${cardName(card)}。已高亮，请确认后提交。`, explainExchangeHint(observation, card.id));
    }).catch(error => {
      if (generation !== hintGeneration.current) return;
      setHint(`DanLM 提示暂时失败，请重试；选牌已保留。${timedOut ? '本次分析超时。' : error instanceof Error ? error.message : ''}`);
    }).finally(() => {
      window.clearTimeout(timer);
      if (generation === hintGeneration.current) { hintRequest.current = null; setHintBusy(false); }
    });
    return { promise: pending };
  };
  const skipAutomaticHint = useContinuousHint({ enabled: continuousHints, ready: myTurn && !paused && classic && nativeDanlmEnabled(), positionKey: selectionKey, request: getHint, cancel: cancelHint });
  const cancelManualHint = () => { skipAutomaticHint(); cancelHint(); };
  const hintControl = <DanlmHintButton continuous={continuousHints} onContinuousChange={enabled => { cancelHint(); onContinuousHintsChange?.(enabled); }} onHint={getHint} canHint={myTurn && !paused} busy={hintBusy} blocked={paused}
    unavailableReason={tx(!classic ? 'DanLM 贡还提示仅支持经典升级' : !nativeDanlmEnabled() ? '请用 GUAN 启动器连接本机 DanLM 模型' : undefined)} interactionKey={`${observation?.sessionId}:${observation?.handId}:${observation?.phase}`}/>;
  const submit = () => {
    if (!chosen || !observation || observation.phase === 'done' || paused) return;
    const stamp = `${observation.sessionId}:${selectionKey}`;
    if (submittedStamp.current === stamp) return;
    cancelHint(); setHint('');
    submittedStamp.current = stamp;
    const committed = onCommit({ sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion,
      player: observation.player, type: observation.phase, cardId: chosen.id });
    if (!committed) submittedStamp.current = null;
  };
  const begin = () => { if (!ready || beginRequested.current) return; beginRequested.current = true; onBegin(); };
  const level = match.saved.state.rules.levelRank;
  return <main className="exchange-screen live-exchange-screen" data-testid="match-exchange">
    <header className="exchange-header"><Brand compact/><div><span className="exchange-mode">{tx(classic ? '经典升级 · 掼蛋规则' : '旧版连续升级')}</span><MatchScoreboard progress={match.progress}/></div><div className="exchange-header-actions"><button className="quiet-button" onClick={onSettings}><Settings2 size={17}/>{tx("设置")}</button><button className="text-button" onClick={onHome}>{tx("保存并返回")}</button></div></header>
    <section className="exchange-panel" aria-labelledby="exchange-title">
      <div className="exchange-title-row"><div><div className="eyebrow">{tx("第")}{tx(match.progress.handNumber)} {tx("副 ·")}{tx(ready ? '准备落座' : '进贡还贡')}</div><h1 id="exchange-title">{tx(ready ? exchange?.antiTribute ? '抗贡成功' : '好牌，已经就位。' : myTurn ? returning ? '选一张，完成还贡。' : '选一张，完成进贡。' : '正在交换，稍候片刻。')}</h1></div><p className="exchange-level">{tx("本副全桌打")}<strong>{tx(rankName(level))}</strong><span>♥{tx(rankName(level))} {tx("逢人配")}</span></p></div>
      {tx(visible && <ExchangeDetails observation={visible} selected={selected} onSelect={id => { cancelManualHint(); setHint(''); setSelected(id === selected ? null : id); }} ready={ready} classic={classic} antiTribute={exchange?.antiTribute}/>)}
      {tx((hint || hintBusy) && <p className="exchange-hint" role="status" data-testid="exchange-hint">{tx(hintBusy ? `DanLM 正在分析${returning ? '还贡' : '进贡'}…` : <HintExplanation summary={tx(hint)} explanation={hintExplanation}/>)}</p>)}
      {tx(myTurn && <div className="exchange-confirm"><span>{tx(chosen ? `已选 ${cardName(chosen)}` : '点击金色边框的牌，再确认')}{tx((chosen || hintBusy || hint) && <button className="text-button" onClick={() => { cancelManualHint(); setHint(''); setSelected(null); }}>{tx("取消选择")}</button>)}</span><div className="exchange-hint-actions">{tx(hintControl)}<button className="primary-button" disabled={!chosen || paused} onClick={submit}>{tx(returning ? '确认还贡' : '确认进贡')}<ArrowRight size={17}/></button></div></div>)}
      {tx(!myTurn && !ready && continuousHints && <div className="exchange-hint-actions exchange-continuous-wait">{tx(hintControl)}</div>)}
      {tx(ready && <div className="exchange-ready-actions">{tx(continuousHints && hintControl)}<button className="primary-button exchange-begin" onClick={begin}>{tx("开始第")}{tx(match.progress.handNumber)} {tx("副")}<ArrowRight size={18}/></button></div>)}
      <p className="exchange-footnote">{tx("双方分别记录级数，本副四人共用同一级牌。进度仅保存在当前浏览器。")}</p>
    </section>
  </main>;
}
