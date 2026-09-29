import { createDeck, isWild } from '../../engine/cards';
import type { Card, RuleConfig, Seat } from '../../engine/types';
import { classicExchangeCandidates } from '../../match/classicExchange';
import type { CardTransfer, ExchangeObservation } from '../../match/types';

export const DANLM_EXCHANGE_ENCODER_VERSION = 'guan-danlm-exchange-v1';
/** Only the actor's original 27 cards and already published gives cross IPC. */
export interface DanlmExchangeInput {
  sessionId: string; handId: string; stateVersion: number;
  rulesVersion: 'guan-classic-house-v1'; rules: RuleConfig;
  player: Seat; hand: Card[]; phase: 'tribute' | 'return';
  eligibleCardIds: string[]; destination: Seat | null; isDouble: boolean;
  publicTransfers: CardTransfer[];
}
const deck = new Map(createDeck().map(card => [card.id, card]));
const seat = (value: unknown): value is Seat => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3;
function fields(value: object, names: string[]) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== [...names].sort().join(',')) throw Error('交换观察含未允许的字段');
}
function card(value: Card) {
  fields(value, ['id', 'deck', 'suit', 'rank']);
  const expected = deck.get(value.id);
  if (!expected || expected.deck !== value.deck || expected.suit !== value.suit || expected.rank !== value.rank) throw Error('交换牌实体无效');
}
export function validateDanlmExchangeInput(obs: DanlmExchangeInput): void {
  fields(obs, ['sessionId', 'handId', 'stateVersion', 'rulesVersion', 'rules', 'player', 'hand', 'phase', 'eligibleCardIds', 'destination', 'isDouble', 'publicTransfers']);
  if (![obs.sessionId, obs.handId].every(id => typeof id === 'string' && id.length > 0 && id.length < 200) || !Number.isSafeInteger(obs.stateVersion) || obs.stateVersion < 0) throw Error('交换版本无效');
  fields(obs.rules, ['version', 'levelRank']);
  if (obs.rulesVersion !== 'guan-classic-house-v1' || obs.rules.version !== 'guan-practice-v1' || !Number.isInteger(obs.rules.levelRank) || obs.rules.levelRank < 2 || obs.rules.levelRank > 14) throw Error('DanLM 交换提示仅支持经典升级规则');
  if (!seat(obs.player) || !['tribute', 'return'].includes(obs.phase) || typeof obs.isDouble !== 'boolean' || obs.destination !== null && (!seat(obs.destination) || obs.destination === obs.player)) throw Error('交换阶段或座位无效');
  if (!Array.isArray(obs.hand) || obs.hand.length !== 27) throw Error('交换提示需要原始 27 张手牌');
  obs.hand.forEach(card);
  const own = new Set(obs.hand.map(card => card.id));
  if (own.size !== 27) throw Error('手牌实体重复');
  const legal = classicExchangeCandidates(obs.hand, obs.rules, obs.phase).map(card => card.id).sort();
  if (!Array.isArray(obs.eligibleCardIds) || JSON.stringify([...obs.eligibleCardIds].sort()) !== JSON.stringify(legal)) throw Error('交换候选与 GUAN 规则不一致');
  if (!Array.isArray(obs.publicTransfers)) throw Error('公开贡牌无效');
  if (obs.phase === 'tribute') {
    if (obs.publicTransfers.length || (obs.destination === null) !== obs.isDouble) throw Error('进贡不能读取尚未公开的选择');
  } else {
    const gives = obs.publicTransfers;
    if (gives.length !== (obs.isDouble ? 2 : 1)) throw Error('公开贡牌不完整');
    for (const give of gives) {
      fields(give, ['type', 'from', 'to', 'card']); card(give.card);
      if (give.type !== 'tribute' || !seat(give.from) || !seat(give.to) || give.from === give.to || own.has(give.card.id) || isWild(give.card, obs.rules)) throw Error('公开贡牌与原始手牌冲突');
    }
    if (new Set(gives.map(t => t.card.id)).size !== gives.length || new Set(gives.map(t => t.from)).size !== gives.length || new Set(gives.map(t => t.to)).size !== gives.length || gives.find(t => t.to === obs.player)?.from !== obs.destination) throw Error('还贡对象与公开进贡关系不一致');
  }
}
export function ownDanlmExchangeInput(obs: ExchangeObservation): DanlmExchangeInput {
  if (obs.currentPlayer !== obs.player || obs.phase === 'done' || !obs.previous || obs.rulesVersion !== 'guan-classic-house-v1') throw Error('当前不是可提示的经典贡还阶段');
  const input: DanlmExchangeInput = structuredClone({
    sessionId: obs.sessionId, handId: obs.handId, stateVersion: obs.stateVersion,
    rulesVersion: obs.rulesVersion, rules: obs.rules, player: obs.player,
    hand: obs.hand, phase: obs.phase, eligibleCardIds: obs.eligibleCardIds,
    destination: obs.destination, isDouble: obs.previous.doubleUp, publicTransfers: obs.publicTransfers ?? [],
  });
  validateDanlmExchangeInput(input);
  return input;
}
