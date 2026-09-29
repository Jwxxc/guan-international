import {rankStrength} from '../engine/cards';
import {resolvePlays} from '../engine/patterns';
import {canBeat} from '../engine/compare';
import type {GameAction} from '../engine/types';
import type {AiObservation} from './types';
import type {StrategyDescriptor,StrategyDecision,StrategyComputation} from './strategyTypes';
import {canonicalDescriptor} from './descriptors';
import {BALANCED_PRO_PUBLIC_FINISH_REVISION} from './balancedPro/config';
import {PUBLIC_FINISH_VERSION,publicFinishInputFingerprint} from './balancedPro/publicFinish';

export function observationAllowsAction(obs:AiObservation,action:GameAction):boolean{
 if(!action||action.sessionId!==obs.sessionId||action.handId!==obs.handId||action.stateVersion!==obs.stateVersion||action.player!==obs.player||obs.isOver||obs.currentPlayer!==obs.player)return false;
 if(action.type==='pass')return!!obs.currentPlay;
 if(action.type!=='play'||!Array.isArray(action.cardIds)||!action.cardIds.length||action.cardIds.length>10||new Set(action.cardIds).size!==action.cardIds.length)return false;
 const cards=obs.hand.filter(card=>action.cardIds.includes(card.id));
 return cards.length===action.cardIds.length&&resolvePlays(cards,obs.rules).some(play=>play.key===action.playKey&&canBeat(play,obs.currentPlay,obs.rules));
}
/** Same bounded browser emergency behavior as before: no planner or full candidate generation. */
export function emergencyDecision(obs:AiObservation,descriptor:StrategyDescriptor,reason:string):StrategyDecision{
 const stamp={sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,player:obs.player};
 const card=[...obs.hand].sort((a,b)=>rankStrength(a.rank,obs.rules)-rankStrength(b.rank,obs.rules)||a.id.localeCompare(b.id))[0];
 const play=!obs.currentPlay&&card?resolvePlays([card],obs.rules)[0]:undefined;
 if(!obs.currentPlay&&!play)throw Error('没有可用的领出牌');
 return{action:play?{...stamp,type:'play',cardIds:[card!.id],playKey:play.key}:{...stamp,type:'pass'},policyVersion:descriptor.id,configVersion:'legal-fallback-v1',configHash:'legal-fallback-v1',reasonCodes:['COMPUTE_FALLBACK'],
  explanation:play?'策略计算暂不可用，备选建议先出最小单张。':'策略计算暂不可用，备选建议本轮不出。',topCandidates:[],stats:{nodes:0,subsetChecks:0,candidateCount:play?1:0,evaluatedCandidates:play?1:0,approximate:true,budgetExhausted:reason.includes('deadline')||reason.includes('timeout'),fallbackReason:reason}};
}
export function emergencyComputation(obs:AiObservation,descriptor:StrategyDescriptor,reason:string):StrategyComputation{
 return{decision:emergencyDecision(obs,descriptor,reason),candidateVersion:'emergency-single-pass-v1',timing:{descriptorMs:0,candidateMs:0,knowledgeMs:0,plannerMs:0,scoringMs:0,policyMs:0,computeMs:0},identity:{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{id:'emergency-legal',version:'legal-fallback-v1',configHash:'legal-fallback-v1'},fallbackReason:reason,fallbackVersion:descriptor.fallbackVersion}};
}
/** Runtime receivers validate identities as well as the action's state stamp. */
export function matchesStrategyComputation(result:StrategyComputation|undefined,descriptor:StrategyDescriptor,observation?:AiObservation):boolean{
 if(!result?.decision||!result.identity?.requested||!result.identity.effective||!result.timing)return false;
 const d=result.decision,i=result.identity;
 if(descriptor.id==='balanced-pro-v1'&&descriptor.config.publicFinishRevision===BALANCED_PRO_PUBLIC_FINISH_REVISION){
  if(!d.action||!['play','pass'].includes(d.action.type))return false;
  const diagnostic=d.balancedProDiagnostics,finish=diagnostic?.publicFinish,certificate=finish?.certificate;
  if(!diagnostic||diagnostic.policyRevision!==descriptor.implementationVersion||!finish||!certificate
   ||finish.revision!==BALANCED_PRO_PUBLIC_FINISH_REVISION||certificate.version!==PUBLIC_FINISH_VERSION
   ||finish.status!==certificate.status||finish.reason!==certificate.reason
   ||!['PROVEN','NOT_PROVEN','UNKNOWN','NOT_APPLICABLE'].includes(certificate.status)
   ||!Number.isFinite(finish.proofMs)||finish.proofMs<0
   ||diagnostic.selectedActionKey!==(d.action.type==='play'?d.action.playKey:'~pass'))return false;
  if(finish.adopted){
   if(diagnostic.method!=='public-finish'||finish.selectedActionSource!=='public-result-certificate'
    ||certificate.status!=='PROVEN'||!certificate.eligibleOverride||!certificate.responseChecksComplete||!certificate.guarantee
    ||!finish.selectedRoute||canonicalDescriptor(finish.selectedRoute.first)!==canonicalDescriptor(d.action)
    ||certificate.sessionId!==d.action.sessionId||certificate.handId!==d.action.handId||certificate.stateVersion!==d.action.stateVersion
    ||!certificate.publicInputFingerprint)return false;
   if(observation&&(canonicalDescriptor(certificate.rules)!==canonicalDescriptor(observation.rules)
    ||certificate.mode!==observation.mode||certificate.publicInputFingerprint!==publicFinishInputFingerprint(observation)))return false;
  }else if(finish.selectedRoute!==null||finish.selectedActionSource!=='existing-policy')return false;
 }
 if(descriptor.id==='jwxxc-pro'||descriptor.id==='jwxxc-model-v1'||descriptor.id==='jwxxc-search-v1'){
  const j=d.jwxxcDiagnostics,work=descriptor.workBudget;
  if(!j||j.version!=='jwxxc-diagnostics-v1'||j.modelId!==descriptor.config.modelId||j.modelHash!==descriptor.config.modelHash||j.checkpointHash!==descriptor.config.checkpointHash
   ||j.encoderVersion!==descriptor.config.encoderVersion||j.objectiveId!==descriptor.config.objectiveId||j.runtimeBackend!==descriptor.config.runtimeBackend
   ||!j.candidatesComplete||!j.capability.modelLoaded||!j.capability.artifactPresent||!j.capability.encoderParityVerified||!j.capability.rulesCompatibilityVerified||!j.capability.informationIsolationVerified
   ||j.valueValidatedForTruncation!==false||j.capability.valueValidatedForTruncation!==false||j.capability.searchEnabled!==j.actualSearchEnabled
   ||!Number.isFinite(j.stateValue)||!j.candidateFingerprint||!['model','certified','model-search','immediate-finish'].includes(j.mode))return false;
  if(descriptor.config.endgameVersion===null&&j.endgame!==null)return false;
  if(descriptor.config.endgameVersion!==null&&j.mode!=='immediate-finish'&&(!j.endgame||j.endgame.version!==descriptor.config.endgameVersion||!work||!('proof' in work)
   ||canonicalDescriptor(j.endgame.workBudget)!==canonicalDescriptor(work.proof)))return false;
  if(j.endgame&&(j.endgame.objectiveId!=='actual-level-transition-v1'||j.endgame.scope!=='actual_level_transition'
   ||j.endgame.lowerBound!==null&&!Number.isFinite(j.endgame.lowerBound)||j.endgame.upperBound!==null&&!Number.isFinite(j.endgame.upperBound)))return false;
  if(j.mode==='certified'&&(!j.endgame?.eligibleOverride||j.endgame.status!=='exact'||j.endgame.lowerBound===null||j.endgame.lowerBound!==j.endgame.upperBound
   ||canonicalDescriptor(j.endgame.action)!==canonicalDescriptor(d.action)))return false;
  if(descriptor.config.searchVersion===null&&(j.search!==null||j.actualSearchEnabled))return false;
  if(descriptor.config.searchVersion!==null&&(!j.search||j.search.version!==descriptor.config.searchVersion||j.search.objectiveId!==j.objectiveId||j.search.enabled!==j.actualSearchEnabled))return false;
  if(j.mode==='model-search'&&(!j.search?.changedAction||j.search.confirmationLowerBound===null||!Number.isFinite(j.search.confirmationLowerBound)||j.search.confirmationLowerBound<=0))return false;
 }
 if(descriptor.id.startsWith('pro-')){
  const p=d.proDiagnostics;
  if(!p||p.version!=='pro-diagnostics-v1'||p.modelHash!==descriptor.config.modelHash||p.checkpointHash!==descriptor.config.checkpointHash||p.encoderVersion!==descriptor.config.encoderVersion||p.objectiveId!==descriptor.config.objectiveId||!p.candidatesComplete||!p.capability.modelLoaded||p.runtimeBackend!==descriptor.config.runtimeBackend)return false;
  if(descriptor.config.endgameVersion!==null&&(!p.endgame||p.endgame.version!==descriptor.config.endgameVersion||!['exact','unknown','not-applicable'].includes(p.endgame.status)||!descriptor.workBudget||!('proof' in descriptor.workBudget)||canonicalDescriptor(p.endgame.workBudget)!==canonicalDescriptor(descriptor.workBudget.proof)))return false;
  if(descriptor.config.endgameVersion===null&&p.endgame!==null)return false;
  if(descriptor.config.searchVersion!==null&&p.search?.version!==descriptor.config.searchVersion)return false;
  if(descriptor.config.searchVersion===null&&p.search!==null)return false;
  if(p.mode==='certified'&&(!p.endgame?.eligibleOverride||p.endgame.status!=='exact'||canonicalDescriptor(p.endgame.action)!==canonicalDescriptor(d.action)))return false;
  if(p.mode==='neural-search'&&(!p.search?.changedAction||p.search.exact!==false||p.search.confirmationLowerBound===null||p.search.confirmationLowerBound<=0))return false;
 }
 if(!Array.isArray(d.reasonCodes)||typeof d.explanation!=='string'||!Array.isArray(d.topCandidates)||!d.stats||Object.values(result.timing).some(value=>value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0)))return false;
 for(const key of ['descriptorMs','candidateMs','knowledgeMs','policyMs','computeMs'] as const)if(typeof result.timing[key]!=='number'||!Number.isFinite(result.timing[key]))return false;
 if(['coop-endgame-v1','balanced-endgame-v1','balanced-attachment-v1'].includes(descriptor.id)){
  const certificate=d.tacticalCertificate,work=descriptor.workBudget;
  if(!certificate||certificate.version!==descriptor.config.tacticalVersion||certificate.certificateScope!=='two-active-players'
   ||!work||!('proof' in work)||canonicalDescriptor(certificate.proofWorkBudget)!==canonicalDescriptor(work.proof)
   ||!['proved','not-proved','not-applicable','budget-exhausted'].includes(certificate.status)||typeof certificate.eligibleOverride!=='boolean'
   ||certificate.eligibleOverride&&certificate.status!=='proved'
   ||!['single-hand-finish','proved-two-play-finish','ordinary'].includes(d.decisionTier??'')||typeof result.timing.tacticalMs!=='number'||!Number.isFinite(result.timing.tacticalMs))return false;
  if(d.decisionTier==='proved-two-play-finish'&&(certificate.status!=='proved'||!certificate.eligibleOverride||!certificate.selectedRoute
   ||canonicalDescriptor(certificate.selectedRoute.first)!==canonicalDescriptor(d.action)))return false;
 }
 if(descriptor.id==='balanced-attachment-v1'){
  const audit=d.attachmentDiagnostics;
  if(!audit||audit.version!==descriptor.configVersion||!Array.isArray(audit.candidates)
   ||audit.selectedActionKey!==(d.action.type==='play'?d.action.playKey:'~pass'))return false;
  for(const row of audit.candidates){
   if(!row||!row.action||!row.features||typeof row.coarseScore!=='number'||!Number.isFinite(row.coarseScore))return false;
   if(row.score===null){if(row.selectedForPlanning||row.oldScore!==null||row.cost!==null)return false;continue;}
   if(typeof row.oldScore!=='number'||typeof row.cost!=='number'||!Number.isFinite(row.score)||!Number.isFinite(row.oldScore)||!Number.isFinite(row.cost)||row.cost<0
    ||Math.abs(row.score-(row.oldScore-row.cost))>1e-8||row.features.attachmentControlCost!==row.cost)return false;
  }
  for(const row of d.topCandidates){
   const key=row.action.type==='play'?row.action.playKey:'~pass',scored=audit.candidates.find(candidate=>(candidate.action.type==='play'?candidate.action.playKey:'~pass')===key);
   if(!scored||scored.score!==row.score)return false;
  }
 }
 return result.candidateVersion===descriptor.candidateVersion&&d.policyVersion===descriptor.id&&d.configVersion===descriptor.configVersion&&d.configHash===descriptor.stamp.configHash
  &&canonicalDescriptor(i.requested.modelRef)===canonicalDescriptor(descriptor.stamp.modelRef)&&i.requested.id===descriptor.id&&i.requested.version===descriptor.stamp.version&&i.requested.configHash===descriptor.stamp.configHash&&i.requestedDescriptorHash===descriptor.descriptorHash
  &&i.effective.id===descriptor.id&&i.effective.version===descriptor.stamp.version&&i.effective.configHash===descriptor.stamp.configHash&&i.effective.descriptorHash===descriptor.descriptorHash
  &&(!['balanced-v1','balanced-endgame-v1','balanced-attachment-v1'].includes(descriptor.id)||d.candidateDiagnostics?.version===descriptor.candidateVersion);
}
