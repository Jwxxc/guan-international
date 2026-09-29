import { createDeck, isWild, rankStrength } from '../engine/cards';
import type { Card, GameResult, GameState, RuleConfig, Seat } from '../engine/types';
import { isValidMatchResult } from './progression';
import type { ExchangeAction, ExchangeObservation, ExchangeResult, ExchangeState } from './types';

const seats: Seat[] = [0, 1, 2, 3];
const canonicalDeck = new Map(createDeck().map(card => [card.id, card]));
const copy = <T,>(value: T): T => structuredClone(value);
const byId = (a: Card, b: Card): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function validDeck(hands: Card[][]): boolean {
  if (!Array.isArray(hands) || hands.length !== 4 || hands.some(hand => !Array.isArray(hand))) return false;
  const cards = hands.flat();
  return cards.length === 108 && new Set(cards.map(card => card.id)).size === 108
    && cards.every(card => {
      const known = canonicalDeck.get(card.id);
      return known && known.deck === card.deck && known.suit === card.suit && known.rank === card.rank;
    });
}

function candidates(hand: Card[], rules: RuleConfig, phase: ExchangeState['phase']): Card[] {
  if (phase === 'done' || !hand.length) return [];
  const nonWild = hand.filter(card => !isWild(card, rules));
  if (phase === 'tribute') {
    const maximum = Math.max(...nonWild.map(card => rankStrength(card.rank, rules)));
    return nonWild.filter(card => rankStrength(card.rank, rules) === maximum).sort(byId);
  }
  const low = nonWild.filter(card => rankStrength(card.rank, rules) <= 10);
  if (low.length) return low.sort(byId);
  if (!nonWild.length) return [...hand].sort(byId).slice(0, 1);
  const minimum = Math.min(...nonWild.map(card => rankStrength(card.rank, rules)));
  return nonWild.filter(card => rankStrength(card.rank, rules) === minimum).sort(byId);
}

/** The engine holds both hands; neither its view nor its policy exposes them. */
export function createExchange(game: GameState, previous: GameResult): ExchangeState {
  if (!isValidMatchResult(previous)) throw new Error('上副名次无效，不能进贡');
  if (!validDeck(game.hands) || game.hands.some(hand => hand.length !== 27)
    || game.stateVersion !== 0 || game.events.length || game.played.length || game.result
    || game.currentPlay || game.currentOwner !== null || game.finished.length || game.pendingResponders.length) {
    throw new Error('只有完整的新发手牌可以进贡');
  }
  const donors = previous.doubleUp ? [...previous.doubleDown].sort((a, b) => a - b) : [previous.last!];
  const recipients = previous.doubleUp ? [...previous.order] : [previous.order[0]];
  const antiTribute = donors.flatMap(seat => game.hands[seat]).filter(card => card.rank === 16).length === 2;
  return {
    sessionId: game.sessionId, handId: game.handId, stateVersion: 0, rules: copy(game.rules),
    hands: copy(game.hands), previous: copy(previous), phase: antiTribute ? 'done' : 'tribute',
    currentPlayer: antiTribute ? null : donors[0], donors, recipients, offers: [], returnOffers: [], transfers: [],
    firstPlayer: previous.order[0], antiTribute,
  };
}

export function getEligibleExchangeCards(exchange: ExchangeState): Card[] {
  return exchange.currentPlayer === null ? [] : copy(candidates(exchange.hands[exchange.currentPlayer], exchange.rules, exchange.phase));
}

export function getExchangeObservation(exchange: ExchangeState, seat: Seat): ExchangeObservation {
  if (!seats.includes(seat)) throw new Error('座位无效');
  const active = exchange.currentPlayer === seat;
  const destination = !active ? null : exchange.phase === 'return'
    ? exchange.transfers.find(transfer => transfer.type === 'tribute' && transfer.to === seat)?.from ?? null
    : exchange.recipients.length === 1 ? exchange.recipients[0] : null;
  return copy({ sessionId: exchange.sessionId, handId: exchange.handId, stateVersion: exchange.stateVersion,
    rules: exchange.rules, player: seat, hand: exchange.hands[seat], phase: exchange.phase,
    eligibleCardIds: active ? getEligibleExchangeCards(exchange).map(card => card.id) : [], destination });
}

function transferCard(exchange: ExchangeState, from: Seat, to: Seat, card: Card, type: 'tribute' | 'return'): void {
  const own = exchange.hands[from].find(item => item.id === card.id);
  if (!own) throw new Error('交换牌已经不在原手牌中');
  exchange.hands[from] = exchange.hands[from].filter(item => item.id !== card.id);
  exchange.hands[to].push(copy(own));
  exchange.transfers.push({ from, to, card: copy(own), type });
}

