import { getLegalMoves } from '../engine/legalMoves';
import { teamOf } from '../engine/rules';
import type { ResolvedPlay, Rng } from '../engine/types';
import { chooseAiAction } from './baseline/policy';
import { AI_WEIGHTS, scoreAiMove } from './baseline/evaluation';
import { chooseCoopAction } from './coop/policy';
import { COOP_CONFIG, COOP_BUDGET, COOP_CONFIG_HASH } from './coop/config';
import { BASELINE_STAMP, isPolicyId } from './metadata';
import type { AiBudget, AiDecision, AiObservation, PolicyId, PolicyStamp } from './types';

export function policyStamp(id: PolicyId): PolicyStamp {
  if (!isPolicyId(id)) throw Error('未知旧版策略');
  const stamps:Record<PolicyId,PolicyStamp>={baseline:BASELINE_STAMP,'coop-v2':{id:'coop-v2',version:'coop-v2',configHash:COOP_CONFIG_HASH}};
  return {...stamps[id]};
}
export function isAvailablePolicy(stamp: {id:string;version:string;configHash:string} | undefined): boolean {
  if (!stamp) return true; // Explicit compatibility default for pre-v0.4 saves.
  if (!isPolicyId(stamp.id)) return false;
  const current = policyStamp(stamp.id);
  return stamp.version === current.version && stamp.configHash === current.configHash;
}
function baselineDecision(obs: AiObservation, legal: ResolvedPlay[], rng: Rng): AiDecision {
  const action = chooseAiAction(obs, legal, rng);
  const chosen = action.type === 'play' ? legal.find(play => play.key === action.playKey && play.cards.every(card => action.cardIds.includes(card.id))) : undefined;
  const scored = chosen ? scoreAiMove(obs, chosen) : undefined;
  const reason = action.type === 'play' ? 'BASELINE_CHOICE' : !legal.length ? 'NO_LEGAL_RESPONSE' : obs.currentOwner !== null && teamOf(obs.currentOwner) === obs.team ? 'PARTNER_LEADING' : 'PRESERVE_STRUCTURE';
  return {
    action, policyVersion: 'baseline', configVersion: BASELINE_STAMP.version, configHash: BASELINE_STAMP.configHash,
    reasonCodes: [reason], explanation: scored?.reason ?? (!legal.length ? '没有可压过当前牌的候选，建议不出。' : reason === 'PARTNER_LEADING' ? '对家保持领先，原版策略建议保留手牌。' : '原版策略倾向保留现有组合，建议本轮不出。'),
    topCandidates: [{ action, score: scored?.score ?? (reason === 'PARTNER_LEADING' ? AI_WEIGHTS.partnerPass : AI_WEIGHTS.normalPass), reasonCodes: [reason], features: { ...(scored?.breakdown ?? {}), legalCandidates: legal.length } }],
    stats: { nodes: 0, subsetChecks: 0, candidateCount: legal.length, evaluatedCandidates: legal.length, approximate: true, budgetExhausted: false },
  };
}
const historicalPolicies:Record<PolicyId,(obs:AiObservation,legal:ResolvedPlay[],rng:Rng,budget?:AiBudget)=>AiDecision>={
  baseline:baselineDecision,
  'coop-v2':(obs,legal,rng,budget)=>chooseCoopAction(obs,legal,COOP_CONFIG,rng,budget??COOP_BUDGET),
};
export function chooseDecisionWithLegal(obs: AiObservation, legal: ResolvedPlay[], policy: PolicyId, rng: Rng, budget?: AiBudget): AiDecision {
  if(!isPolicyId(policy))throw Error('未知旧版策略');
  return historicalPolicies[policy](obs,legal,rng,budget);
}
export function chooseDecision(obs: AiObservation, policy: PolicyId, rng: Rng, budget?: AiBudget): AiDecision {
  return chooseDecisionWithLegal(obs, getLegalMoves(obs), policy, rng, budget);
}
