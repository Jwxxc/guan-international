/** Rule-version boundary: historical journals retain their original exchange semantics. */
import * as classic from './classicExchange';
import * as legacy from './legacyExchange';
import type { GameResult, GameState, Seat } from '../engine/types';
import { CLASSIC_RULES_VERSION, type ExchangeAction, type ExchangeObservation, type ExchangeState, type MatchRulesVersion } from './types';

function implementation(version?: MatchRulesVersion) {
  if (version === CLASSIC_RULES_VERSION) return classic;
  if (version === undefined || version === 'guan-match-v1') return legacy;
  throw Error('不支持的贡还规则版本');
}
export function createExchange(game: GameState, previous: GameResult, version: MatchRulesVersion = 'guan-match-v1'): ExchangeState {
  return implementation(version).createExchange(game, previous);
}
export const getEligibleExchangeCards = (exchange: ExchangeState) => implementation(exchange.rulesVersion).getEligibleExchangeCards(exchange);
export const getExchangeObservation = (exchange: ExchangeState, seat: Seat) => implementation(exchange.rulesVersion).getExchangeObservation(exchange, seat);
export const applyExchangeAction = (exchange: ExchangeState, action: ExchangeAction) => implementation(exchange.rulesVersion).applyExchangeAction(exchange, action);
export const chooseExchangeAction = (observation: ExchangeObservation) => implementation(observation.rulesVersion).chooseExchangeAction(observation);
export const finishExchangeGame = (game: GameState, exchange: ExchangeState) => implementation(exchange.rulesVersion).finishExchangeGame(game, exchange);
