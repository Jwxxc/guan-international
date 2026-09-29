import { createDeck, isWild, rankStrength } from '../engine/cards';
import { maxDisjointNaturalStraightFlushes } from '../engine/naturalStructures';
import { previousSeatOf, SEATS } from '../engine/rules';
import type { Card, GameResult, GameState, RuleConfig, Seat } from '../engine/types';
import { isValidMatchResult } from './progression';
import { CLASSIC_RULES_VERSION, type CardTransfer, type ExchangeAction, type ExchangeObservation, type ExchangeResult, type ExchangeState } from './types';

const seats: Seat[] = SEATS.map(seat => seat.id);
const deck = new Map(createDeck().map(card => [card.id, card]));
const copy = <T,>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const byId = (a: Card, b: Card): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const knownCard = (card: Card): boolean => !!card && same(deck.get(card.id), card);
function validDeck(hands: Card[][]): boolean {
  return Array.isArray(hands) && hands.length === 4 && hands.every(hand => Array.isArray(hand) && hand.length === 27)
    && hands.flat().every(knownCard) && new Set(hands.flat().map(card => card.id)).size === 108;
}
function validNewGame(game: GameState): boolean {
  return game.rules.version === 'guan-practice-v1' && Number.isInteger(game.rules.levelRank) && game.rules.levelRank >= 2 && game.rules.levelRank <= 14
    && validDeck(game.hands) && game.stateVersion === 0 && !game.events.length && !game.played.length && !game.result
    && !game.currentPlay && game.currentOwner === null && !game.finished.length && !game.pendingResponders.length;
}
function returnOptions(hand: Card[], rules: RuleConfig): { cards: Card[]; rule: 'normal' | 'fallback' } {
  const ordinary = hand.filter(card => card.suit !== 'J' && card.rank >= 2 && card.rank <= 14 && card.rank !== rules.levelRank);
  const normal = ordinary.filter(card => card.rank <= 10);
  if (normal.length) return { cards: normal.sort(byId), rule: 'normal' };
  if (!ordinary.length) throw Error('手牌状态异常：没有可还的非级普通牌');
  const minimum = Math.min(...ordinary.map(card => card.rank));
  return { cards: ordinary.filter(card => card.rank === minimum).sort(byId), rule: 'fallback' };
}
function candidates(hand: Card[], rules: RuleConfig, phase: ExchangeState['phase']): Card[] {
  if (phase === 'done') return [];
  if (phase === 'return') return returnOptions(hand, rules).cards;
  const eligible = hand.filter(card => !isWild(card, rules));
  if (!eligible.length) throw Error('手牌状态异常：没有可进贡的实体牌');
  const maximum = Math.max(...eligible.map(card => rankStrength(card.rank, rules)));
  return eligible.filter(card => rankStrength(card.rank, rules) === maximum).sort(byId);
}
function donorsFor(previous: GameResult): Seat[] {
  return previous.doubleUp ? [...previous.doubleDown].sort((a, b) => a - b) : [previous.last!];
}
function recipientsFor(previous: GameResult): Seat[] { return previous.doubleUp ? [...previous.order] : [previous.order[0]]; }
function antiEvidence(hands: Card[][], donors: Seat[]): Array<{ player: Seat; card: Card }> {
  const evidence = donors.flatMap(player => hands[player].filter(card => card.rank === 16).map(card => ({ player, card: copy(card) })));
  return evidence.length === 2 ? evidence : [];
}
function resolvePairs(exchange: ExchangeState): CardTransfer[] {
  const ordered = [...exchange.offers].sort((a, b) => rankStrength(b.card.rank, exchange.rules) - rankStrength(a.card.rank, exchange.rules));
  const equal = ordered.length === 2 && rankStrength(ordered[0].card.rank, exchange.rules) === rankStrength(ordered[1].card.rank, exchange.rules);
  const upstream = previousSeatOf(exchange.previous.order[0]);
  return ordered.map((offer, index) => ({ from: offer.player,
    to: equal ? offer.player === upstream ? exchange.recipients[0] : exchange.recipients[1] : exchange.recipients[index],
    card: copy(offer.card), type: 'tribute' }));
}
/** Remove every source first, then deliver all destinations; no transient 26/28 state is exposed. */
function exchangedHands(original: Card[][], transfers: CardTransfer[]): Card[][] {
  if (new Set(transfers.map(transfer => transfer.card.id)).size !== transfers.length) throw Error('同一实体不能重复交换');
  for (const transfer of transfers) if (!original[transfer.from]?.some(card => same(card, transfer.card))) throw Error('交换牌不属于原始手牌');
  const outgoing = new Set(transfers.map(transfer => transfer.card.id));
  const hands = original.map(hand => hand.filter(card => !outgoing.has(card.id)).map(copy));
  for (const transfer of transfers) hands[transfer.to].push(copy(transfer.card));
  if (!validDeck(hands)) throw Error('交换后的实体牌不守恒');
  return hands;
}
/** Reverse references only for validating a completed authority; pending references are never counted as extra cards. */
function originalHands(exchange: ExchangeState): Card[][] {
  if (exchange.phase !== 'done' || exchange.antiTribute) return exchange.hands;
  return exchangedHands(exchange.hands, exchange.transfers.map(transfer => ({ ...transfer, from: transfer.to, to: transfer.from })));
}
function assertState(exchange: ExchangeState): void {
  if (exchange.rulesVersion !== CLASSIC_RULES_VERSION || !isValidMatchResult(exchange.previous) || !validDeck(exchange.hands)
    || exchange.rules.version !== 'guan-practice-v1' || !Number.isInteger(exchange.rules.levelRank) || exchange.rules.levelRank < 2 || exchange.rules.levelRank > 14
    || !same(exchange.donors, donorsFor(exchange.previous)) || !same(exchange.recipients, recipientsFor(exchange.previous))
    || !Array.isArray(exchange.offers) || !Array.isArray(exchange.returnOffers) || !Array.isArray(exchange.transfers)
    || !Array.isArray(exchange.tributePairs) || !Array.isArray(exchange.antiTributeEvidence)) throw Error('经典贡还状态无效');
  const original = originalHands(exchange);
  const evidence = antiEvidence(original, exchange.donors);
  if (exchange.antiTribute !== (evidence.length === 2) || exchange.antiTributeEvidence.some(item => !knownCard(item.card))
    || !same(exchange.antiTributeEvidence?.map(e => [e.player, e.card.id]).sort(), evidence.map(e => [e.player, e.card.id]).sort())) throw Error('抗贡证据与实体牌不一致');
  if (exchange.antiTribute) {
    if (exchange.phase !== 'done' || exchange.currentPlayer !== null || exchange.stateVersion !== 0 || exchange.offers.length || exchange.returnOffers.length
      || exchange.transfers.length || exchange.tributePairs.length || exchange.firstPlayer !== exchange.previous.order[0]) throw Error('抗贡不能同时交换牌');
    return;
  }
  for (const [offers, owners, phase] of [[exchange.offers, exchange.donors, 'tribute'], [exchange.returnOffers, exchange.recipients, 'return']] as const) {
    if (offers.length > owners.length || offers.some((offer, index) => offer.player !== owners[index] || !knownCard(offer.card)
      || !candidates(original[offer.player], exchange.rules, phase).some(card => card.id === offer.card.id))) throw Error('待交换引用不合法');
  }
  if (exchange.stateVersion !== exchange.offers.length + exchange.returnOffers.length) throw Error('交换版本不一致');
  const tributeReady = exchange.offers.length === exchange.donors.length;
  const pairs = tributeReady ? resolvePairs(exchange) : [];
  if (!same(exchange.tributePairs, pairs)) throw Error('贡牌配对不一致');
  if (!tributeReady && exchange.returnOffers.length) throw Error('贡牌未齐不能还贡');
  const done = tributeReady && exchange.returnOffers.length === exchange.recipients.length;
  const phase = done ? 'done' : tributeReady ? 'return' : 'tribute';
  const actor = done ? null : tributeReady ? exchange.recipients[exchange.returnOffers.length] : exchange.donors[exchange.offers.length];
  const first = tributeReady ? pairs.find(transfer => transfer.to === exchange.previous.order[0])!.from : exchange.previous.order[0];
  if (exchange.phase !== phase || exchange.currentPlayer !== actor || exchange.firstPlayer !== first) throw Error('贡还阶段或先手不一致');
  const expectedTransfers = done ? [...pairs, ...exchange.returnOffers.map(offer => ({ from: offer.player,
    to: pairs.find(pair => pair.to === offer.player)!.from, card: copy(offer.card), type: 'return' as const }))] : [];
  if (!same(exchange.transfers, expectedTransfers)) throw Error('不能提前或重复交换实体牌');
}

