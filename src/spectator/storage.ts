import { restoreStudy, storeStudy, type StudyDocument, type StoredStudy } from './model';

// Deliberately separate from gameplay saves, personal statistics and training.
export const STUDY_DATABASE = 'guan.spectator.v1';
export interface StudySummary { id: string; createdAt: number; updatedAt: number; hands: number; actions: number; bookmarks: number; complete: boolean }
interface StudyRow extends StudySummary { value: StoredStudy }
/** Concurrent tabs may move their camera freely, but cannot overwrite a longer
 * or divergent action journal with an older copy of the same match. */
export function extendsStudyJournal(previous: StoredStudy, next: StoredStudy): boolean {
  if (previous.journal.matchId !== next.journal.matchId || previous.journal.records.length > next.journal.records.length) return false;
  return previous.journal.records.every((record, index) => {
    const current = next.journal.records[index];
    return record.seed === current.seed && record.config.handId === current.config.handId
      && (!record.started || current.started) && record.actions.length <= current.actions.length && record.exchangeActions.length <= current.exchangeActions.length
      && record.actions.every((action, i) => JSON.stringify(action) === JSON.stringify(current.actions[i]))
      && record.exchangeActions.every((action, i) => JSON.stringify(action) === JSON.stringify(current.exchangeActions[i]));
  });
}
let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(STUDY_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = () => reject(Error('观战存储暂时无法打开'));
    request.onblocked = () => reject(Error('观战存储被其他窗口占用，请关闭旧窗口后重试'));
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}

export async function saveStudy(document: StudyDocument): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const row: StudyRow = { id: document.match.journal.matchId, createdAt: document.createdAt, updatedAt: document.updatedAt,
      hands: document.match.journal.records.length, actions: document.decisions.length, bookmarks: document.bookmarks.length,
      complete: document.match.phase === 'complete', value: storeStudy(document) };
    const store = tx.objectStore('sessions');
    let failure = '观战进度暂时无法保存，请重试保存；当前牌局仍在内存中';
    const previous = store.get(row.id);
    previous.onsuccess = () => {
      if (previous.result && !extendsStudyJournal((previous.result as StudyRow).value, row.value)) {
        failure = '另一个窗口已有更新的观战记录。请刷新页面后重新打开这场观战，避免覆盖已发生的动作';
        tx.abort(); return;
      }
      store.put(row);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(Error(failure));
  });
}

export async function listStudies(): Promise<StudySummary[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const rows: StudySummary[] = [];
    const request = db.transaction('sessions').objectStore('sessions').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(rows.sort((a, b) => b.updatedAt - a.updatedAt)); return; }
      const { value: _value, ...summary } = cursor.value as StudyRow;
      rows.push(summary); cursor.continue();
    };
    request.onerror = () => reject(Error('无法读取观战列表，已保存的记录未改动'));
  });
}

export async function loadStudy(id: string): Promise<StudyDocument> {
  const db = await database();
  const row = await new Promise<StudyRow>((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').get(id);
    request.onsuccess = () => request.result ? resolve(request.result as StudyRow) : reject(Error('没有找到这场观战'));
    request.onerror = () => reject(Error('无法读取观战，原记录已保留'));
  });
  return restoreStudy(row.value);
}
