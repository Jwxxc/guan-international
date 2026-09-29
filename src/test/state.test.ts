import { describe, expect, it } from 'vitest';
import { chooseAiAction } from '../ai/policy';
import { createDeck, createRng } from '../engine/cards';
import { getLegalMoves } from '../engine/legalMoves';
import { getObservation } from '../engine/observations';
import { resolvePlays } from '../engine/patterns';
import { applyAction, createPracticeGame, validateAction } from '../engine/reducer';
import { SEATS } from '../engine/rules';
import type { GameAction, GameState, Seat } from '../engine/types';

function scenario(ranks: number[][]): GameState {
  const deck = createDeck();
  const used = new Set<string>();
  const hands = ranks.map((hand) => hand.map((rank) => {
    const card = deck.find((item) => item.rank === rank && item.suit !== 'H' && !used.has(item.id))!;
    if (!card) throw new Error(`Fixture cannot supply rank ${rank}`);
    used.add(card.id);
    return card;
  }));
  return { ...createPracticeGame({ firstPlayer: 0 }, 1), hands, played: deck.filter((card) => !used.has(card.id)) };
}
function action(state: GameState, type: 'play' | 'pass', rank?: number): GameAction {
  const stamp = { sessionId: state.sessionId, handId: state.handId, stateVersion: state.stateVersion, player: state.currentPlayer };
  if (type === 'pass') return { ...stamp, type };
  const card = state.hands[state.currentPlayer].find((item) => rank === undefined || item.rank === rank)!;
  const play = resolvePlays([card], state.rules)[0];
  return { ...stamp, type, cardIds: [card.id], playKey: play.key };
}
function move(state: GameState, type: 'play' | 'pass', rank?: number): GameState {
  const result = applyAction(state, action(state, type, rank));
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

// These scenarios assert manually specified turn orders and results, not self-derived expectations.
describe('creation and immutable action validation', () => {
  it('deals all 108 unique cards, 27 per seat, and uses the fixed seat mapping', () => {
    const state = createPracticeGame({ levelRank: 7 }, 20260919);
    expect(state.hands.map((hand) => hand.length)).toEqual([27, 27, 27, 27]);
    expect(new Set(state.hands.flat().map((card) => card.id)).size).toBe(108);
    expect(SEATS.map((seat) => [seat.id, seat.position, seat.team])).toEqual([[0, 'bottom', 0], [1, 'right', 1], [2, 'top', 0], [3, 'left', 1]]);
    expect(createPracticeGame({ levelRank: 7 }, 20260919)).toEqual(state);
  });
  it('rejects empty-table pass, wrong player, stale stamps, unavailable and duplicate card ids atomically', () => {
    const state = scenario([[3, 8], [4, 9], [5, 10], [6, 11]]);
    const before = structuredClone(state);
    const valid = action(state, 'play', 3);
    const bad: GameAction[] = [
      action(state, 'pass'), { ...valid, player: 1 }, { ...valid, stateVersion: 99 },
      { ...valid, sessionId: 'old' }, { ...valid, handId: 'old' },
      { ...valid, type: 'play', cardIds: ['missing'], playKey: 'missing' },
      { ...valid, type: 'play', cardIds: [state.hands[0][0].id, state.hands[0][0].id], playKey: 'missing' },
      { ...valid, type: 'play', cardIds: [state.hands[0][0].id], playKey: 'forged-explanation' },
    ];
    for (const candidate of bad) {
      expect(validateAction(state, candidate).ok).toBe(false);
      expect(applyAction(state, candidate).ok).toBe(false);
      expect(state).toEqual(before);
    }
    const next = applyAction(state, valid);
    expect(next.ok).toBe(true);
    expect(state).toEqual(before);
    if (next.ok) expect(applyAction(next.state, valid).ok).toBe(false);
  });
  it('keeps a legal voluntary pass possible and lets that seat respond again after another play', () => {
    let state = scenario([[3, 8], [4, 9], [5, 10], [6, 11]]);
    state = move(state, 'play', 3);
    expect(getLegalMoves(getObservation(state, 1)).length).toBeGreaterThan(0);
    state = move(state, 'pass'); // 1 declines despite a legal response.
    expect(state.pendingResponders).toEqual([2, 3]);
    state = move(state, 'play', 5); // 2 resets all other active responders.
    expect(state.pendingResponders).toEqual([0, 1, 3]);
    state = move(state, 'pass'); // 3
    state = move(state, 'pass'); // 0
    expect(state.currentPlayer).toBe(1);
    state = move(state, 'play', 9);
    expect(state.currentOwner).toBe(1);
  });
});

describe('finishers, response sets, wind and single-deal result', () => {
  it('retains a finisher’s play, gives all opponents a response, then transfers wind to partner', () => {
    let state = scenario([[3], [4, 9], [5, 10], [6, 11]]);
    state = move(state, 'play', 3);
    expect(state.finished).toEqual([0]);
    expect(state.currentPlayer).toBe(1);
    expect(state.currentOwner).toBe(0);
    expect(state.currentPlay?.cards[0].rank).toBe(3);
    expect(state.pendingResponders).toEqual([1, 2, 3]);
    state = move(state, 'pass');
    state = move(state, 'pass');
    expect(state.currentPlayer).toBe(3);
    state = move(state, 'pass');
    expect(state.currentPlayer).toBe(2);
    expect(state.currentPlay).toBeNull();
    expect(state.currentOwner).toBeNull();
    expect(state.pendingResponders).toEqual([]);
    expect(state.events.at(-1)?.roundEnded).toBe(true);
    expect(validateAction(state, action(state, 'pass')).ok).toBe(false);
  });
  it('does not transfer wind when another player legitimately beats the finisher', () => {
    let state = scenario([[3], [4, 9], [5, 10], [6, 11]]);
    state = move(state, 'play', 3);
    state = move(state, 'play', 4);
    expect(state.currentOwner).toBe(1);
    expect(state.pendingResponders).toEqual([2, 3]);
    state = move(state, 'pass');
    state = move(state, 'pass');
    expect(state.currentPlayer).toBe(1);
    expect(state.currentPlay).toBeNull();
  });
  it('immediately ends double-up without inventing third and fourth places', () => {
    let state = scenario([[3], [4, 9], [5], [6, 11]]);
    state = move(state, 'play', 3);
    state = move(state, 'pass');
    state = move(state, 'play', 5);
    expect(state.result).toEqual({ winningTeam: 0, doubleUp: true, order: [0, 2], last: null, doubleDown: [1, 3] });
    const before = structuredClone(state);
    expect(applyAction(state, action(state, 'pass')).ok).toBe(false);
    expect(state).toEqual(before);
    expect(state.events).toHaveLength(3);
  });
  it('uses head finisher’s team as winner even when the other team finishes second and third', () => {
    let state = scenario([[3], [4], [8, 10], [5]]);
    state = move(state, 'play', 3);
    state = move(state, 'play', 4);
    expect(state.result).toBeNull();
    state = move(state, 'pass');
    state = move(state, 'play', 5);
    expect(state.finished).toEqual([0, 1, 3]);
    expect(state.result).toEqual({ winningTeam: 0, doubleUp: false, order: [0, 1, 3, 2], last: 2, doubleDown: [] });
    expect(state.hands[2]).toHaveLength(2);
    expect(state.events.at(-1)?.nextPlayer).toBeNull();
  });
});

describe('AI observation isolation and visible-information cooperation', () => {
  it('has the same observation and decision after hidden hands are exchanged', () => {
    const state = createPracticeGame({ firstPlayer: 0 }, 8765);
    const swapped = structuredClone(state);
    [swapped.hands[1], swapped.hands[3]] = [swapped.hands[3], swapped.hands[1]];
    const first = getObservation(state, 0);
    const second = getObservation(swapped, 0);
    expect(second).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(['sessionId', 'handId', 'stateVersion', 'player', 'team', 'hand', 'rules', 'remainingCounts', 'currentPlayer', 'currentPlay', 'currentOwner', 'finished', 'history', 'isOver'].sort());
    expect(chooseAiAction(first, getLegalMoves(first), createRng(17))).toEqual(chooseAiAction(second, getLegalMoves(second), createRng(17)));
  });
  it('returns detached private and public data, never mutable state references', () => {
    const state = move(scenario([[3, 8], [4, 9], [5, 10], [6, 11]]), 'play', 3);
    const before = structuredClone(state);
    const obs = getObservation(state, 1);
    obs.hand[0].rank = 99;
    obs.rules.levelRank = 14;
    obs.remainingCounts[0] = 999;
    obs.currentPlay!.cards[0].rank = 99;
    obs.history[0].play!.cards[0].rank = 99;
    expect(state).toEqual(before);
  });
  it('usually passes a partner lead but prioritizes an immediate finish', () => {
    let state = scenario([[3, 8], [4, 9], [5, 10], [6, 11]]);
    state = move(state, 'play', 3);
    state = move(state, 'pass');
    const obs = getObservation(state, 2);
    expect(chooseAiAction(obs, getLegalMoves(obs), createRng(3)).type).toBe('pass');
    const oneCard = { ...obs, hand: [obs.hand[0]], remainingCounts: [1, 2, 1, 2] };
    expect(chooseAiAction(oneCard, getLegalMoves(oneCard), createRng(3)).type).toBe('play');
  });
  it('never grants finished players turns throughout a deterministic full game', () => {
    let state = createPracticeGame({ firstPlayer: 0 }, 321);
    const aiRng = createRng(765);
    let steps = 0;
    while (!state.result && steps++ < 1500) {
      expect(state.finished).not.toContain(state.currentPlayer);
      const obs = getObservation(state, state.currentPlayer);
      const choice = chooseAiAction(obs, getLegalMoves(obs), aiRng);
      expect(validateAction(state, choice).ok).toBe(true);
      const result = applyAction(state, choice);
      if (!result.ok) throw new Error(result.error);
      state = result.state;
      const ids = [...state.hands.flat(), ...state.played].map((card) => card.id);
      expect(ids).toHaveLength(108);
      expect(new Set(ids).size).toBe(108);
    }
    expect(state.result).not.toBeNull();
    expect(steps).toBeLessThan(1500);
  });
});