export function createExchange(game: GameState, previous: GameResult): ExchangeState {
  if (!isValidMatchResult(previous)) throw Error('上副名次无效，不能进贡');
  if (!validNewGame(game)) throw Error('只有完整的新发手牌可以进贡');
  const donors = donorsFor(previous); const evidence = antiEvidence(game.hands, donors); const antiTribute = evidence.length === 2;
  return { rulesVersion: CLASSIC_RULES_VERSION, sessionId: game.sessionId, handId: game.handId, stateVersion: 0, rules: copy(game.rules),
    hands: copy(game.hands), previous: copy(previous), phase: antiTribute ? 'done' : 'tribute', currentPlayer: antiTribute ? null : donors[0],
    donors, recipients: recipientsFor(previous), offers: [], returnOffers: [], transfers: [], tributePairs: [],
    firstPlayer: previous.order[0], antiTribute, antiTributeEvidence: evidence };
}
export function getEligibleExchangeCards(exchange: ExchangeState): Card[] {
  return exchange.currentPlayer === null ? [] : copy(candidates(exchange.hands[exchange.currentPlayer], exchange.rules, exchange.phase));
}
/** Explicit allow-list: no hidden hands, pending offers, deck seed or shared player cache. */
export function getExchangeObservation(exchange: ExchangeState, seat: Seat): ExchangeObservation {
  if (!seats.includes(seat)) throw Error('座位无效');
  const active = exchange.currentPlayer === seat;
  const publicTransfers = exchange.phase === 'done' ? exchange.transfers : exchange.phase === 'return' ? exchange.tributePairs ?? [] : [];
  const destination = !active ? null : exchange.phase === 'return'
    ? publicTransfers.find(transfer => transfer.type === 'tribute' && transfer.to === seat)?.from ?? null
    : exchange.recipients.length === 1 ? exchange.recipients[0] : null;
  return copy({ rulesVersion: CLASSIC_RULES_VERSION, sessionId: exchange.sessionId, handId: exchange.handId, stateVersion: exchange.stateVersion,
    rules: exchange.rules, player: seat, hand: exchange.hands[seat], phase: exchange.phase,
    eligibleCardIds: active ? candidates(exchange.hands[seat], exchange.rules, exchange.phase).map(card => card.id) : [], destination,
    previous: exchange.previous, currentPlayer: exchange.currentPlayer, firstPlayer: exchange.firstPlayer,
    publicTransfers, antiTributeEvidence: exchange.antiTributeEvidence ?? [],
    returnRule: exchange.phase === 'return' && exchange.recipients.includes(seat) ? returnOptions(exchange.hands[seat], exchange.rules).rule : null });
}
export function applyExchangeAction(exchange: ExchangeState, action: ExchangeAction): ExchangeResult {
  try {
    if (!action || typeof action !== 'object') throw Error('交换动作格式无效');
    if (exchange.phase === 'done' || exchange.currentPlayer === null) throw Error('本副贡还牌已完成');
    if (action.sessionId !== exchange.sessionId || action.handId !== exchange.handId || action.stateVersion !== exchange.stateVersion) throw Error('这次贡还操作已过期，请重新选择');
    if (action.player !== exchange.currentPlayer || !seats.includes(action.player)) throw Error('还没有轮到你交换牌');
    if (action.type !== exchange.phase || typeof action.cardId !== 'string') throw Error('交换阶段或牌张无效');
    assertState(exchange);
    const card = getEligibleExchangeCards(exchange).find(card => card.id === action.cardId);
    if (!card) throw Error(action.type === 'tribute' ? '必须进贡最大的非逢人配牌' : '请从原始手牌选择符合还贡规则的牌');
    const next = copy(exchange); next.stateVersion++;
    if (action.type === 'tribute') {
      next.offers.push({ player: action.player, card });
      if (next.offers.length < next.donors.length) next.currentPlayer = next.donors[next.offers.length];
      else { next.tributePairs = resolvePairs(next); next.firstPlayer = next.tributePairs.find(pair => pair.to === next.previous.order[0])!.from;
        next.phase = 'return'; next.currentPlayer = next.recipients[0]; }
    } else {
      next.returnOffers.push({ player: action.player, card });
      if (next.returnOffers.length < next.recipients.length) next.currentPlayer = next.recipients[next.returnOffers.length];
      else {
        next.transfers = [...next.tributePairs!, ...next.returnOffers.map(offer => ({ from: offer.player,
          to: next.tributePairs!.find(pair => pair.to === offer.player)!.from, card: copy(offer.card), type: 'return' as const }))];
        next.hands = exchangedHands(next.hands, next.transfers); next.phase = 'done'; next.currentPlayer = null;
      }
    }
    assertState(next); return { ok: true, exchange: next };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '贡还牌状态异常' }; }
}

