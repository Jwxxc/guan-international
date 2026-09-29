import {createDeck} from '../../engine/cards';
import {canBeat} from '../../engine/compare';
import {getLegalMoves} from '../../engine/legalMoves';
import {getPlayTemplates, resolvePlays} from '../../engine/patterns';
import {applyAction} from '../../engine/reducer';
import {partnerOf, teamOf} from '../../engine/rules';
import {createMatchProgress, settleMatchProgress} from '../../match/progression';
import type {Card, GameAction, GameState, ResolvedPlay, RuleConfig, Seat} from '../../engine/types';
import {fingerprint} from '../fingerprint';
import type {AiObservation} from '../types';

export const PUBLIC_FINISH_VERSION = 'balanced-pro-public-head-finish-v1';
export interface PublicFinishBudget {maxOwnCards:number;maxHistoryEvents:number;maxCandidateSubsets:number;maxResponseChecks:number;maxReplyTemplates:number}
export const PUBLIC_FINISH_BUDGET:Readonly<PublicFinishBudget> = Object.freeze({maxOwnCards:10,maxHistoryEvents:512,maxCandidateSubsets:1023,maxResponseChecks:96,maxReplyTemplates:1024});
export interface PooledResponseCheck {
  status:'PROVEN_UNBEATABLE'|'POSSIBLE_RESPONSE'|'UNKNOWN';reason:string;complete:boolean;templatesChecked:number;witness:ResolvedPlay|null;
}
export interface PublicFinishChoice {first:GameAction;passes:GameAction[];finish:GameAction|null;firstPlay:ResolvedPlay;remainingPlay:ResolvedPlay|null}
export interface PublicFinishCertificate {
  version:typeof PUBLIC_FINISH_VERSION;status:'PROVEN'|'NOT_PROVEN'|'UNKNOWN'|'NOT_APPLICABLE';reason:string;
  sessionId:string;handId:string;stateVersion:number;rules:RuleConfig;mode:AiObservation['mode'];publicInputFingerprint:string;
  method:'none'|'direct-finish'|'unbeatable-two-play';historyReplayVerified:boolean;responseChecksComplete:boolean;candidateSelectionComplete:boolean;eligibleOverride:boolean;
  assumptions:string[];guarantee:null|{place:1|2;winningTeam:0|1;doubleUp:boolean|null;actualAdvance:number|null;passesAce:boolean|null};
  work:{historySteps:number;candidateSubsets:number;responseChecks:number;replyTemplates:number;pathTransitions:number};
}
export interface PublicFinishAnalysis {status:PublicFinishCertificate['status'];reason:string;choices:PublicFinishChoice[];certificate:PublicFinishCertificate}
const seats:Seat[]=[0,1,2,3];
const face=(card:Card)=>`${card.suit}:${card.rank}`;
const deck=createDeck();
const faceSet=new Set(deck.map(face));
const sameSeats=(a:readonly Seat[],b:readonly Seat[])=>a.length===b.length&&a.every((seat,index)=>seat===b[index]);
const sameCard=(a:Card,b:Card)=>a.id===b.id&&face(a)===face(b);
const samePlay=(a:ResolvedPlay|null,b:ResolvedPlay|null)=>a===null||b===null?a===b:a.key===b.key&&a.kind===b.kind&&a.size===b.size&&a.value===b.value
  &&a.cards.length===b.cards.length&&a.cards.every(card=>b.cards.some(other=>sameCard(card,other)))
  &&a.wildcards.length===b.wildcards.length&&a.wildcards.every(w=>b.wildcards.some(other=>other.cardId===w.cardId&&other.rank===w.rank&&other.suit===w.suit));
const stamp=(state:GameState)=>({sessionId:state.sessionId,handId:state.handId,stateVersion:state.stateVersion,player:state.currentPlayer});
const playAction=(state:GameState,play:ResolvedPlay):GameAction=>({...stamp(state),type:'play',cardIds:play.cards.map(card=>card.id),playKey:play.key});

/** Cheap public binding for asynchronous receiver checks; this does not rerun proof. */
export function publicFinishInputFingerprint(obs:AiObservation):string {
  return fingerprint({version:PUBLIC_FINISH_VERSION,sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,mode:obs.mode,rules:obs.rules,
    hand:obs.hand,played:obs.publicCardLedger?.playedCards??obs.history.flatMap(event=>event.play?.cards??[]),remainingCounts:obs.remainingCounts,
    currentPlay:obs.currentPlay,currentOwner:obs.currentOwner,currentPlayer:obs.currentPlayer,pendingResponders:obs.pendingResponders,
    finished:obs.finished,matchContext:obs.matchContext,publicTransfers:obs.publicTransfers,antiTributeEvidence:obs.antiTributeEvidence,
    publicHistoryInvalid:obs.publicHistoryInvalid??false,ledgerSource:obs.publicCardLedger?.source??'public-history',ledgerVersion:obs.publicCardLedger?.stateVersion??obs.stateVersion});
}

