import type { AiObservation } from '../ai/types';
import type { DecisionRecord } from '../game/aiDiagnostics';
import type { SavedGame } from '../game/persistence';
import type { MatchJournal, MatchSession } from '../match/sessionTypes';
import { archiveKey, mergeHand, summarizeHand, type AnalysisBundle, type ArchivedDecision, type ArchivedHand, type ArchiveSummary } from './model';
import { resolveStrategy } from '../ai/descriptors';
import {getProLifecycle} from '../game/aiLifecycle';

export const ARCHIVE_CHANGED = 'guan:analysis-archive-changed';
export const ARCHIVE_DATABASE = 'guan.analysis.v1';
let database: Promise<IDBDatabase> | undefined;
let failure = '';
const pending: Array<() => Promise<void>> = [];
let draining: Promise<void> | undefined;
const signal = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(ARCHIVE_CHANGED)); };
export const archiveStatus = () => ({ error: failure, pending: pending.length });
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ARCHIVE_DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('hands', { keyPath: 'key' });
      db.createObjectStore('summaries', { keyPath: 'key' });
      db.createObjectStore('matches', { keyPath: 'matchId' });
      db.createObjectStore('decisions', { keyPath: 'key' }).createIndex('handKey', 'handKey');
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('档案数据库被其他窗口占用，请关闭旧窗口后重试。'));
  }).catch(error => { database = undefined; throw error; });
  return database;
}
const requestValue = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
const transactionDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error ?? Error('档案写入中断'));
});
function queue(operation: () => Promise<void>) { pending.push(operation); void flushArchive().catch(() => {}); }
export function flushArchive(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    try {
      while (pending.length) { await pending[0](); pending.shift(); }
      failure = '';
    } catch (error) {
      failure = `分析档案尚未保存：${error instanceof Error ? error.message : '浏览器存储不可用或空间不足'}。请保留当前页面并重试。`;
      throw Error(failure);
    }
  })().finally(() => { draining = undefined; signal(); });
  return draining;
}

/** Checkpoints and journals are archived outside the engine and never fed to AI. */
export function archiveCheckpoint(saved: SavedGame, match?: MatchSession | null, origin: ArchivedHand['origin'] = 'live', acceptedAction = false, persistJournal = true) {
  const now = Date.now(), snapshot = structuredClone(saved), journal = match && persistJournal ? structuredClone(match.journal) : undefined;
  const hand: ArchivedHand = {
    schema: 'guan-analysis-hand-v1', key: archiveKey(saved.state.sessionId, saved.state.handId), sessionId: saved.state.sessionId, handId: saved.state.handId,
    mode: match ? match.journal.rulesVersion === 'guan-classic-house-v1' ? 'classic' : 'legacy' : 'practice', handNumber: match?.progress.handNumber ?? 1,
    firstArchivedAt: now, updatedAt: now, completedAt: origin === 'live' && acceptedAction && saved.state.result ? now : null,
    origin, saved: snapshot, actionTimes: acceptedAction && saved.actions.length ? { [saved.actions.at(-1)!.stateVersion]: now } : {},
  };
  queue(async () => {
    const db = await openDatabase();
    const tx = db.transaction(['hands', 'summaries', 'matches'], 'readwrite'), done = transactionDone(tx);
    let conflict: unknown;
    const request = tx.objectStore('hands').get(hand.key);
    request.onsuccess = () => {
      try {
        const merged = mergeHand(request.result, hand);
        tx.objectStore('hands').put(merged); tx.objectStore('summaries').put(summarizeHand(merged));
      } catch (error) { conflict = error; tx.abort(); }
    };
    if (journal) {
      const current = tx.objectStore('matches').get(journal.matchId);
      current.onsuccess = () => {
        const previous = current.result as MatchJournal | undefined;
        const weight = (value: MatchJournal) => value.records.reduce((count, record) => count + 1 + record.actions.length + record.exchangeActions.length + Number(record.started), 0);
        if (!previous || weight(journal) >= weight(previous)) tx.objectStore('matches').put(journal);
      };
    }
    try { await done; } catch (error) { throw conflict ?? error; }
  });
}

export function archiveDecision(record: DecisionRecord, observation: AiObservation, decisionSeed: number) {
  const { history: _history, ...view } = observation;
  const handKey = archiveKey(record.sessionId, record.handId);
  // The same family ID can execute different immutable Beta snapshots. Keep the
  // identity that produced this decision rather than the family's bundled model.
  const decisionDescriptor = resolveStrategy(record.identity?.requested ?? record.decision.policyVersion);
  if (record.identity && record.identity.requestedDescriptorHash !== decisionDescriptor.descriptorHash) throw Error('决策档案的运行策略身份不一致');
  const value: ArchivedDecision = structuredClone({ ...record, handKey,
    key: JSON.stringify([record.sessionId, record.handId, record.stateVersion, record.player, record.role]),
    recordedAt: Date.now(), decisionSeed, observation: view, decisionDescriptor });
  queue(async () => {
    const db = await openDatabase(), tx = db.transaction('decisions', 'readwrite'), done = transactionDone(tx);
    // Repeated hints at the same state preserve the first real computation.
    const store = tx.objectStore('decisions'), old = store.get(value.key);
    old.onsuccess = () => { if (!old.result) store.put(value); };
    await done;
  });
}

export async function listArchive(): Promise<ArchiveSummary[]> {
  const db = await openDatabase();
  const rows = await requestValue(db.transaction('summaries').objectStore('summaries').getAll()) as ArchiveSummary[];
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || b.handNumber - a.handNumber);
}
export async function readArchive(key: string): Promise<AnalysisBundle> {
  await flushArchive();
  const db = await openDatabase();
  const tx = db.transaction(['hands', 'decisions', 'matches']);
  const hand = await requestValue(tx.objectStore('hands').get(key)) as ArchivedHand | undefined;
  if (!hand) throw Error('找不到这副分析档案。');
  if (!hand.saved.state.result) throw Error('本副尚未结束，完整分析文档将在结算后开放。');
  const [decisions, journal] = await Promise.all([
    requestValue(tx.objectStore('decisions').index('handKey').getAll(key)) as Promise<ArchivedDecision[]>,
    requestValue(tx.objectStore('matches').get(hand.sessionId)) as Promise<MatchJournal | undefined>,
  ]);
  return { schema: 'guan-analysis-bundle-v1', exportedAt: Date.now(), hand,
    runtimeAttempts:{coverage:'current-page-bounded-pro-attempts',records:getProLifecycle(hand.handId)},
    decisions: decisions.sort((a, b) => a.stateVersion - b.stateVersion || a.recordedAt - b.recordedAt),
    ...(journal ? { matchJournal: { ...journal, records: journal.records.slice(0, hand.handNumber) } } : {}) };
}
