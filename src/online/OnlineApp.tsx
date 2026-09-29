import { tx } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, LockKeyhole, Settings2, Users, X } from 'lucide-react';
import { StatisticsDialog } from '../components/StatisticsDialog';
import { importAvailableHistory } from '../statistics/recording';
import { Brand } from '../components/Brand';
import { Modal } from '../components/Modal';
import { MatchScoreboard } from '../components/MatchScoreboard';
import { Table } from '../screens/Table';
import { Results } from '../screens/Results';
import { Replay } from '../screens/Replay';
import { ExchangeDetails } from '../screens/MatchExchange';
import { cardName } from '../components/PlayingCard';
import { useBackgroundMusic } from '../audio/useBackgroundMusic';
import { MusicSettings } from '../components/MusicSettings';
import { loadSettings, saveSettings, type Settings } from '../game/persistence';
import { startAiTask, type AiTask } from '../game/aiTask';
import {resolveStrategy,STRATEGY_LABELS} from '../ai/descriptors';
import type {AiTier,StrategyDescriptor} from '../ai/strategyTypes';
import {PLAYER_TIERS} from '../game/playerTiers';
import { useVictoryMoment } from '../game/useVictoryMoment';
import { getPlayImpact } from '../game/playImpact';
import { restoreMatchJournal } from '../match/session';
import type { ReplaySource } from '../match/replay';
import type { GameAction, Seat } from '../engine/types';
import { rankName } from '../engine/rules';
import { OnlineConnection, emptyOnlineState, type OnlineClientState } from './client';
import { ROOM_CODE_PATTERN, type OnlineAction } from './protocol';
import { forgetOnlineSession } from './storage';
import { onlineTableView } from './view';
import { encodeOnlineReplay, decodeOnlineReplay } from './replayFile';
import '../styles/match.css';
import './online.css';

