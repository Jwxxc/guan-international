import type {ResolvedPlay,Rng} from '../../engine/types';
import type {AiObservation,AiCandidateDiagnostic} from '../types';
import type {StrategyComputation,StrategyDescriptor} from '../strategyTypes';
import {getStrategicCandidates} from '../candidates/strategic';
import {buildPublicKnowledge} from '../publicKnowledge';
import {ownAiInput} from '../input';
import {solveBalancedPlusEndgame} from '../balancedPlus/endgame';
import {sampleBalancedPlusWorlds} from '../balancedPlus/sampling';
import {createSampleControl} from '../balancedPlus/control';
import {chooseProHeuristic} from './heuristic';
import {chooseProContinuation} from './continuation';
import {selectProRoots} from './roots';
import {proActionKey,runProForward} from './forward';
import {BALANCED_PRO_CONFIG,BALANCED_PRO_PUBLIC_FINISH_REVISION,BALANCED_PRO_RELAY_REVISION,type BalancedProWorkBudget} from './config';
import type {BalancedProDiagnostics} from './diagnostics';
import {provePublicFinish,type PublicFinishBudget} from './publicFinish';

export function computeBalancedPro(input:AiObservation,descriptor:StrategyDescriptor,rng:Rng,now:()=>number,sharedPool?:ResolvedPlay[]):StrategyComputation {
  const obs=ownAiInput(input),started=now(),work=descriptor.workBudget as BalancedProWorkBudget;
  const revised=descriptor.config.publicFinishRevision===BALANCED_PRO_PUBLIC_FINISH_REVISION;
  const publicStart=now(),publicProof=revised?provePublicFinish(obs,descriptor.config.publicFinishBudget as PublicFinishBudget):null,publicProofMs=now()-publicStart;
  const protectedRoute=publicProof?.status==='PROVEN'&&publicProof.certificate.eligibleOverride?publicProof.choices[0]:undefined;
  const knowledgeStart=now(),knowledge=buildPublicKnowledge(obs),knowledgeMs=now()-knowledgeStart,candidateStart=now();
  const batch=sharedPool?{moves:[...sharedPool],legalPass:!!obs.currentPlay,stats:{version:'experimental-common-pool',baseCandidates:sharedPool.length,addedCandidates:0,variantChecks:0,choiceNodes:0,truncatedCandidates:false,allPhysicalPlaysEnumerated:false as const}}:getStrategicCandidates(obs,work.base.candidates);
  const candidateMs=now()-candidateStart,policyStart=now();
  // Proof candidates are generated before any heuristic shortlist. A complete
  // physical/wildcard interpretation must remain executable even if not in Top-K.
  if(protectedRoute&&!batch.moves.some(play=>play.key===protectedRoute.firstPlay.key))batch.moves.push(protectedRoute.firstPlay);
  const immediate=!batch.moves.length||batch.moves.some(play=>play.size===obs.hand.length);
  const proofStart=now(),proof=immediate||protectedRoute?null:solveBalancedPlusEndgame(obs,work.endgame),tacticalMs=now()-proofStart+publicProofMs;
  const diagnostics:BalancedProDiagnostics={version:'balanced-pro-diagnostics-v1',objective:BALANCED_PRO_CONFIG.objective,
    method:immediate?'immediate':'heuristic',baseActionKey:'',selectedActionKey:'',sampledWorlds:0,samplingReason:null,controlAdjusted:false,publicHistoryReplays:0,
    forward:{attempted:false,changedAction:false,reason:'not-needed',transitions:0,completed:0,initialRoots:0,refinedRoots:0,selectionSamples:0,confirmationSamples:0,selectionGain:null,confirmationGain:null,estimateOnly:true},
    endgame:proof?{status:proof.certificate.status,method:proof.certificate.method,nodes:proof.certificate.nodes,reason:proof.certificate.reason,exact:proof.certificate.status==='exact'}
      :{status:'not-applicable',method:'none',nodes:0,reason:'immediate-action',exact:false}};
  const sampleStart=now();
  let sampled:ReturnType<typeof sampleBalancedPlusWorlds>|null=null;
  if(!immediate&&!proof?.action&&!protectedRoute){
    const random=rng();if(!Number.isFinite(random)||random<0||random>=1)throw Error('均衡 Pro 随机源无效');
    sampled=sampleBalancedPlusWorlds(obs,work.controlSamples+work.confirmationSamples,Math.floor(random*0x100000000));
    diagnostics.sampledWorlds=sampled.worlds.length;diagnostics.samplingReason=sampled.diagnostics.reason;
    diagnostics.publicHistoryReplays=sampled.diagnostics.publicHistoryReplays;
  }
  const control=sampled?.worlds.length?createSampleControl(obs,sampled.worlds.slice(0,work.controlSamples)):undefined;
  const preferred=protectedRoute?[protectedRoute.first]:immediate?[]:[chooseProContinuation(obs,'balanced'),chooseProContinuation(obs,'pressure')];
  const beforeProposalMs=now()-sampleStart;
  const result=chooseProHeuristic(obs,batch,knowledge,work.base,descriptor.stamp.configHash,rng,now,
    descriptor.config.relayRevision===BALANCED_PRO_RELAY_REVISION?{seatAwareRelay:true}:undefined,proof?.tactical,control,preferred);
  let decision=result.decision;
  diagnostics.baseActionKey=proActionKey(decision.action);
  let forwardMs=0;
  if(protectedRoute){
    diagnostics.method='public-finish';
    diagnostics.forward.reason='public-result-certificate-priority';
    decision={...decision,action:protectedRoute.first,reasonCodes:[protectedRoute.finish?'PRO_PUBLIC_UNBEATABLE_FINISH':'PRO_PUBLIC_DIRECT_FINISH'],
      explanation:protectedRoute.finish?'公开牌账证明这手无人能压，按实际轮转重新领牌后可出完；确定的团队结果优先于保牌和未证实的接力。':'这手可合法出完，按当前公开名次取得已证明的团队结果。'};
  }else if(proof?.action){
    diagnostics.method='public-exact';
    decision={...decision,action:proof.action,reasonCodes:['PRO_PUBLIC_ENDGAME'],
      explanation:'根据完整公开牌账算清后续回应，这条残局路线可改善我方实际升级或过 A 结果。'};
  }else if(!immediate&&sampled?.worlds.length){
    const rows:AiCandidateDiagnostic[]=(decision.attachmentDiagnostics?.candidates??[]).filter(row=>row.score!==null).map(row=>({
      action:row.action,score:row.score!,reasonCodes:['PRO_PUBLIC_TEAM_PLAN'],features:{...row.features,scoreScope:'heuristic-proposal'},
    })).sort((a,b)=>b.score-a.score||proActionKey(a.action).localeCompare(proActionKey(b.action)));
    // A comparison within the same finalists, not a full causal ablation.
    const unadjusted=[...rows].sort((a,b)=>(b.score-Number(b.features.proPublicAdjustment??0))-(a.score-Number(a.features.proPublicAdjustment??0))||proActionKey(a.action).localeCompare(proActionKey(b.action)))[0];
    diagnostics.controlAdjusted=!!unadjusted&&proActionKey(unadjusted.action)!==proActionKey(decision.action);
    const roots=selectProRoots(rows,new Map(batch.moves.map(play=>[play.key,play])),decision.action,preferred,work.rootCandidates);
    const forwardStart=now();
    const forward=runProForward(obs,sampled.worlds.slice(0,work.pilotSamples+work.refineSamples),
      sampled.worlds.slice(work.controlSamples,work.controlSamples+work.confirmationSamples),roots,decision.action,work);
    forwardMs=now()-forwardStart;diagnostics.forward=forward.diagnostics;
    if(forward.diagnostics.changedAction){
      diagnostics.method='adaptive-forward';
      decision={...decision,action:forward.action,reasonCodes:['PRO_ADAPTIVE_TEAM_FORWARD'],
        explanation:'用重视组合与配合的续策比较不同出法，对接近的方案追加推演，并由独立样本复核团队收益；这是估计，不是必胜证明。'};
    }
    const selected=rows.find(row=>proActionKey(row.action)===proActionKey(decision.action));
    decision={...decision,topCandidates:(selected?[selected,...rows.filter(row=>row!==selected)]:rows).slice(0,5)};
  }
  diagnostics.selectedActionKey=proActionKey(decision.action);
  if(publicProof){
    diagnostics.policyRevision=descriptor.implementationVersion;
    const row=decision.topCandidates.find(candidate=>proActionKey(candidate.action)===diagnostics.selectedActionKey);
    diagnostics.publicFinish={revision:BALANCED_PRO_PUBLIC_FINISH_REVISION,status:publicProof.status,reason:publicProof.reason,
      adopted:!!protectedRoute,certificate:publicProof.certificate,selectedRoute:protectedRoute??null,
      baseAction:result.decision.action,baseScope:'heuristic-proposal',selectedActionSource:protectedRoute?'public-result-certificate':'existing-policy',
      selectedHeuristicScore:row?.score??null,relayVetoReason:protectedRoute&&obs.remainingCounts[obs.partner]===1?'proven-team-result-before-unproven-relay':null,proofMs:publicProofMs};
  }
  const {attachmentDiagnostics:_attachment,...compact}=decision;
  return {decision:{...compact,configVersion:descriptor.configVersion,balancedProDiagnostics:diagnostics},candidateVersion:batch.stats.version,
    identity:{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{...descriptor.stamp,descriptorHash:descriptor.descriptorHash},fallbackVersion:descriptor.fallbackVersion},
    timing:{descriptorMs:0,candidateMs,knowledgeMs,plannerMs:result.plannerMs,scoringMs:null,searchMs:beforeProposalMs+forwardMs,tacticalMs,policyMs:now()-policyStart,computeMs:now()-started}};
}
