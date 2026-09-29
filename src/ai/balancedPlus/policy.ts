import type { ResolvedPlay, Rng } from '../../engine/types';
import type { AiObservation, AiCandidateDiagnostic } from '../types';
import type { StrategyComputation, StrategyDescriptor } from '../strategyTypes';
import { getStrategicCandidates } from '../candidates/strategic';
import { buildPublicKnowledge } from '../publicKnowledge';
import { chooseAttachmentBalancedAction } from '../balanced/attachmentPolicy';
import { BALANCED_PLUS_CONFIG, type BalancedPlusWorkBudget } from './config';
import {solveBalancedPlusEndgame} from './endgame';
import {sampleBalancedPlusWorlds} from './sampling';
import {createSampleControl} from './control';
import {plusActionKey,runPlusForward} from './forward';
import type {BalancedPlusDiagnostics} from './diagnostics';
import {ownAiInput} from '../input';

export function computeBalancedPlus(obs:AiObservation, descriptor:StrategyDescriptor, rng:Rng, now:()=>number, sharedPool?:ResolvedPlay[]):StrategyComputation {
  obs=ownAiInput(obs);
  const started=now(),work=descriptor.workBudget as BalancedPlusWorkBudget;
  const knowledge=buildPublicKnowledge(obs),knowledgeMs=now()-started,candidateStart=now();
  const batch=sharedPool?{moves:sharedPool,legalPass:!!obs.currentPlay,stats:{version:'experimental-common-pool',baseCandidates:sharedPool.length,addedCandidates:0,variantChecks:0,choiceNodes:0,truncatedCandidates:false,allPhysicalPlaysEnumerated:false as const}}:getStrategicCandidates(obs,work.base.candidates);
  const candidateMs=now()-candidateStart,policyStart=now();
  const result=chooseAttachmentBalancedAction(obs,batch,knowledge,work.base,descriptor.stamp.configHash,rng,now);
  let decision={...result.decision,policyVersion:'balanced-plus-v1' as const,configVersion:BALANCED_PLUS_CONFIG.version};
  const diagnostics:BalancedPlusDiagnostics={version:'balanced-plus-diagnostics-v1',objective:BALANCED_PLUS_CONFIG.objective,
    method:'heuristic',sampledWorlds:0,samplingReason:null,publicHistoryReplays:0,baseActionKey:plusActionKey(decision.action),selectedActionKey:plusActionKey(decision.action),controlAdjusted:false,
    forward:{attempted:false,changedAction:false,reason:'not-needed',transitions:0,completed:0,roots:0,selectionGain:null,confirmationGain:null,estimateOnly:true},
    endgame:{status:'not-applicable',method:'none',nodes:0,reason:'ordinary-turn',exact:false}};
  let searchMs=0,tacticalMs=0;
  if(decision.reasonCodes.includes('FINISH_HAND')||!batch.moves.length){
    diagnostics.method='immediate';
  }else{
    const proofStart=now(),proof=solveBalancedPlusEndgame(obs,work.endgame);tacticalMs=now()-proofStart;
    diagnostics.endgame={status:proof.certificate.status,method:proof.certificate.method,nodes:proof.certificate.nodes,reason:proof.certificate.reason,exact:proof.certificate.status==='exact'};
    decision.tacticalCertificate=proof.tactical.certificate;
    if(proof.action){
      diagnostics.method='public-exact';
      decision={...decision,action:proof.action,reasonCodes:['PLUS_PROVED_ENDGAME'],explanation:'根据完整公开牌账算清后续回应，这条残局路线可改善本副实际升级或过 A 结果。'};
    }else{
      const searchStart=now(),sample=rng();
      if(!Number.isFinite(sample)||sample<0||sample>=1)throw Error('均衡 Plus 随机源无效');
      const sampled=sampleBalancedPlusWorlds(obs,work.samples,Math.floor(sample*0x100000000));
      diagnostics.sampledWorlds=sampled.worlds.length;diagnostics.samplingReason=sampled.diagnostics.reason;diagnostics.publicHistoryReplays=sampled.diagnostics.publicHistoryReplays;
      if(sampled.worlds.length){
        const controlWorlds=sampled.worlds.slice(0,work.controlSamples);
        const assess=createSampleControl(obs,controlWorlds),plays=new Map(batch.moves.map(play=>[play.key,play]));
        const rows:AiCandidateDiagnostic[]=(decision.attachmentDiagnostics?.candidates??[]).filter(row=>row.score!==null).map(row=>{
          const play=row.action.type==='play'?plays.get(row.action.playKey)??null:null;
          const risk=assess(row.action,play);
          const remaining=obs.hand.length-(play?.size??0);
          const controlWeight=obs.currentPlay?BALANCED_PLUS_CONFIG.followControlWeight:BALANCED_PLUS_CONFIG.leadControlWeight;
          const controlBonus=risk.secure*controlWeight*(remaining<=8?1:.35);
          const teamBonus=-risk.opponentFinish*BALANCED_PLUS_CONFIG.opponentFinishWeight+risk.partnerFinish*BALANCED_PLUS_CONFIG.partnerFinishWeight;
          const adjustment=controlBonus+teamBonus;
          return{action:row.action,score:row.score!+adjustment,reasonCodes:['PLUS_PUBLIC_CONTROL'],features:{...row.features,plusBaseScore:row.score!,plusAdjustment:adjustment,
            sampledControl: risk.secure,sampledOpponentFinish:risk.opponentFinish,sampledPartnerFinish:risk.partnerFinish,sampledWorlds:controlWorlds.length}};
        }).sort((a,b)=>b.score-a.score||plusActionKey(a.action).localeCompare(plusActionKey(b.action)));
        if(rows.length){
          const chosen=rows[0];diagnostics.controlAdjusted=plusActionKey(chosen.action)!==plusActionKey(decision.action);
          decision={...decision,action:chosen.action,reasonCodes:chosen.reasonCodes,explanation:'结合公开记牌估计被压和双方收尾的可能性，再权衡余牌与出牌权。',topCandidates:rows.slice(0,5)};
          // Keep a pass alternative and the original decision in the forward pool.
          const pass=rows.find(row=>row.action.type==='pass');
          const original=rows.find(row=>plusActionKey(row.action)===diagnostics.baseActionKey);
          const roots=[chosen.action,...(original?[original.action]:[]),...(pass?[pass.action]:[]),...rows.map(row=>row.action)];
          // Confirmation allocations never participate in heuristic adjustment,
          // base/root selection or the first simulation batch.
          const forwardWorlds=[...sampled.worlds.slice(0,work.rolloutSamples),...sampled.worlds.slice(work.controlSamples,work.controlSamples+work.rolloutSamples)];
          const forward=runPlusForward(obs,forwardWorlds,roots,chosen.action,work);
          diagnostics.forward=forward.diagnostics;
          if(forward.diagnostics.changedAction){
            diagnostics.method='sampled-forward';
            decision={...decision,action:forward.action,reasonCodes:['PLUS_TEAM_FORWARD'],explanation:'比较多种符合公开记录的后续牌局，这手在独立复核样本中更有利于我方收尾；这是估计，不是必胜证明。'};
          }
        }
      }
      searchMs=now()-searchStart;
    }
  }
  diagnostics.selectedActionKey=plusActionKey(decision.action);
  // Keep only compact Plus diagnostics; inherited attachment audit scores describe
  // the proposal stage and must not masquerade as the final search ranking.
  const {attachmentDiagnostics:_attachment,...compact}=decision;
  decision={...compact,plusDiagnostics:diagnostics};
  return {decision,candidateVersion:batch.stats.version,
    identity:{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{...descriptor.stamp,descriptorHash:descriptor.descriptorHash},fallbackVersion:descriptor.fallbackVersion},
    timing:{descriptorMs:0,candidateMs,knowledgeMs,plannerMs:result.plannerMs,scoringMs:null,searchMs,tacticalMs,policyMs:now()-policyStart,computeMs:now()-started}};
}
