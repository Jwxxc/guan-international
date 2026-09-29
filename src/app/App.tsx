import { tx } from '../i18n';
import { LanguagePicker, useLocale } from '../i18n/react';
import {isPortableDistribution,isFullMacDistribution} from '../game/distribution';
import {LearningSettings} from '../components/LearningSettings';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MusicSettings } from '../components/MusicSettings';
import { useGameController } from '../game/controller';
import { useVictoryMoment } from '../game/useVictoryMoment';
import { rankName } from '../engine/rules';
import { StatisticsDialog } from '../components/StatisticsDialog';
import { Home } from '../screens/Home';
import { Table } from '../screens/Table';
import { Results } from '../screens/Results';
import { Replay } from '../screens/Replay';
import { Modal } from '../components/Modal';
import { BRAND_MOTTO } from '../components/Brand';
import { MatchScoreboard } from '../components/MatchScoreboard';
import { MatchExchange } from '../screens/MatchExchange';
import '../styles/match.css';
import {nativeDanlmEnabled} from '../ai/pro/nativeInfo';
import {PLAYER_TIERS,playerTier,savedTierLabel, type PlayerTierId} from '../game/playerTiers';
import type { StrategyId as PolicyId } from '../ai/strategyTypes';
import type { SavedGame } from '../game/persistence';

const Spectator = lazy(() => import('../screens/Spectator').then(module => ({ default: module.Spectator })));

function currentAiLabel(saved: SavedGame): string {
  const base = saved.policy?.id;
  const seats = ([1, 2, 3] as const).map(seat => saved.seatPolicies?.[seat]?.id ?? base);
  if (seats.every(id => id === seats[0])) return `${savedTierLabel(seats[0])} · 三个电脑`;
  return `对家 ${savedTierLabel(seats[1])} · 南山 ${savedTierLabel(seats[0])} · 松风 ${savedTierLabel(seats[2])}`;
}

function TierControl({ selectedTier, onTier, unavailable, description, availability, context, compact = false }: {
  selectedTier: PlayerTierId | ''; onTier: (id: string) => void; unavailable: (id: PolicyId) => boolean;
  description: string; availability: string; context: string; compact?: boolean;
}) {
  const prefix = compact ? 'home-ai' : 'ai-tier';
  return <section className={compact ? 'home-ai-control' : 'settings-ai-control'}>
    <label className="setting-row ai-policy-setting"><span><strong>{tx("电脑牌技")}</strong>{tx(context && <small>{tx(context)}</small>)}</span>
      <select ref={node => { if (node && selectedTier === '') node.selectedIndex = -1; }} aria-label={tx(compact ? '新对局电脑牌技' : '电脑牌技')} aria-describedby={`${prefix}-description ${prefix}-availability`} value={selectedTier} onChange={event => onTier(event.target.value)}>
        {tx(PLAYER_TIERS.map(tier => <option key={tier.id} value={tier.id} disabled={unavailable(tier.id)}>{tx(tier.label)}</option>))}
      </select>
    </label>
    <p id={`${prefix}-description`} className="ai-tier-description" data-testid={compact ? 'home-ai-description' : 'ai-tier-description'}>{tx(description)}</p>
    <p id={`${prefix}-availability`} className="ai-tier-availability" data-testid={compact ? 'home-ai-availability' : 'ai-tier-availability'} hidden={!availability}>{tx(availability)}</p>
  </section>;
}

