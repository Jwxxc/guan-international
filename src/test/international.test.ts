import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale, t, tx } from '../i18n';
import english from '../i18n/en.json';
import { createPracticeGame, applyAction } from '../engine/reducer';
import { getObservation } from '../engine/observations';
import { getLegalMoves } from '../engine/legalMoves';

afterEach(() => setLocale('en'));
describe('International edition presentation boundary', () => {
  it('defaults to English and translates current and historical labels', () => {
    expect(getLocale()).toBe('en');
    expect(t('开始升级赛')).toBe('Start match');
    expect(t('三带二 · K 带 2')).toBe('Full house · K over 2');
    expect(t('8 张炸弹 · A')).toBe('8-card bomb · A');
    expect(t('第 12 副')).toBe('Deal 12');
    expect(t('松风正在思考')).toBe('Songfeng is thinking');
    expect(t('♥7 为逢人配')).toBe('♥7 is wild');
  });
  it('keeps explicit interpolation arguments literal', () => {
    expect(t('选择分组：{0}，{1} 张', ['我的私人牌组', 5])).toBe('Select group: 我的私人牌组, 5 cards');
    expect(tx({ id: 'balanced-pro-v1', label: '均衡 Pro' })).toEqual({ id: 'balanced-pro-v1', label: '均衡 Pro' });
    expect(t('balanced-pro-v1')).toBe('balanced-pro-v1');
  });
  it('does not alter legal moves, physical IDs, observations or accepted actions', () => {
    const game = createPracticeGame({ levelRank: 7, sessionId: 'i18n', handId: 'i18n', firstPlayer: 0 }, 2026);
    const before = JSON.stringify(game);
    const observation = getObservation(game, 0);
    const moves = getLegalMoves(observation);
    setLocale('zh-CN');
    expect(t(moves[0].label)).toBe(moves[0].label);
    setLocale('en');
    const action = { type: 'play' as const, player: 0 as const, sessionId: game.sessionId, handId: game.handId, stateVersion: game.stateVersion, cardIds: moves[0].cards.map(card => card.id), playKey: moves[0].key };
    const englishResult = applyAction(game, action);
    setLocale('zh-CN');
    expect(applyAction(game, action)).toEqual(englishResult);
    expect(getLegalMoves(getObservation(game, 0))).toEqual(moves);
    expect(JSON.stringify(game)).toBe(before);
  });
  it('keeps every catalog placeholder and has no Chinese in English translations', () => {
    for (const [source, translated] of Object.entries(english)) {
      expect(translated, source).not.toMatch(/[\u3400-\u9fff]/);
      expect((translated.match(/\{\d+\}/g) ?? []).sort(), source).toEqual((source.match(/\{\d+\}/g) ?? []).sort());
    }
  });
});
