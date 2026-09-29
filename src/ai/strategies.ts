import {getLegalMoves} from '../engine/legalMoves';
import type {ResolvedPlay,Rng} from '../engine/types';
import {chooseDecisionWithLegal} from './registry';
import {getStrategicCandidates} from './candidates/strategic';
import {buildPublicKnowledge} from './publicKnowledge';
import {chooseBalancedAction} from './balanced/policy';
import {chooseAttachmentBalancedAction} from './balanced/attachmentPolicy';
import {computeBalancedPlus} from './balancedPlus/policy';
import {computeBalancedPro} from './balancedPro/policy';
import type {BalancedWorkBudget} from './balanced/config';
import type {AiObservation,AiBudget} from './types';
import {resolveStrategy} from './descriptors';
import {ownAiInput} from './input';
import {proveTwoPlayEndgame} from './endgame/proof';
import {applyEndgamePriority} from './endgame/priority';
import type {StrategyComputation,StrategyDescriptor,StrategyId,StrategyStamp,RuntimeStrategyIdentity,EndgameWorkBudget} from './strategyTypes';
import {computePro} from './pro/controller';
import {computeJwxxc} from './jwxxc/policy';

export function normalIdentity(descriptor:StrategyDescriptor):RuntimeStrategyIdentity{return{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{...descriptor.stamp,descriptorHash:descriptor.descriptorHash},fallbackVersion:descriptor.fallbackVersion};}
type StrategyImplementation=(obs:AiObservation,descriptor:StrategyDescriptor,rng:Rng,now:()=>number,sharedPool?:ResolvedPlay[])=>StrategyComputation;
const historical:StrategyImplementation=(obs,descriptor,rng,now,sharedPool)=>{
 if(descriptor.id!=='baseline'&&descriptor.id!=='coop-v2')throw Error('历史策略映射错误');
 const started=now(),legal=sharedPool??getLegalMoves(obs),candidateMs=now()-started,decisionStart=now();
 const decision=chooseDecisionWithLegal(obs,legal,descriptor.id,rng,descriptor.workBudget as AiBudget|undefined);
 const policyMs=now()-decisionStart;return{decision,candidateVersion:sharedPool?'experimental-common-pool':descriptor.candidateVersion,identity:normalIdentity(descriptor),timing:{descriptorMs:0,candidateMs,knowledgeMs:0,plannerMs:null,scoringMs:null,policyMs,computeMs:now()-started}};
};
const endgame:StrategyImplementation=(obs,descriptor,rng,now,sharedPool)=>{
 const started=now(),work=descriptor.workBudget as EndgameWorkBudget;
 const analysis=proveTwoPlayEndgame(obs,work.proof),tacticalMs=now()-started;
 const baseId=descriptor.id==='coop-endgame-v1'?'coop-v2':'balanced-v1';
 // Reuse the actual frozen entry and its RNG exactly; proof work itself has no random stream.
 const original=sharedPool?computeWithSharedCandidates(obs,baseId,rng,sharedPool,now):computeStrategy(obs,baseId,rng,now);
 const decision=applyEndgamePriority(original.decision,analysis);
 const {fallbackReason,...stats}=decision.stats;
 decision.stats={...stats,...(fallbackReason?{approximationReason:fallbackReason}:{})};
 decision.policyVersion=descriptor.id;decision.configVersion=descriptor.configVersion;decision.configHash=descriptor.stamp.configHash;
 return{decision,candidateVersion:original.candidateVersion,identity:normalIdentity(descriptor),timing:{...original.timing,tacticalMs,computeMs:now()-started}};
};
const implementations:Record<StrategyId,StrategyImplementation>={
 'balanced-plus-v1':computeBalancedPlus,
 'balanced-pro-v1':computeBalancedPro,
 'jwxxc-pro':computeJwxxc,'jwxxc-model-v1':computeJwxxc,'jwxxc-search-v1':computeJwxxc,
 'balanced-attachment-v1':(obs,descriptor,rng,now,sharedPool)=>{
  const started=now(),work=descriptor.workBudget as EndgameWorkBudget,baseWork=work.base as BalancedWorkBudget;
  const analysis=proveTwoPlayEndgame(obs,work.proof),tacticalMs=now()-started;
  const knowledgeStart=now(),knowledge=buildPublicKnowledge(obs),knowledgeMs=now()-knowledgeStart,candidateStart=now();
  const batch=sharedPool?{moves:sharedPool,legalPass:!!obs.currentPlay,stats:{version:'experimental-common-pool',baseCandidates:sharedPool.length,addedCandidates:0,variantChecks:0,choiceNodes:0,truncatedCandidates:false,allPhysicalPlaysEnumerated:false as const}}:getStrategicCandidates(obs,baseWork.candidates);
  const candidateMs=now()-candidateStart,decisionStart=now(),result=chooseAttachmentBalancedAction(obs,batch,knowledge,baseWork,descriptor.stamp.configHash,rng,now,undefined,analysis);
  const decision=applyEndgamePriority(result.decision,analysis);
  if(decision.attachmentDiagnostics){
   decision.attachmentDiagnostics.selectedActionKey=decision.action.type==='play'?decision.action.playKey:'~pass';
   if(decision.decisionTier==='proved-two-play-finish')decision.attachmentDiagnostics.selectionMethod='proved-two-play-finish';
  }
  return{decision,candidateVersion:batch.stats.version,identity:normalIdentity(descriptor),timing:{descriptorMs:0,candidateMs,knowledgeMs,plannerMs:result.plannerMs,scoringMs:Math.max(0,now()-decisionStart-result.plannerMs),policyMs:now()-decisionStart,tacticalMs,computeMs:now()-started}};
 },
 'pro-danlm-v1':()=>{throw Error('DanLM requires the explicit local asynchronous practice backend');},
 'pro-danlm-classic-v1':()=>{throw Error('DanLM requires the explicit local asynchronous classic backend');},
 'pro-neural-v1':computePro,'pro-endgame-v1':computePro,'pro-search-v1':computePro,
 baseline:historical,'coop-v2':historical,
 'coop-endgame-v1':endgame,'balanced-endgame-v1':endgame,
 'balanced-v1':(obs,descriptor,rng,now,sharedPool)=>{
  const started=now(),knowledge=buildPublicKnowledge(obs),knowledgeMs=now()-started,work=descriptor.workBudget as BalancedWorkBudget,candidateStart=now();
  const batch=sharedPool?{moves:sharedPool,legalPass:!!obs.currentPlay,stats:{version:'experimental-common-pool',baseCandidates:sharedPool.length,addedCandidates:0,variantChecks:0,choiceNodes:0,truncatedCandidates:false,allPhysicalPlaysEnumerated:false as const}}:getStrategicCandidates(obs,work.candidates);
  const candidateMs=now()-candidateStart,decisionStart=now(),result=chooseBalancedAction(obs,batch,knowledge,work,descriptor.stamp.configHash,rng,now);
  return{decision:result.decision,candidateVersion:batch.stats.version,identity:normalIdentity(descriptor),timing:{descriptorMs:0,candidateMs,knowledgeMs,plannerMs:result.plannerMs,scoringMs:Math.max(0,now()-decisionStart-result.plannerMs),policyMs:now()-decisionStart,computeMs:now()-started}};
 },
};
/** Production and the new end-to-end runner both resolve the real provider here. */
export function computeStrategy(obs:AiObservation,identity:StrategyId|StrategyStamp|StrategyDescriptor,rng:Rng,now:()=>number=()=>0):StrategyComputation {
 const started=now(),descriptor=resolveStrategy(identity),descriptorMs=now()-started,result=implementations[descriptor.id](ownAiInput(obs),descriptor,rng,now);result.timing.descriptorMs=descriptorMs;result.timing.computeMs=now()-started;return result;
}
/** Explicitly labelled scoring-only ablation. Never used by the game or main paired comparison. */
export function computeWithSharedCandidates(obs:AiObservation,identity:StrategyId|StrategyStamp|StrategyDescriptor,rng:Rng,pool:ResolvedPlay[],now:()=>number=()=>0):StrategyComputation {
 const started=now(),descriptor=resolveStrategy(identity),descriptorMs=now()-started,result=implementations[descriptor.id](ownAiInput(obs),descriptor,rng,now,pool);result.timing.descriptorMs=descriptorMs;result.timing.computeMs=now()-started;
 const variant='common-root-pool';result.decision.configHash=descriptor.stamp.configHash+':'+variant;result.identity.effective={...descriptor.stamp,version:descriptor.implementationVersion+':'+variant,configHash:result.decision.configHash,descriptorHash:descriptor.descriptorHash+':'+variant};return result;
}