/** Existence, not candidate ranking: every rank/count/suit template is examined by
 * the frozen legal-move generator. One physical realization per template suffices
 * to witness a response. No sampling, rank-only hand set, or Top-K enters this check.
 * The full finite scan is reserved before starting; an insufficient budget is UNKNOWN. */
export function checkPooledResponse(pool:Card[],target:ResolvedPlay,rules:RuleConfig,limits:{maxTemplates?:number}={}):PooledResponseCheck {
  const needed=getPlayTemplates().length+pool.length;
  const maxTemplates=limits.maxTemplates??PUBLIC_FINISH_BUDGET.maxReplyTemplates;
  const unknown=(reason:string):PooledResponseCheck=>({status:'UNKNOWN',reason,complete:false,templatesChecked:0,witness:null});
  if(!Number.isSafeInteger(maxTemplates)||maxTemplates<0||rules.version!=='guan-practice-v1'||!Number.isInteger(rules.levelRank)||rules.levelRank<2||rules.levelRank>14)return unknown('invalid-rules-or-budget');
  const used=new Set<string>(),counts=new Map<string,number>();
  for(const card of pool){
    if(!card||typeof card.id!=='string'||!card.id||used.has(card.id)||!faceSet.has(face(card)))return unknown('invalid-pooled-card-ledger');
    used.add(card.id);const count=(counts.get(face(card))??0)+1;counts.set(face(card),count);if(count>2)return unknown('invalid-pooled-card-ledger');
  }
  if(!resolvePlays(target.cards,rules).some(play=>samePlay(play,target)))return unknown('invalid-target-interpretation');
  if(maxTemplates<needed)return unknown('reply-template-budget');
  const moves=getLegalMoves({sessionId:'public-pool',handId:'public-pool',stateVersion:0,player:0,team:0,hand:pool,rules,
    remainingCounts:[pool.length,0,0,0],currentPlayer:0,currentPlay:target,currentOwner:1,finished:[],history:[],isOver:false});
  const witness=moves[0]??null;
  return{status:witness?'POSSIBLE_RESPONSE':'PROVEN_UNBEATABLE',reason:witness?'pooled-legal-response-exists':'all-response-templates-checked',complete:true,templatesChecked:needed,witness};
}

/** This module never imports authoritative GameState or hidden hands from callers.
 * Synthetic ownership only lets the existing reducer verify public turn transitions;
 * the stronger pooled-hand test is what proves every actual player cannot respond. */
