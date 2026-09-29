import { tx } from '../i18n';
import { useEffect, useState } from 'react';
import type { GameState, ResolvedPlay, Seat } from '../engine/types';
import { getRoundView } from '../game/roundView';
import { displayPlayCards } from '../game/playPresentation';
import { isWild } from '../engine/cards';
import { rankName } from '../engine/rules';
import { Modal } from '../components/Modal';
import { PlayingCard, cardName, suitSymbol } from '../components/PlayingCard';
import { wildcardDescription } from '../components/PlayInterpretation';
import { STUDY_NAMES } from './model';

/** Compact public indices fit the study arena; full physical cards and wildcard
 * declarations remain available in the same accessible modal used by the game. */
export function StudyRound({ state, viewer, onInspect }: { state: GameState; viewer: Seat; onInspect: () => void }) {
  const round = getRoundView(state);
  const [detail, setDetail] = useState<{ seat: Seat; play: ResolvedPlay } | null>(null);
  useEffect(() => { setDetail(null); }, [state.handId, state.stateVersion, viewer]);
  const seats = [3, 2, 1, 0].map(offset => ((viewer + offset) % 4) as Seat);
  if (!round.events.length && !state.currentPlay) return <div className="study-round-lead"><span>{tx(state.events.length ? '新一轮' : '起手')}</span><strong>{tx(STUDY_NAMES[state.currentPlayer])}{tx("领出")}</strong></div>;
  return <>
    <div className="study-round" aria-label={tx("本轮各家出牌")}>{tx(seats.map(seat => {
      const slot = round.seats[seat], play = slot.play;
      const passed = slot.lastAction?.type === 'pass';
      return <button key={seat} type="button" className={`study-round-slot ${slot.isCurrent ? 'study-round-current' : ''}`} data-testid={`study-play-${seat}`}
        disabled={!play} aria-label={tx(`${STUDY_NAMES[seat]}：${play?.label ?? (passed ? '不出' : '尚未行动')}${play ? '，查看完整牌张' : ''}`)}
        onClick={event => { if (play) { event.currentTarget.focus(); onInspect(); setDetail({ seat, play }); } }}>
        <span className="study-round-owner"><strong>{tx(STUDY_NAMES[seat])}</strong><span>{tx(slot.isCurrent ? '待压牌' : passed ? '不出' : seat === viewer ? '关注席位' : '')}</span></span>
        {tx(play ? <><span className="study-round-indices">{tx(displayPlayCards(play, state.rules).map(card => <span className={`study-play-index ${card.suit === 'H' || card.suit === 'D' || card.rank === 16 ? 'is-red' : ''}`} key={card.id} aria-label={tx(cardName(card))}><b>{tx(rankName(card.rank))}</b>{tx(card.rank < 15 && <span>{tx(suitSymbol(card.suit))}</span>)}{tx(isWild(card, state.rules) && <i>{tx("配")}</i>)}</span>))}</span><span className="study-round-caption">{tx(play.label)}{tx(passed ? ' · 后续不出' : '')}<span>{tx("查看 ↗")}</span></span></>
          : <span className="study-round-no-play">{tx(passed ? '不出' : state.currentPlayer === seat && !state.result ? '待行动' : '—')}</span>)}
      </button>;
    }))}</div>
    {tx(detail && <Modal title={tx(`${STUDY_NAMES[detail.seat]} · ${detail.play.label}`)} onClose={() => setDetail(null)} wide>
      <div className="study-round-detail" data-testid="study-play-detail"><p>{tx("本轮实际出牌 ·")}{tx(detail.play.cards.length)} {tx("张")}</p><div>{tx(displayPlayCards(detail.play, state.rules).map(card => <PlayingCard key={card.id} card={card} rules={state.rules}/>))}</div>
        {tx(!!detail.play.wildcards.length && <p>{tx(wildcardDescription(detail.play))}</p>)}<p>{tx("关闭后保持暂停，可以继续单步研习。")}</p></div>
    </Modal>)}
  </>;
}