export function applyExchangeAction(exchange: ExchangeState, action: ExchangeAction): ExchangeResult {
  if (!action || typeof action !== 'object') return { ok: false, error: '交换动作格式无效' };
  if (exchange.phase === 'done' || exchange.currentPlayer === null) return { ok: false, error: '本副进贡已完成' };
  if (action.sessionId !== exchange.sessionId || action.handId !== exchange.handId || action.stateVersion !== exchange.stateVersion) {
    return { ok: false, error: '这次进贡操作已过期，请重新选择' };
  }
  if (action.player !== exchange.currentPlayer || !seats.includes(action.player)) return { ok: false, error: '还没有轮到你交换牌' };
  if (action.type !== exchange.phase || typeof action.cardId !== 'string') return { ok: false, error: '交换阶段或牌张无效' };
  if (!validDeck(exchange.hands)) return { ok: false, error: '实体牌有重复或缺失，不能交换' };
  const card = getEligibleExchangeCards(exchange).find(item => item.id === action.cardId);
  if (!card) return { ok: false, error: exchange.phase === 'tribute' ? '必须进贡最大的非逢人配牌' : '请选择符合还贡规则的牌' };
  const next = copy(exchange);
  next.stateVersion++;
  if (action.type === 'tribute') {
    next.offers.push({ player: action.player, card: copy(card) });
    const unchosen = next.donors.find(seat => !next.offers.some(offer => offer.player === seat));
    if (unchosen !== undefined) next.currentPlayer = unchosen;
    else {
      const ordered = [...next.offers].sort((a, b) => rankStrength(b.card.rank, next.rules) - rankStrength(a.card.rank, next.rules));
      const equal = ordered.length === 2 && rankStrength(ordered[0].card.rank, next.rules) === rankStrength(ordered[1].card.rank, next.rules);
      ordered.forEach((offer, index) => {
        const recipient = equal ? ((offer.player + 3) % 4) as Seat : next.recipients[index];
        transferCard(next, offer.player, recipient, offer.card, 'tribute');
        if (recipient === next.previous.order[0]) next.firstPlayer = offer.player;
      });
      next.phase = 'return';
      next.currentPlayer = next.recipients[0];
    }
  } else {
    next.returnOffers.push({ player: action.player, card: copy(card) });
    const pending = next.recipients.find(seat => !next.returnOffers.some(item => item.player === seat));
    next.currentPlayer = pending ?? null;
    if (pending === undefined) {
      for (const offer of next.returnOffers) {
        const donation = next.transfers.find(item => item.type === 'tribute' && item.to === offer.player);
        if (!donation) return { ok: false, error: '找不到对应的进贡者' };
        transferCard(next, offer.player, donation.from, offer.card, 'return');
      }
      next.phase = 'done';
    }
  }
  if (!validDeck(next.hands) || (next.phase === 'done' && next.hands.some(hand => hand.length !== 27))) {
    return { ok: false, error: '交换后牌数不一致' };
  }
  return { ok: true, exchange: next };
}

/** Observation-only AI: legal smallest return; equivalent cards break ties by ID. */
export function chooseExchangeAction(observation: ExchangeObservation): ExchangeAction {
  const card = candidates(observation.hand, observation.rules, observation.phase)
    .filter(item => observation.eligibleCardIds.includes(item.id))
    .sort((a, b) => rankStrength(a.rank, observation.rules) - rankStrength(b.rank, observation.rules) || byId(a, b))[0];
  if (!card || observation.phase === 'done') throw new Error('当前没有合法交换动作');
  return { sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion,
    player: observation.player, type: observation.phase, cardId: card.id };
}

export function finishExchangeGame(originalGame: GameState, exchange: ExchangeState): GameState {
  if (exchange.phase !== 'done' || exchange.currentPlayer !== null) throw new Error('进贡尚未完成');
  if (originalGame.sessionId !== exchange.sessionId || originalGame.handId !== exchange.handId
    || originalGame.rules.version !== exchange.rules.version || originalGame.rules.levelRank !== exchange.rules.levelRank
    || originalGame.stateVersion !== 0 || originalGame.events.length || originalGame.played.length || originalGame.result
    || originalGame.currentPlay || originalGame.currentOwner !== null || originalGame.finished.length || originalGame.pendingResponders.length
    || !seats.includes(exchange.firstPlayer) || !validDeck(originalGame.hands)
    || !validDeck(exchange.hands) || exchange.hands.some(hand => hand.length !== 27)) {
    throw new Error('进贡记录与本副新发手牌不一致');
  }
  return { ...copy(originalGame), hands: copy(exchange.hands), firstPlayer: exchange.firstPlayer,
    currentPlayer: exchange.firstPlayer, stateVersion: 0, events: [] };
}
