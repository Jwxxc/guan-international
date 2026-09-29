import { tx } from '../i18n';
import { useMemo, useState, type ReactNode } from 'react';
import type { SavedGame } from '../game/persistence';
import type { GameState, Seat } from '../engine/types';
import { getReplayStates } from '../game/replay';
import { clampReplayIndex, initialReplayHandIndex, nextReplayPlayIndex } from '../game/replayNavigation';
import { getMatchHistory, getMatchReplayHand, type ReplaySource } from '../match/replay';
import { Table } from './Table';
import { ExchangeDetails } from './MatchExchange';
import { rankName } from '../engine/rules';
import { toTableView, seatName, type SeatNames } from '../game/tableView';
import { otherReplaySeats, replaySeatInfo, replayLabelForViewer, replayExchangeForViewer, type ReplaySeatKinds } from '../game/replayView';
import { PlayingCard } from '../components/PlayingCard';
import { Brand } from '../components/Brand';
import { MatchScoreboard } from '../components/MatchScoreboard';
import '../styles/replay.css';

type ReplayProps = { source: ReplaySource; muted: boolean; onMute: () => void; onExit: () => void; musicEnabled?: boolean; onMusicToggle?: () => void; viewerSeat?: Seat; seatNames?: SeatNames; seatKinds?: ReplaySeatKinds; initialHandId?: string };
function ReplaySteps({ index, count, onSeek, nextPlay, start, result, completed = true }: { index: number; count: number; onSeek: (index: number) => void; nextPlay: number | null; start?: number; result?: number; completed?: boolean }) {
  return <div className="replay-steps">
    <button className="secondary-button" onClick={() => onSeek(start ?? 0)} disabled={index === (start ?? 0)}>{tx(start === undefined ? '回到开局' : '本副开始')}</button>
    <button className="secondary-button" onClick={() => onSeek(index - 1)} disabled={index === 0}>{tx("上一步")}</button>
    <span data-testid="replay-step">{tx(index)} / {tx(count - 1)}</span>
    <button className="secondary-button" onClick={() => onSeek(index + 1)} disabled={index === count - 1}>{tx("下一步")}</button>
    <button className="secondary-button replay-next-play" onClick={() => { if (nextPlay !== null) onSeek(nextPlay); }} disabled={nextPlay === null} title={tx("跳到你下一次实际出牌之前；略过不出")}>{tx("下次我出牌")}</button>
    {tx(result !== undefined && <button className="secondary-button" onClick={() => onSeek(result)} disabled={!completed || index === result}>{tx("本副结算")}</button>)}
  </div>;
}
function ReplayTimeline({ index, count, onSeek, label }: { index: number; count: number; onSeek: (index: number) => void; label: string }) {
  return <label className="replay-timeline"><span>{tx("回放进度")}</span><input type="range" min={0} max={Math.max(0, count - 1)} step={1} value={index} disabled={count < 2} onChange={event => onSeek(Number(event.target.value))} aria-label={tx("回放进度")} aria-valuetext={tx(`第 ${index} 步，共 ${count - 1} 步。${label}`)}/><span className="replay-timeline-hint" aria-hidden="true">{tx("拖动定位")}</span></label>;
}
function AllHands({ state, onClose, viewerSeat = 0, seatNames }: { state: GameState; onClose: () => void; viewerSeat?: Seat; seatNames?: SeatNames }) {
  return <div className="all-hands-panel"><div className="all-hands-title"><strong>{tx("赛后全信息视角")}</strong><button className="text-button" onClick={onClose}>{tx("收起 ×")}</button></div>{tx(otherReplaySeats(viewerSeat).map(seat => <div className="replay-player-hand" key={seat}><span>{tx(seatName(seat, seatNames))} · {tx(state.hands[seat].length)} {tx("张")}</span><div>{tx(state.hands[seat].map((card,index) => <PlayingCard key={card.id} card={card} rules={state.rules} detail="tiny" jokerExposure={index < state.hands[seat].length - 1 ? 'left' : 'full'} jokerStrip={29}/>))}</div></div>))}</div>;
}
function ReplayTable({ state, props, matchStatus, replayLabel }: { state: GameState; props: Omit<ReplayProps, 'source'>; matchStatus?: ReactNode; replayLabel?: string }) {
  const view = useMemo(() => toTableView(state, props.viewerSeat ?? 0, replaySeatInfo(props.seatNames, props.seatKinds)), [state, props.viewerSeat, props.seatNames, props.seatKinds]);
  return <Table view={view} muted={props.muted} paused={false} dealing={false} replayMode musicEnabled={props.musicEnabled} onMusicToggle={props.onMusicToggle} onMute={props.onMute} onSettings={() => undefined} onCommit={() => false} onSound={() => undefined} matchStatus={matchStatus} replayLabel={tx(replayLabel)}/>;
}
function PracticeReplay({ saved, ...props }: { saved: SavedGame } & Omit<ReplayProps, 'source'>) {
  const states = useMemo(() => getReplayStates(saved), [saved]);
  const [index, setIndex] = useState(0);
  const [allHands, setAllHands] = useState(false);
  const safeIndex = clampReplayIndex(index, states.length);
  const state = states[safeIndex]!;
  const event = state.events[state.events.length - 1];
  const label = replayLabelForViewer(event?.message ?? '开局：每人 27 张，随机先手。', props.viewerSeat, props.seatNames);
  const seek = (target: number) => setIndex(clampReplayIndex(target, states.length));
  const nextPlay = nextReplayPlayIndex(states, safeIndex, props.viewerSeat ?? 0);
  const controls = <div className="replay-toolbar"><button className="text-button" onClick={props.onExit}>{tx("← 退出回放")}</button><ReplaySteps index={safeIndex} count={states.length} onSeek={seek} nextPlay={nextPlay}/><label className="replay-view"><input type="checkbox" checked={allHands} onChange={e => setAllHands(e.target.checked)}/>{tx("查看全桌手牌")}</label><ReplayTimeline index={safeIndex} count={states.length} onSeek={seek} label={tx(label)}/></div>;
  return <div className="replay-screen">{tx(controls)}<ReplayTable state={state} props={props}/><div className="replay-event" aria-live="polite">{tx(label)}{tx(allHands && <strong>{tx("赛后全信息视角")}</strong>)}</div>{tx(allHands && <AllHands state={state} viewerSeat={props.viewerSeat} seatNames={props.seatNames} onClose={() => setAllHands(false)}/>)}</div>;
}
function MatchReplay({ source, ...props }: ReplayProps & { source: Extract<ReplaySource, { kind: 'match' }> }) {
  const match = source.match;
  const history = useMemo(() => getMatchHistory(match), [match]);
  const [handIndex, setHandIndex] = useState(() => initialReplayHandIndex(history, props.initialHandId));
  const [index, setIndex] = useState(0);
  const [allHands, setAllHands] = useState(false);
  const hand = useMemo(() => getMatchReplayHand(match, handIndex), [match, handIndex]);
  const safeIndex = clampReplayIndex(index, hand.frames.length);
  const frame = hand.frames[safeIndex]!;
  const classic = match.journal.rulesVersion === 'guan-classic-house-v1';
  const canSeeAllHands = !!hand.summary.result;
  const states = useMemo(() => hand.frames.map(frame => frame.state), [hand]);
  const nextPlay = nextReplayPlayIndex(states, safeIndex, props.viewerSeat ?? 0);
  const seek = (target: number) => setIndex(clampReplayIndex(target, hand.frames.length));
  const label = replayLabelForViewer(frame.label, props.viewerSeat, props.seatNames);
  const controls = <div className="replay-toolbar match-replay-toolbar">
    <button className="text-button" onClick={props.onExit}>{tx("← 退出回放")}</button>
    <label className="replay-hand-picker">{tx("选择副数")}<select aria-label={tx("选择回放副数")} value={handIndex} onChange={event => { setHandIndex(Number(event.target.value)); setIndex(0); setAllHands(false); }}>{tx(history.map((record, position) => <option key={record.handId} value={position}>{tx("第")}{tx(record.handNumber)} {tx("副 · 打")}{tx(rankName(record.levelRank))}{tx(record.result ? '' : ' · 进行中')}</option>))}</select></label>
    <ReplaySteps index={safeIndex} count={hand.frames.length} onSeek={seek} nextPlay={nextPlay} start={hand.startIndex} result={hand.resultIndex} completed={canSeeAllHands}/>
    {tx(canSeeAllHands && <label className="replay-view"><input type="checkbox" checked={allHands} onChange={event => setAllHands(event.target.checked)}/>{tx("查看全桌手牌")}</label>)}
    <ReplayTimeline index={safeIndex} count={hand.frames.length} onSeek={seek} label={tx(label)}/>
  </div>;
  const exchangeObservation = props.viewerSeat !== undefined || props.seatNames ? replayExchangeForViewer(frame, props.viewerSeat ?? 0, classic) : frame.exchange;
  const exchangeFrame = frame.exchange && ['deal', 'tribute', 'return', 'ready'].includes(frame.phase);
  return <div className="replay-screen match-replay-screen" data-testid="match-replay" data-replay-phase={frame.phase}>
    {tx(controls)}
    {tx(exchangeFrame && frame.exchange ? <main className="exchange-screen replay-exchange-screen"><header className="exchange-header"><Brand compact/><div><span className="exchange-mode">{tx(classic ? '经典升级 · 掼蛋规则' : '旧版连续升级')} {tx("· 整场回放")}</span><MatchScoreboard progress={frame.progress} viewerSeat={props.viewerSeat}/></div><p className="exchange-level">{tx("本副全桌打")}<strong>{tx(rankName(frame.state.rules.levelRank))}</strong></p></header><section className="exchange-panel"><div className="exchange-title-row"><h1>{tx(frame.phase === 'tribute' ? '进贡记录' : frame.phase === 'return' ? '还贡记录' : frame.phase === 'ready' ? '交换已完成' : '本副发牌')}</h1><span className="replay-phase-badge">{tx("第")}{tx(hand.summary.handNumber)} {tx("副 · 实际交换记录")}</span></div><ExchangeDetails observation={exchangeObservation!} seatNames={props.seatNames} ready={frame.phase === 'ready'} readOnly classic={classic} antiTribute={frame.antiTribute}/></section></main>
      : <ReplayTable state={frame.state} props={props} matchStatus={<MatchScoreboard progress={frame.progress} viewerSeat={props.viewerSeat}/>} replayLabel={tx(`整场回放 · 第 ${hand.summary.handNumber} 副`)}/>)}
    <div className="replay-event match-replay-event" aria-live="polite" data-testid="match-replay-event">{tx(label)}{tx(allHands && canSeeAllHands && <strong>{tx("本副已结束 · 全信息视角")}</strong>)}</div>
    {tx(allHands && canSeeAllHands && <AllHands state={frame.state} viewerSeat={props.viewerSeat} seatNames={props.seatNames} onClose={() => setAllHands(false)}/>)}
  </div>;
}
export function Replay({ source, ...props }: ReplayProps) {
  return source.kind === 'practice' ? <PracticeReplay key={source.saved.state.handId} saved={source.saved} {...props}/> : <MatchReplay key={`${source.match.journal.matchId}:${props.initialHandId ?? ''}`} source={source} {...props}/>;
}
