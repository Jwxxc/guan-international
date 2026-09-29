import type {GameAction,Rng} from '../../engine/types';
import type {AiObservation} from '../types';
import type {StrategyComputation,StrategyDescriptor} from '../strategyTypes';
import {enumerateProActions,PRO_CANDIDATE_VERSION,type ProCandidate} from '../pro/actions';
import {candidateFingerprint} from '../models/contract';
import {cleanProObservation} from '../models/encoding';
import {jwxxcModelCapability} from './modelManifest';
import {scoreJwxxcModel,getJwxxcHandle,type JwxxcModelHandle} from './modelAdapter';
import type {JwxxcModelScores} from './modelTypes';
import {proveJwxxcEndgame} from './endgame';
import {isJwxxcExactOverride} from './certificates';
import {jwxxcBeliefRollout} from './rollout';
import type {JwxxcWorkBudget} from './budgets';

export function actionFromJwxxcScores(candidates:ProCandidate[],scores:JwxxcModelScores,handle:JwxxcModelHandle=getJwxxcHandle()):GameAction{
 const model=handle;
 if(!candidates.length||scores.modelHash!==model.weightsSha256||scores.encoderVersion!==model.encoderVersion||scores.objectiveId!==model.objectiveId
  ||scores.candidateFingerprint!==candidateFingerprint(candidates)||scores.values.length!==candidates.length||scores.actionIds.length!==candidates.length
  ||scores.diagnostics.backend!==model.runtimeBackend||scores.diagnostics.candidateCount!==candidates.length||scores.diagnostics.stateEncodes!==1
  ||!Number.isFinite(scores.stateValue))throw Error('JWXXC 模型响应身份或维度不匹配');
 let best=0;
 for(let i=0;i<candidates.length;i++){
  if(scores.actionIds[i]!==candidates[i]!.id||!Number.isFinite(scores.values[i]))throw Error('JWXXC 模型返回无效候选分数');
  if(scores.values[i]!>scores.values[best]!||scores.values[i]===scores.values[best]&&candidates[i]!.id<candidates[best]!.id)best=i;
 }
 return candidates[best]!.action;
}
function rank(obs:AiObservation,work:JwxxcWorkBudget,now:()=>number,handle:JwxxcModelHandle){
 const at=now(),enumeration=enumerateProActions(obs,work.actions),candidateMs=now()-at;
 if(!enumeration.complete)throw Error(`JWXXC 合法候选超出预算：${enumeration.reason}`);
 const scores=scoreJwxxcModel(obs,enumeration.actions,now,handle),action=actionFromJwxxcScores(enumeration.actions,scores,handle);
 return{enumeration,scores,action,candidateMs};
}