const hostingNote = '私人房间目前由房主设备临时托管。房主电脑休眠、关机或关闭联机服务后，牌局会中断。';
const hintFailureNotice = '提示计算暂时失败，请再点一次提示；没有替你出牌或“不出”。';
const connectionText = { connecting: '正在连接', online: '已连接', reconnecting: '正在重连', offline: '已离线', replaced: '连接已结束' };
export default function OnlineApp({ initialRoomCode = null }: { initialRoomCode?: string | null }) {
  const [net, setNet] = useState<OnlineClientState>(emptyOnlineState);
  const connection = useRef<OnlineConnection | null>(null), latest = useRef(net); latest.current = net;
  const [settings, setSettings] = useState<Settings>(() => loadSettings().value);
  const [nickname, setNickname] = useState(''), [roomInput, setRoomInput] = useState(initialRoomCode ?? '');
  const [recoveryInput, setRecoveryInput] = useState(''), [recoverForm, setRecoverForm] = useState(false), [showRecovery, setShowRecovery] = useState(false);
  const [takeover, setTakeover] = useState(true), [copyNotice, setCopyNotice] = useState(''), [localNotice, setLocalNotice] = useState('');
  const [dialog, setDialog] = useState<'settings' | 'leave' | 'dissolve' | 'info' | 'statistics' | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);
  useEffect(() => { const error = importAvailableHistory(); if (error) setLocalNotice(error); }, []);
  const [selectedExchange, setSelectedExchange] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplaySource | null>(null);
  const [replayNames, setReplayNames] = useState<Partial<Record<Seat, string>>>({});
  const [replayKinds, setReplayKinds] = useState<Partial<Record<Seat, 'human' | 'ai'>>>({});
  const [replayViewer, setReplayViewer] = useState<Seat>(0);
  const hint = useRef<AiTask | null>(null);
  const updateSettings = (patch: Partial<Settings>) => setSettings(previous => { const next = { ...previous, ...patch }; const error = saveSettings(next); if (error) setLocalNotice(error); return next; });
  const { musicStatus, sound } = useBackgroundMusic(settings, musicTrack => updateSettings({ musicTrack }));
  useEffect(() => {
    const client = new OnlineConnection(initialRoomCode, setNet); connection.current = client; client.connect();
    return () => { client.close(); connection.current = null; hint.current?.cancel(); };
  }, [initialRoomCode]);
  useEffect(() => { hint.current?.cancel(); }, [net.observation?.stateVersion, net.connection, net.presentationEpoch, dialog]);
  useEffect(() => { setSelectedExchange(null); }, [net.observation?.game.handId, net.observation?.exchange?.stateVersion]);
  useEffect(() => { if (net.connection === 'replaced') setDialog(null); }, [net.connection]);
  const room = net.room, packet = net.observation;
  const view = useMemo(() => room && packet && room.roomCode === packet.roomCode ? onlineTableView(packet, room) : null, [room, packet]);
  const names = useMemo(() => Object.fromEntries(room?.seats.map(seat => [seat.seat, seat.nickname]) ?? []) as Partial<Record<Seat, string>>, [room]);
  const synced = net.authenticated && net.connection === 'online' && !!room && (room.phase === 'lobby' || packet?.stateVersion === room.stateVersion);
  const canAct = synced && !net.pending;
  const host = !!room && room.hostPlayerId === net.session?.playerId;
  const mine = room?.seats.find(seat => seat.playerId === net.session?.playerId);
  const victory = useVictoryMoment(view, synced && !dialog && !replay, settings.reducedMotion, packet?.progress.winner, { viewerSeat: view?.viewerSeat, seatNames: names, presentationEpoch: net.presentationEpoch });
  const soundSeen = useRef({ hand: '', index: -1, epoch: -1 });
  useEffect(() => {
    const event = view?.events.at(-1), previous = soundSeen.current;
    if (view && synced && event?.type === 'play' && previous.hand === view.handId && previous.epoch === net.presentationEpoch && event.index > previous.index) sound(getPlayImpact(event.play)?.sound ?? 'play');
    soundSeen.current = { hand: view?.handId ?? '', index: event?.index ?? -1, epoch: net.presentationEpoch };
  }, [view, synced, net.presentationEpoch, sound]);
  const mutate = (intent: Parameters<OnlineConnection['mutate']>[0]) => connection.current?.mutate(intent);
  const invite = room ? `${window.location.origin}/room/${room.roomCode}` : '';
  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); setCopyNotice(message); }
    catch { setCopyNotice('复制未成功，请选中文本框里的内容手动复制。'); }
  };
  const chooseHint = (): AiTask => {
    const current = latest.current, observation = current.observation;
    if (!observation || !current.authenticated || observation.phase !== 'playing') return { promise: Promise.resolve(null), cancel: () => {} };
    hint.current?.cancel();
    let descriptor:StrategyDescriptor;
    try{descriptor=resolveStrategy(observation.policy);if(!observation.policyDescriptor||resolveStrategy(observation.policyDescriptor).descriptorHash!==descriptor.descriptorHash)throw Error('descriptor mismatch');}
    catch{setLocalNotice('无法计算本副提示：策略或预算版本不兼容，请刷新页面。');return{promise:Promise.resolve(null),cancel:()=>{}};}
    const task = startAiTask(observation.game, descriptor, ((observation.game.stateVersion + 1) * 2246822519 + observation.game.player * 971 + 0x48494e54) >>> 0);
    hint.current = task;
    return { cancel: task.cancel, promise: task.promise.then(result => {
      const now = latest.current;
      if (!result || !now.authenticated || now.observation?.roomCode !== observation.roomCode || now.observation.stateVersion !== observation.stateVersion || now.presentationEpoch !== current.presentationEpoch) return null;
      if (result.identity.fallbackReason) {
        setLocalNotice(hintFailureNotice);
        return null;
      }
      setLocalNotice(previous => previous === hintFailureNotice ? '' : previous);
      return result;
    }) };
  };
  const commit = (action: GameAction): boolean => {
    if (!canAct || !packet || action.player !== packet.game.player) return false;
    const intent: OnlineAction = action.type === 'pass' ? { type: 'pass' } : { type: 'play', cardIds: action.cardIds, playKey: action.playKey };
    void mutate({ type: 'game:action', handId: packet.game.handId, action: intent });
    return false; // Keep selection and cards until a new authoritative observation arrives.
  };
  const handCommand = (type: 'nextHand' | 'beginHand') => { if (packet && canAct) void mutate({ type: 'game:action', handId: packet.game.handId, action: { type } }); };
  const leave = async () => {
    if (room && net.authenticated) {
      const result = await mutate({ type: 'room:leave' });
      if (!result?.ok) return;
      if (room.phase === 'lobby') forgetOnlineSession(room.roomCode);
    }
    window.location.assign('/');
  };
  const viewReplay = async () => {
    const result = await connection.current?.replay();
    if (!result?.ok || !result.replay) return;
    try {
      setReplay({ kind: 'match', match: restoreMatchJournal(result.replay) }); setReplayNames(names); setReplayViewer(view?.viewerSeat ?? 0);
      setReplayKinds(Object.fromEntries(room?.seats.map(seat => [seat.seat, seat.kind === 'ai' ? 'ai' : 'human']) ?? []));
    }
    catch { setLocalNotice('这份回放暂时无法读取，牌桌记录仍保存在房主设备。'); }
  };
  const downloadReplay = async () => {
    const journal = replay?.kind === 'match' ? replay.match.journal : null;
    if (!journal) return;
    const encoded = encodeOnlineReplay(journal, replayNames, replayViewer, Object.keys(replayKinds).length ? replayKinds : undefined);
    const url = URL.createObjectURL(new Blob([encoded], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `GUAN-${room?.roomCode ?? '已完成牌局'}-完整回放.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importReplay = async (file?: File) => {
    if (!file) return;
    if (file.size > 8_000_000) { setLocalNotice('回放文件过大，暂时无法读取。'); return; }
    try {
      const loaded = decodeOnlineReplay(await file.text()); setReplay(loaded.source); setReplayNames(loaded.seatNames);
      setReplayViewer(loaded.viewerSeat); setReplayKinds(loaded.seatKinds ?? {}); setLocalNotice('');
    } catch { setLocalNotice('这份文件不是完整有效的 GUAN 联机回放。'); }
  };
  const notice = localNotice || (!replay ? room?.aiNotice || net.notice : '');
  const validName = !!nickname.trim() && [...nickname.trim()].length <= 16 && !/[\p{Cc}\p{Cf}]/u.test(nickname);
  const formReady = net.connection === 'online' && !net.pending;
  const tableReady = room && packet && view && room.phase !== 'lobby';
  const stateLabel = synced ? net.pending ? '提交中…' : '已连接' : connectionText[net.connection];
  return <div className={`app online-app ${settings.reducedMotion ? 'reduced-motion' : ''}`} data-music-status={musicStatus}>
    {tx(replay ? <><Replay source={replay} viewerSeat={replayViewer} seatNames={replayNames} seatKinds={replayKinds} muted={settings.muted} onMute={() => updateSettings({ muted: !settings.muted })} onExit={() => setReplay(null)} musicEnabled={settings.musicEnabled} onMusicToggle={() => updateSettings({ musicEnabled: !settings.musicEnabled })}/><button className="online-download-replay quiet-button" onClick={downloadReplay}>{tx("下载完整回放")}</button></>
      : !room ? <main className="private-room-screen private-entry">
        <header className="private-header"><Brand compact/><button className="quiet-button" onClick={() => setDialog('statistics')}>{tx("个人战绩")}</button><button className="quiet-button" onClick={() => window.location.assign('/')}><ArrowLeft size={16}/>{tx("返回首页")}</button></header>
        <section className="private-entry-copy"><div className="eyebrow">{tx("FRIENDS & FAMILY · 私人联机")}</div><h1>{tx("熟悉的人，")}<br/>{tx("同一桌好牌。")}</h1><p>{tx("分享一桌，为朋友留个位置。空位可以交给电脑。")}</p></section>
        <section className="private-entry-panel" aria-labelledby="private-title"><h2 id="private-title">{tx(initialRoomCode ? `加入房间 ${initialRoomCode}` : '私人牌局')}</h2><p className={`online-connection ${net.connection}`} role="status">{tx(connectionText[net.connection])}</p>
          {tx(net.session && !net.authenticated && <button className="secondary-button" disabled={!formReady} onClick={() => connection.current?.reconnect()}>{tx("重试恢复座位")}</button>)}
          <label className="private-field">{tx("你的昵称")}<input aria-label={tx("你的昵称")} value={nickname} onChange={event => setNickname(event.target.value)} maxLength={32} placeholder={tx("1–16 个字")} autoComplete="nickname"/></label>
          {tx(!initialRoomCode && <><label className="private-check"><input type="checkbox" checked={takeover} onChange={event => setTakeover(event.target.checked)}/>{tx("离线 30 秒后电脑托管")}</label><button className="primary-button" disabled={!formReady || !validName} onClick={() => { void connection.current?.create(nickname.trim(), takeover); }}>{tx("创建私人牌局")}<ArrowRight size={17}/></button><div className="private-divider">{tx("或加入朋友的牌桌")}</div></>)}
          <label className="private-field">{tx("房间号")}<input aria-label={tx("房间号")} value={roomInput} onChange={event => setRoomInput(event.target.value.trim().toUpperCase())} maxLength={6} autoCapitalize="characters" spellCheck={false}/></label>
          <button className={initialRoomCode ? 'primary-button' : 'secondary-button'} disabled={!formReady || !validName || !ROOM_CODE_PATTERN.test(roomInput)} onClick={() => { void connection.current?.join(roomInput, nickname.trim()); }}>{tx("加入牌局")}<Users size={17}/></button>
          <button className="text-button private-recover-toggle" onClick={() => setRecoverForm(!recoverForm)}>{tx("恢复原座位")}</button>
          {tx(recoverForm && <div className="private-recover-form"><label className="private-field">{tx("座位恢复码")}<input type="password" aria-label={tx("座位恢复码")} value={recoveryInput} onChange={event => setRecoveryInput(event.target.value)} autoComplete="off" maxLength={100}/></label><button className="secondary-button" disabled={!formReady || !ROOM_CODE_PATTERN.test(roomInput) || !/^[a-f0-9]{64}$/i.test(recoveryInput.replace(/[\s-]/g, ''))} onClick={() => { void connection.current?.recover(roomInput, recoveryInput); }}>{tx("恢复我的座位")}</button><p>{tx("用于换网址后找回自己的座位，不要发给其他人。")}</p></div>)}
          <label className="private-replay-import text-button">{tx("查看已下载回放")}<input type="file" aria-label={tx("导入完整联机回放")} accept=".json,application/json" onChange={event => { void importReplay(event.target.files?.[0]); event.target.value = ''; }}/></label>
        </section><p className="private-hosting-note">{tx(hostingNote)}</p>
      </main> : room.phase === 'lobby' ? <main className="private-room-screen" data-testid="online-lobby">
        <header className="private-header"><Brand compact/><button className="quiet-button" onClick={() => setDialog('statistics')}>{tx("个人战绩")}</button><div className="private-heading"><span>{tx("私人牌局")}</span><h1>{tx("房间")}{tx(room.roomCode)}</h1></div><span className={`online-connection ${net.connection}`}>{tx(stateLabel)}</span><button className="quiet-button" onClick={() => setDialog('info')}>{tx("联机说明")}</button><button className="quiet-button" onClick={() => setDialog('settings')}><Settings2 size={16}/>{tx("设置")}</button></header>
        <div className="private-lobby-layout"><section className="private-lobby-table" aria-label={tx("四席牌桌")}>
          <div className="private-lobby-mark"><Brand symbolOnly/><span>{tx("经典升级 · 掼蛋规则")}</span><small>{tx("座位 0 ↔ 2 · 座位 1 ↔ 3")}</small></div>
          {tx(room.seats.map(seat => <section key={seat.seat} className={`lobby-seat lobby-seat-${seat.seat} ${seat.playerId === net.session?.playerId ? 'is-me' : ''}`} data-testid={`lobby-seat-${seat.seat}`} aria-label={tx(`座位 ${seat.seat}`)}><span className="lobby-seat-number">{tx("座位")}{tx(seat.seat)}</span><h2 title={tx(seat.nickname)}>{tx(seat.kind === 'empty' ? '为朋友留座' : seat.nickname)}</h2><p>{tx(seat.playerId === room.hostPlayerId ? '房主 · ' : '')}{tx(seat.kind === 'empty' ? '空位' : seat.kind === 'ai' ? '电脑 · 已准备' : `${seat.playerId === net.session?.playerId ? '你 · ' : ''}${seat.connected ? seat.ready ? '已准备' : '等待准备' : '重连中'}`)}</p><div className="lobby-seat-actions">
            {tx(seat.kind === 'empty' && <button className="secondary-button" disabled={!canAct} onClick={() => { void mutate({ type: 'room:selectSeat', seat: seat.seat }); }}>{tx("坐这里")}</button>)}
            {tx(host && seat.kind !== 'human' && <button className="text-button" disabled={!canAct} onClick={() => { void mutate({ type: 'room:setAiSeat', seat: seat.seat, enabled: seat.kind !== 'ai' }); }}>{tx(seat.kind === 'ai' ? '留给朋友' : '加入电脑')}</button>)}
            {tx(host && seat.kind === 'human' && seat.playerId !== net.session?.playerId && !seat.ready && <button className="text-button" disabled={!canAct} onClick={() => { void mutate({ type: 'room:kick', playerId: seat.playerId! }); }}>{tx("移出本桌")}</button>)}
          </div></section>))}
        </section><aside className="private-invite-panel"><div className="eyebrow">{tx("邀请入席")}</div><h2>{tx("把这一桌，分享出去。")}</h2><p>{tx("真人")}{tx(room.seats.filter(seat => seat.kind === 'human').length)} {tx("/ 4 · 电脑")}{tx(room.seats.filter(seat => seat.kind === 'ai').length)} / 4</p><label className="private-field">{tx("邀请链接")}<input aria-label={tx("邀请链接")} readOnly value={invite} onFocus={event => event.target.select()}/></label><button className="secondary-button" onClick={() => { void copy(invite, '邀请链接已复制'); }}><Copy size={15}/>{tx("复制邀请链接")}</button><p className="copy-notice" role="status">{tx(copyNotice)}</p>
          {tx(net.session?.recoveryCode && <div className="private-recovery"><button className="text-button" onClick={() => setShowRecovery(!showRecovery)}><LockKeyhole size={14}/>{tx(showRecovery ? '隐藏恢复码' : '保留座位恢复码')}</button>{tx(showRecovery && <><input aria-label={tx("我的座位恢复码")} readOnly value={net.session.recoveryCode.match(/.{1,8}/g)?.join('-')} onFocus={event => event.target.select()}/><button className="text-button" onClick={() => { void copy(net.session!.recoveryCode!, '座位恢复码已复制，请自己保管'); }}>{tx("复制恢复码")}</button><small>{tx("临时网址变化后，用它找回自己的座位。")}</small></>)}</div>)}
          {tx(host && <label className="private-check"><input type="checkbox" checked={room.options.offlineTakeover} disabled={!canAct} onChange={event => { void mutate({ type: 'room:setOptions', offlineTakeover: event.target.checked }); }}/>{tx("离线 30 秒后电脑托管")}</label>)}
          <label className="private-field">{tx("房间电脑档位")}<select ref={node=>{if(node&&!PLAYER_TIERS.some(tier=>tier.roomTier===(room.options.aiTier??'casual')))node.selectedIndex=-1;}} aria-label={tx("房间电脑档位")} aria-describedby="room-ai-availability" value={room.options.aiTier??'casual'} disabled={!host||!canAct} onChange={event=>{const tier=PLAYER_TIERS.find(item=>item.roomTier===event.target.value);if(!tier?.roomTier)return;void mutate({type:'room:setOptions',offlineTakeover:room.options.offlineTakeover,aiTier:tier.roomTier as AiTier});}}>{tx(PLAYER_TIERS.map(tier=><option key={tier.id} value={tier.roomTier??tier.id} disabled={tier.roomTier===null}>{tx(tier.label)}</option>))}</select></label><p>{tx(room.options.aiTier==='pro'?'当前房间保留旧版 PRO 试验配置；主动选择新档位前保持原配置。':room.options.aiTier==='jwxxc-pro'?'此房间保留旧版 Jwxxc Beta 配置；该档位已从难度列表移除，房主可选择其他档位。':room.options.aiTier==='balanced-pro'?'在均衡 Plus 基础上探索更充分的公开牌推演、团队配合与残局计算；所有电脑、掉线托管与真人提示统一使用均衡 Pro。独立试验策略，强度以对战评测为准。':room.options.aiTier==='balanced-plus'?'在均衡基础上加入公开牌推演、团队配合和更完整的残局计算；所有电脑、掉线托管与真人提示统一使用均衡 Plus。独立试验策略，强度以对战评测为准。':room.options.aiTier==='balanced'?'所有电脑、掉线托管与真人提示都使用均衡。':'全部电脑与提示使用休闲，保留原 Astra 体验。')}{tx(host?' 修改档位后请大家重新准备。':' 由房主设置，开局后固定。')}</p><p id="room-ai-availability" className="private-policy-availability" data-testid="room-ai-availability">{tx("DanLM：当前联机后端暂不支持，本地入口保持可用。")}</p>
        </aside></div>
        <footer className="private-lobby-footer"><div><span>{tx(room.seats.some(seat => seat.kind === 'empty') ? '先坐满四席，也可用电脑补位。' : room.seats.some(seat => seat.kind === 'human' && !seat.ready) ? '请所有真人准备，房主再开始牌局。' : '四席已就位，可以开局。')}</span><small>{tx("你的对家是座位")}{tx(((mine?.seat ?? 0) + 2) % 4)} {tx("· 开局后座位和队伍固定")}</small></div><div className="private-lobby-buttons">{tx(host && <button className="secondary-button" disabled={!canAct || !room.seats.some(seat => seat.kind === 'empty')} onClick={() => { void mutate({ type: 'room:fillAi' }); }}>{tx("AI 补满空位")}</button>)}<button className="secondary-button" disabled={!canAct} onClick={() => { void mutate({ type: 'room:setReady', ready: !mine?.ready }); }}><Check size={16}/>{tx(mine?.ready ? '取消准备' : '准备')}</button>{tx(host && <button className="primary-button" disabled={!canAct || !room.seats.every(seat => seat.kind !== 'empty' && seat.ready && seat.connected)} onClick={() => { void mutate({ type: 'room:start' }); }}>{tx("开始牌局")}<ArrowRight size={17}/></button>)}<button className="text-button" onClick={() => setDialog('leave')}>{tx("离开")}</button>{tx(host && <button className="text-button" onClick={() => setDialog('dissolve')}>{tx("解散房间")}</button>)}</div></footer><p className="private-hosting-note">{tx(hostingNote)}</p>
      </main> : tableReady ? <>
        {tx(room.phase === 'exchange' || room.phase === 'ready' ? <main className="exchange-screen online-exchange" data-testid="match-exchange"><header className="exchange-header"><Brand compact/><MatchScoreboard progress={packet.progress} viewerSeat={view.viewerSeat}/><div className="exchange-header-actions"><span>{tx(stateLabel)}</span><button className="quiet-button" onClick={() => setDialog('settings')}>{tx("设置")}</button><button className="text-button" onClick={() => setDialog('leave')}>{tx("离开牌桌")}</button></div></header><section className="exchange-panel"><div className="exchange-title-row"><div><div className="eyebrow">{tx("第")}{tx(packet.progress.handNumber)} {tx("副 · 私人联机")}</div><h1>{tx(room.phase === 'ready' ? packet.antiTribute ? '抗贡成功' : '好牌，已经就位。' : packet.exchange?.currentPlayer === view.viewerSeat ? packet.exchange.phase === 'return' ? '选一张，完成还贡。' : '选一张，完成进贡。' : '正在交换，稍候片刻。')}</h1></div><p className="exchange-level">{tx("本副全桌打")}<strong>{tx(rankName(view.rules.levelRank))}</strong></p></div>
          {tx(packet.exchange && <ExchangeDetails observation={packet.exchange} selected={selectedExchange} onSelect={id => setSelectedExchange(previous => previous === id ? null : id)} readOnly={!canAct} ready={room.phase === 'ready'} classic antiTribute={packet.antiTribute} seatNames={names}/>)}
          {tx(room.phase === 'exchange' && packet.exchange?.currentPlayer === view.viewerSeat && <div className="exchange-confirm"><span>{tx(selectedExchange ? `已选 ${cardName(view.myHand.find(card => card.id === selectedExchange)!)}` : '点击金色边框的牌，再确认')}</span><button className="primary-button" disabled={!canAct || !selectedExchange || !packet.exchange.eligibleCardIds.includes(selectedExchange)} onClick={() => { if (packet.exchange && selectedExchange && packet.exchange.phase !== 'done') void mutate({ type: 'game:action', handId: view.handId, action: { type: packet.exchange.phase, cardId: selectedExchange } }); }}>{tx(net.pending ? '提交中…' : packet.exchange.phase === 'return' ? '确认还贡' : '确认进贡')}</button></div>)}
          {tx(room.phase === 'ready' && <button className="primary-button exchange-begin" disabled={!canAct} onClick={() => handCommand('beginHand')}>{tx("开始第")}{tx(packet.progress.handNumber)} {tx("副")}<ArrowRight size={17}/></button>)}<p className="exchange-footnote">{tx("贡还由牌桌服务器确认。未全部确认的选择不会提前公开。")}</p></section></main>
          : <><Table onStatistics={() => setDialog('statistics')} view={view} muted={settings.muted} paused={!synced || !!dialog} pausedLabel={tx(!synced ? '正在同步牌桌' : '本地设置中')} pausedDescription={tx(!synced ? '等待连接恢复，选牌已保留。' : '其他人继续对局，选牌已保留。')} dealing={false} onMute={() => updateSettings({ muted: !settings.muted })} onSettings={() => setDialog('settings')} onCommit={commit} onHint={chooseHint} onSound={() => sound('select')} musicEnabled={settings.musicEnabled} onMusicToggle={() => updateSettings({ musicEnabled: !settings.musicEnabled })} matchStatus={<MatchScoreboard progress={packet.progress} viewerSeat={view.viewerSeat}/>} matchLabel={tx(`私人牌局 · ${room.roomCode}`)} submissionPending={net.pending} controllerMessage={tx(!synced ? net.notice || '正在同步牌桌…' : net.slow ? '网络似乎有些慢，正在等待确认。' : undefined)} presentationEpoch={net.presentationEpoch} presentationLive={net.authenticated && net.connection === 'online'} victory={victory}/>{tx(packet.result && <Results suspended={!!dialog} onStatistics={() => setDialog('statistics')} view={view} viewerSeat={view.viewerSeat} seatNames={names} progress={packet.progress} classicRules primaryDisabled={!canAct || room.phase === 'complete' && !host} primaryLabel={tx(room.phase === 'complete' && !host ? '等待房主再来一场' : undefined)} onNext={() => handCommand('nextHand')} onAgain={() => { void mutate({ type: 'room:rematch' }); }} onReplay={room.phase === 'complete' ? viewReplay : undefined} onHome={() => setDialog('leave')} victory={victory}/>)}</>)}
      </> : <main className="private-room-screen private-connecting"><Brand/><p role="status">{tx("正在同步牌桌…")}</p></main>)}
    {tx(!replay && net.connection !== 'online' && <div className="online-connection-bar" role="status"><span>{tx(connectionText[net.connection])}</span>{tx(net.connection !== 'replaced' && <button className="text-button" onClick={() => connection.current?.reconnect()}>{tx("重新连接")}</button>)}{tx(net.connection === 'replaced' && <button className="text-button" onClick={() => window.location.assign('/private')}>{tx("返回私人牌局")}</button>)}</div>)}
    {tx(notice && <div className="notice" role="status"><span>{tx(notice)}</span>{tx(net.authenticated && <button className="text-button" onClick={() => { void connection.current?.refresh(); }}>{tx("同步牌桌")}</button>)}<button className="icon-button" aria-label={tx("关闭提示")} onClick={() => { setLocalNotice(''); connection.current?.clearNotice(); }}><X size={16}/></button></div>)}
    {tx(dialog === 'statistics' && <StatisticsDialog onClose={closeDialog} online/>)}
    {tx(dialog === 'settings' && <Modal title={tx("牌桌设置")} onClose={() => setDialog(null)}><p className="modal-intro">{tx("这些设置只影响你的显示与声音，其他人会继续对局。")}</p><MusicSettings settings={settings} status={musicStatus} onChange={updateSettings}/><label className="setting-row"><span><strong>{tx("游戏音效")}</strong></span><input type="checkbox" role="switch" aria-label={tx("游戏音效")} checked={!settings.muted} onChange={event => updateSettings({ muted: !event.target.checked })}/></label><label className="setting-row"><span><strong>{tx("减少动态效果")}</strong></span><input type="checkbox" role="switch" aria-label={tx("减少动态效果")} checked={settings.reducedMotion} onChange={event => updateSettings({ reducedMotion: event.target.checked })}/></label><p className="local-note" data-testid="room-policy-description">{tx(packet ? `本副配置：${room?.seats.filter(seat=>seat.kind==='ai'||seat.control==='takeover').map(seat=>`${seat.nickname} ${STRATEGY_LABELS[(packet.seatPolicies?.[seat.seat]??packet.policy).id]??'未知策略'}`).join(' · ')||'真人席位'}；提示 ${STRATEGY_LABELS[packet.policy.id]??'未知策略'}。` : `房间电脑档位：${room?.options.aiTier==='pro'?'PRO（旧版训练试验）':room?.options.aiTier==='jwxxc-pro'?'Jwxxc Beta':room?.options.aiTier==='balanced-pro'?'均衡 Pro（试验）':room?.options.aiTier==='balanced-plus'?'均衡 Plus（试验）':room?.options.aiTier==='balanced'?'均衡（试验）':'休闲'}${room?.options.endgameFix?' · 残局修复（试验）':''}。`)}{tx("座位与本副配置由服务器保存。")}</p>{tx(net.session?.recoveryCode && <div className="private-recovery"><button className="text-button" onClick={() => setShowRecovery(!showRecovery)}>{tx("座位恢复码")}</button>{tx(showRecovery && <><input aria-label={tx("我的座位恢复码")} readOnly value={net.session.recoveryCode.match(/.{1,8}/g)?.join('-')} onFocus={event => event.target.select()}/><button className="text-button" onClick={() => { void copy(net.session!.recoveryCode!, '恢复码已复制'); }}>{tx("复制恢复码")}</button><p role="status">{tx(copyNotice)}</p></>)}</div>)}<button className="rule-link" onClick={() => setDialog('statistics')}>{tx("个人战绩与胜率")}<span>↗</span></button><div className="pause-actions"><button className="primary-button" onClick={() => setDialog(null)}>{tx("返回牌桌")}</button><button className="text-button" onClick={() => setDialog('leave')}>{tx("离开牌桌")}</button></div></Modal>)}
    {tx(dialog === 'leave' && <Modal title={tx("离开这桌？")} onClose={() => setDialog(null)}><p className="modal-intro">{tx(room?.phase === 'lobby' ? host ? '房主离开会解散尚未开始的房间。' : '离开后会释放你的座位。' : `离开后该座位会暂时保留${room?.options.offlineTakeover ? '并可能由电脑托管' : '，回来后可继续对局'}。请保留自己的座位恢复码。`)}</p><div className="confirm-actions"><button className="secondary-button" onClick={() => setDialog(null)}>{tx("留在牌桌")}</button><button className="primary-button" onClick={() => { void leave(); }}>{tx("确认离开")}</button></div></Modal>)}
    {tx(dialog === 'dissolve' && <Modal title={tx("解散未开始的房间？")} onClose={() => setDialog(null)}><p className="modal-intro">{tx("其他人将离开这桌，原邀请链接不再有效。")}</p><div className="confirm-actions"><button className="secondary-button" onClick={() => setDialog(null)}>{tx("保留房间")}</button><button className="primary-button" onClick={() => { void mutate({ type: 'room:dissolve' })?.then(result => { if (result?.ok) window.location.assign('/private'); }); }}>{tx("确认解散")}</button></div></Modal>)}
    {tx(dialog === 'info' && <Modal title={tx("私人联机说明")} onClose={() => setDialog(null)}><p className="modal-intro">{tx(hostingNote)}</p><p className="modal-intro">{tx("临时网址可能在服务重启后变化。请保留自己的座位恢复码，在新网址选择“恢复原座位”。普通邀请链接可以分享，恢复码仅供自己使用。")}</p><p className="modal-intro">{tx("本版为好友测试。联机期间请保持房主电脑唤醒、服务终端开启。")}</p><button className="primary-button modal-done" onClick={() => setDialog(null)}>{tx("知道了")}</button></Modal>)}
  </div>;
}
