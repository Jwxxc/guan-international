import type { ExchangeAction, ExchangeObservation } from '../match/types';
import { nativeDanlmEnabled, DANLM_MODEL_HASH, DANLM_OBJECTIVE } from '../ai/pro/nativeInfo';
import { DANLM_EXCHANGE_ENCODER_VERSION, ownDanlmExchangeInput } from '../ai/pro/exchangeContract';
import { randomId } from './randomId';

export async function requestDanlmExchangeHint(observation: ExchangeObservation, signal: AbortSignal): Promise<ExchangeAction> {
  if (!nativeDanlmEnabled()) throw Error('本机 DanLM 模型尚未连接，请用 GUAN 启动器打开游戏。');
  const input = ownDanlmExchangeInput(observation), requestId = randomId();
  const response = await fetch('/__pro/native/exchange-score', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guan-Pro': 'classic-and-practice' },
    body: JSON.stringify({ requestId, observation: input, encoderVersion: DANLM_EXCHANGE_ENCODER_VERSION }), signal,
  });
  const result = await response.json();
  if (!response.ok) throw Error(typeof result.error === 'string' ? result.error.slice(0, 220) : '本机模型暂时不可用');
  if (result.requestId !== requestId || result.modelHash !== DANLM_MODEL_HASH || result.encoderVersion !== DANLM_EXCHANGE_ENCODER_VERSION || result.objectiveId !== DANLM_OBJECTIVE || !Array.isArray(result.values) || result.values.length !== input.eligibleCardIds.length || result.values.some((v: unknown) => typeof v !== 'number' || !Number.isFinite(v))) throw Error('DanLM 交换建议未通过身份检查');
  const ranked = input.eligibleCardIds.map((cardId, index) => ({ cardId, value: result.values[index] as number })).sort((a, b) => b.value - a.value || a.cardId.localeCompare(b.cardId));
  return { sessionId: input.sessionId, handId: input.handId, stateVersion: input.stateVersion, player: input.player, type: input.phase, cardId: ranked[0].cardId };
}
