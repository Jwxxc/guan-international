import {createDeck} from '../../engine/cards';
import {canBeat} from '../../engine/compare';
import {getLegalMoves} from '../../engine/legalMoves';
import {resolvePlays} from '../../engine/patterns';
import {applyAction,getResult} from '../../engine/reducer';
import {partnerOf,teamOf} from '../../engine/rules';
import {createMatchProgress,settleMatchProgress} from '../../match/progression';
import type {Card,GameAction,GameState,ResolvedPlay,Seat} from '../../engine/types';
import type {AiObservation} from '../types';
import {ENDGAME_PROOF_BUDGET,ENDGAME_TACTICAL_VERSION} from './config';
import type {EndgameAnalysis,EndgameOutcome,EndgameProofBudget,TacticalCertificate} from './types';

const seats:Seat[]=[0,1,2,3];
const face=(card:Pick<Card,'suit'|'rank'>)=>`${card.suit}:${card.rank}`;
const faces=[...new Map(createDeck().map(card=>[face(card),{suit:card.suit,rank:card.rank}])).values()];
const faceKeys=new Set(faces.map(face));
const sameSeats=(a:readonly Seat[],b:readonly Seat[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const samePlay=(a:ResolvedPlay|null,b:ResolvedPlay|null)=>a===null||b===null?a===b:a.key===b.key&&a.kind===b.kind&&a.value===b.value&&a.size===b.size
 &&a.cards.length===b.cards.length&&a.cards.every(card=>b.cards.some(other=>card.id===other.id&&face(card)===face(other)))
 &&a.wildcards.length===b.wildcards.length&&a.wildcards.every(w=>b.wildcards.some(other=>other.cardId===w.cardId&&other.rank===w.rank&&other.suit===w.suit));
const makeAction=(state:GameState,play:ResolvedPlay):GameAction=>({sessionId:state.sessionId,handId:state.handId,stateVersion:state.stateVersion,player:state.currentPlayer,type:'play',cardIds:play.cards.map(card=>card.id),playKey:play.key});

/** Builds a counterfactual engine model entirely from observed faces, not hidden ownership.
 * Opponent IDs are local placeholders. Neither deck labels nor unobserved physical IDs
 * determine its face multiset. The model and inferred hand never leave this module. */
function publicModel(obs:AiObservation,opponent:Seat,certificate:TacticalCertificate):GameState|null{
 if(!Number.isInteger(obs.stateVersion)||obs.stateVersion<1||obs.history.length!==obs.stateVersion)return null;
 const seen=new Set<string>(),usedFaces=new Map<string,number>(),playedBySeat:Card[][]=seats.map(()=>[]);
 const inspect=(card:Card)=>{
  if(!card||typeof card.id!=='string'||!card.id.length||seen.has(card.id)||!faceKeys.has(face(card)))return false;
  seen.add(card.id);const key=face(card),count=(usedFaces.get(key)??0)+1;usedFaces.set(key,count);return count<=2;
 };
 for(const card of obs.hand)if(!inspect(card))return null;
 for(let index=0;index<obs.history.length;index++){
  const event=obs.history[index]!;
  if(event.index!==index||!seats.includes(event.player)||!['play','pass'].includes(event.type))return null;
  if(event.type==='pass'){if(event.play)return null;continue;}
  if(!event.play||!event.play.cards.length||event.play.cards.length>10)return null;
  for(const card of event.play.cards){if(!inspect(card))return null;playedBySeat[event.player]!.push({...card});}
 }
 // Public exchanges conserve 27 per seat before the first ordinary action. No pending
 // exchange choices or server state are used to complete missing public histories.
 if(seats.some(seat=>playedBySeat[seat]!.length+obs.remainingCounts[seat]!==27))return null;
 const inferred:Card[]=[];
 for(const item of faces)for(let copy=usedFaces.get(face(item))??0;copy<2;copy++){
  let id=`proof-only:${item.suit}:${item.rank}:${copy}`;while(seen.has(id))id+=':';seen.add(id);
  inferred.push({id,deck:copy,suit:item.suit,rank:item.rank});
 }
 if(inferred.length!==obs.remainingCounts[opponent])return null;
 const initialHands=playedBySeat.map((cards,seat)=>[...cards,...(seat===obs.player?obs.hand:seat===opponent?inferred:[])]);
 if(initialHands.some(hand=>hand.length!==27))return null;
 const firstPlayer=obs.history[0]!.player;
 let model:GameState={sessionId:obs.sessionId,handId:obs.handId,stateVersion:0,rules:{...obs.rules},hands:initialHands,currentPlayer:firstPlayer,firstPlayer,currentPlay:null,currentOwner:null,pendingResponders:[],finished:[],played:[],events:[],result:null};
 for(const event of obs.history){
  const stamp={sessionId:obs.sessionId,handId:obs.handId,stateVersion:model.stateVersion,player:event.player};
  const action:GameAction=event.type==='pass'?{...stamp,type:'pass'}:{...stamp,type:'play',cardIds:event.play!.cards.map(card=>card.id),playKey:event.play!.key};
  const moved=applyAction(model,action);certificate.work.historySteps++;
  if(!moved.ok)return null;
  model=moved.state;const accepted=model.events.at(-1)!;
  if(accepted.roundEnded!==event.roundEnded||accepted.nextPlayer!==event.nextPlayer||accepted.finished!==event.finished||!samePlay(accepted.play??null,event.play??null))return null;
 }
 if(model.result||model.currentPlayer!==obs.currentPlayer||model.currentOwner!==obs.currentOwner||!samePlay(model.currentPlay,obs.currentPlay)
  ||!sameSeats(model.finished,obs.finished)||!sameSeats(model.pendingResponders,obs.pendingResponders)||seats.some(seat=>model.hands[seat]!.length!==obs.remainingCounts[seat]))return null;
 if(model.hands[obs.player]!.length!==obs.hand.length||model.hands[obs.player]!.some(card=>!obs.hand.some(own=>own.id===card.id&&face(own)===face(card))))return null;
 return model;
}
function outcome(obs:AiObservation,model:GameState,third:Seat):EndgameOutcome|null{
 const context=obs.matchContext;
 if(!context||obs.mode==='practice')return null;
 const result=getResult([...obs.finished,third]);if(!result)return null;
 const progress={...createMatchProgress(obs.mode==='classic'?'guan-classic-house-v1':'guan-match-v1'),teamLevels:[...context.teamLevels] as [number,number],activeTeam:context.levelOwnerTeamId,handNumber:context.handNumber};
 const settled=settleMatchProgress(progress,{...model,result});if(!settled.ok||!settled.progress.lastAdvance)return null;
 const advance=settled.progress.lastAdvance,head=result.order[0]!,last=result.last!;
 return{place:third===obs.player?3:4,winningTeam:result.winningTeam,order:[...result.order],nominalAdvance:advance.steps,actualAdvance:advance.to-advance.from,
  teamLevelsBefore:[...context.teamLevels],teamLevelsAfter:[...settled.progress.teamLevels],passesAce:advance.passedAce,matchWinner:settled.progress.winner,
  nextExchange:settled.progress.winner!==null?null:{kind:'single',tributeFrom:last,tributeTo:head,returnFrom:head,returnTo:last,firstLeaderIfNoAnti:last,firstLeaderIfAnti:head}};
}
function benefit(own:EndgameOutcome,other:EndgameOutcome,team:0|1):TacticalCertificate['benefit']{
 if(own.matchWinner===team&&other.matchWinner!==team)return'own-passed-ace';
 if(other.matchWinner!==null&&other.matchWinner!==team&&own.matchWinner!==other.matchWinner)return'opponent-pass-ace-denied';
 if(own.matchWinner!==other.matchWinner)return'placement-only-no-actual-benefit';
 const opposing=team===0?1:0;
 if(own.teamLevelsAfter[team]>other.teamLevelsAfter[team]&&own.teamLevelsAfter[opposing]<=other.teamLevelsAfter[opposing])return'more-own-advance';
 if(own.teamLevelsAfter[opposing]<other.teamLevelsAfter[opposing]&&own.teamLevelsAfter[team]>=other.teamLevelsAfter[team])return'less-opponent-advance';
 // Rank and the next tribute donor alone do not define a strict whole-match ordering.
 return'placement-only-no-actual-benefit';
}

/** A sufficient, bounded certificate, not an endgame solver or a win-probability model. */
export function proveTwoPlayEndgame(obs:AiObservation,budget:EndgameProofBudget=ENDGAME_PROOF_BUDGET):EndgameAnalysis{
 const certificate:TacticalCertificate={status:'not-applicable',certificateScope:'two-active-players',version:ENDGAME_TACTICAL_VERSION,reason:'outside-two-player-scope',eligibleOverride:false,
  proofWorkBudget:{...budget},work:{historySteps:0,firstCandidates:0,replySubsets:0,replyInterpretations:0,replyComparisons:0,pathTransitions:0},checkedReplyCount:0};
 const analysis:EndgameAnalysis={certificate,choices:[]};
 const finish=(status:TacticalCertificate['status'],reason:string)=>{certificate.status=status;certificate.reason=reason;return analysis;};
 if(Object.values(budget).some(value=>!Number.isInteger(value)||value<0||value>4096))throw Error('残局证明预算无效');
 if(obs.isOver||obs.currentPlayer!==obs.player||!seats.includes(obs.player)||obs.team!==teamOf(obs.player)||obs.partner!==partnerOf(obs.player)||!obs.matchContext||!['classic','legacy'].includes(obs.mode))return analysis;
 if(obs.rules.version!=='guan-practice-v1'||!Number.isInteger(obs.rules.levelRank)||obs.rules.levelRank<2||obs.rules.levelRank>14)return finish('not-proved','invalid-rules');
 if(obs.remainingCounts.length!==4||obs.remainingCounts.some(n=>!Number.isInteger(n)||n<0||n>27)||obs.remainingCounts[obs.player]!==obs.hand.length)return finish('not-proved','invalid-public-counts');
 const active=seats.filter(seat=>obs.remainingCounts[seat]!>0),finished=obs.finished;
 if(active.length!==2||!active.includes(obs.player)||teamOf(active[0]!)===teamOf(active[1]!)||finished.length!==2||new Set(finished).size!==2||finished.some(seat=>!seats.includes(seat)||active.includes(seat))||teamOf(finished[0]!)===teamOf(finished[1]!))return analysis;
 const opponent=active.find(seat=>seat!==obs.player)!;certificate.forcedResponder=opponent;
 // Existing immediate finish remains above this optional two-play layer.
 if(obs.hand.length<=10&&resolvePlays(obs.hand,obs.rules).some(play=>canBeat(play,obs.currentPlay,obs.rules)))return finish('not-applicable','single-hand-finish-priority');
 if(obs.hand.length>Math.min(12,budget.maxOwnCards)||obs.remainingCounts[opponent]!>Math.min(8,budget.maxOpponentCards)||obs.history.length>Math.min(512,budget.maxHistoryEvents))return finish('budget-exhausted','proof-size-or-history-budget');
 let model:GameState|null;
 try{model=publicModel(obs,opponent,certificate);}catch{return finish('not-proved','invalid-public-history');}
 if(!model)return finish('not-proved','incomplete-or-inconsistent-public-history');
 const selfThird=outcome(obs,model,obs.player),opponentThird=outcome(obs,model,opponent);
 if(!selfThird||!opponentThird)return finish('not-proved','invalid-public-match-context');
 certificate.selfThirdOutcome=selfThird;certificate.opponentThirdOutcome=opponentThird;certificate.benefit=benefit(selfThird,opponentThird,obs.team);certificate.orderingScope='current-hand-actual-progress-and-pass-A';
 const opponentCards=model.hands[opponent]!,totalSubsets=(1<<opponentCards.length)-1;
 if(totalSubsets>budget.maxReplySubsets)return finish('budget-exhausted','reply-subset-budget');
 const replies:ResolvedPlay[]=[];
 for(let mask=1;mask<=totalSubsets;mask++){
  const cards=opponentCards.filter((_,index)=>mask&(1<<index));const parsed=resolvePlays(cards,obs.rules);replies.push(...parsed);certificate.work.replySubsets++;certificate.work.replyInterpretations+=parsed.length;
 }
 const candidates=getLegalMoves(obs);
 let exhausted=false;
 for(const first of candidates){
  if(certificate.work.firstCandidates>=Math.min(128,budget.maxFirstCandidates)){exhausted=true;break;}certificate.work.firstCandidates++;
  const used=new Set(first.cards.map(card=>card.id)),remaining=obs.hand.filter(card=>!used.has(card.id));if(!remaining.length||remaining.length>10)continue;
  const finishing=resolvePlays(remaining,obs.rules);if(!finishing.length)continue;
  let beatable=false;
  for(const reply of replies){certificate.work.replyComparisons++;if(canBeat(reply,first,obs.rules)){beatable=true;break;}}
  if(beatable)continue;
  const firstAction=makeAction(model,first),played=applyAction(model,firstAction);certificate.work.pathTransitions++;
  if(!played.ok||played.state.result||played.state.currentPlayer!==opponent||!sameSeats(played.state.pendingResponders,[opponent]))continue;
  const forcedPass:GameAction={sessionId:obs.sessionId,handId:obs.handId,stateVersion:played.state.stateVersion,player:opponent,type:'pass'},passed=applyAction(played.state,forcedPass);certificate.work.pathTransitions++;
  if(!passed.ok||passed.state.result||passed.state.currentPlay!==null||passed.state.currentOwner!==null||passed.state.currentPlayer!==obs.player)continue;
  const finishAction=makeAction(passed.state,finishing[0]!),ended=applyAction(passed.state,finishAction);certificate.work.pathTransitions++;
  if(!ended.ok||!ended.state.result||!sameSeats(ended.state.result.order,selfThird.order)||ended.state.result.winningTeam!==selfThird.winningTeam)continue;
  analysis.choices.push({first:firstAction,forcedPass,finish:finishAction});
 }
 certificate.checkedReplyCount=replies.length;
 if(!analysis.choices.length)return finish(exhausted?'budget-exhausted':'not-proved',exhausted?'first-candidate-budget':'no-certified-two-play-route');
 certificate.expectedPlace=3;certificate.expectedWinningTeam=selfThird.winningTeam;certificate.nominalAdvance=selfThird.nominalAdvance;certificate.actualAdvance=selfThird.actualAdvance;
 certificate.eligibleOverride=certificate.benefit!=='placement-only-no-actual-benefit';
 return finish('proved',certificate.eligibleOverride?'unbeatable-lead-then-one-hand-finish':'placement-only-no-actual-benefit');
}