/** Independent trained weights and controller; sampled worlds never cross the observation boundary. */
export function computeJwxxc(input:AiObservation,descriptor:StrategyDescriptor,rng:Rng,now:()=>number):StrategyComputation{
 const started=now(),obs=cleanProObservation(input),work=descriptor.workBudget as JwxxcWorkBudget,model=getJwxxcHandle(descriptor.stamp.modelRef);
 const base=rank(obs,work,now,model),rows=base.enumeration.actions.map((candidate,index)=>({candidate,value:base.scores.values[index]!})).sort((a,b)=>b.value-a.value||a.candidate.id.localeCompare(b.candidate.id));
 const finish=rows.find(row=>row.candidate.play?.size===obs.hand.length);
 const proofStarted=now(),proof=!finish&&descriptor.config.endgameVersion!==null?proveJwxxcEndgame(obs,work.proof,{now}):null,tacticalMs=now()-proofStarted;
 const certified=proof!==null&&isJwxxcExactOverride(proof);
 let action=finish?.candidate.action??(certified?proof!.action!:base.action);
 const enabled=work.search.enabled&&!finish&&!certified&&obs.remainingCounts.reduce((sum,n)=>sum+n,0)<=work.searchMaxRemaining;
 // Continuation scores only its own observation; there is no recursive search or sampled-world closure.
 const continuation=(observation:AiObservation)=>rank(cleanProObservation(observation),work,now,model).action;
 const rootScores=Object.fromEntries(rows.map(row=>[row.candidate.id,row.value]));
 const search=work.search.enabled?jwxxcBeliefRollout(obs,rows.map(row=>row.candidate.action),action,continuation,{...work.search,enabled,seed:Math.floor(rng()*0x100000000),now,rootScores}):null;
 if(search)action=search.action;
 const mode=finish?'immediate-finish':certified?'certified':search?.diagnostics.changedAction?'model-search':'model';
 const capability=jwxxcModelCapability(true,model);capability.searchEnabled=enabled;
 const key=(a:GameAction)=>a.type==='pass'?'pass':a.playKey;
 const chosen=rows.find(row=>key(row.candidate.action)===key(action));
 const ordered=chosen?[chosen,...rows.filter(row=>row!==chosen)]:rows;
 return{candidateVersion:PRO_CANDIDATE_VERSION,
  identity:{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{...descriptor.stamp,descriptorHash:descriptor.descriptorHash},fallbackVersion:descriptor.fallbackVersion},
  timing:{descriptorMs:0,candidateMs:base.candidateMs,knowledgeMs:0,plannerMs:null,scoringMs:base.scores.diagnostics.inferenceMs,inferenceMs:base.scores.diagnostics.inferenceMs,policyMs:now()-started,computeMs:now()-started,tacticalMs,searchMs:search?.diagnostics.elapsedMs??0},
  decision:{action,policyVersion:descriptor.id,configVersion:descriptor.configVersion,configHash:descriptor.stamp.configHash,
   reasonCodes:[finish?'JWXXC_LEGAL_FINISH':certified?'JWXXC_PROVED_BOUNDARY':mode==='model-search'?'JWXXC_CONFIRMED_ROLLOUT':'JWXXC_TRAINED_MODEL'],
   explanation:finish?'这手可以合法出完全部余牌。':certified?'公开信息证明这条残局路线能改善当前副的实际结算；不代表整场必胜。':mode==='model-search'?'独立确认样本支持这步前瞻选择；结论限于采样假设。':'JWXXC 小规模训练模型的试验选择；当前开发对照弱于均衡。',
   topCandidates:ordered.slice(0,5).map(row=>({action:row.candidate.action,score:row.value,reasonCodes:['JWXXC_LEARNED_ROUND_RETURN'],features:{modelId:model.modelId,modelHash:model.weightsSha256,objectiveId:model.objectiveId,rawQ:row.value,probability:false}})),
   stats:{nodes:proof?.certificate.nodes??0,subsetChecks:0,candidateCount:base.enumeration.actions.length,evaluatedCandidates:base.enumeration.actions.length,approximate:!certified&&!finish,budgetExhausted:proof?.certificate.status==='unknown'||!!search?.diagnostics.fallbackReason?.includes('budget')},
   jwxxcDiagnostics:{version:'jwxxc-diagnostics-v1',mode,modelId:model.modelId,modelHash:model.weightsSha256,checkpointHash:model.checkpointSha256,encoderVersion:model.encoderVersion,objectiveId:model.objectiveId,runtimeBackend:model.runtimeBackend,
    capability,candidateFingerprint:base.scores.candidateFingerprint,candidatesComplete:base.enumeration.complete,actionWork:base.enumeration.work,stateValue:base.scores.stateValue,valueValidatedForTruncation:false,baseAction:base.action,
    endgame:proof?.certificate??null,search:search?.diagnostics??null,searchGate:enabled?'eligible':work.search.enabled?'outside-bounded-search-scope':'default-disabled-pending-evidence',actualSearchEnabled:enabled,searchFallback:search?.diagnostics.fallbackReason??null}},};
}