/** Own-hand-only heuristic, always restricted to candidates validated by the phase rules. */
export function chooseExchangeAction(observation: ExchangeObservation): ExchangeAction {
  const eligible = candidates(observation.hand, observation.rules, observation.phase).filter(card => observation.eligibleCardIds.includes(card.id));
  const flushes = maxDisjointNaturalStraightFlushes(observation.hand);
  const score = (card: Card): number => {
    const count = observation.hand.filter(item => item.rank === card.rank).length;
    const groupCost = count >= 4 ? 30 : count === 3 ? 8 : count === 2 ? 5 : 0;
    const losesFlush = maxDisjointNaturalStraightFlushes(observation.hand.filter(item => item.id !== card.id)) < flushes;
    return groupCost + (losesFlush ? 40 : 0) + rankStrength(card.rank, observation.rules) * .1;
  };
  const card = eligible.map(card => ({ card, score: score(card) })).sort((a, b) => a.score - b.score || byId(a.card, b.card))[0]?.card;
  if (!card || observation.phase === 'done') throw Error('当前没有合法交换动作');
  return { sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion,
    player: observation.player, type: observation.phase, cardId: card.id };
}
export function finishExchangeGame(game: GameState, exchange: ExchangeState): GameState {
  assertState(exchange);
  if (exchange.phase !== 'done' || exchange.currentPlayer !== null) throw Error('贡还牌尚未完成');
  if (!validNewGame(game) || game.sessionId !== exchange.sessionId || game.handId !== exchange.handId || !same(game.rules, exchange.rules)
    || !same(exchangedHands(game.hands, exchange.transfers), exchange.hands)) throw Error('贡还记录与原始发牌不一致');
  return { ...copy(game), hands: copy(exchange.hands), firstPlayer: exchange.firstPlayer, currentPlayer: exchange.firstPlayer, stateVersion: 0, events: [] };
}

/** Same own-hand candidate rules for the native hint boundary; no state mutation. */
export { candidates as classicExchangeCandidates };
