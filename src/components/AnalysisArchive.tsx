import { tx, dateLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { readArchive } from '../archive/storage';
import { downloadAnalysisFile, exportAnalysis } from '../archive/export';
import { replayFromArchive } from '../archive/replay';
import type { ArchiveState } from '../archive/useArchive';
import type { ReplaySource } from '../match/replay';
import { MODE_LABELS } from '../statistics/model';
import { rankName } from '../engine/rules';
import { isFullMacDistribution } from '../game/distribution';

export function ArchiveStatusNotice({ archive }: { archive: ArchiveState }) {
  return <>
    {tx(archive.status.error && <div className="statistics-error" role="status"><p>{tx(archive.status.error)}</p><button className="secondary-button" disabled={archive.retrying} onClick={() => void archive.retrySave()}>{tx(archive.retrying ? '正在重试保存…' : '重试保存分析档案')}</button></div>)}
    {tx(archive.loadError && <div className="statistics-error" role="status"><p>{tx(archive.loadError)}</p><button className="secondary-button" disabled={archive.loading} onClick={() => void archive.refresh()}>{tx("重试读取分析档案")}</button></div>)}
  </>;
}

export function AnalysisArchive({ archive, onReplay, onError }: { archive: ArchiveState; onReplay?: (source: ReplaySource, handId?: string) => void; onError?: (message: string) => void }) {
  const { rows, status, loadError, loading } = archive;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(''); onError?.('');
    try { await operation(); } catch (error) { if (active.current) {
      const message = error instanceof Error ? error.message : '档案暂时无法打开，请重试。';
      setError(message); onError?.(message);
    } }
    finally { if (active.current) setBusy(false); }
  };
  const openReplay = async (key: string) => {
    const replay = replayFromArchive(await readArchive(key));
    if (active.current) onReplay?.(replay.source, replay.handId);
  };
  const complete = rows.filter(row => row.completed);
  const pages = Math.max(1, Math.ceil(rows.length / 6)), current = Math.min(page, pages - 1);
  const exportAll = async () => {
    const hands = [];
    for (const row of complete) hands.push(await readArchive(row.key));
    if (active.current) downloadAnalysisFile(`GUAN-全部对局分析-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schema: 'guan-analysis-collection-v1', exportedAt: Date.now(), hands }, null, 2), 'application/json');
  };
  return <section className="analysis-archive" aria-label={tx("对局分析档案")}>
    <div className="statistics-history-heading"><h3>{tx("对局分析档案")}<small>{tx(rows.length)} {tx("副")}</small></h3><button className="text-button" disabled={busy || !complete.length} onClick={() => void run(exportAll)}>{tx("导出全部 JSON")}</button></div>
    <p>{tx("想复盘一手选择时，再来这里。已结束的本地对局")}{tx(onReplay ? '可查看回放，或导出' : '可导出')}{tx("出牌过程与当时记录的 AI 决策。")}</p>
    <p className="analysis-archive-note">{tx("旧存档只补录能恢复的过程，缺失决策会明确标注。")}{tx(isFullMacDistribution ? '档案保存在这台 Mac 的 GUAN 中' : '档案保存在当前浏览器、当前网址中')}{tx("；下载文档后可在游戏外长期留存。联机记录暂不包含在此档案中。")}</p>
    {tx(error && !onError && <p role="status" className="statistics-error">{tx(error)}</p>)}
    {tx(!rows.length && !error && !status.error && !loadError && <p>{tx(loading ? '正在读取本机档案…' : '完成本地对局后可在这里回看；可恢复的旧存档也会补录。')}</p>)}
    <ul className="analysis-archive-list">{tx(rows.slice(current * 6, (current + 1) * 6).map(row => <li key={row.key}>
      <div><strong>{tx(MODE_LABELS[row.mode])} {tx("· 第")}{tx(row.handNumber)} {tx("副 · 打")}{tx(rankName(row.levelRank))}</strong><small>{tx(row.completed ? `${row.actionCount} 步 · 已结束` : `${row.actionCount} 步 · 未结束，持续保存`)} · {tx(row.completedAt ? new Date(row.completedAt).toLocaleString(dateLocale()) : '结束时间未记录')}</small><details className="analysis-record-details"><summary>{tx("记录编号")}</summary><small className="analysis-hand-id">{tx(row.handId)}</small></details></div>
      <div className="analysis-archive-actions">{tx(onReplay && <button className="text-button archive-replay-button" disabled={busy || !row.completed} onClick={() => void run(() => openReplay(row.key))}>{tx("回看本副")}</button>)}<button className="text-button" disabled={busy || !row.completed} onClick={() => void run(() => exportAnalysis(row.key, 'md'))}>{tx("分析文档")}</button><button className="text-button" disabled={busy || !row.completed} onClick={() => void run(() => exportAnalysis(row.key, 'json'))}>{tx("原始 JSON")}</button></div>
    </li>))}</ul>
    {tx(pages > 1 && <nav className="statistics-pagination" aria-label={tx("分析档案翻页")}><button className="text-button" disabled={!current} onClick={() => setPage(current - 1)}>{tx("上一页")}</button><span>{tx(current + 1)} / {tx(pages)}</span><button className="text-button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>{tx("下一页")}</button></nav>)}
    {tx(busy && <p role="status">{tx("正在处理分析档案…")}</p>)}
  </section>;
}
