import type {Card,ResolvedPlay,GameResult,GameEvent} from '../engine/types';
import type {AiObservation} from './types';
import type {ExchangeObservation} from '../match/types';
const card=(value:Card):Card=>({id:value.id,deck:value.deck,suit:value.suit,rank:value.rank});
const play=(value:ResolvedPlay):ResolvedPlay=>({key:value.key,cards:value.cards.map(card),kind:value.kind,size:value.size,value:value.value,label:value.label,wildcards:value.wildcards.map(w=>({cardId:w.cardId,rank:w.rank,suit:w.suit}))});
const result=(value:GameResult):GameResult=>({winningTeam:value.winningTeam,doubleUp:value.doubleUp,order:[...value.order],last:value.last,doubleDown:[...value.doubleDown]});
const event=(value:GameEvent):GameEvent=>({index:value.index,player:value.player,type:value.type,...(value.play?{play:play(value.play)}:{}),roundEnded:value.roundEnded,nextPlayer:value.nextPlayer,...(value.finished!==undefined?{finished:value.finished}:{}),message:value.message});

/** Runtime allowlist, in addition to the authority adapter. Extra private/UI fields are not cloned. */
export function ownAiInput(value:AiObservation):AiObservation{
 return{...(value.publicCardLedger?{publicCardLedger:{stateVersion:value.publicCardLedger.stateVersion,playedCards:value.publicCardLedger.playedCards.map(card),source:value.publicCardLedger.source}}:{}),
  ...(value.publicHistoryInvalid||value.history.some(item=>!Number.isInteger(item.index)||item.index<0||item.index>=value.stateVersion)?{publicHistoryInvalid:true}:{}),
  sessionId:value.sessionId,handId:value.handId,stateVersion:value.stateVersion,player:value.player,team:value.team,hand:value.hand.map(card),rules:{version:value.rules.version,levelRank:value.rules.levelRank},
  remainingCounts:[...value.remainingCounts],currentPlayer:value.currentPlayer,currentPlay:value.currentPlay?play(value.currentPlay):null,currentOwner:value.currentOwner,finished:[...value.finished],
  history:value.history.filter(item=>item.index>=0&&item.index<value.stateVersion).map(event),isOver:value.isOver,partner:value.partner,pendingResponders:[...value.pendingResponders],mode:value.mode,
  matchContext:value.matchContext?{teamLevels:[...value.matchContext.teamLevels],levelOwnerTeamId:value.matchContext.levelOwnerTeamId,handNumber:value.matchContext.handNumber}:null,
  publicTransfers:value.publicTransfers.map(item=>({from:item.from,to:item.to,card:card(item.card),type:item.type})),antiTributeEvidence:value.antiTributeEvidence.map(item=>({player:item.player,card:card(item.card)})),
  finishOutcome:{place:value.finishOutcome.place,handEnds:value.finishOutcome.handEnds,winningTeam:value.finishOutcome.winningTeam,doubleUp:value.finishOutcome.doubleUp,nominalAdvance:value.finishOutcome.nominalAdvance,passesAce:value.finishOutcome.passesAce},
  passOutcome:{endsRound:value.passOutcome.endsRound,nextLeader:value.passOutcome.nextLeader}};
}
export function ownExchangeInput(value:ExchangeObservation):ExchangeObservation{
 return{sessionId:value.sessionId,handId:value.handId,stateVersion:value.stateVersion,rules:{version:value.rules.version,levelRank:value.rules.levelRank},player:value.player,hand:value.hand.map(card),phase:value.phase,eligibleCardIds:[...value.eligibleCardIds],destination:value.destination,
  ...(value.rulesVersion?{rulesVersion:value.rulesVersion}:{}),...(value.previous?{previous:result(value.previous)}:{}),...(value.currentPlayer!==undefined?{currentPlayer:value.currentPlayer}:{}),...(value.firstPlayer!==undefined?{firstPlayer:value.firstPlayer}:{}),
  ...(value.publicTransfers?{publicTransfers:value.publicTransfers.map(item=>({from:item.from,to:item.to,card:card(item.card),type:item.type}))}:{}),...(value.antiTributeEvidence?{antiTributeEvidence:value.antiTributeEvidence.map(item=>({player:item.player,card:card(item.card)}))}:{}),...(value.returnRule!==undefined?{returnRule:value.returnRule}:{})};
}
