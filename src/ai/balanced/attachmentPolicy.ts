import {assessAttachmentControl, ATTACHMENT_CONTROL_CONFIG} from './attachmentControl';
import type {EndgameAnalysis} from '../endgame/types';
import {rankAiMoves} from '../evaluation';
import {rankStrength} from '../../engine/cards';
import {bombTier} from '../../engine/compare';
import {partnerOf,teamOf} from '../../engine/rules';
import type {Card,GameAction,ResolvedPlay,Rng,Seat} from '../../engine/types';
import type {AiObservation,AiCandidateDiagnostic} from '../types';
import type {StrategyDecision} from '../strategyTypes';
import type {CandidateBatch} from '../candidates/types';
import type {PublicKnowledge} from '../publicKnowledge';
import {typeControlUpperBound} from '../publicKnowledge';
import {BALANCED_CONFIG,type BalancedWorkBudget} from './config';
import {BALANCED_PLANNER_VERSION,planResidualHand,planLegacyCatalogForExperiment,rankCover,residualWildCount,summarizePartition,type BalancedPlan,type BalancedPlanningResult} from './planning';

const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const actionKey=(action:GameAction)=>action.type==='pass'?'~pass':action.playKey;
const explanations:Record<string,string>={
 PRESERVE_ATTACHMENT_CONTROL:'综合余牌与当前局面，避免把王对仅作为三带二附件消耗。',
 FINISH_MATCH:'这手可以出完，并按当前公开名次满足我方过 A 条件。',FINISH_HAND:'这手可以合法出完剩余手牌。',
 NO_LEGAL_RESPONSE:'当前没有能压过待压牌的合法组合。',ACCEPT_WIND:'你是最后的回应者，不出后将由你接风。',
 PARTNER_LEAD:'对家当前领先，综合余牌结构后建议保留手牌。',RELAY_SINGLE:'对家只剩一张，尝试领出较小单张接力；其牌面仍未知。',
 DENY_OPPONENT_WIND:'不出将给余牌很少的对手接风，这手争取领出权。',CONTEST_SHORT_OPPONENT:'对手余牌很少，权衡后争取本轮控制。',
 CONTEST_SECOND_PLACE:'对方已有头游，这手争取接手以改善我方名次。',CONTEST_THIRD_PLACE:'头游和二游已有归属，这手争取三游。',
 LIMIT_SHORT_REPLY:'这手普通牌的张数能限制短手对手直接同型出完。',FEWER_GROUPS:'按本次找到的可行分解，这手改善剩余牌组。',
 RETAIN_CONTROL:'剩余手牌保留了较完整的高牌或炸弹资源。',TYPE_CONTROL:'公开牌账本排除了对手更大的同类回应；仍须防范炸弹。',
 KEEP_CONTROL:'本次接牌需要耗费较重要的组合，建议暂时保留。',BALANCED_PLAN:'综合合法出法、残余结构与公开局面作出选择。',
};
export function chooseAttachmentBalancedAction(obs:AiObservation,batch:CandidateBatch,knowledge:PublicKnowledge,work:BalancedWorkBudget,configHash:string,rng:Rng,clock:()=>number=()=>0,experiment?:{legacyPlanner?:boolean;publicControl?:boolean},analysis?:EndgameAnalysis):{decision:StrategyDecision;plannerMs:number}{
 if(obs.isOver||obs.currentPlayer!==obs.player||!obs.hand.length)throw Error('策略只能为当前行动者决策');
 const config=BALANCED_CONFIG,stamp={sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,player:obs.player};
 const action=(play:ResolvedPlay):GameAction=>({...stamp,type:'play',cardIds:play.cards.map(card=>card.id),playKey:play.key});
 const pass:GameAction={...stamp,type:'pass'};
 const candidateDiagnostics={version:batch.stats.version,base:batch.stats.baseCandidates,added:batch.stats.addedCandidates,variantChecks:batch.stats.variantChecks,choiceNodes:batch.stats.choiceNodes,truncatedCandidates:batch.stats.truncatedCandidates};
 const knowledgeDiagnostics={version:knowledge.version,playedEntities:knowledge.played.length,knownHeldEntities:knowledge.knownHeld.length,unlocatedEntities:knowledge.unlocated.length,consistent:knowledge.consistent,futureEventsIgnored:knowledge.futureEventsIgnored,scoringEnabled:experiment?.publicControl!==false};
 const identity={policyVersion:'balanced-attachment-v1' as const,configVersion:ATTACHMENT_CONTROL_CONFIG.version,configHash,candidateDiagnostics,knowledgeDiagnostics};
 const finishers=batch.moves.filter(play=>play.size===obs.hand.length).sort((a,b)=>bombTier(b.kind,b.size)-bombTier(a.kind,a.size)||b.value-a.value||order(a.key,b.key));
 const earlyDiagnostics=(rows:AiCandidateDiagnostic[]):NonNullable<StrategyDecision['attachmentDiagnostics']>=>({version:ATTACHMENT_CONTROL_CONFIG.version,candidates:rows.map(row=>({action:row.action,selectedForPlanning:false,coarseScore:row.score,oldScore:row.score,score:row.score,cost:0,features:row.features,baseBreakdown:{}})),tiedActionKeys:rows.filter(row=>row.score===rows[0]!.score).map(row=>actionKey(row.action)),tieSample:null,scoringSelectedActionKey:actionKey(rows[0]!.action),selectedActionKey:actionKey(rows[0]!.action),selectionMethod:rows[0]!.action.type==='pass'?'no-legal-response':'single-hand-finish',rootCandidatesSkipped:0});
 if(finishers.length){
  const codes=obs.finishOutcome.passesAce&&obs.finishOutcome.winningTeam===obs.team?['FINISH_MATCH','FINISH_HAND']:['FINISH_HAND'];
  const rows:AiCandidateDiagnostic[]=finishers.map(play=>({action:action(play),score:100000,reasonCodes:codes,features:{...assessAttachmentControl(obs,play).features,oldBalancedScore:100000,attachmentControlCost:0,immediateFinish:true,finishesHand:true,nominalAdvance:obs.finishOutcome.nominalAdvance,passesAce:obs.finishOutcome.passesAce}}));
  return{plannerMs:0,decision:{...identity,action:rows[0]!.action,reasonCodes:codes,explanation:explanations[codes[0]!]!,topCandidates:rows.slice(0,5),attachmentDiagnostics:earlyDiagnostics(rows),stats:{nodes:0,subsetChecks:0,candidateCount:batch.moves.length,evaluatedCandidates:0,approximate:false,budgetExhausted:batch.stats.truncatedCandidates}}};
 }
 if(!batch.moves.length){
  if(!batch.legalPass)throw Error('空桌必须存在合法动作');
  const rows:AiCandidateDiagnostic[]=[{action:pass,score:0,reasonCodes:['NO_LEGAL_RESPONSE'],features:{legalResponses:0,oldBalancedScore:0,attachmentControlCost:0}}];
  return{plannerMs:0,decision:{...identity,action:pass,reasonCodes:['NO_LEGAL_RESPONSE'],explanation:explanations.NO_LEGAL_RESPONSE!,topCandidates:rows,attachmentDiagnostics:earlyDiagnostics(rows),stats:{nodes:0,subsetChecks:0,candidateCount:0,evaluatedCandidates:0,approximate:false,budgetExhausted:false}}};
 }
 const base=rankAiMoves(obs,batch.moves),cheapBefore=rankCover(obs);
 const cheapResult=(cards:readonly Card[]):BalancedPlanningResult=>({plans:[rankCover(obs,cards)],groupCountExact:false,secondaryExact:false,approximate:true,proof:'none',stats:{nodes:0,subsetChecks:0,catalogChecks:0,catalogGenerations:0,unvisitedBranches:0,nodeBudgetExhausted:false,subsetBudgetExhausted:false,catalogBudgetExhausted:false}});
 const plan=experiment?.legacyPlanner?planLegacyCatalogForExperiment:planResidualHand;
 const beforeStart=clock(),before=work.maxEvaluatedCandidates>0?plan(obs,obs.hand,work.planner):cheapResult(obs.hand);let plannerMs=clock()-beforeStart;
 const planCache=new Map<string,BalancedPlanningResult>();
 const plannerDiagnostics={version:experiment?.legacyPlanner?'legacy-root-catalog-ablation':BALANCED_PLANNER_VERSION,perCandidate:true,analyzed:work.maxEvaluatedCandidates>0?1:0,nodes:before.stats.nodes,subsetChecks:before.stats.subsetChecks,catalogChecks:before.stats.catalogChecks,unvisitedBranches:before.stats.unvisitedBranches,exactGroupCounts:before.groupCountExact?1:0,approximatePlans:before.groupCountExact?0:1,nodeBudgetExhausted:before.stats.nodeBudgetExhausted,subsetBudgetExhausted:before.stats.subsetBudgetExhausted,catalogBudgetExhausted:before.stats.catalogBudgetExhausted,rootCandidatesSkipped:0};
 const summarizePlan=(plan:BalancedPlan)=>-plan.groupCount*config.planningWeight-plan.weakSingles*config.weakSingleWeight+plan.controlResources*config.controlResourceWeight;
 const bestPlan=(result:BalancedPlanningResult)=>[...result.plans].sort((a,b)=>summarizePlan(b)-summarizePlan(a)||a.groupCount-b.groupCount)[0]!;
 const current=obs.currentPlay,partnerLeading=obs.currentOwner===obs.partner;
 const head=obs.finished[0],opposingSurvivor=head!==undefined&&teamOf(head)!==obs.team?partnerOf(head):null;
 const contestSecond=opposingSurvivor!==null&&!partnerLeading&&obs.currentOwner===opposingSurvivor&&obs.remainingCounts[opposingSurvivor]!>0&&obs.remainingCounts[opposingSurvivor]!<=5;
 const opponents=([0,1,2,3] as Seat[]).filter(seat=>teamOf(seat)!==obs.team&&obs.remainingCounts[seat]!>0),near=opponents.filter(seat=>obs.remainingCounts[seat]!<=3);
 const relevant=near.filter(seat=>!current||obs.pendingResponders.includes(seat)||obs.currentOwner===seat);
 const oneOpponent=near.some(seat=>obs.remainingCounts[seat]===1),sameShape=!!current&&current.size<=3&&relevant.some(seat=>obs.remainingCounts[seat]===current.size);
 const unbeatableTarget=!!current&&['single','pair'].includes(current.kind)&&current.value===rankStrength(16,obs.rules);
 const urgent=sameShape&&!unbeatableTarget,wind=obs.passOutcome;
 const acceptWind=!!current&&wind.endsRound&&wind.nextLeader===obs.player;
 const denyWind=!!current&&wind.endsRound&&wind.nextLeader!==null&&teamOf(wind.nextLeader)!==obs.team&&obs.remainingCounts[wind.nextLeader]!>0&&obs.remainingCounts[wind.nextLeader]!<=2;
 const controlCache=new Map<string,ReturnType<typeof typeControlUpperBound>>();
 const context=(play:ResolvedPlay)=>{
  const relay=!current&&obs.remainingCounts[obs.partner]===1&&!oneOpponent&&play.kind==='single'&&play.value<=10;
  const limitsShortReply=!current&&bombTier(play.kind,play.size)===0&&near.some(seat=>obs.remainingCounts[seat]!<4&&play.size>obs.remainingCounts[seat]!);
  const controlKey=`${play.kind}:${play.size}:${play.value}`;
  let control=controlCache.get(controlKey);if(!control){control=typeControlUpperBound(obs,knowledge,play);controlCache.set(controlKey,control);}
  const relayScore=relay?config.relayBonus-play.value*.4:0,pressure=urgent?config.urgentFollow+(play.kind===current?.kind?play.value*config.urgentRank:0):0;
  const windScore=denyWind?config.denyWind:acceptWind?-config.acceptWind:0,shortScore=limitsShortReply?config.shortOpponentLead:0,placement=contestSecond?config.opponentHeadPressure:0;
  const typeControl=experiment?.publicControl!==false&&control.assessed&&!control.higherSameTypePossible?config.provenTypeControlWeight:0;
  return{relay,limitsShortReply,control,score:relayScore+pressure+windScore+shortScore+placement+typeControl,relayScore,pressure,windScore,shortScore,placement,typeControl};
 };
 const coarse=base.map(row=>{
  const used=new Set(row.play.cards.map(card=>card.id)),remaining=obs.hand.filter(card=>!used.has(card.id)),cheap=rankCover(obs,remaining),situation=context(row.play);
  return{row,remaining,cheap,situation,score:row.score+summarizePlan(cheap)-summarizePlan(cheapBefore)+situation.score};
 }).sort((a,b)=>b.score-a.score||order(a.row.play.key,b.row.play.key));
 // Coarse evaluation is identical for every move. Each selected root gets the same independent
 // planner budget and same before-hand baseline; shared mutable catalogs never cross candidates.
 const frontier:typeof coarse=[],seenKinds=new Set<string>(),seenStructures=new Set<string>();
 const add=(item:typeof coarse[number])=>{
  const key=`${item.row.play.kind}:${item.row.play.size}:${item.row.play.value}:${item.remaining.map(card=>card.id).sort().join('|')}`;
  if(frontier.length>=Math.max(1,work.maxEvaluatedCandidates)||seenStructures.has(key))return;
  seenStructures.add(key);frontier.push(item);
 };
 for(const item of coarse)if(!seenKinds.has(item.row.play.kind)){seenKinds.add(item.row.play.kind);add(item);}
 for(const item of coarse)add(item);
 plannerDiagnostics.rootCandidatesSkipped=Math.max(0,coarse.length-(work.maxEvaluatedCandidates>0?frontier.length:0));
 const getPlan=(remaining:Card[])=>{
  const key=remaining.map(card=>card.id).sort().join('|');let result=planCache.get(key);
  if(!result){const start=clock();result=work.maxEvaluatedCandidates>0?plan(obs,remaining,work.planner):cheapResult(remaining);plannerMs+=clock()-start;planCache.set(key,result);plannerDiagnostics.analyzed+=work.maxEvaluatedCandidates>0?1:0;plannerDiagnostics.nodes+=result.stats.nodes;plannerDiagnostics.subsetChecks+=result.stats.subsetChecks;plannerDiagnostics.catalogChecks+=result.stats.catalogChecks;plannerDiagnostics.unvisitedBranches+=result.stats.unvisitedBranches;plannerDiagnostics.exactGroupCounts+=result.groupCountExact?1:0;plannerDiagnostics.approximatePlans+=result.groupCountExact?0:1;plannerDiagnostics.nodeBudgetExhausted ||= result.stats.nodeBudgetExhausted;plannerDiagnostics.subsetBudgetExhausted ||= result.stats.subsetBudgetExhausted;plannerDiagnostics.catalogBudgetExhausted ||= result.stats.catalogBudgetExhausted;}
  return result;
 };
 // First finish every independent residual query, then use one common feasible baseline.
 // A plan found through one action cannot grant only later actions an improved catalog/baseline.
 let beforePlan=bestPlan(before);
 for(const item of frontier)for(const plan of getPlan(item.remaining).plans){const cover=summarizePartition([item.row.play,...plan.groups],obs);if(summarizePlan(cover)>summarizePlan(beforePlan))beforePlan=cover;}
 // The frozen shortlist and planner are unchanged. Only finalist opportunity costs differ.
 const rows:AiCandidateDiagnostic[]=frontier.map(({row,remaining,cheap,situation})=>{
  const result=getPlan(remaining),after=bestPlan(result),planning=summarizePlan(after)-summarizePlan(beforePlan),reasons:string[]=[];
  if(denyWind)reasons.push('DENY_OPPONENT_WIND');if(urgent)reasons.push('CONTEST_SHORT_OPPONENT');if(contestSecond)reasons.push(obs.finished.length===1?'CONTEST_SECOND_PLACE':'CONTEST_THIRD_PLACE');
  if(situation.limitsShortReply)reasons.push('LIMIT_SHORT_REPLY');if(situation.relay)reasons.push('RELAY_SINGLE');
  if(situation.typeControl)reasons.push('TYPE_CONTROL');if(after.groupCount<beforePlan.groupCount)reasons.push('FEWER_GROUPS');if(after.controlResources>0)reasons.push('RETAIN_CONTROL');if(!reasons.length)reasons.push('BALANCED_PLAN');
  const assessed=assessAttachmentControl(obs,row.play);
  const certified=analysis?.certificate.status==='proved'&&analysis.certificate.eligibleOverride&&analysis.choices.some(choice=>choice.first.type==='play'&&choice.first.playKey===row.play.key);
  const attachmentControlCost=certified?0:assessed.cost,oldBalancedScore=row.score+planning+situation.score;
  return{action:action(row.play),score:oldBalancedScore-attachmentControlCost,reasonCodes:reasons,features:{...assessed.features,attachmentControlRawCost:assessed.cost,attachmentControlCost,attachmentControlApplied:attachmentControlCost>0,attachmentControlWaivedByProof:!!certified,attachmentControlReason:certified?'proved-two-play-finish':assessed.diagnostic.reason,attachmentMainRank:assessed.diagnostic.mainRank,attachmentMainCardIds:assessed.diagnostic.mainCardIds.join(','),attachmentPairRank:assessed.diagnostic.attachmentRank,attachmentPairCardIds:assessed.diagnostic.attachmentCardIds.join(','),oldBalancedScore,baseScore:row.score,planningScore:planning,commonFeasibleBaseline:true,groupsBefore:beforePlan.groupCount,groupsAfter:after.groupCount,minimumGroups:result.plans[0]!.groupCount,chosenPlanUsesMinimum:after.groupCount===result.plans[0]!.groupCount,weakSinglesAfter:after.weakSingles,controlResourcesAfter:after.controlResources,wildsRemaining:residualWildCount(remaining,obs),remainingCards:remaining.length,primaryMinimumGroupsExact:result.groupCountExact,secondaryExact:false,planAlternatives:result.plans.length,coarseGroups:cheap.groupCount,partnerLeading,partnerCards:obs.remainingCounts[obs.partner]!,relevantShortOpponents:relevant.length,relay:situation.relay,limitsShortReply:situation.limitsShortReply,higherSameTypePossible:situation.control.higherSameTypePossible,bombResponsePossible:situation.control.bombResponsePossible,publicControlAssessed:situation.control.assessed,controlScope:'same-type-opponents-only',secondarySearch:work.maxEvaluatedCandidates>0}};
 });
 if(batch.legalPass){let score=partnerLeading?config.partnerPass:0;if(acceptWind)score+=config.acceptWind;if(denyWind)score-=config.denyWind;if(partnerLeading&&urgent)score-=config.urgentFollow*.5;rows.push({action:pass,score,reasonCodes:[acceptWind?'ACCEPT_WIND':partnerLeading?'PARTNER_LEAD':'KEEP_CONTROL'],features:{partnerLeading,acceptWind,denyWind,secondarySearch:false}});}
 rows.sort((a,b)=>b.score-a.score||order(actionKey(a.action),actionKey(b.action)));
 const tied=rows.filter(row=>Math.abs(row.score-rows[0]!.score)<1e-6);let chosen=tied[0]!,tieSample:number|null=null;
 if(tied.length>1){const sample=rng();if(!Number.isFinite(sample)||sample<0||sample>=1)throw Error('策略随机源无效');tieSample=sample;chosen=tied[Math.floor(sample*tied.length)]!;}
 const bestOldScore=Math.max(...rows.map(row=>Number(row.features.oldBalancedScore??row.score)));
 if(Number(chosen.features.attachmentControlCost??0)===0&&rows.some(row=>Number(row.features.attachmentControlCost??0)>0&&Number(row.features.oldBalancedScore)===bestOldScore&&row!==chosen)&&Number(chosen.features.oldBalancedScore??chosen.score)<bestOldScore){chosen.reasonCodes=['PRESERVE_ATTACHMENT_CONTROL',...chosen.reasonCodes];}
 const approximate=plannerDiagnostics.approximatePlans>0||frontier.length<coarse.length||batch.stats.truncatedCandidates;
 const diagnosticRows=new Map(rows.map(row=>[actionKey(row.action),row]));
 const candidates=coarse.map(item=>{const key=item.row.play.key,row=diagnosticRows.get(key);return{action:action(item.row.play),selectedForPlanning:!!row,coarseScore:item.score,oldScore:row?.features.oldBalancedScore as number|undefined??null,score:row?.score??null,cost:row?.features.attachmentControlCost as number|undefined??null,features:row?.features??{baseScore:item.row.score,coarseGroups:item.cheap.groupCount},baseBreakdown:{...item.row.breakdown}};});
 if(batch.legalPass){const row=diagnosticRows.get('~pass')!;candidates.push({action:pass,selectedForPlanning:true,coarseScore:row.score,oldScore:row.score,score:row.score,cost:0,features:{...row.features,oldBalancedScore:row.score,attachmentControlCost:0},baseBreakdown:{}});}
 return{plannerMs,decision:{...identity,attachmentDiagnostics:{version:ATTACHMENT_CONTROL_CONFIG.version,candidates,tiedActionKeys:tied.map(row=>actionKey(row.action)),tieSample,scoringSelectedActionKey:actionKey(chosen.action),selectedActionKey:actionKey(chosen.action),selectionMethod:'score',rootCandidatesSkipped:plannerDiagnostics.rootCandidatesSkipped},action:chosen.action,reasonCodes:chosen.reasonCodes,explanation:chosen.reasonCodes.map(code=>explanations[code]).find(Boolean)??explanations.BALANCED_PLAN!,topCandidates:[chosen,...rows.filter(row=>row!==chosen)].slice(0,5),plannerDiagnostics,
  stats:{nodes:plannerDiagnostics.nodes,subsetChecks:plannerDiagnostics.subsetChecks,candidateCount:batch.moves.length,evaluatedCandidates:work.maxEvaluatedCandidates>0?frontier.length:0,approximate,budgetExhausted:approximate,...(approximate?{fallbackReason:'bounded-planning: feasible independent residual plans retained'}:{})}}};
}
