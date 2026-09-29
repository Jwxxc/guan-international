import { applyAction, createPracticeGame } from '../engine/reducer';
import { RNG_VERSION, RULES_VERSION } from '../engine/rules';
import type { GameAction, GameState, PracticeConfig } from '../engine/types';
import { applyExchangeAction, createExchange, finishExchangeGame } from '../match/exchange';
import type { HandSetup } from '../match/types';
import { isStrategyId, readStrategyStamp as readPolicyStamp, readSeatPolicies } from '../ai/descriptors';
import type { StrategyId as PolicyId, StrategyStamp as PolicyStamp, SeatPolicies } from '../ai/strategyTypes';
import { DEFAULT_MUSIC_TRACK, getMusicTrack, getMusicPlaybackMode, type MusicPlaybackMode, type MusicTrackId } from '../audio/tracks';

export interface Settings { levelRank: number; muted: boolean; reducedMotion: boolean; musicEnabled: boolean; musicVolume: number; danlmContinuousHints?: boolean; musicTrack?: MusicTrackId; musicPlaybackMode?: MusicPlaybackMode; playMode?: 'match' | 'practice'; aiPolicy?: PolicyId; unrecognizedAiPolicy?:unknown }
export interface SavedGame {
  schemaVersion: 1;
  rulesVersion: typeof RULES_VERSION;
  rngVersion: typeof RNG_VERSION;
  seed: number;
  config: PracticeConfig;
  actions: GameAction[];
  state: GameState;
  setup?: HandSetup;
  policy?: PolicyStamp;
  seatPolicies?: SeatPolicies;
}
export const STORAGE_KEYS = { current: 'guan.current.v1', replay: 'guan.replay.v1', settings: 'guan.settings.v1' } as const;
const DEFAULT_SETTINGS: Settings = { levelRank: 2, muted: false, reducedMotion: false, musicEnabled: true, musicVolume: .22, musicTrack: DEFAULT_MUSIC_TRACK, musicPlaybackMode: 'sequence', playMode: 'match' };
const INVALID = '无法恢复这份存档：数据损坏或版本不兼容。可以重新开始。';
const UNAVAILABLE = '本次无法保存：浏览器存储不可用或空间不足。当前对局仍可继续。';
const MAX_ACTIONS = 1500;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const seat = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 4;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 200;
const uint = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;

export function initialGame(config: PracticeConfig, seed: number, setup?: HandSetup): GameState {
  const game = createPracticeGame(config, seed);
  if (!setup) return game;
  if (!['guan-tribute-v1','guan-classic-house-v1'].includes(setup.version) || !Array.isArray(setup.actions) || setup.actions.length > 4) throw new Error(INVALID);
  let exchange = createExchange(game, setup.previous, setup.version==='guan-classic-house-v1'?'guan-classic-house-v1':'guan-match-v1');
  for (const action of setup.actions) {
    const next = applyExchangeAction(exchange, action);
    if (!next.ok) throw new Error(INVALID);
    exchange = next.exchange;
  }
  return finishExchangeGame(game, exchange);
}

export function createSavedGame(config: PracticeConfig, seed: number, setup?: HandSetup, policy?: PolicyStamp, seatPolicies?: SeatPolicies): SavedGame {
  const state = initialGame(config, seed, setup);
  return {
    schemaVersion: 1, rulesVersion: RULES_VERSION, rngVersion: RNG_VERSION, seed,
    config: { levelRank: state.rules.levelRank, sessionId: state.sessionId, handId: state.handId, firstPlayer: state.firstPlayer },
    actions: [], state, ...(setup ? { setup: structuredClone(setup) } : {}), ...(policy ? { policy: readPolicyStamp(policy) } : {}), ...(seatPolicies ? {seatPolicies:readSeatPolicies(seatPolicies)} : {}),
  };
}

export function advanceSavedGame(saved: SavedGame, action: GameAction): { ok: true; saved: SavedGame } | { ok: false; error: string } {
  const result = applyAction(saved.state, action);
  return result.ok ? { ok: true, saved: { ...saved, actions: [...saved.actions, structuredClone(action)], state: result.state } } : result;
}

// Compare the complete replayed authority, including IDs, hands, pending replies and substitutions.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function validAction(value: unknown): value is GameAction {
  if (!record(value) || !identifier(value.sessionId) || !identifier(value.handId) || !seat(value.player) || !uint(value.stateVersion)) return false;
  if (value.type === 'pass') return true;
  return value.type === 'play' && Array.isArray(value.cardIds) && value.cardIds.length > 0 && value.cardIds.length <= 10
    && value.cardIds.every(identifier) && new Set(value.cardIds).size === value.cardIds.length
    && typeof value.playKey === 'string' && value.playKey.length > 0 && value.playKey.length < 5000;
}