export function provePublicFinish(obs:AiObservation,limits:Partial<PublicFinishBudget>={}):PublicFinishAnalysis {
  const budget={...PUBLIC_FINISH_BUDGET,...limits};
  const certificate:PublicFinishCertificate={version:PUBLIC_FINISH_VERSION,status:'NOT_APPLICABLE',reason:'outside-unfinished-head-scope',
    sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,rules:{...obs.rules},mode:obs.mode,publicInputFingerprint:'',
    method:'none',historyReplayVerified:false,responseChecksComplete:false,candidateSelectionComplete:false,eligibleOverride:false,assumptions:[],guarantee:null,
    work:{historySteps:0,candidateSubsets:0,responseChecks:0,replyTemplates:0,pathTransitions:0}};
  const analysis:PublicFinishAnalysis={status:certificate.status,reason:certificate.reason,choices:[],certificate};
  const end=(status:PublicFinishCertificate['status'],reason:string)=>{analysis.status=certificate.status=status;analysis.reason=certificate.reason=reason;return analysis;};
  if(Object.values(budget).some(n=>!Number.isSafeInteger(n)||n<0))return end('UNKNOWN','invalid-proof-budget');
  if(obs.isOver||obs.currentPlayer!==obs.player||obs.finished.length>1)return analysis;
  if(obs.publicHistoryInvalid||!Number.isSafeInteger(obs.stateVersion)||obs.stateVersion<0||obs.history.some((event,index)=>event.index!==index||event.index>=obs.stateVersion))return end('UNKNOWN','invalid-public-history-index');
  if(!seats.includes(obs.player)||obs.team!==teamOf(obs.player)||obs.partner!==partnerOf(obs.player)||!['practice','classic','legacy'].includes(obs.mode)||obs.rules.version!=='guan-practice-v1'
    ||!Number.isInteger(obs.rules.levelRank)||obs.rules.levelRank<2||obs.rules.levelRank>14)return end('UNKNOWN','invalid-rules-or-seat');
  if(obs.remainingCounts.length!==4||obs.remainingCounts.some(n=>!Number.isInteger(n)||n<0||n>27)||obs.remainingCounts[obs.player]!==obs.hand.length||!obs.hand.length
    ||new Set(obs.finished).size!==obs.finished.length||obs.finished.some(seat=>!seats.includes(seat))
    ||seats.some(seat=>(obs.remainingCounts[seat]===0)!==obs.finished.includes(seat)))return end('UNKNOWN','invalid-public-counts');
  if(obs.hand.length>Math.min(12,budget.maxOwnCards))return end('UNKNOWN','own-hand-size-budget');
  if(obs.history.length>budget.maxHistoryEvents)return end('UNKNOWN','public-history-budget');
  const fullHistory=obs.history.length===obs.stateVersion;
  const ledger=obs.publicCardLedger;
  if(ledger&&(ledger.stateVersion!==obs.stateVersion||!['public-history','public-snapshot'].includes(ledger.source)))return end('UNKNOWN','stale-or-invalid-public-ledger');
  if(!fullHistory&&(!ledger||ledger.source!=='public-snapshot'||obs.history.length>0))return end('UNKNOWN','incomplete-public-history');
  const played=ledger?.playedCards??obs.history.flatMap(event=>event.play?.cards??[]);
  const known=new Map<string,Card>(),counts=new Map<string,number>();
  const inspect=(card:Card)=>{
    if(!card||typeof card.id!=='string'||!card.id||known.has(card.id)||!faceSet.has(face(card)))return false;
    known.set(card.id,card);const count=(counts.get(face(card))??0)+1;counts.set(face(card),count);return count<=2;
  };
  for(const card of [...obs.hand,...played])if(!inspect(card))return end('UNKNOWN','invalid-physical-card-ledger');
  if(deck.length-obs.hand.length-played.length!==obs.remainingCounts.reduce((sum,n,seat)=>sum+(seat===obs.player?0:n),0))return end('UNKNOWN','public-card-count-mismatch');
  if(obs.currentPlay){
    if(!seats.includes(obs.currentOwner!)||obs.currentOwner===obs.player||!obs.currentPlay.cards.every(card=>played.some(other=>sameCard(card,other)))
      ||!resolvePlays(obs.currentPlay.cards,obs.rules).some(play=>samePlay(play,obs.currentPlay)))return end('UNKNOWN','invalid-public-table');
    const ordered=Array.from({length:3},(_,index)=>((obs.currentOwner!+index+1)%4) as Seat).filter(seat=>obs.remainingCounts[seat]!>0),start=ordered.indexOf(obs.player);
    if(start<0||!sameSeats([...ordered.slice(start)].sort(),[...obs.pendingResponders].sort()))return end('UNKNOWN','invalid-pending-responders');
  }else if(obs.currentOwner!==null||obs.pendingResponders.length)return end('UNKNOWN','invalid-empty-table');
  const owners=new Map<string,{card:Card;seat:Seat}>();
  const references=new Map(known);
  const noteOwner=(card:Card,seat:Seat)=>{
    if(!card||typeof card.id!=='string'||!card.id||!seats.includes(seat)||!faceSet.has(face(card)))return false;
    const previous=references.get(card.id);if(previous&&!sameCard(previous,card))return false;
    references.set(card.id,card);owners.set(card.id,{card,seat});return true;
  };
  for(const item of obs.antiTributeEvidence)if(!noteOwner(item.card,item.player))return end('UNKNOWN','conflicting-public-ownership');
  for(const item of obs.publicTransfers)if(!seats.includes(item.from)||item.from===item.to||!['tribute','return'].includes(item.type)||!noteOwner(item.card,item.to))return end('UNKNOWN','conflicting-public-ownership');
  const playedIds=new Set(played.map(card=>card.id)),pool:Card[]=[],hands:Card[][]=seats.map(seat=>seat===obs.player?[...obs.hand]:[]);
  for(const {card,seat} of owners.values()){
    if(!seats.includes(seat)||!faceSet.has(face(card)))return end('UNKNOWN','invalid-public-owned-card');
    const prior=known.get(card.id);
    if(prior&&!sameCard(prior,card))return end('UNKNOWN','conflicting-public-owned-card');
    if(playedIds.has(card.id))continue;
    if(seat===obs.player){if(!obs.hand.some(own=>sameCard(own,card)))return end('UNKNOWN','known-own-card-missing');continue;}
    if(!inspect(card))return end('UNKNOWN','conflicting-public-ownership');
    hands[seat]!.push(card);pool.push(card);
  }
  for(const source of deck){
    const count=counts.get(face(source))??0;if(count>0){counts.set(face(source),count-1);continue;}
    let id=`public-finish:${source.id}`;while(known.has(id))id+=':';
    const card={...source,id};known.set(id,card);pool.push(card);
  }
  const reserved=new Set(hands.flatMap(hand=>hand.map(card=>card.id)));
  const unassigned=pool.filter(card=>!reserved.has(card.id));let next=0;
  for(const seat of seats){
    if(hands[seat]!.length>obs.remainingCounts[seat]!)return end('UNKNOWN','public-owner-capacity-mismatch');
    while(hands[seat]!.length<obs.remainingCounts[seat]!)hands[seat]!.push(unassigned[next++]!);
  }
  if(next!==unassigned.length||hands.some(hand=>hand.some(card=>!card)))return end('UNKNOWN','public-pool-allocation-mismatch');
  let model:GameState={sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,rules:{...obs.rules},hands,currentPlayer:obs.currentPlayer,firstPlayer:obs.currentPlayer,
    currentPlay:obs.currentPlay?structuredClone(obs.currentPlay):null,currentOwner:obs.currentOwner,pendingResponders:[...obs.pendingResponders],finished:[...obs.finished],played:[],events:[],result:null};
  if(fullHistory){
    const historyCards=obs.history.flatMap(event=>event.play?.cards??[]);
    if(historyCards.length!==played.length||new Set(historyCards.map(card=>card.id)).size!==played.length||historyCards.some(card=>!played.some(other=>sameCard(card,other))))return end('UNKNOWN','history-ledger-mismatch');
    const initial=hands.map(hand=>[...hand]);
    for(const event of obs.history){
      if(!seats.includes(event.player)||!['play','pass'].includes(event.type)||event.type==='pass'&&event.play||event.type==='play'&&!event.play)return end('UNKNOWN','invalid-public-history-event');
      if(event.play)initial[event.player]!.push(...event.play.cards);
    }
    if(initial.some(hand=>hand.length!==27))return end('UNKNOWN','public-seat-history-count-mismatch');
    let replay:GameState={...model,stateVersion:0,hands:initial,currentPlayer:obs.history[0]?.player??obs.currentPlayer,firstPlayer:obs.history[0]?.player??obs.currentPlayer,currentPlay:null,currentOwner:null,pendingResponders:[],finished:[]};
    try{
      for(const event of obs.history){
        const action:GameAction=event.type==='pass'?{...stamp(replay),player:event.player,type:'pass'}:{...stamp(replay),player:event.player,type:'play',cardIds:event.play!.cards.map(card=>card.id),playKey:event.play!.key};
        const accepted=applyAction(replay,action);certificate.work.historySteps++;
        if(!accepted.ok)return end('UNKNOWN','public-history-replay-rejected');
        replay=accepted.state;const actual=replay.events.at(-1)!;
        if(actual.roundEnded!==event.roundEnded||actual.nextPlayer!==event.nextPlayer||actual.finished!==event.finished||!samePlay(actual.play??null,event.play??null))return end('UNKNOWN','public-history-transition-mismatch');
        // The reducer never reads historical events/played for future legality. Keep
        // only this transition to avoid quadratic history cloning during validation.
        replay={...replay,events:[],played:[]};
      }
    }catch{return end('UNKNOWN','public-history-replay-error');}
    if(replay.result||replay.currentPlayer!==obs.currentPlayer||replay.currentOwner!==obs.currentOwner||!samePlay(replay.currentPlay,obs.currentPlay)
      ||!sameSeats(replay.pendingResponders,obs.pendingResponders)||!sameSeats(replay.finished,obs.finished))return end('UNKNOWN','public-current-state-mismatch');
    model=replay;certificate.historyReplayVerified=true;
  }
  certificate.publicInputFingerprint=publicFinishInputFingerprint(obs);
  certificate.assumptions=['Frozen GUAN rules and current public snapshot are valid.','Other players choose only legal actions.',
    fullHistory?'Full public action history replayed through the production reducer.':'Historical action timeline unavailable; public snapshot and subsequent reducer transitions verified.'];
  const recordOutcome=(ended:GameState)=>{
    const winningTeam=teamOf(ended.finished[0]!),place=(obs.finished.length+1) as 1|2;
    certificate.guarantee={place,winningTeam,doubleUp:place===1?null:ended.result?.doubleUp??false,actualAdvance:null,passesAce:null};
    certificate.eligibleOverride=place===1||winningTeam===obs.team;
    if(ended.result&&obs.mode!=='practice'&&obs.matchContext){
      const context=obs.matchContext,progress={...createMatchProgress(obs.mode==='classic'?'guan-classic-house-v1':'guan-match-v1'),teamLevels:[...context.teamLevels] as [number,number],activeTeam:context.levelOwnerTeamId,handNumber:context.handNumber};
      const settled=settleMatchProgress(progress,ended);
      if(settled.ok&&settled.progress.lastAdvance){const advance=settled.progress.lastAdvance;certificate.guarantee.actualAdvance=advance.to-advance.from;certificate.guarantee.passesAce=advance.passedAce;}
    }
  };
  const direct=resolvePlays(obs.hand,obs.rules).filter(play=>canBeat(play,obs.currentPlay,obs.rules));
  for(const play of direct){
    const action=playAction(model,play),ended=applyAction(model,action);certificate.work.pathTransitions++;
    if(ended.ok&&ended.state.finished[obs.finished.length]===obs.player){analysis.choices.push({first:action,passes:[],finish:null,firstPlay:play,remainingPlay:null});recordOutcome(ended.state);}
  }
  if(analysis.choices.length){certificate.method='direct-finish';certificate.responseChecksComplete=true;certificate.candidateSelectionComplete=true;return end('PROVEN',obs.finished.length?'legal-direct-second-finish':'legal-direct-head-finish');}
  const subsetCount=(1<<obs.hand.length)-2;
  if(subsetCount>budget.maxCandidateSubsets)return end('UNKNOWN','candidate-subset-budget');
  const tested=new Map<string,PooledResponseCheck>();let exhausted=false,possible=false;
  for(let mask=1;mask<(1<<obs.hand.length)-1;mask++){
    certificate.work.candidateSubsets++;
    const firstCards=obs.hand.filter((_,index)=>mask&(1<<index)),remaining=obs.hand.filter((_,index)=>!(mask&(1<<index)));
    const finals=resolvePlays(remaining,obs.rules);if(!finals.length)continue;
    for(const first of resolvePlays(firstCards,obs.rules)){
      if(!canBeat(first,obs.currentPlay,obs.rules))continue;
      const semantic=`${first.kind}:${first.size}:${first.value}`;
      let response=tested.get(semantic);
      if(!response){
        if(certificate.work.responseChecks>=budget.maxResponseChecks){exhausted=true;continue;}
        response=checkPooledResponse(pool,first,obs.rules,{maxTemplates:budget.maxReplyTemplates});tested.set(semantic,response);
        certificate.work.responseChecks++;certificate.work.replyTemplates+=response.templatesChecked;
      }
      if(response.status==='UNKNOWN'){exhausted=true;continue;}
      if(response.status==='POSSIBLE_RESPONSE'){possible=true;continue;}
      const action=playAction(model,first),playedFirst=applyAction(model,action);certificate.work.pathTransitions++;
      if(!playedFirst.ok||playedFirst.state.result||playedFirst.state.finished.length!==obs.finished.length)continue;
      let nextState=playedFirst.state;const passes:GameAction[]=[];
      for(let count=0;count<3&&nextState.currentPlay;count++){
        const pass:GameAction={...stamp(nextState),type:'pass'},moved=applyAction(nextState,pass);certificate.work.pathTransitions++;
        if(!moved.ok)break;passes.push(pass);nextState=moved.state;
      }
      if(nextState.result||nextState.currentPlay||nextState.currentOwner!==null||nextState.currentPlayer!==obs.player||nextState.pendingResponders.length)continue;
      const finishing=playAction(nextState,finals[0]!),ended=applyAction(nextState,finishing);certificate.work.pathTransitions++;
      if(!ended.ok||ended.state.finished[obs.finished.length]!==obs.player||ended.state.hands[obs.player]!.length)continue;
      analysis.choices.push({first:action,passes,finish:finishing,firstPlay:first,remainingPlay:finals[0]!});
      recordOutcome(ended.state);
    }
  }
  if(analysis.choices.length){
    certificate.method='unbeatable-two-play';certificate.responseChecksComplete=true;certificate.candidateSelectionComplete=!exhausted;
    return end('PROVEN',obs.finished.length?'pooled-unbeatable-then-second-finish':'pooled-unbeatable-then-head-finish');
  }
  certificate.candidateSelectionComplete=!exhausted;
  return end(exhausted?'UNKNOWN':'NOT_PROVEN',exhausted?'public-response-budget':possible?'pooled-response-prevents-proof':'no-legal-two-play-route');
}
