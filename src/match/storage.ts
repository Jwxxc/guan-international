import { decodeSavedGame, STORAGE_KEYS, type SavedGame } from '../game/persistence';
import { decodeMatchSession, encodeMatchSession } from './session';
import type { MatchSession } from './sessionTypes';
import type { ReplaySource } from './replay';

/** Old keys are read-only compatibility sources. New modes never overwrite them. */
export const MATCH_STORAGE = {
  classic: 'guan.classic.current.v1', legacy: 'guan.legacy-match.current.v1',
  practice: 'guan.practice.current.v2', active: 'guan.active-session.v2',
  practiceRetired: 'guan.practice.legacy-retired.v2',
  replay: 'guan.match.replay.v2', practiceReplay: 'guan.practice.replay.v2', activeReplay: 'guan.active-replay.v2',
} as const;
const invalid = '无法恢复这份存档：数据损坏或版本不兼容。原始数据已保留，可以重新开始。';
const unavailable = '本次进度暂时无法保存：浏览器存储不可用或空间不足。当前对局仍可继续。';
type LoadedSession = { saved: SavedGame | null; match: MatchSession | null; error?: string };
function decodeSession(raw: string): LoadedSession {
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && 'kind' in parsed && parsed.kind === 'match') {
    const match = decodeMatchSession(raw); return { saved: match.saved, match };
  }
  return { saved: decodeSavedGame(raw), match: null };
}
export function loadSession(preferredMode?: 'match' | 'practice'): LoadedSession {
  try {
    if(preferredMode){
      const raw=preferredMode==='match'?localStorage.getItem(MATCH_STORAGE.classic)??localStorage.getItem(MATCH_STORAGE.legacy):localStorage.getItem(MATCH_STORAGE.practice);
      if(raw){try{return decodeSession(raw);}catch{return {saved:null,match:null,error:invalid};}}
      if(preferredMode==='practice'&&localStorage.getItem(MATCH_STORAGE.practiceRetired)==='true')return {saved:null,match:null};
      const legacy=localStorage.getItem(STORAGE_KEYS.current);
      if(!legacy)return {saved:null,match:null};
      try {const loaded=decodeSession(legacy);return (!!loaded.match)===(preferredMode==='match')?loaded:{saved:null,match:null};}
      catch{return {saved:null,match:null,error:invalid};}
    }
    const active = localStorage.getItem(MATCH_STORAGE.active);
    if (active === 'none') return { saved: null, match: null };
    const key = active === 'classic' ? MATCH_STORAGE.classic : active === 'legacy' ? MATCH_STORAGE.legacy : active === 'practice' ? MATCH_STORAGE.practice : null;
    const raw = key ? localStorage.getItem(key) : localStorage.getItem(MATCH_STORAGE.classic) ?? localStorage.getItem(MATCH_STORAGE.practice) ?? localStorage.getItem(MATCH_STORAGE.legacy) ?? localStorage.getItem(STORAGE_KEYS.current);
    if (!raw) return { saved: null, match: null };
    try { return decodeSession(raw); } catch { return { saved: null, match: null, error: invalid }; }
  } catch { return { saved: null, match: null, error: unavailable }; }
}
function writeCurrent(key: string, raw: string, active: string): string | null {
  try { localStorage.setItem(key, raw); localStorage.setItem(MATCH_STORAGE.active, active); return null; }
  catch { return unavailable; }
}
export function saveMatch(match: MatchSession): string | null {
  const classic = match.journal.rulesVersion === 'guan-classic-house-v1';
  return writeCurrent(classic ? MATCH_STORAGE.classic : MATCH_STORAGE.legacy, encodeMatchSession(match), classic ? 'classic' : 'legacy');
}
export function savePracticeSession(saved: SavedGame): string | null {
  const error=writeCurrent(MATCH_STORAGE.practice,JSON.stringify(saved),'practice');
  if(error)return error;
  try{localStorage.setItem(MATCH_STORAGE.practiceRetired,'true');return null;}catch{return unavailable;}
}
export function clearPracticeSession(): string | null {
  try { localStorage.setItem(MATCH_STORAGE.practiceRetired,'true');localStorage.removeItem(MATCH_STORAGE.practice); localStorage.setItem(MATCH_STORAGE.active, 'none'); return null; } catch { return unavailable; }
}
export function saveReplaySource(source: ReplaySource): string | null {
  if (source.kind === 'match' && source.match.phase !== 'complete') return '本场尚未结束，不能覆盖最近一场完整回放。';
  if (source.kind === 'practice' && !source.saved.state.result) return '本副尚未结束，不能保存完整回放。';
  try {
    const key = source.kind === 'match' ? MATCH_STORAGE.replay : MATCH_STORAGE.practiceReplay;
    localStorage.setItem(key, source.kind === 'match' ? encodeMatchSession(source.match) : JSON.stringify(source.saved));
    localStorage.setItem(MATCH_STORAGE.activeReplay, source.kind); return null;
  } catch { return unavailable; }
}
/** Do not discard the last recoverable practice checkpoint until its replay is durable. */
export function saveFinishedPractice(saved: SavedGame): string | null {
  const error = saveReplaySource({kind:'practice',saved});
  return error ?? clearPracticeSession();
}
export function loadReplaySource(): { source: ReplaySource | null; error?: string } {
  try {
    const preferred = localStorage.getItem(MATCH_STORAGE.activeReplay);
    const matchRaw = localStorage.getItem(MATCH_STORAGE.replay);
    const practiceRaw = localStorage.getItem(MATCH_STORAGE.practiceReplay) ?? localStorage.getItem(STORAGE_KEYS.replay);
    try {
      if ((preferred === 'match' || !practiceRaw) && matchRaw) {
        const match = decodeMatchSession(matchRaw); if (match.phase !== 'complete') throw Error('incomplete'); return { source: { kind: 'match', match } };
      }
      if (practiceRaw) return { source: { kind: 'practice', saved: decodeSavedGame(practiceRaw, true) } };
      return { source: null };
    } catch { return { source: null, error: invalid }; }
  } catch { return { source: null, error: unavailable }; }
}