export function decodeSavedGame(raw: string, requireCompleted = false): SavedGame {
  if (raw.length > 5_000_000) throw new Error(INVALID);
  const data: unknown = JSON.parse(raw);
  if (!record(data) || data.schemaVersion !== 1 || data.rulesVersion !== RULES_VERSION || data.rngVersion !== RNG_VERSION || !uint(data.seed)
    || !record(data.config) || !Array.isArray(data.actions) || data.actions.length > MAX_ACTIONS || !record(data.state)) throw new Error(INVALID);
  const c = data.config;
  if (!Number.isInteger(c.levelRank) || Number(c.levelRank) < 2 || Number(c.levelRank) > 14 || !identifier(c.sessionId) || !identifier(c.handId) || !seat(c.firstPlayer)) throw new Error(INVALID);
  if (data.setup !== undefined && !record(data.setup)) throw new Error(INVALID);
  let saved = createSavedGame(c as PracticeConfig, data.seed, data.setup as HandSetup | undefined, readPolicyStamp(data.policy), readSeatPolicies(data.seatPolicies));
  for (const action of data.actions) {
    if (!validAction(action)) throw new Error(INVALID);
    const result = advanceSavedGame(saved, action);
    if (!result.ok) throw new Error(INVALID);
    saved = result.saved;
  }
  if (canonical(saved.state) !== canonical(data.state) || (requireCompleted && !saved.state.result)) throw new Error(INVALID);
  return saved;
}

function load(key: string, completed: boolean): { value: SavedGame | null; error?: string } {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return { value: null, error: UNAVAILABLE }; }
  if (!raw) return { value: null };
  try { return { value: decodeSavedGame(raw, completed) }; } catch { return { value: null, error: INVALID }; }
}
function write(key: string, value: unknown): string | null {
  try { localStorage.setItem(key, JSON.stringify(value)); return null; } catch { return UNAVAILABLE; }
}
export const loadCurrent = () => load(STORAGE_KEYS.current, false);
export const loadReplay = () => load(STORAGE_KEYS.replay, true);
export const saveCurrent = (saved: SavedGame): string | null => write(STORAGE_KEYS.current, saved);
export const saveReplay = (saved: SavedGame): string | null => saved.state.result ? write(STORAGE_KEYS.replay, saved) : '本副尚未结束，不能保存为完整回放。';
export function clearCurrent(): string | null {
  try { localStorage.removeItem(STORAGE_KEYS.current); return null; } catch { return UNAVAILABLE; }
}
export function loadSettings(): { value: Settings; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return { value: { ...DEFAULT_SETTINGS } };
    const data: unknown = JSON.parse(raw);
    if (!record(data) || !Number.isInteger(data.levelRank) || Number(data.levelRank) < 2 || Number(data.levelRank) > 14 || typeof data.muted !== 'boolean' || typeof data.reducedMotion !== 'boolean') {
      return { value: { ...DEFAULT_SETTINGS }, error: '设置数据损坏，已使用默认设置。' };
    }
    // v1 settings before music existed remain valid; preserve every prior choice.
    const musicEnabled = typeof data.musicEnabled === 'boolean' ? data.musicEnabled : DEFAULT_SETTINGS.musicEnabled;
    const musicVolume = typeof data.musicVolume === 'number' && Number.isFinite(data.musicVolume) && data.musicVolume >= 0 && data.musicVolume <= 1 ? data.musicVolume : DEFAULT_SETTINGS.musicVolume;
    const mode: Pick<Settings, 'playMode'> = data.playMode === 'match' || data.playMode === 'practice' ? { playMode: data.playMode } : {};
    return { value: { levelRank: Number(data.levelRank), muted: data.muted, reducedMotion: data.reducedMotion, musicEnabled, musicVolume, musicTrack: getMusicTrack(data.musicTrack).id, musicPlaybackMode: getMusicPlaybackMode(data.musicPlaybackMode), ...(typeof data.danlmContinuousHints === 'boolean' ? { danlmContinuousHints: data.danlmContinuousHints } : {}), ...mode, ...(isStrategyId(data.aiPolicy) ? { aiPolicy: data.aiPolicy } : data.aiPolicy!==undefined?{unrecognizedAiPolicy:data.aiPolicy}:{}) }, ...(data.aiPolicy !== undefined && !isStrategyId(data.aiPolicy) ? { error: '保存的电脑牌技版本无法识别，请在设置中重新选择；当前对局配置未更改。' } : {}) };
  } catch { return { value: { ...DEFAULT_SETTINGS }, error: UNAVAILABLE }; }
}
export const saveSettings = (settings: Settings): string | null => {
 const {unrecognizedAiPolicy,...known}=settings;
 return write(STORAGE_KEYS.settings,{...known,...(!known.aiPolicy&&unrecognizedAiPolicy!==undefined?{aiPolicy:unrecognizedAiPolicy}:{})});
};
