import {getLegalMoves} from '../engine/legalMoves';
import type {Rng} from '../engine/types';
import type {AiObservation} from './types';
import {resolveStrategy} from './descriptors';
import {computeStrategy,normalIdentity} from './strategies';
import {getStrategicCandidates} from './candidates/strategic';
import {buildPublicKnowledge} from './publicKnowledge';
import {chooseBalancedAction} from './balanced/policy';
import type {BalancedWorkBudget} from './balanced/config';
import type {StrategyDescriptor,StrategyComputation} from './strategyTypes';
export type ComponentAblation='legacy-root-candidates'|'legacy-planner'|'no-knowledge-control';
/** Isolated research entry, never imported by the game/Worker. Its effective identity is not a production stamp. */
export function computeComponentAblation(obs:AiObservation,identity:StrategyDescriptor,rng:Rng,variant:ComponentAblation,now:()=>number=()=>0):StrategyComputation{
 const descriptor=resolveStrategy(identity);if(descriptor.id!=='balanced-v1')return computeStrategy(obs,descriptor,rng,now);
 const started=now(),knowledge=buildPublicKnowledge(obs),knowledgeMs=now()-started,work=descriptor.workBudget as BalancedWorkBudget,at=now();
 const batch=variant==='legacy-root-candidates'?{moves:getLegalMoves(obs),legalPass:!!obs.currentPlay,stats:{version:'legacy-physical-representatives-v1',baseCandidates:0,addedCandidates:0,variantChecks:0,choiceNodes:0,truncatedCandidates:false,allPhysicalPlaysEnumerated:false as const}}:getStrategicCandidates(obs,work.candidates);
 if(variant==='legacy-root-candidates')batch.stats.baseCandidates=batch.moves.length;
 const candidateMs=now()-at,decisionStart=now(),configHash=descriptor.stamp.configHash+':'+variant;
 const result=chooseBalancedAction(obs,batch,knowledge,work,configHash,rng,now,{legacyPlanner:variant==='legacy-planner',publicControl:variant!=='no-knowledge-control'}),identityResult=normalIdentity(descriptor);
 identityResult.effective={id:descriptor.id,version:descriptor.implementationVersion+':'+variant,configHash,descriptorHash:descriptor.descriptorHash+':'+variant};
 return{decision:result.decision,candidateVersion:batch.stats.version,identity:identityResult,timing:{descriptorMs:0,candidateMs,knowledgeMs,plannerMs:result.plannerMs,scoringMs:Math.max(0,now()-decisionStart-result.plannerMs),policyMs:now()-decisionStart,computeMs:now()-started}};
}
