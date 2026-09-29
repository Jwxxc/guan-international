import { t, tx } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { GameState, ResolvedPlay, RuleConfig, Seat } from '../engine/types';
import { partnerOf } from '../engine/rules';
import { relativeSeat, seatName, seatPosition, type SeatNames } from '../game/tableView';
import { publicPileLayouts } from '../game/cardAppearance';
import { getRoundView } from '../game/roundView';
import { displayPlayCards } from '../game/playPresentation';
import { getPlayImpact } from '../game/playImpact';
import { PlayingCard } from './PlayingCard';
import { SpecialPlayEffect, type ActivePlayImpact } from './SpecialPlayEffect';
import { wildcardDescription } from './PlayInterpretation';
import { Modal } from './Modal';
import '../styles/round-plays.css';

const roles = ['你', '对手 · 下家', '对家', '对手 · 上家'] as const;

type RoundPlayState = Pick<GameState, 'sessionId' | 'handId' | 'events' | 'currentOwner' | 'currentPlay' | 'rules' | 'currentPlayer' | 'finished' | 'result'>;
export function RoundPlays({ state, effectsEnabled = true, viewerSeat = 0, seatNames }: { state: RoundPlayState; effectsEnabled?: boolean; viewerSeat?: Seat; seatNames?: SeatNames }) {
  const root = useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:1200,height:420});
  useLayoutEffect(()=>{const el=root.current;if(!el)return;const update=()=>setSize(previous=>previous.width===el.clientWidth&&previous.height===el.clientHeight?previous:{width:el.clientWidth,height:el.clientHeight});update();const observer=new ResizeObserver(update);observer.observe(el);return()=>observer.disconnect();},[]);
  const round = getRoundView(state);
  const layouts=publicPileLayouts(size.width,size.height,round.seats.map(slot=>({position:seatPosition(slot.seat,viewerSeat),count:slot.play?.cards.length??0,current:slot.isCurrent,wild:!!slot.play?.wildcards.length,hasAction:!!slot.lastAction||!!slot.play})));
  const latest = state.events.at(-1);
  const previous = useRef({ sessionId: state.sessionId, handId: state.handId, eventIndex: latest?.index ?? -1 });
  const [animatedEvent, setAnimatedEvent] = useState<string | null>(null);
  const [impacts, setImpacts] = useState<ActivePlayImpact[]>([]);
  const [historyDetail, setHistoryDetail] = useState<{ seat: Seat; play: ResolvedPlay; rules: RuleConfig } | null>(null);
  const closeHistoryDetail = useCallback(() => setHistoryDetail(null), []);
  const seenThrough = useRef(latest?.index ?? -1);
  const removeImpact = useCallback((key: string) => setImpacts(current => current.filter(event => event.key !== key)), []);
  const eventKey = (index: number) => `${state.sessionId}:${state.handId}:${index}`;
  useEffect(() => { setHistoryDetail(null); }, [state.sessionId, state.handId]);

  // Set the initial flight pose before paint. A passive effect can expose the
  // settled cards for one frame before moving them back to the source seat.
  useLayoutEffect(() => {
    const prior = previous.current;
    const sameHand = prior.sessionId === state.sessionId && prior.handId === state.handId;
    const unseen = sameHand && latest && latest.index > seenThrough.current;
    if (!sameHand) seenThrough.current = latest?.index ?? -1;
    else seenThrough.current = Math.max(seenThrough.current, latest?.index ?? -1);
    // Saved/replayed tables mount as still life. Only a newly observed action
    // flies in; rendering, settings changes, and passes cannot replay a flight.
    if (effectsEnabled && sameHand && latest && latest.index > prior.eventIndex && latest.type === 'play' && !latest.roundEnded) {
      setAnimatedEvent(`${state.sessionId}:${state.handId}:${latest.index}`);
    } else if (!effectsEnabled || !sameHand || (latest?.index ?? -1) < prior.eventIndex || !state.currentPlay) {
      setAnimatedEvent(null);
    }
    if (!effectsEnabled || !sameHand || !state.currentPlay || (latest?.index ?? -1) < prior.eventIndex) {
      setImpacts([]);
    } else if (unseen && latest.type === 'play' && !latest.roundEnded) {
      const impact = getPlayImpact(latest.play);
      // A seat may immediately replace its prior flourish; other seats finish
      // independently. Each child clears its own timer on expiry or unmount.
      setImpacts(current => [...current.filter(event => event.seat !== latest.player), ...(impact ? [{ key: `${state.sessionId}:${state.handId}:${latest.index}`, seat: latest.player, eventIndex: latest.index, impact }] : [])]);
    }
    previous.current = { sessionId: state.sessionId, handId: state.handId, eventIndex: latest?.index ?? -1 };
  }, [state.sessionId, state.handId, state.currentPlay, latest, effectsEnabled]);

  useEffect(() => {
    if (!animatedEvent) return;
    const timeout = window.setTimeout(() => setAnimatedEvent(null), 580);
    return () => window.clearTimeout(timeout);
  }, [animatedEvent]);

  const announcement = round.lastEvent
    ? (round.lastEvent.type === 'pass'
      ? t('{0}不出。', [tx(seatName(round.lastEvent.player, seatNames))])
      : t('{0}打出{1}。', [tx(seatName(round.lastEvent.player, seatNames)), tx(round.lastEvent.play?.label ?? '一手牌')]))
      + (state.currentOwner !== null && state.currentPlay ? t('当前待压牌由{0}打出：{1}。', [tx(seatName(state.currentOwner, seatNames)), tx(state.currentPlay.label)]) : '')
    : t('{0}，{1}领出。', [tx(state.events.length ? '新一轮' : '起手'), tx(seatName(state.currentPlayer, seatNames))]);

  return <div ref={root} className="round-plays round-plays-responsive" aria-label={tx("本轮各家出牌")}>
    <div className="round-plays-announcement" aria-live="polite" aria-atomic="true">{tx(announcement)}</div>
    {tx(round.seats.map(slot => {
      const layout=layouts[slot.seat]!;
      const info = { name: seatName(slot.seat, seatNames), position: seatPosition(slot.seat, viewerSeat) };
      const hasAction = !!slot.lastAction || !!slot.play;
      const didPass = slot.lastAction?.type === 'pass';
      const isTurn = !state.result && state.currentPlayer === slot.seat;
      const isHistory = !!slot.play && !slot.isCurrent;
      const animate = slot.playEventIndex !== null && animatedEvent === eventKey(slot.playEventIndex);
      const impact = impacts.find(event => event.seat === slot.seat && event.eventIndex === slot.playEventIndex);
      return <section key={slot.seat}
        className={`round-plays-slot round-plays-${info.position}${slot.isCurrent ? ' round-plays-current' : ''}${isHistory ? ' round-plays-history' : ''}${layout.compact ? ' is-compact-history' : ''}${hasAction ? '' : ' round-plays-empty-slot'}`}
        style={{'--round-card-width':`${layout.width}px`,'--round-card-height':`${layout.height}px`,'--round-card-step':`${layout.step}px`,'--round-slot-width':`${layout.slotWidth}px`,left:layout.x,top:layout.bottom?'auto':layout.y,bottom:layout.bottom?layout.y:'auto'} as CSSProperties}
        data-spread={layout.step>=layout.width*.5?'open':'tight'} data-card-detail={layout.detail} data-testid={`seat-play-${slot.seat}`} data-owner={slot.seat} data-current={slot.isCurrent}
        data-current-turn={isTurn} data-finished={state.finished.includes(slot.seat)}
        data-play-key={slot.play?.key} data-state={slot.isCurrent ? 'current' : didPass ? 'passed' : isHistory ? 'history' : 'empty'}
        aria-label={tx(`${info.name}，${roles[relativeSeat(slot.seat, viewerSeat)]}，${slot.play?.label ?? (didPass ? '不出' : '本轮尚未出牌')}${slot.isCurrent ? '，当前待压牌' : ''}${didPass && slot.play ? '，最近一次行动不出' : ''}`)}>
        {tx(hasAction && <>
          <div className="round-plays-owner"><strong>{tx(info.name)}</strong>{tx(slot.seat === partnerOf(viewerSeat) && <span className="round-plays-role">{tx("对家")}</span>)}{tx(slot.isCurrent && <span className="round-plays-live">{tx("待压牌")}</span>)}</div>
          {tx(slot.play ? <>
            <div className={`round-plays-pile${animate ? ' round-plays-enter' : ''}${impact?.impact.tier === 'royal' ? ' round-plays-power-royal' : impact?.impact.kind === 'bomb' && impact.impact.tier === 'strong' ? ' round-plays-power-strong' : ''}`}
              key={eventKey(slot.playEventIndex ?? -1)}
              data-testid={slot.isCurrent ? 'current-play' : undefined}
              data-owner={slot.seat} data-event-index={slot.playEventIndex ?? undefined}>
              {tx(displayPlayCards(slot.play, state.rules).map((card, index) => <div className="round-plays-card" key={card.id} style={{ '--round-card-delay': `${index * 12}ms` } as CSSProperties}><PlayingCard card={card} rules={state.rules} detail={layout.detail} jokerExposure={index < slot.play!.cards.length - 1 && layout.step < layout.width ? 'left' : 'full'} jokerStrip={layout.step}/></div>))}
            </div>
            <div className="round-plays-caption"><span>{tx(slot.play.label)}</span>{tx(isHistory && <span className="round-plays-superseded">{tx("已被压过")}</span>)}{tx(didPass && <b className="round-plays-pass">{tx("不出")}</b>)}</div>
            {tx(slot.play.wildcards.length > 0 && <div className="round-plays-wild">{tx(wildcardDescription(slot.play))}</div>)}
            {tx(isHistory && <button type="button" className="round-history-detail-button" data-testid={`history-detail-seat-${slot.seat}`}
              aria-label={tx(`查看${info.name}本轮历史牌张`)} aria-haspopup="dialog" aria-expanded={historyDetail?.seat === slot.seat}
              onClick={event => {
                // Safari does not focus a mouse-clicked button by default. The
                // shared modal restores this explicit public-history trigger.
                event.currentTarget.focus();
                setHistoryDetail(structuredClone({ seat: slot.seat, play: slot.play!, rules: state.rules }));
              }}>{tx("查看牌张")}</button>)}
          </> : didPass && <div className="round-plays-pass-only">{tx("不出")}</div>)}
        </>)}
        {tx(impact && <SpecialPlayEffect key={impact.key} event={impact} onDone={removeImpact}/>)}
      </section>;
    }))}
    {tx(!state.currentPlay && <div className="round-plays-lead"><span>{tx(state.events.length ? '新一轮' : '起手')}</span><p>{tx(seatName(state.currentPlayer, seatNames))}{tx("领出")}</p>{tx(latest?.roundEnded && <small>{tx("上一轮已收起")}</small>)}</div>)}
    {tx(historyDetail && createPortal(<Modal title={tx(`${seatName(historyDetail.seat, seatNames)} · 本轮历史牌`)} onClose={closeHistoryDetail} wide>
      <div className="round-history-detail" data-testid="history-play-detail" data-play-key={historyDetail.play.key}>
        <p className="round-history-detail-label">{tx(historyDetail.play.label)}<span>{tx("已被压过")}</span></p>
        <div className="round-history-detail-cards">{tx(displayPlayCards(historyDetail.play, historyDetail.rules).map(card => <div key={card.id} data-history-card-id={card.id}><PlayingCard card={card} rules={historyDetail.rules}/></div>))}</div>
        {tx(historyDetail.play.wildcards.length > 0 && <p className="round-history-detail-mapping" data-testid="history-wild-mapping">{tx(wildcardDescription(historyDetail.play))}</p>)}
        <p className="round-history-detail-note">{tx("这里展示本轮已经公开的实际牌张与提交解释。")}</p>
      </div>
    </Modal>, document.body))}
  </div>;
}