function SettingsDialog({ game, isTable, rulesTitle, aiControl, onClose }: {
  game: ReturnType<typeof useGameController>; isTable: boolean; rulesTitle: string; aiControl: ReactNode; onClose: () => void;
}) {
  const [tab, setTab] = useState<'common' | 'learning'>('common');
  const [learningVisited, setLearningVisited] = useState(false);
  const panelScroll = useRef<HTMLDivElement>(null);
  const selectTab = (next: 'common' | 'learning') => {
    setTab(next);
    if (next === 'learning') setLearningVisited(true);
    if (panelScroll.current) panelScroll.current.scrollTop = 0;
  };
  return <Modal title={tx(isTable ? '暂停一下' : '规则与设置')} onClose={onClose} className="settings-refined">
    <p className="modal-intro">{tx(isTable ? '牌局已暂停。继续时，电脑将从当前回合重新思考。' : '按你喜欢的节奏，享受这一桌。')}</p>
    <div className="settings-tabs" role="tablist" aria-label={tx("设置分类")} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'common' : event.key === 'End' ? 'learning' : tab === 'common' ? 'learning' : 'common';
      selectTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`#settings-tab-${next}`)?.focus();
    }}>
      <button id="settings-tab-common" type="button" role="tab" aria-selected={tab === 'common'} aria-controls="settings-panel-common" tabIndex={tab === 'common' ? 0 : -1} onClick={() => selectTab('common')}>{tx("常用设置")}</button>
      <button id="settings-tab-learning" type="button" role="tab" aria-selected={tab === 'learning'} aria-controls="settings-panel-learning" tabIndex={tab === 'learning' ? 0 : -1} onClick={() => selectTab('learning')}>{tx("实验学习")}</button>
    </div>
    <div className="settings-panel-scroll" ref={panelScroll}>
      <section id="settings-panel-common" role="tabpanel" aria-labelledby="settings-tab-common" hidden={tab !== 'common'}>
        <div className="settings-language"><LanguagePicker/><span className="international-edition">International Edition</span></div>
        {tx(aiControl)}
        <div className="settings-quick-controls">
          <label className="setting-row"><span><strong>{tx("游戏音效")}</strong><small>{tx("选牌与落牌声音")}</small></span><input type="checkbox" role="switch" aria-label={tx("游戏音效")} checked={!game.settings.muted} onChange={event => game.updateSettings({ muted: !event.target.checked })}/></label>
          <label className="setting-row"><span><strong>{tx("减少动态效果")}</strong><small>{tx("关闭发牌、抬牌与过渡动画")}</small></span><input type="checkbox" role="switch" aria-label={tx("减少动态效果")} checked={game.settings.reducedMotion} onChange={event => game.updateSettings({ reducedMotion: event.target.checked })}/></label>
        </div>
        <MusicSettings settings={game.settings} status={game.musicStatus} onChange={game.updateSettings}/>
        {tx(isTable && game.saved && <div className="setting-row"><span><strong>{tx("本副级牌：")}{tx(rankName(game.saved.state.rules.levelRank))}</strong><small>{tx(game.match ? '两队独立记录级数；本副四人共用同一级牌' : '开始新一副之前，可在首页选择 2 至 A')}</small></span><span className="setting-lock">{tx("对局中固定")}</span></div>)}
        <div className="settings-related"><button className="rule-link" onClick={() => game.setDialog('statistics')}>{tx("个人战绩与胜率")}<span>↗</span></button><button className="rule-link" onClick={() => game.setDialog('rules')}>{tx(rulesTitle)} <span>↗</span></button></div>
      </section>
      <section id="settings-panel-learning" role="tabpanel" aria-labelledby="settings-tab-learning" hidden={tab !== 'learning'}>{tx(learningVisited && <LearningSettings/>)}</section>
    </div>
    <footer className="settings-footer">
      {tx(isTable ? <div className="pause-actions"><button className="primary-button" onClick={onClose}>{tx("继续对局")}</button><button className="secondary-button" onClick={() => game.setDialog('restart')}>{tx(game.match ? '重新开一场' : '重新开一副')}</button><button className="text-button pause-home-button" onClick={game.home}>{tx("返回首页")}</button></div> : <button className="primary-button modal-done" onClick={onClose}>{tx("完成")}</button>)}
      <p className="local-note">{tx(isFullMacDistribution ? '设置与牌局保存在这台 Mac 的 GUAN 中。' : '设置与牌局仅保存在当前浏览器中。')}</p>
    </footer>
  </Modal>;
}

