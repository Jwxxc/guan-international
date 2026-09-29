import { beforeAll, describe, expect, it } from 'vitest';
import classicFixture from './fixtures/classic-complete.json';
import legacyFixture from './fixtures/legacy-match-completed-hand-v1.json';
import { createSavedGame } from '../game/persistence';
import { getReplayStates } from '../game/replay';
import { clampReplayIndex, initialReplayHandIndex, nextReplayPlayIndex } from '../game/replayNavigation';
import { getMatchHistory, getMatchReplayHand } from '../match/replay';
import { restoreMatchJournal } from '../match/session';
import type { MatchSession } from '../match/sessionTypes';

let classic: MatchSession, legacy: MatchSession;
beforeAll(() => {
  classic = restoreMatchJournal(classicFixture);
  legacy = restoreMatchJournal(legacyFixture);
});

describe('replay progress bounds and history entry', () => {
  it('clamps the first, last and empty positions without allowing invalid range values', () => {
    expect(clampReplayIndex(-3, 8)).toBe(0);
    expect(clampReplayIndex(100, 8)).toBe(7);
    expect(clampReplayIndex(4.9, 8)).toBe(4);
    expect(clampReplayIndex(3, 0)).toBe(0);
    expect(clampReplayIndex(3, 1)).toBe(0);
    for (const invalid of [NaN, Infinity, -Infinity]) expect(clampReplayIndex(invalid, 8)).toBe(0);
  });

  it('opens the requested physical hand and safely falls back for missing or unknown identifiers', () => {
    const history = getMatchHistory(classic);
    const selected = history[history.length - 2];
    const index = initialReplayHandIndex(history, selected.handId);
    expect(getMatchReplayHand(classic, index).summary.handId).toBe(selected.handId);
    expect(initialReplayHandIndex(history)).toBe(0);
    expect(initialReplayHandIndex(history, 'missing-hand')).toBe(0);
    expect(initialReplayHandIndex([], selected.handId)).toBe(0);
  });
});

describe('next actual viewer play', () => {
  it('lands before each future recorded play for all four practice viewers, skipping passes and the current position', () => {
    const saved = legacy.saved, states = getReplayStates(saved);
    expect(saved.actions.some(action => action.type === 'pass')).toBe(true);
    for (const viewer of [0, 1, 2, 3] as const) {
      const expected = saved.actions.flatMap((action, index) => action.player === viewer && action.type === 'play' && index > 0 ? [index] : []);
      expect(expected.length).toBeGreaterThan(0);
      let index = 0;
      for (const target of expected) {
        const found = nextReplayPlayIndex(states, index, viewer);
        expect(found).toBe(target);
        expect(states[found!].currentPlayer).toBe(viewer);
        expect(states[found!].events).toHaveLength(target);
        expect(states[found! + 1].events.at(-1)?.player).toBe(viewer);
        index = found!;
      }
      expect(nextReplayPlayIndex(states, index, viewer)).toBeNull();
      expect(nextReplayPlayIndex(states, states.length - 1, viewer)).toBeNull();
    }
  });

  for (const version of ['classic', 'legacy'] as const) it(`seeks past ${version} tribute and return frames to the recorded action boundary`, () => {
    const match = version === 'classic' ? classic : legacy;
    const handIndex = 1, hand = getMatchReplayHand(match, handIndex);
    const actions = match.journal.records[handIndex].actions;
    const states = hand.frames.map(frame => frame.state);
    const playingIndex = hand.frames.findIndex(frame => frame.phase === 'playing');
    expect(playingIndex).toBeGreaterThan(0);
    expect(hand.frames.slice(0, playingIndex).some(frame => frame.phase === 'ready')).toBe(true);
    for (const viewer of [0, 1, 2, 3] as const) {
      const expected = actions.flatMap((action, index) => action.player === viewer && action.type === 'play' ? [playingIndex + index] : []);
      expect(expected.length).toBeGreaterThan(0);
      let index = 0;
      for (const target of expected) {
        const found = nextReplayPlayIndex(states, index, viewer);
        expect(found).toBe(target);
        expect(hand.frames[found!].phase).toBe('playing');
        expect(states[found!].currentPlayer).toBe(viewer);
        index = found!;
      }
      expect(nextReplayPlayIndex(states, index, viewer)).toBeNull();
      expect(nextReplayPlayIndex(states, hand.resultIndex, viewer)).toBeNull();
    }
  });

  it('does not invent a future turn from an unfinished deal or its pending actor', () => {
    const state = createSavedGame({ sessionId: 'unfinished', handId: 'one', firstPlayer: 3 }, 8).state;
    expect(nextReplayPlayIndex([], 0, 3)).toBeNull();
    expect(nextReplayPlayIndex([state], 0, 3)).toBeNull();
    expect(nextReplayPlayIndex([state, state, state], 0, 3)).toBeNull();
  });

  it('does not seek into another hand if snapshots from different hands are supplied', () => {
    const states = getReplayStates(legacy.saved);
    const candidate = states.findIndex((state, index) => index > 0 && states[index + 1]?.events.at(-1)?.type === 'play' && !state.result);
    expect(candidate).toBeGreaterThan(0);
    const before = states[candidate], after = { ...states[candidate + 1], handId: 'different-hand' };
    expect(nextReplayPlayIndex([states[0], before, after], 0, before.currentPlayer)).toBeNull();
  });
});
