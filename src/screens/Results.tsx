import { tx } from '../i18n';
import { canExportDiagnostics, exportCompletedDiagnostics } from '../game/aiDiagnostics';
import { Brand } from '../components/Brand';
import { useEffect, useMemo, useRef } from 'react';
import type { GameState, Seat } from '../engine/types';
import { partnerOf, rankName, teamOf } from '../engine/rules';
import { getMatchLevel } from '../match/progression';
import type { MatchProgress } from '../match/types';
import type { MatchSession } from '../match/sessionTypes';
import { getMatchHistory, type MatchHandSummary } from '../match/replay';
import { seatName, type ResultView, type SeatNames, type TableView } from '../game/tableView';
import { VictoryCelebration } from '../components/VictoryCelebration';
import type { VictoryMoment } from '../game/victory';
export function Results({ state: localState, view, viewerSeat: requestedViewer, seatNames, publicHistory, classicRules, primaryDisabled = false, primaryLabel, onAgain, onReplay, onHome, progress, onNext, match, victory, onStatistics, suspended = false }: { state?: GameState; view?: ResultView & Partial<Pick<TableView, 'viewerSeat' | 'seats'>>; viewerSeat?: Seat; seatNames?: SeatNames; publicHistory?: MatchHandSummary[]; classicRules?: boolean; primaryDisabled?: boolean; primaryLabel?: string; onAgain: () => void; onReplay?: () => void; onHome: () => void; progress?: MatchProgress; onNext?: () => void; match?: MatchSession; victory?: VictoryMoment | null; onStatistics?: () => void; suspended?: boolean }) {
  const state = view ?? localState;
  if (!state?.result) throw Error('结算缺少公开结果');
  const viewerSeat = requestedViewer ?? view?.viewerSeat ?? 0, ours = teamOf(viewerSeat), theirs = (1 - ours) as 0 | 1;
  const name = (seat: Seat) => seatNames?.[seat] ?? view?.seats?.[seat]?.name ?? seatName(seat);
  const teamName = (team: 0 | 1, separator = '与') => ([0, 1, 2, 3] as const).filter(seat => teamOf(seat) === team).map(name).join(separator);
  const role = (seat: Seat) => seat === viewerSeat ? '真人' : seat === partnerOf(viewerSeat) ? '你的对家' : view?.seats?.[seat]?.kind === 'human' ? '真人对手' : '电脑对手';
  const result = state.result!;
  const advance = progress?.lastAdvance;
  const complete = progress?.winner !== null && progress?.winner !== undefined;
  const history = useMemo(() => publicHistory ?? (match ? getMatchHistory(match) : []), [publicHistory, match]);
  const classic = classicRules ?? match?.journal.rulesVersion === 'guan-classic-house-v1';
  const partnerPlace = result.order.indexOf(partnerOf(result.order[0]));
  const placeName = ['头游', '二游', '三游', '末游'][partnerPlace];
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (suspended) return;
    const previous = document.activeElement as HTMLElement | null;
    const buttons = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0);
    panel.current?.querySelector<HTMLButtonElement>(':scope > .primary-button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault(); event.stopPropagation();
      const nodes = buttons();
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      (nodes[next] ?? panel.current)?.focus();
    };
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); previous?.focus(); };
  }, [suspended]);
  return <div className="results-backdrop" style={suspended ? { display: 'none' } : undefined}>{tx(victory && victory.kind!=='first' && <VictoryCelebration moment={victory}/>)}<section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" className={`results-panel ${progress ? 'match-results' : ''}`} aria-labelledby="result-title" data-testid="results">
    <div className="eyebrow">{tx(complete ? '过 A 通关 · 本场落定' : progress ? `第 ${progress.handNumber} 副，落定` : '这一副，落定')}</div>
    <div className="result-symbol" aria-hidden="true"><Brand symbolOnly/></div>
    <h1 id="result-title">{tx(teamName(complete ? progress.winner! : result.winningTeam))}，{tx(complete ? '整场获胜' : '本副获胜')}</h1>
    <p className="result-subtitle">{tx(result.doubleUp ? result.winningTeam === ours ? '双上 · 与对家一起，先一步抵达。' : '本副双下 · 下一副，再找配合。' : '头游所在队伍获胜。每一手，都是配合。')}</p>
    <div className="result-order">{tx(result.order.map((seat, i) => <div key={seat}><span>{tx(['头游', '二游', '三游', '末游'][i])}</span><strong>{tx(name(seat))}</strong><small>{tx(role(seat))}</small></div>))}{tx(result.last !== null && !result.order.includes(result.last) && <div><span>{tx("末游")}</span><strong>{tx(name(result.last))}</strong><small>{tx("剩余玩家")}</small></div>)}{tx(result.doubleDown.length > 0 && <div className="double-down"><span>{tx("双下 · 不区分先后")}</span><strong>{tx(result.doubleDown.map(seat => name(seat)).join(' / '))}</strong><small>{tx("本副在双上时结束")}</small></div>)}</div>
    {tx(progress && advance && <div className="result-progress" data-testid="result-progress">
      <p className="result-advance-reason" data-testid="advance-reason">{tx("头游＋")}{tx(placeName)}，{tx(advance.passedAce ? '符合过 A 条件' : `按名次升 ${advance.steps} 级`)}{tx(advance.to === 14 && !advance.passedAce ? '，最高停在 A' : '')}。</p>
      <div className="result-team-levels">{tx([ours, theirs].map(team => <div key={team} className={advance.team === team ? 'team-advanced' : ''}><span>{tx(team === ours ? '我方' : '对方')} · {tx(teamName(team as 0 | 1, ' / '))}</span><strong><small>{tx(rankName(advance.team === team ? advance.from : progress.teamLevels[team]))}</small><i>→</i>{tx(rankName(progress.teamLevels[team]))}</strong><em>{tx(advance.team !== team ? '级数保留' : advance.passedAce ? '过 A 通关' : advance.from === 14 ? '保留 A · 尚未通关' : `按名次升 ${advance.steps} 级${advance.to === 14 ? ' · A 封顶' : ''}`)}</em></div>))}</div>
      <p>{tx(complete ? `本场共完成 ${history.length || progress.handNumber} 副。下一场两队重新从 2 出发。` : <>{tx("下一副全桌打")}<b>{tx(rankName(getMatchLevel(progress)))}</b> · ♥{tx(rankName(getMatchLevel(progress)))} {tx("为逢人配")}{tx(advance.to === 14 && advance.from !== 14 && <span>{tx("进入 A 级，下一副冲 A。本副只升到 A，尚未整场获胜。")}</span>)}{tx(advance.from === 14 && !advance.passedAce && <span>{tx(state.rules.levelRank !== 14 ? '本副共同级牌不是 A；下一副打 A 后，头游＋二游或三游才能通关。' : '本副头游＋末游，仍保留 A；头游＋二游或三游才能通关。')}</span>)}</>)}</p>
      {tx(!complete && <div className="result-next-exchange" data-testid="next-exchange"><strong>{tx("下一副预计")}{tx(result.doubleUp ? '双贡' : '单贡')}</strong><p>{tx(result.doubleUp ? <>{tx(result.doubleDown.map(seat => name(seat)).join('、'))}{tx("分别进贡给头游")}{tx(name(result.order[0]))} {tx("与二游")}{tx(name(result.order[1]))}{tx("；贡牌大小确定对应关系，还贡按原路返回。")}</> : <>{tx(name(result.last!))}{tx("（末游）向")}{tx(name(result.order[0]))}{tx("（头游）进贡，再由")}{tx(name(result.order[0]))} {tx("还贡")}{tx(result.winningTeam === (result.last! % 2) ? '；同队也按名次交换' : '')}。</>)}</p><small>{tx("是否抗贡，须等下一副实际发牌后判断。")}</small></div>)}
    </div>)}
    {tx(complete && history.length > 0 && <div className="match-history" data-testid="match-history"><h2>{tx("逐副级数记录")}<small>{tx(classic ? '经典升级 · 掼蛋规则' : '旧版连续升级')}</small></h2><div className="match-history-scroll" tabIndex={0} aria-label={tx("逐副级数记录表")}><table><thead><tr><th>{tx("副数")}</th><th>{tx("本副打")}</th><th>{tx("结果")}</th><th>{tx("我方")}</th><th>{tx("对方")}</th></tr></thead><tbody>{tx(history.map(hand => <tr key={hand.handId}><td>{tx(hand.handNumber)}</td><td>{tx(rankName(hand.levelRank))}</td><td>{tx(hand.result ? `${hand.result.winningTeam === ours ? '我方' : '对方'}${hand.advance?.passedAce ? '过 A' : `升 ${hand.advance?.steps ?? 0} 级`}` : '未结束')}</td><td>{tx(rankName(hand.levelsBefore[ours]))} → {tx(rankName(hand.levelsAfter[ours]))}</td><td>{tx(rankName(hand.levelsBefore[theirs]))} → {tx(rankName(hand.levelsAfter[theirs]))}</td></tr>))}</tbody></table></div></div>)}
    <button className="primary-button" disabled={primaryDisabled || (!!progress && !complete && !onNext)} onClick={progress && !complete ? onNext : onAgain}>{tx(primaryLabel ?? (progress ? complete ? '重新开一场' : '下一副' : '再来一副'))} <span>→</span></button>
    <div className="result-links">{tx(onStatistics && <button className="text-button" onClick={onStatistics}>{tx("个人战绩")}</button>)}{tx(!view && canExportDiagnostics(state.handId) && <button className="text-button" onClick={()=>exportCompletedDiagnostics(state.handId)}>{tx("导出 AI 诊断")}</button>)}{tx(onReplay && <button className="text-button" onClick={onReplay}>{tx(progress ? '整场回放' : '查看回放')}</button>)}<button className="text-button" onClick={onHome}>{tx(progress && !complete ? '保存并返回' : '返回首页')}</button></div>
  </section></div>;
}