function LocalGame() {
  const game = useGameController(); const close = useCallback(() => game.setDialog(null), [game.setDialog]);
  const notice = game.notice || (game.aiFailure ? '电脑计算已暂停，请点“重试电脑”继续。' : '');
  const victory = useVictoryMoment(game.saved?.state, game.screen==='table'&&!game.dialog&&!game.hidden, game.settings.reducedMotion, game.match?.progress.winner);
  const isTable = game.screen === 'table';
  const keepActiveTable = isTable || (game.screen === 'replay' && game.replayKeepsTable);
  const isExchange = keepActiveTable && !!game.match && (game.match.phase === 'exchange' || game.match.phase === 'ready');
  const legacyMatch = isTable && game.match?.journal.rulesVersion === 'guan-match-v1';
  const selectedTier = game.settings.unrecognizedAiPolicy!==undefined&&!game.settings.aiPolicy?'':playerTier(game.settings.aiPolicy);
  const danlmUnavailable = !nativeDanlmEnabled() || legacyMatch;
  const tierUnavailable = (id:PolicyId) => id==='pro-danlm-classic-v1'&&danlmUnavailable;
  const tierDescription = selectedTier===''?'保存的电脑牌技版本无法识别，原配置已保留。请选择兼容档位后再开始新局。':game.settings.aiPolicy?.startsWith('jwxxc-')?'Jwxxc Beta 已从难度列表移除，新开的副使用休闲；已有对局保留原配置。你也可以选择其他档位。':PLAYER_TIERS.find(tier=>tier.id===selectedTier)!.description;
  const matchLabel = game.match?.journal.rulesVersion === 'guan-classic-house-v1' ? BRAND_MOTTO : '旧版连续升级';
  const rulesTitle = game.mode === 'match' ? legacyMatch ? '旧版连续升级规则' : '经典升级 · 掼蛋规则' : 'GUAN 单副练习规则';
  const tierAvailability = [
    danlmUnavailable ? legacyMatch ? 'DanLM：这场旧版升级赛暂不支持；可在新开的经典升级或单副中使用。' : isPortableDistribution ? 'DanLM：此分享版未包含本机 DanLM 模型，暂不可选。' : 'DanLM：本机模型尚未连接，请用 GUAN 启动器打开游戏。' : '',
  ].filter(Boolean).join(' ');
  const onTier = (id: string) => {
    const tier = PLAYER_TIERS.find(item => item.id === id);
    if (tier && !tierUnavailable(tier.id)) game.updateSettings({ aiPolicy: tier.id });
  };
  const tierControl = (compact = false) => <TierControl compact={compact} selectedTier={selectedTier} onTier={onTier} unavailable={tierUnavailable} description={tx(tierDescription)} availability={tx(tierAvailability)}
    context={tx(compact ? game.canContinue ? '仅新开对局生效，存档配置不变。' : '' : isTable && game.saved ? `本副：${currentAiLabel(game.saved)}；更改在下一副生效。` : game.canContinue ? '更改在新开的副生效，当前存档沿用本副配置。' : '三个电脑统一选择；牌桌提示使用 DanLM。')}/>;
  const continueDetails = game.saved ? [
    game.match ? `第 ${game.match.progress.handNumber} 副${game.saved.state.result ? ' · 已结算' : ` · 打 ${rankName(game.saved.state.rules.levelRank)}`} · 我方 ${rankName(game.match.progress.teamLevels[0])} / 对方 ${rankName(game.match.progress.teamLevels[1])}` : `打 ${rankName(game.saved.state.rules.levelRank)} · 你的手牌剩 ${game.saved.state.hands[0].length} 张`,
    `${game.saved.state.result ? '上副' : '本副'} AI：${currentAiLabel(game.saved)}`,
  ] : [];
  return <div className={`app ${game.settings.reducedMotion ? 'reduced-motion' : ''}`} data-music-status={game.musicStatus}>
    <div className="small-screen-message">{tx("建议将设备横屏，或在宽度至少 1024 像素的桌面窗口中享受完整牌桌。")}</div>
    {tx(game.screen === 'home' && <Home onSpectate={() => game.setScreen('spectator')} continueDetails={continueDetails} aiControl={tierControl(true)} newGameDisabled={selectedTier === '' || tierUnavailable(selectedTier)} onStatistics={() => game.setDialog('statistics')} onPrivate={() => window.location.assign('/private')} mode={game.mode} onMode={game.setMode} continueMode={game.continueMode} continueComplete={game.match?.phase === 'complete'} levelRank={game.settings.levelRank} onLevel={levelRank => game.updateSettings({ levelRank })} canContinue={game.canContinue} canReplay={game.canReplay} onStart={() => game.canContinue && game.mode === (game.match ? 'match' : 'practice') && game.match?.phase !== 'complete' ? game.setDialog('restart') : game.start()} onContinue={game.continueGame} onReplay={game.openReplay} onRules={() => game.setDialog('rules')} onSettings={() => game.setDialog('settings')} musicEnabled={game.settings.musicEnabled} onMusicToggle={() => game.updateSettings({ musicEnabled: !game.settings.musicEnabled })}/>)}
    {tx(keepActiveTable && <div className="active-table-surface" data-testid="active-table-surface" hidden={!isTable} inert={!isTable} aria-hidden={!isTable} style={!isTable ? { display: 'none' } : undefined}>
      {tx(isExchange && game.match && <MatchExchange continuousHints={game.settings.danlmContinuousHints ?? false} onContinuousHintsChange={enabled => game.updateSettings({ danlmContinuousHints: enabled })} paused={!!game.dialog || game.hidden} match={game.match} observation={game.exchangeObservation} onCommit={game.commitExchange} onBegin={game.beginHand} onHome={game.home} onSettings={() => game.setDialog('settings')}/>)}
      {tx(!isExchange && game.saved && <><Table onStatistics={() => game.setDialog('statistics')} victory={victory} matchLabel={matchLabel} matchStatus={game.match ? <MatchScoreboard progress={game.match.progress}/> : undefined} key={game.saved.state.handId} state={game.saved.state} muted={game.settings.muted} paused={!isTable || !!game.dialog || game.hidden || !!game.aiFailure} presentationLive={isTable} pausedLabel={tx(game.aiFailure ? '电脑计算已暂停' : undefined)} dealing={game.dealing} onMute={() => game.updateSettings({ muted: !game.settings.muted })} onSettings={() => game.setDialog('settings')} onCommit={game.commit} onDanlmHint={game.requestHint} continuousHints={game.settings.danlmContinuousHints ?? false} onContinuousHintsChange={enabled => game.updateSettings({ danlmContinuousHints: enabled })} danlmHintUnavailableReason={tx(tierAvailability)} onSound={() => game.sound('select')} musicEnabled={game.settings.musicEnabled} onMusicToggle={() => game.updateSettings({ musicEnabled: !game.settings.musicEnabled })}/>{tx(game.saved.state.result && <Results suspended={!isTable || !!game.dialog} onStatistics={() => game.setDialog('statistics')} victory={victory} match={game.match ?? undefined} progress={game.match?.progress} onNext={game.nextHand} state={game.saved.state} onAgain={game.start} onReplay={game.openReplay} onHome={game.home}/>)}</>)}
    </div>)}
    {tx(game.screen === 'spectator' && <Suspense fallback={<p role="status">{tx("正在打开观战研习…")}</p>}><Spectator onExit={() => game.setScreen('home')}/></Suspense>)}
    {tx(game.screen === 'replay' && game.replaySource && <Replay source={game.replaySource} initialHandId={game.replayHandId} muted={game.settings.muted} onMute={() => game.updateSettings({ muted: !game.settings.muted })} onExit={game.exitReplay} musicEnabled={game.settings.musicEnabled} onMusicToggle={() => game.updateSettings({ musicEnabled: !game.settings.musicEnabled })}/>)}
    {tx(game.screen !== 'spectator' && notice && <div className="notice" role="status"><span>{tx(notice)}</span>{tx(game.aiFailure && <><button className="text-button" onClick={game.retryAi}>{tx("重试电脑")}</button><details><summary>{tx("错误详情")}</summary><span>{tx(game.aiFailure)}</span></details></>)}{tx(notice.includes('无法保存') && <button className="text-button" onClick={game.retrySave}>{tx("重试保存")}</button>)}{tx(!game.aiFailure && <button className="icon-button" aria-label={tx("关闭提示")} onClick={() => game.setNotice('')}>×</button>)}</div>)}
    {tx(game.dialog === 'statistics' && <StatisticsDialog onClose={close} onReplay={game.openArchivedReplay}/>) }
    {tx(game.dialog === 'settings' && <SettingsDialog game={game} isTable={isTable} rulesTitle={rulesTitle} aiControl={tierControl()} onClose={close}/>) }
    {tx(game.dialog === 'restart' && <Modal title={tx(game.mode === 'match' ? '开始新的一场？' : '开始新的一副？')} onClose={close}><p className="modal-intro">{tx(game.match ? '当前升级赛及两队进度将被替换。' : '当前未完成的练习将被新牌局替换。')}{tx(game.mode === 'match' ? '新场两队都从 2 开始。' : '新副使用首页选择的级牌。')}{tx("最近的完整回放会保留。两种模式的存档分别保存。")}</p><div className="confirm-actions"><button className="secondary-button" onClick={close}>{tx("保留当前对局")}</button><button className="primary-button" onClick={game.start}>{tx(game.mode === 'match' ? '开始新的一场' : '开始新的一副')}</button></div></Modal>)}
    {tx(game.dialog === 'rules' && <Modal title={tx(rulesTitle)} onClose={close} wide><div className="rules-scroll"><p className="rule-version">{tx(legacyMatch ? 'guan-match-v1 · 旧版连续升级' : 'guan-classic-house-v1 · 经典升级 · 掼蛋规则')} {tx("/ guan-practice-v1 · 单副练习")}</p><p>{tx("本产品冻结的可执行约定，不代表官方认证或所有地区统一规则。旧版比赛沿用创建时的规则。")}</p><section><h3>{tx("四人，两队，一起配合")}</h3><p>{tx("两副共 108 张，每人 27 张。你在下方，与上方的青禾一队。行动顺序为你 → 右侧南山 → 对家青禾 → 左侧松风。首副先手随机，所有人的剩余张数公开。")}</p><p>{tx("头游所在队伍获胜。任一队两人出完即结算：同队占前两名为双上，对方记双下；前两名分属两队时，继续到第三人出完，最后一人为末游。")}</p></section><section><h3>{tx("经典升级：两队各记级数，一副共用级牌")}</h3><p>{tx("双方各从 2 开始。头游的对家为二游、三游、末游时，胜方从自己的原有级数分别升 3、2、1 级，败方不变。最高停在 A。下一副采用上一副获胜队升级后的级数，全桌四人共用，发牌后固定到本副结束。")}</p><p>{tx("例如我方双上从 2 升到 5，对方仍为 2，下一副打 5。若对方接着取得头游＋三游，对方从自己的 2 升到 4，我方仍为 5，下一副共同打 4。")}</p><p>{tx("过 A 必须同时满足：该队开副前已是 A、本副共同级牌为 A、该队取得头游且对家为二游或三游。刚升到 A 的那副不结束整场；A 级头游＋末游仍留在 A；自身已是 A 但本副打较低级牌，也只获得下一副打 A 的机会。双方都为 A 时，任一队满足条件即可通关。没有三次失败退回 2 的约定。")}</p></section><section><h3>{tx("单贡、双贡与先手")}</h3><p>{tx("首副不进贡，随机先手。从第二副开始，普通单贡由上副末游向头游贡一张最大非逢人配牌，再沿原路还贡；即使两人同队也交换，由末游先出。双上后两位双下各进贡，较大的给头游、较小的给二游，给头游进贡者先出。双下不编造第三、第四名。")}</p>{tx(legacyMatch ? <p>{tx("本场为旧版比赛，等贡沿用旧版座位映射，还牌候选和交换时机沿用创建时的 guan-match-v1；新开经典升级才使用下述新版约定。")}</p> : <p>{tx("两张贡牌等大时，固定由上一副头游的上家向头游进贡，另一位向二游进贡。座位为你 0、右侧 1、对家 2、左侧 3；例如 0 头游、2 二游时，3 → 0、1 → 2，3 先出。还贡沿各自实际关系反向进行。")}</p>)}<p>{tx("贡牌按新副的单张大小，从原始 27 张中选最大的非逢人配实体；红心级牌排除，其他花色级牌参与比较。同点花色不分高低，可在等大实体中选择。")}</p></section><section><h3>{tx("还贡范围与兜底")}</h3>{tx(legacyMatch ? <p>{tx("旧版优先还 10 及以下的非级普通牌；没有时按旧版“最小非逢人配”候选执行。旧档不会静默改用新版规则。")}</p> : <><p>{tx("从本次原始 27 张选一张自然点数 2–10 的非级牌。所有花色的本副级牌、大小王都不能正常还出；A 不作为 1。不能把刚收到的贡牌原样退回。")}</p><p>{tx("没有正常候选时，排除大小王与全部本副级牌，按自然点数还最小的普通牌；同点实体都可选。例如打 7，没有 2–6 或 8–10，最小合格点数为 J 时可还 J。真人必须选牌并确认，不能自动代还。")}</p><p>{tx("双贡必须双方确认后才公开贡牌与配对；所有还牌确认后一次交换，并公开还牌。中途每人保持原始 27 张，完成后仍每人 27 张，交换期间不能普通出牌。")}</p></>)}</section><section><h3>{tx("自动抗贡与公开证据")}</h3><p>{tx("单贡只检查应进贡的末游本人：独自持有两张真实大王才抗贡。双贡检查两位贡方合计的两张真实大王，一人两王或每人一王均成立。逢人配不能替代大王。")}</p><p>{tx("抗贡在选贡之前自动判断，成立就取消本副全部进贡和还贡，由上副头游先出。只公开两张大王及其持有人，其余手牌不公开。下一副尚未发牌时不能预判抗贡。")}</p></section><section><h3>{tx("级牌与逢人配")}</h3><p>{tx("单张与同点数牌型大小：大王 ＞ 小王 ＞ 级牌 ＞ A ＞ K…2。两张红心级牌是逢人配，可替普通牌的点数、花色，不可替王。单出按级牌，两张配单独作对子也按级牌。")}</p><p>{tx("有多种解释时可在操作区选择；替代映射在出牌前后都可见。连续牌型中，级牌仍按自然点数排列。")}</p></section><section><h3>{tx("普通牌型")}</h3><p>{tx("单张、对子、三张、三带二（只比较三张）、恰好五张的顺子、恰好三组的三连对、恰好两组的钢板。必须同类、同张数且严格更大才能压过；相等不算大。")}</p><p>{tx("两个真实小王或两个真实大王可作对子；大小王各一张不是对子。没有三带一、四带二、飞机带翅膀或不定长连对。")}</p></section><section><h3>{tx("A 的两端与连续牌")}</h3><p>{tx("顺子从 A2345 到 10JQKA；三连对从 AA2233 到 QQKKAA；钢板从 AAA222 到 KKKAAA。A 只在最小端或最大端，不可绕回，JQKA2、KKAA22 均不合法。王不可加入连续牌型。")}</p></section><section><h3>{tx("炸弹，从小到大")}</h3><p>{tx("4 张炸弹 ＜ 5 张炸弹 ＜ 同花顺 ＜ 6 张 ＜ 7 张 ＜ 8 张 ＜ 9 张 ＜ 10 张 ＜ 四王炸。")}</p><p>{tx("同张数炸弹比点数。同花顺恰好五张有效同花连续牌，只比较连续大小、不比较花色。天然同花顺不能降为普通顺子。四王炸须两个真实大王加两个真实小王。逢人配可补普通炸弹，但不得重复计数；级牌最多八张。")}</p></section><section><h3>{tx("不出、接风与领出")}</h3><p>{tx("有待压牌时可以主动不出；之后有人再出牌，轮转回来仍可跟牌。所有其他仍参与的人都放弃压当前牌后，本轮结束。")}</p><p>{tx("最后出牌者还有手牌，由其领出；已出完则由仍有牌的对家接风。出完后其他人仍有合法跟牌机会，不会立刻跳给对家。新一轮领出不能不出。")}</p></section><section><h3>{tx("操作与本地数据")}</h3><p>{tx("单击选牌，按住鼠标划过可连续选牌；从已选牌开始划则连续取消。松开后再点出牌。双击选中同原始点数全部手牌，理牌保留实体牌选择。DanLM 提示仅预选并高亮建议手牌，不自动出牌；点“取消选择”或手牌区空白，可以一次取消所有选牌。手牌区域可用 H 调用 DanLM 提示、P 不出、Esc 取消、Enter 出牌。后台或打开设置时暂停电脑。")}</p><p>{tx("有效操作后自动保存当前比赛与升级进度。经典升级提供整场回放，可选副、查看贡还牌与级数变化；单副练习保留独立存档和回放。仅已结束的副可开启全桌手牌视角；正常对局只显示自己的手牌。电脑仅使用自身手牌和公开信息。比赛在本地进行，不含联网。")}</p></section></div></Modal>)}
  </div>;
}

const OnlineApp = lazy(() => import('../online/OnlineApp'));
export default function App() {
  useLocale();
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => { const update = () => setPath(window.location.pathname); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []);
  const match = /^\/room\/([ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6})\/?$/i.exec(path);
  if (path === '/private' || path.startsWith('/room/')) return <Suspense fallback={<main className="private-connecting" role="status">{tx("正在打开私人牌桌…")}</main>}><OnlineApp key={path} initialRoomCode={match?.[1].toUpperCase() ?? null}/></Suspense>;
  return <LocalGame/>;
}
