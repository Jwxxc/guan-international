import { tx, dateLocale } from '../i18n';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { BarChart3, Download, History, Trophy } from 'lucide-react';
import { Modal } from './Modal';
import { downloadTextFile } from '../game/download';
import { AnalysisArchive, ArchiveStatusNotice } from './AnalysisArchive';
import { useArchive } from '../archive/useArchive';
import { findReplayArchive, replayFromArchive } from '../archive/replay';
import { readArchive } from '../archive/storage';
import { isFullMacDistribution } from '../game/distribution';
import type { ReplaySource } from '../match/replay';
import { rankName } from '../engine/rules';
import { DIFFICULTY_LABELS, entryDifficulty, entryId, filterEntries, formatRate, isWin, MODE_LABELS, placeLabel, summarize, type StatisticsEntry, type StatisticsFilter, type StatisticsMode } from '../statistics/model';
import { loadStatistics, STATISTICS_CHANGED, STATISTICS_PREFIX } from '../statistics/storage';
import '../styles/statistics.css';
import '../styles/statistics-experience.css';

const PAGE_SIZE = 10;
const dateLabel = (entry: StatisticsEntry) => entry.completedAt === null ? '补录 · 日期未知' : new Date(entry.completedAt).toLocaleString(dateLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function exportHistory(entries: StatisticsEntry[]) {
  const rows = [['结束时间', '玩法', 'AI 难度', '统计单位', '结果', '个人名次', '级牌', '副数'], ...entries.map(entry => [
    dateLabel(entry), MODE_LABELS[entry.mode], DIFFICULTY_LABELS[entryDifficulty(entry)], entry.kind === 'hand' ? '单副' : '整场', isWin(entry) ? '胜' : '负',
    entry.kind === 'hand' ? placeLabel(entry) : '', entry.kind === 'hand' ? rankName(entry.levelRank) : '', entry.kind === 'hand' ? entry.handNumber : entry.handCount,
  ])];
  const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${String(tx(cell)).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  downloadTextFile(tx(`GUAN-个人战绩-${new Date().toISOString().slice(0, 10)}.csv`), csv, 'text/csv;charset=utf-8');
}
export function StatisticsDialog({ onClose, online = false, onReplay }: { onClose: () => void; online?: boolean; onReplay?: (source: ReplaySource, handId?: string) => void }) {
  const [stored, setStored] = useState(loadStatistics);
  const archive = useArchive();
  const [tab, setTab] = useState<'overview' | 'analysis'>('overview');
  const [replayError, setReplayError] = useState('');
  const [replayBusy, setReplayBusy] = useState<string | null>(null);
  const active = useRef(false);
  const [filter, setFilter] = useState<StatisticsFilter>({ mode: 'all', days: 0, kind: 'hand', difficulty: 'all' });
  const [page, setPage] = useState(0);
  const now = Date.now();
  useEffect(() => {
    active.current = true;
    const refresh = () => setStored(loadStatistics());
    const storage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(STATISTICS_PREFIX)) refresh(); };
    window.addEventListener(STATISTICS_CHANGED, refresh); window.addEventListener('storage', storage);
    return () => { active.current = false; window.removeEventListener(STATISTICS_CHANGED, refresh); window.removeEventListener('storage', storage); };
  }, []);
  const entries = useMemo(() => filterEntries(stored.entries, filter, now), [stored.entries, filter, now]);
  const summary = useMemo(() => summarize(entries), [entries]);
  const difficultyEntries = useMemo(() => filterEntries(stored.entries, { ...filter, difficulty: 'all' }, now), [stored.entries, filter, now]);
  const otherDifficulties = difficultyEntries.filter(entry => !['casual', 'balanced', 'balanced-plus', 'balanced-pro', 'jwxxc', 'danlm'].includes(entryDifficulty(entry))).length;
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE)), currentPage = Math.min(page, pages - 1);
  const unit = filter.kind === 'hand' ? '副' : '场';
  const recent = entries.filter(entry => entry.completedAt !== null).slice(0, 20).reverse();
  const recentSummary = summarize(recent);
  const updateFilter = (patch: Partial<StatisticsFilter>) => { setFilter(previous => ({ ...previous, ...patch })); setPage(0); };
  const unknownDates = entries.filter(entry => entry.completedAt === null).length;
  const changeTabWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'analysis' : tab === 'overview' ? 'analysis' : 'overview';
    setTab(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#statistics-tab-${next}`)?.focus();
  };
  const openReplay = async (entry: StatisticsEntry) => {
    const row = findReplayArchive(entry, archive.rows);
    if (!row || !onReplay || replayBusy) return;
    setReplayBusy(entryId(entry)); setReplayError('');
    try {
      const replay = replayFromArchive(await readArchive(row.key), entry);
      if (active.current) onReplay(replay.source, replay.handId);
    } catch (error) {
      if (active.current) setReplayError(error instanceof Error ? error.message : '暂时无法读取这份回放，请重试。');
    } finally { if (active.current) setReplayBusy(null); }
  };
  return <Modal title={tx("个人战绩")} onClose={onClose} wide className="statistics-dialog">
    <div className="statistics-intro"><span>{tx("每一副配合，都值得记下。")}</span><span>{tx("本机记录 · 自动保存")}</span></div>
    <div className="statistics-view-tabs" role="tablist" aria-label={tx("战绩内容")}>
      <button id="statistics-tab-overview" role="tab" aria-selected={tab === 'overview'} aria-controls="statistics-panel-overview" tabIndex={tab === 'overview' ? 0 : -1} onClick={() => setTab('overview')} onKeyDown={changeTabWithKeyboard}><BarChart3 size={16}/>{tx("战绩总览")}</button>
      <button id="statistics-tab-analysis" role="tab" aria-selected={tab === 'analysis'} aria-controls="statistics-panel-analysis" tabIndex={tab === 'analysis' ? 0 : -1} onClick={() => setTab('analysis')} onKeyDown={changeTabWithKeyboard}><History size={16}/>{tx("分析档案")}</button>
    </div>
    {tx(stored.error && <p role="status" className="statistics-error">{tx(stored.error)}</p>)}
    <ArchiveStatusNotice archive={archive}/>
    {tx(replayError && <p role="status" className="statistics-error">{tx(replayError)}</p>)}
    <div id="statistics-panel-overview" role="tabpanel" aria-labelledby="statistics-tab-overview" hidden={tab !== 'overview'}>
    <div className="statistics-filters">
      <div className="statistics-segment" role="group" aria-label={tx("战绩统计单位")}>
        <button aria-pressed={filter.kind === 'hand'} onClick={() => updateFilter({ kind: 'hand' })}>{tx("每副战绩")}</button>
        <button aria-pressed={filter.kind === 'match'} onClick={() => updateFilter({ kind: 'match' })}>{tx("整场升级赛")}</button>
      </div>
      <div className="statistics-selects"><label>{tx("玩法")}<select aria-label={tx("战绩玩法")} value={filter.mode} onChange={event => updateFilter({ mode: event.target.value as StatisticsMode | 'all' })}>
        <option value="all">{tx("全部玩法")}</option>{tx(Object.entries(MODE_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{tx(label)}</option>))}
      </select></label><label>{tx("AI 难度")}<select aria-label={tx("战绩 AI 难度")} value={filter.difficulty ?? 'all'} onChange={event => updateFilter({ difficulty: event.target.value as StatisticsFilter['difficulty'] })}>
        <option value="all">{tx("全部难度")}</option><option value="casual">{tx("休闲")}</option><option value="balanced">{tx("均衡")}</option><option value="balanced-plus">{tx("均衡 Plus")}</option><option value="balanced-pro">{tx("均衡 Pro")}</option><option value="jwxxc">Jwxxc Beta</option><option value="danlm">DanLM</option>
      </select></label><label>{tx("时间")}<select aria-label={tx("战绩时间范围")} value={filter.days} onChange={event => updateFilter({ days: Number(event.target.value) as StatisticsFilter['days'] })}>
        <option value={0}>{tx("全部时间")}</option><option value={7}>{tx("最近 7 天")}</option><option value={30}>{tx("最近 30 天")}</option>
      </select></label></div>
    </div>
    <section className="statistics-overview" aria-label={tx("战绩概览")}>
      <div className="statistics-winrate">
        <div className="statistics-ring" style={{ '--win-rate': `${(summary.winRate ?? 0) * 100}%` } as CSSProperties}>
          <div><span>{tx("我方胜率")}</span><strong data-testid="statistics-winrate">{tx(formatRate(summary.winRate))}</strong></div>
        </div>
        <p><strong>{tx(summary.wins)}</strong> {tx("胜")}<span> / </span><strong>{tx(summary.losses)}</strong> {tx("负")}</p>
      </div>
      <div className="statistics-metrics">
        <div><span>{tx("已完成")}{tx(filter.kind === 'hand' ? '对局' : '整场')}</span><strong data-testid="statistics-total">{tx(summary.total)}<small>{tx(unit)}</small></strong><p>{tx("仅统计已结算记录")}</p></div>
        {tx(filter.kind === 'hand' ? <><div><span>{tx("个人头游率")}</span><strong>{tx(formatRate(summary.firstRate))}</strong><p>{tx("你先出完，共")}{tx(summary.firsts)} {tx("次")}</p></div><div><span>{tx("我方双上")}</span><strong>{tx(summary.doubleUps)}<small>{tx("次")}</small></strong><p>{tx("你和对家包揽前两名")}</p></div></> : <><div><span>{tx("通关获胜")}</span><strong>{tx(summary.wins)}<small>{tx("场")}</small></strong><p>{tx("我方满足过 A 条件")}</p></div><div><span>{tx("整场失利")}</span><strong>{tx(summary.losses)}<small>{tx("场")}</small></strong><p>{tx("对方先完成通关")}</p></div></>)}
        <div><span>{tx("当前 / 最佳连胜")}</span><strong className="statistics-streak">{tx(summary.dated ? summary.streak : '—')}<i>/</i>{tx(summary.dated ? summary.bestStreak : '—')}</strong><p>{tx("按筛选内有日期的记录")}</p></div>
      </div>
    </section>
    <p className="statistics-definition">{tx(filter.kind === 'hand' ? '每副胜负以头游所在队伍为准；个人名次另行记录。' : '只有完整结束的升级赛计入整场胜率；未通关的比赛和单副练习不计入。')}</p>
    {tx(recent.length > 0 && <section className="statistics-recent" aria-label={tx("近期胜负走势")}><div><h3>{tx("最近")}{tx(recent.length)} {tx(unit)}</h3><p>{tx("胜率")}{tx(formatRate(recentSummary.winRate))}<span>{tx("由早到晚 →")}</span></p></div><ol>{tx(recent.map(entry => <li key={entryId(entry)} className={isWin(entry) ? 'is-win' : 'is-loss'} title={tx(`${dateLabel(entry)} · ${MODE_LABELS[entry.mode]} · ${isWin(entry) ? '胜' : '负'}`)} aria-label={tx(`${dateLabel(entry)} ${isWin(entry) ? '胜' : '负'}`)}>{tx(isWin(entry) ? '胜' : '负')}</li>))}</ol></section>)}
    <section className="statistics-history" aria-label={tx("历史对局")}>
      <div className="statistics-history-heading"><h3>{tx("历史对局")}<small>{tx(entries.length)} {tx("条")}</small></h3><button className="text-button" disabled={!entries.length} onClick={() => exportHistory(entries)}><Download size={14}/>{tx("导出当前记录")}</button></div>
      {tx(!entries.length ? <div className="statistics-empty"><BarChart3 size={30}/><h3>{tx(stored.entries.length ? '这个范围内，还没有已完成的对局' : '你的第一笔战绩，等这一副落定')}</h3><p>{tx(stored.entries.length ? '试试其他玩法或“全部时间”。' : '完成对局后会自动记入这里。继续存档和查看回放不会重复计数。')}</p></div>
        : <div className="statistics-table-wrap" tabIndex={0} aria-label={tx("历史对局明细")}><table><thead><tr><th>{tx("结束时间")}</th><th>{tx("玩法")}</th><th>{tx("AI 难度")}</th><th>{tx("我方结果")}</th><th>{tx(filter.kind === 'hand' ? '个人名次' : '完成副数')}</th><th>{tx(filter.kind === 'hand' ? '本副级牌' : '结算')}</th>{tx(onReplay && <th>{tx("回看")}</th>)}</tr></thead><tbody>
          {tx(entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(entry => <tr key={entryId(entry)}>
            <td><time dateTime={entry.completedAt === null ? undefined : new Date(entry.completedAt).toISOString()}>{tx(dateLabel(entry))}</time></td>
            <td>{tx(MODE_LABELS[entry.mode])}{tx(entry.kind === 'hand' && entry.mode !== 'practice' && <small>{tx(`第 ${entry.handNumber} 副`)}</small>)}</td>
            <td>{tx(DIFFICULTY_LABELS[entryDifficulty(entry)])}</td>
            <td><span className={`statistics-outcome ${isWin(entry) ? 'is-win' : 'is-loss'}`}>{tx(isWin(entry) ? '胜利' : '失利')}</span>{tx(entry.kind === 'hand' && entry.result.doubleUp && <small>{tx(isWin(entry) ? '我方双上' : '我方双下')}</small>)}</td>
            <td>{tx(entry.kind === 'hand' ? <span className={placeLabel(entry) === '头游' ? 'statistics-first' : undefined}>{tx(placeLabel(entry) === '头游' && <Trophy size={12}/>)} {tx(placeLabel(entry))}</span> : `${entry.handCount} 副`)}</td>
            <td>{tx(entry.kind === 'hand' ? `打 ${rankName(entry.levelRank)}` : isWin(entry) ? '我方过 A' : '对方过 A')}</td>
            {tx(onReplay && <td>{tx(findReplayArchive(entry, archive.rows)
              ? <button className="text-button statistics-replay-button" aria-label={tx(`回看${MODE_LABELS[entry.mode]}${entry.kind === 'hand' ? `第 ${entry.handNumber} 副` : '整场升级赛'}`)} disabled={replayBusy !== null} onClick={() => void openReplay(entry)}>{tx(replayBusy === entryId(entry) ? '正在读取…' : entry.kind === 'hand' ? '回看本副' : '回看整场')}</button>
              : <span className="statistics-replay-unavailable">{tx(entry.mode === 'online' ? '仅战绩记录' : archive.loading ? '读取档案…' : archive.loadError ? '档案读取失败' : '过程未留存')}</span>)}</td>)}
          </tr>))}
        </tbody></table></div>)}
      {tx(pages > 1 && <nav className="statistics-pagination" aria-label={tx("战绩翻页")}><button className="text-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{tx("上一页")}</button><span aria-live="polite">{tx(currentPage + 1)} / {tx(pages)}</span><button className="text-button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>{tx("下一页")}</button></nav>)}
    </section>
    <details className="statistics-breakdown"><summary>{tx("按 AI 难度与玩法细看")}</summary>
    <section className="statistics-difficulty-section" aria-label={tx("各 AI 难度胜率")}>
      <div className="statistics-difficulty-heading"><h3>{tx("按 AI 难度")}</h3><span>{tx("当前玩法与时间范围 · 点击查看明细")}</span></div>
      <div className="statistics-difficulties">{tx((['casual', 'balanced', 'balanced-plus', 'balanced-pro', 'jwxxc', 'danlm'] as const).map(difficulty => {
        const stats = summarize(difficultyEntries.filter(entry => entryDifficulty(entry) === difficulty));
        return <button key={difficulty} data-testid={`statistics-difficulty-${difficulty}`} aria-label={tx(`筛选${DIFFICULTY_LABELS[difficulty]}难度战绩`)}
          aria-pressed={filter.difficulty === difficulty} onClick={() => updateFilter({ difficulty: filter.difficulty === difficulty ? 'all' : difficulty })}>
          <span>{tx(DIFFICULTY_LABELS[difficulty])}<small>{tx("AI 难度")}</small></span><strong>{tx(formatRate(stats.winRate))}</strong><small>{tx(stats.total)} {tx(unit)} · {tx(stats.wins)} {tx("胜")}{tx(stats.losses)} {tx("负")}</small>
        </button>;
      }))}</div>
      {tx(otherDifficulties > 0 && <p className="statistics-difficulty-note">{tx("另有")}{tx(otherDifficulties)} {tx(unit)}{tx("联机、旧版配置、难度混用或未记录难度的战绩，不计入上述档位胜率，仍保留在总战绩。")}</p>)}
      {tx(filter.kind === 'match' && <p className="statistics-difficulty-note">{tx("整场所有已完成的副数使用同一难度，才计入对应胜率。")}</p>)}
    </section>
    {tx(filter.mode === 'all' && <section className="statistics-modes" aria-label={tx("各玩法胜率")}>
      {tx((Object.keys(MODE_LABELS) as StatisticsMode[]).filter(mode => filter.kind === 'hand' || mode !== 'practice').map(mode => {
        const stats = summarize(entries.filter(entry => entry.mode === mode));
        return <button key={mode} onClick={() => updateFilter({ mode })} aria-label={tx(`筛选${MODE_LABELS[mode]}战绩`)}><span>{tx(MODE_LABELS[mode])}</span><strong>{tx(formatRate(stats.winRate))}</strong><small>{tx(stats.total)} {tx(unit)} · {tx(stats.wins)} {tx("胜")}{tx(stats.losses)} {tx("负")}</small></button>;
      }))}
    </section>)}
    </details>
    <footer className="statistics-footnote"><p>{tx(isFullMacDistribution ? '战绩保存在这台 Mac 的 GUAN 中，更换设备不会自动同步。' : '战绩保存在当前浏览器、当前网址中，更换设备或网址不会自动同步。')}{tx(online ? '联机牌桌会继续进行。' : '')}</p>{tx((online || entries.some(entry => entry.mode === 'online')) && <p>{tx("联机按你入座的队伍记录，包含该座位的离线托管结果。")}</p>)}<p>{tx("现有存档中能核实的结果会自动补录。")}{tx(unknownDates > 0 ? `当前有 ${unknownDates} 条补录记录无日期，` : '无日期的补录记录')}{tx("不计入近期范围和连胜；已被覆盖的旧对局无法补回。")}</p>{tx(onReplay && <p>{tx("只有保存了完整过程的本地对局可回看；“过程未留存”的记录仍计入战绩。")}</p>)}</footer>
    </div>
    <div id="statistics-panel-analysis" role="tabpanel" aria-labelledby="statistics-tab-analysis" hidden={tab !== 'analysis'}><AnalysisArchive archive={archive} onReplay={onReplay} onError={setReplayError}/></div>
  </Modal>;
}
