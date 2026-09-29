import { useCallback, useEffect, useRef, useState } from 'react';
import { ARCHIVE_CHANGED, archiveStatus, flushArchive, listArchive } from './storage';
import type { ArchiveSummary } from './model';

export function useArchive() {
  const [rows, setRows] = useState<ArchiveSummary[]>([]);
  const [status, setStatus] = useState(archiveStatus);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (active.current) { setStatus(archiveStatus()); setLoading(true); }
    try {
      const next = await listArchive();
      if (active.current && request === generation.current) { setRows(next); setLoadError(''); }
    } catch (error) {
      if (active.current && request === generation.current) setLoadError(`无法读取分析档案：${error instanceof Error ? error.message : '本机存储暂不可用'}。可重试读取，原记录不会被覆盖。`);
    } finally {
      if (active.current && request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const update = () => { void refresh(); };
    update(); window.addEventListener(ARCHIVE_CHANGED, update);
    return () => { active.current = false; generation.current++; window.removeEventListener(ARCHIVE_CHANGED, update); };
  }, [refresh]);
  const retrySave = async () => {
    setRetrying(true);
    try { await flushArchive(); } catch { /* flushArchive retains and broadcasts the actionable error. */ }
    finally { if (active.current) { setStatus(archiveStatus()); setRetrying(false); } }
  };
  return { rows, status, loadError, loading, retrying, refresh, retrySave };
}
export type ArchiveState = ReturnType<typeof useArchive>;
