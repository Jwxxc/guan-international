import { createDeck, createRng, shuffleDeck } from './cards';
import { canBeat } from './compare';
import { resolvePlays } from './patterns';
import { makeRules, partnerOf, teamOf } from './rules';
import type { ActionResult, GameAction, GameEvent, GameResult, GameState, PracticeConfig, Seat, ValidationResult } from './types';

const seats: Seat[] = [0, 1, 2, 3];
const copy = <T,>(value: T): T => structuredClone(value);

/** Pure and reproducible: persistence owns seed storage; AI never receives the seed. */
export function createPracticeGame(config: PracticeConfig = {}, seed: number): GameState {
  if (!Number.isFinite(seed)) throw new Error('发牌种子无效');
  const rules = makeRules(config.levelRank ?? 2);
  const rng = createRng(seed);
  const deck = shuffleDeck(createDeck(), rng);
  const firstPlayer = config.firstPlayer ?? Math.floor(rng() * 4) as Seat;
  if (!seats.includes(firstPlayer)) throw new Error('先手座位无效');
  return {
    // Production callers supply independently generated IDs. Defaults must not encode the deal seed.
    sessionId: config.sessionId ?? 'practice-session', handId: config.handId ?? 'practice-hand',
    stateVersion: 0, rules, hands: seats.map((seat) => deck.filter((_, index) => index % 4 === seat)),
    currentPlayer: firstPlayer, firstPlayer, currentPlay: null, currentOwner: null,
    pendingResponders: [], finished: [], played: [], events: [], result: null,
  };
}

/** Validates the exact physical cards and chosen interpretation, without editing state. */
export function validateAction(state: GameState, action: GameAction): ValidationResult {
  if (!action || typeof action !== 'object') return { ok: false, error: '动作格式无效' };
  if (state.result) return { ok: false, error: '本副已经结束，请再来一副' };
  if (action.sessionId !== state.sessionId || action.handId !== state.handId || action.stateVersion !== state.stateVersion) {
    return { ok: false, error: '这次操作已过期，请按当前牌局重新操作' };
  }
  if (action.player !== state.currentPlayer || !seats.includes(action.player)) return { ok: false, error: '还没有轮到你出牌' };
  const hand = state.hands[action.player];
  if (!hand.length || state.finished.includes(action.player)) return { ok: false, error: '已出完的玩家不能再次行动' };
  if (action.type === 'pass') {
    return state.currentPlay ? { ok: true } : { ok: false, error: '本轮由你领出，不能不出' };
  }
  if (action.type !== 'play' || !Array.isArray(action.cardIds) || !action.cardIds.length || typeof action.playKey !== 'string') {
    return { ok: false, error: '请先选择要出的牌和牌型解释' };
  }
  if (action.cardIds.some((id) => typeof id !== 'string') || new Set(action.cardIds).size !== action.cardIds.length) {
    return { ok: false, error: '同一张实体牌不能重复使用' };
  }
  const byId = new Map(hand.map((card) => [card.id, card]));
  if (action.cardIds.some((id) => !byId.has(id))) return { ok: false, error: '所选牌已经不在你的手中' };
  const cards = action.cardIds.map((id) => byId.get(id)!);
  const interpretations = resolvePlays(cards, state.rules);
  if (!interpretations.length) return { ok: false, error: '所选牌不符合 GUAN 单副练习规则' };
  const play = interpretations.find((candidate) => candidate.key === action.playKey);
  if (!play) return { ok: false, error: '牌型解释与所选牌不匹配，请重新选择' };
  if (!canBeat(play, state.currentPlay, state.rules)) return { ok: false, error: '这手牌不能压过当前待压牌' };
  return { ok: true, play };
}

function nextResponder(after: Seat, responders: Seat[]): Seat {
  for (let offset = 1; offset <= 4; offset++) {
    const seat = ((after + offset) % 4) as Seat;
    if (responders.includes(seat)) return seat;
  }
  throw new Error('规则状态异常：没有可行动的回应者');
}

export function getResult(finished: Seat[]): GameResult | null {
  if (finished.length < 2) return null;
  const winningTeam = teamOf(finished[0]);
  if (teamOf(finished[0]) === teamOf(finished[1])) {
    return { winningTeam, doubleUp: true, order: [...finished], last: null, doubleDown: seats.filter((seat) => !finished.includes(seat)) };
  }
  if (finished.length === 3) {
    const last = seats.find((seat) => !finished.includes(seat))!;
    return { winningTeam, doubleUp: false, order: [...finished, last], last, doubleDown: [] };
  }
  return null;
}

/** The only state transition entry point. A rejection never mutates any part of state. */
export function applyAction(state: GameState, action: GameAction): ActionResult {
  const validation = validateAction(state, action);
  if (!validation.ok) return validation;
  // Detach all nested data: the resulting authoritative state shares no mutable leaves.
  const next = copy(state);
  next.stateVersion++;
  const actor = action.player;
  let finished: Seat | undefined;
  if (action.type === 'play') {
    const play = copy(validation.play!);
    const ids = new Set(play.cards.map((card) => card.id));
    next.hands[actor] = next.hands[actor].filter((card) => !ids.has(card.id));
    next.played.push(...copy(play.cards));
    next.currentPlay = play;
    next.currentOwner = actor;
    if (!next.hands[actor].length) {
      next.finished.push(actor);
      finished = actor;
    }
    next.pendingResponders = seats.filter((seat) => seat !== actor && next.hands[seat].length > 0);
    next.result = getResult(next.finished);
  } else {
    next.pendingResponders = next.pendingResponders.filter((seat) => seat !== actor);
  }
  let roundEnded = false;
  if (next.result) {
    next.pendingResponders = [];
  } else if (!next.pendingResponders.length) {
    roundEnded = true;
    const owner = next.currentOwner!;
    const leader = next.hands[owner].length ? owner : partnerOf(owner);
    if (!next.hands[leader].length) throw new Error('规则状态异常：接风玩家已出完');
    next.currentPlayer = leader;
    next.currentPlay = null;
    next.currentOwner = null;
  } else {
    next.currentPlayer = nextResponder(actor, next.pendingResponders);
  }
  const event: GameEvent = {
    index: next.events.length, player: actor, type: action.type,
    ...(validation.play ? { play: copy(validation.play) } : {}),
    roundEnded, nextPlayer: next.result ? null : next.currentPlayer,
    ...(finished !== undefined ? { finished } : {}),
    message: action.type === 'pass' ? '不出' : validation.play!.label,
  };
  next.events.push(event);
  return { ok: true, state: next };
}
