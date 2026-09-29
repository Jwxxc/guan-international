import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegalMoves } from '../engine/legalMoves';
import { getObservation } from '../engine/observations';
import { chooseAiAction } from '../ai/policy';
import { createRng } from '../engine/cards';
import { advanceSavedGame, createSavedGame, decodeSavedGame, loadCurrent, loadReplay, loadSettings, saveCurrent, saveReplay, saveSettings, STORAGE_KEYS } from '../game/persistence';
import { getReplayStates } from '../game/replay';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});

describe('验证式存档和实际动作回放', () => {
  it('初始发牌可恢复，108张牌与随机先手保持一致', () => {
    const saved = createSavedGame({ levelRank: 7, sessionId: 'save-test', handId: 'one' }, 123);
    expect(saveCurrent(saved)).toBeNull();
    expect(loadCurrent().value).toEqual(saved);
    expect(saved.state.hands.map(h => h.length)).toEqual([27, 27, 27, 27]);
  });
  it('完整副逐步重放的终局、事件、实体牌和解释完全相同', () => {
    let saved = createSavedGame({ levelRank: 2, sessionId: 'replay-test', handId: 'one' }, 27);
    const rng = createRng(890);
    while (!saved.state.result && saved.actions.length < 600) {
      const obs = getObservation(saved.state, saved.state.currentPlayer);
      const next = advanceSavedGame(saved, chooseAiAction(obs, getLegalMoves(obs), rng));
      if (!next.ok) throw new Error(next.error);
      saved = next.saved;
    }
    expect(saved.state.result).not.toBeNull();
    expect(saveReplay(saved)).toBeNull();
    const restored = loadReplay();
    expect(restored.error).toBeUndefined();
    expect(restored.value).toEqual(saved);
    const states = getReplayStates(saved);
    expect(states).toHaveLength(saved.actions.length + 1);
    expect(states[0].played).toHaveLength(0);
    expect(states.at(-1)).toEqual(saved.state);
  }, 30_000);
  it('拒绝更改手牌、重复实体牌、改版本、改种子和伪造状态', () => {
    const saved = createSavedGame({ levelRank: 14 }, 456);
    for (const mutate of [
      (s: any) => { s.state.hands[0][0] = s.state.hands[0][1]; },
      (s: any) => { s.state.hands[1].pop(); },
      (s: any) => { s.rulesVersion = 'other'; },
      (s: any) => { s.rngVersion = 'other'; },
      (s: any) => { s.schemaVersion = 9; },
      (s: any) => { s.seed++; },
      (s: any) => { s.state.currentPlayer = 99; },
    ]) {
      const invalid = structuredClone(saved); mutate(invalid);
      expect(() => decodeSavedGame(JSON.stringify(invalid))).toThrow();
    }
  });
  it('损坏或不完整回放给出中文提示，页面可重新开始', () => {
    localStorage.setItem(STORAGE_KEYS.current, '{bad json');
    expect(loadCurrent().error).toContain('无法恢复这份存档');
    const saved = createSavedGame({}, 42);
    expect(saveReplay(saved)).toContain('尚未结束');
    localStorage.setItem(STORAGE_KEYS.replay, JSON.stringify(saved));
    expect(loadReplay().error).toContain('无法恢复这份存档');
  });
  it('存储禁用或满额不会抛出，内存中对局仍可继续', () => {
    const saved = createSavedGame({ firstPlayer: 0 }, 13);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } });
    expect(saveCurrent(saved)).toContain('本次无法保存');
    expect(loadCurrent().error).toContain('本次无法保存');
    const obs = getObservation(saved.state, 0);
    expect(advanceSavedGame(saved, chooseAiAction(obs, getLegalMoves(obs), createRng(1))).ok).toBe(true);
  });
  it('设置保存静音和减少动态效果，并拒绝无效级牌', () => {
    const settings = { levelRank: 14, muted: true, reducedMotion: true, musicEnabled: false, musicVolume: .35 };
    expect(saveSettings(settings)).toBeNull();
    expect(loadSettings().value).toEqual({ ...settings, musicTrack: 'afternoon', musicPlaybackMode: 'sequence' });
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...settings, levelRank: 16 }));
    expect(loadSettings().error).toBeTruthy();
    expect(loadSettings().value.levelRank).toBe(2);
  });
  it('连续 DanLM 提示只恢复显式布尔设置，不把旧档或坏值变成开启', () => {
    const settings = { levelRank: 7, muted: true, reducedMotion: true, musicEnabled: false, musicVolume: .22 };
    for (const enabled of [true, false]) {
      saveSettings({ ...settings, danlmContinuousHints: enabled });
      expect(loadSettings().value.danlmContinuousHints).toBe(enabled);
    }
    for (const bad of [undefined, null, 'true', 1, {}]) {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...settings, danlmContinuousHints: bad }));
      expect(loadSettings().value.danlmContinuousHints).toBeUndefined();
    }
  });
  it('迁移旧设置时保留级牌、音效静音和减少动态，音乐使用新默认值', () => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ levelRank: 9, muted: true, reducedMotion: true }));
    expect(loadSettings()).toEqual({ value: { levelRank: 9, muted: true, reducedMotion: true, musicEnabled: true, musicVolume: .22, musicTrack: 'afternoon', musicPlaybackMode: 'sequence' } });
  });
  it('独立音乐开关、零音量和有效音量可恢复，坏音量不覆盖旧设置', () => {
    for (const musicVolume of [0, .22, 1]) {
      const settings = { levelRank: 12, muted: false, reducedMotion: false, musicEnabled: false, musicVolume };
      saveSettings(settings); expect(loadSettings().value).toEqual({ ...settings, musicTrack: 'afternoon', musicPlaybackMode: 'sequence' });
    }
    for (const musicVolume of [-1, 1.1, null, 'loud']) {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ levelRank: 12, muted: true, reducedMotion: true, musicEnabled: false, musicVolume }));
      expect(loadSettings().value).toEqual({ levelRank: 12, muted: true, reducedMotion: true, musicEnabled: false, musicVolume: .22, musicTrack: 'afternoon', musicPlaybackMode: 'sequence' });
    }
  });
  it('选曲可以保存，无效曲目只回退原曲而保留其他偏好', () => {
    const settings = { levelRank: 9, muted: true, reducedMotion: true, musicEnabled: false, musicVolume: .35 };
    for (const musicTrack of ['afternoon', 'evening', 'breeze', 'tea', 'moonlight', 'waltz', 'bamboo'] as const) {
      expect(saveSettings({ ...settings, musicTrack })).toBeNull();
      expect(loadSettings().value).toEqual({ ...settings, musicTrack, musicPlaybackMode: 'sequence' });
    }
    for (const musicTrack of [undefined, null, 'missing', 1, {}]) {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...settings, musicTrack }));
      expect(loadSettings().value).toEqual({ ...settings, musicTrack: 'afternoon', musicPlaybackMode: 'sequence' });
    }
  });
  it('两种播放方式可保存，缺失或无效方式回退顺序播放并保留已有曲目与开关', () => {
    const settings = { levelRank: 9, muted: true, reducedMotion: true, musicEnabled: false, musicVolume: .35, musicTrack: 'moonlight' as const };
    for (const musicPlaybackMode of ['sequence', 'repeat-one'] as const) {
      saveSettings({ ...settings, musicPlaybackMode });
      expect(loadSettings().value).toEqual({ ...settings, musicPlaybackMode });
    }
    for (const musicPlaybackMode of [undefined, null, 'bad', 1, {}]) {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...settings, musicPlaybackMode }));
      expect(loadSettings().value).toEqual({ ...settings, musicPlaybackMode: 'sequence' });
    }
  });
});
