import type { PlayerSession } from './protocol';
import { ROOM_CODE_PATTERN } from './protocol';

export const ONLINE_SESSION_KEY = 'guan.online.sessions.v1';
interface StoredSession { session: PlayerSession; savedAt: number }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function read(): StoredSession[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is StoredSession => {
      if (!object(row) || !object(row.session) || typeof row.savedAt !== 'number') return false;
      const s = row.session;
      return typeof s.roomCode === 'string' && ROOM_CODE_PATTERN.test(s.roomCode) && typeof s.playerId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s.playerId)
        && typeof s.playerToken === 'string' && /^[a-f0-9]{64}$/.test(s.playerToken) && Number.isInteger(s.seat) && Number(s.seat) >= 0 && Number(s.seat) < 4
        && (s.recoveryCode === undefined || typeof s.recoveryCode === 'string' && /^[a-f0-9]{64}$/.test(s.recoveryCode));
    }).slice(-8);
  } catch { return []; }
}
export function loadOnlineSession(roomCode: string): PlayerSession | null {
  const value = read().find(row => row.session.roomCode === roomCode); return value ? { ...value.session } : null;
}
export function saveOnlineSession(session: PlayerSession): boolean {
  try {
    const rows = read().filter(row => row.session.roomCode !== session.roomCode);
    rows.push({ session: { ...session }, savedAt: Date.now() });
    localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(rows.slice(-8))); return true;
  } catch { return false; }
}
export function forgetOnlineSession(roomCode: string): void {
  try { localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(read().filter(row => row.session.roomCode !== roomCode))); } catch { /* Explicit recovery remains available. */ }
}
