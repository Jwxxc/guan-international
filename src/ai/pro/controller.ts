import type {GameAction,Rng} from '../../engine/types';
import type {AiObservation} from '../types';
import type {StrategyComputation,StrategyDescriptor} from '../strategyTypes';
import {cleanProObservation,ENCODER_VERSION} from '../models/encoding';
import {actionFromScores,type ProRequest} from '../models/contract';
import {PRO_MANIFEST,proCapability} from '../models/manifest';
import {enumerateProActions,PRO_CANDIDATE_VERSION} from './actions';
import {scoreBlueprint} from './blueprint';
import {proveProEndgame} from './endgame';
import {beliefRollout} from './rollout';
import type {ProWorkBudget} from './budgets';

function ranked(obs:AiObservation,budget:ProWorkBudget,now:()=>number){
 const enumeration=enumerateProActions(obs,budget.actions);
 if(!enumeration.complete)throw Error(`PRO incomplete legal candidates: ${enumeration.reason}`);
 if(!enumeration.actions.length)throw Error('PRO no legal candidates');
 const scores=scoreBlueprint(obs,enumeration.actions,now);
 const request:ProRequest={requestId:'synchronous',matchId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,actorId:obs.player,
  observation:obs,legalActions:enumeration.actions,modelHash:PRO_MANIFEST.weightsSha256,encoderVersion:ENCODER_VERSION,objectiveId:PRO_MANIFEST.objectiveId};
 return{enumeration,scores,action:actionFromScores(request,scores)};
}
/** Pure-observation production entry. The trained blueprint and bounded proof are
 * independent. Rollouts never recursively invoke PRO and never see real hands. */
export function computePro(input:AiObservation,descriptor:StrategyDescriptor,rng:Rng,now:()=>number):StrategyComputation {
 const started=now(),obs=cleanProObservation(input),work=descriptor.workBudget as ProWorkBudget;
 const proofStart=now(),proof=descriptor.id==='pro-neural-v1'?null:proveProEndgame(obs,work.proof),tacticalMs=now()-proofStart;
 const at=now(),base=ranked(obs,work,now),policyMs=now()-at,inferenceMs=base.scores.diagnostics.inferenceMs;
 let action:GameAction=proof?.action??base.action;
 const rows=base.enumeration.actions.map((candidate,i)=>({candidate,value:base.scores.values[i]})).sort((a,b)=>b.value-a.value||(a.candidate.id<b.candidate.id?-1:1));
 const continuation=(observation:AiObservation)=>ranked(cleanProObservation(observation),work,now).action;
 const eligible=descriptor.id==='pro-search-v1'&&!proof?.action&&obs.remainingCounts.reduce((a,b)=>a+b,0)<=work.searchMaxRemaining;
 // Always retain the base and a PASS alternative. Complete enumeration remains
 // separate from the bounded root pool; Q values never get added to rollout returns.
 const roots=[action,...rows.filter(row=>row.candidate.action.type==='pass').map(row=>row.candidate.action),...rows.map(row=>row.candidate.action)];
 const search=descriptor.id==='pro-search-v1'?beliefRollout(obs,roots,action,continuation,{...work.search,enabled:eligible,seed:Math.floor(rng()*0x100000000),now}):null;
 if(search)action=search.action;
 const mode=proof?.action?'certified':search?.diagnostics.changedAction?'neural-search':'neural';
 const capability=proCapability(true);
 capability.searchEnabled=eligible;
 return{candidateVersion:PRO_CANDIDATE_VERSION,identity:{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{...descriptor.stamp,descriptorHash:descriptor.descriptorHash},fallbackVersion:descriptor.fallbackVersion},
  timing:{descriptorMs:0,candidateMs:Math.max(0,policyMs-inferenceMs),knowledgeMs:0,plannerMs:null,scoringMs:inferenceMs,policyMs,computeMs:now()-started,tacticalMs,inferenceMs,searchMs:search?.diagnostics.elapsedMs??0},
  decision:{action,policyVersion:descriptor.id,configVersion:descriptor.configVersion,configHash:descriptor.stamp.configHash,
   reasonCodes:[mode==='certified'?'PRO_CERTIFIED_CURRENT_HAND':mode==='neural-search'?'PRO_CONFIRMED_BELIEF_ROLLOUT':'PRO_TRAINED_BLUEPRINT'],
   explanation:mode==='certified'?'已从公开信息证明这条残局路线的本副升级结果。':mode==='neural-search'?'学习策略经独立模拟确认后选择此步；仍是试验模型。':'自主训练模型的候选选择；训练规模有限，尚未证明强于休闲。',
   topCandidates:rows.slice(0,5).map(row=>({action:row.candidate.action,score:row.value,reasonCodes:['LEARNED_ROUND_RETURN'],features:{modelHash:PRO_MANIFEST.weightsSha256,objectiveId:PRO_MANIFEST.objectiveId,rawQ:row.value,probability:false}})),
   stats:{nodes:proof?.certificate.nodes??0,subsetChecks:0,candidateCount:base.enumeration.actions.length,evaluatedCandidates:base.enumeration.actions.length,approximate:true,budgetExhausted:proof?.certificate.status==='unknown',},
   proDiagnostics:{version:'pro-diagnostics-v1',mode,capability,modelHash:PRO_MANIFEST.weightsSha256,checkpointHash:PRO_MANIFEST.checkpointSha256,encoderVersion:ENCODER_VERSION,objectiveId:PRO_MANIFEST.objectiveId,
    candidateFingerprint:base.scores.candidateFingerprint,candidatesComplete:base.enumeration.complete,actionWork:base.enumeration.work,baseAction:base.action,
    endgame:proof?.certificate??null,search:search?.diagnostics??null,searchGate:eligible?'eligible':descriptor.id==='pro-search-v1'?'outside-bounded-search-scope':'disabled',runtimeBackend:PRO_MANIFEST.runtimeBackend}},};
}
