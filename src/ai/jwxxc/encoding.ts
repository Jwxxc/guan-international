import {encodeProObservation,encodeProAction,cleanProObservation,faceCounts,relativeSeat,nextEventClass} from '../models/encoding';
import {isWild} from '../../engine/cards';
import type {Card,ResolvedPlay,Seat} from '../../engine/types';
import type {AiObservation} from '../types';
export const JWXXC_ENCODER_VERSION='guan-jwxxc-observation-v1';
export const STATE_DIM=432,HISTORY_DIM=144,ACTION_DIM=266,HISTORY_LIMIT=64;
export const ENCODER_VERSION=JWXXC_ENCODER_VERSION;
export {nextEventClass};
export interface EncodedJwxxcObservation{state:number[];history:number[][]}
export const cleanJwxxcObservation=(value:AiObservation):AiObservation=>cleanProObservation(value);
/** Reuses only immutable public feature helpers; no old model parameters or private state. */
export function encodeJwxxcObservation(value:AiObservation):EncodedJwxxcObservation{
 const obs=cleanJwxxcObservation(value),base=encodeProObservation(obs),leader=obs.passOutcome.nextLeader;
 const state=[...base.state,obs.finishOutcome.place/4,Number(obs.finishOutcome.handEnds),Number(obs.finishOutcome.doubleUp),(obs.finishOutcome.nominalAdvance??0)/3,Number(obs.passOutcome.endsRound),
  ...Array.from({length:5},(_,i)=>Number(i===(leader===null?4:relativeSeat(leader,obs.player)))),
  Number(obs.matchContext?.teamLevels[obs.team]===14),Number(obs.matchContext?.teamLevels[(1-obs.team) as 0|1]===14)];
 if(state.length!==STATE_DIM||state.some(x=>!Number.isFinite(x)))throw Error('JWXXC state feature shape/value mismatch');
 return{state,history:base.history};
}
export interface JwxxcFullHouseParts{main:Card[];attachment:Card[];mainRank:number|null;attachmentRank:number|null}
export function jwxxcFullHouseParts(obs:AiObservation,play:ResolvedPlay|null):JwxxcFullHouseParts{
 const empty={main:[],attachment:[],mainRank:null,attachmentRank:null};if(!play||play.kind!=='fullHouse')return empty;
 const mappings=new Map(play.wildcards.map(w=>[w.cardId,w.rank])),groups=new Map<number,Card[]>();
 for(const card of play.cards){const rank=isWild(card,obs.rules)?mappings.get(card.id):card.rank;if(rank===undefined)throw Error('JWXXC missing declared wildcard');groups.set(rank,[...(groups.get(rank)??[]),card]);}
 const main=[...groups].find(([,cards])=>cards.length===3),pair=[...groups].find(([,cards])=>cards.length===2);
 if(groups.size!==2||!main||!pair)throw Error('JWXXC invalid full house decomposition');
 return{main:main[1],attachment:pair[1],mainRank:main[0],attachmentRank:pair[0]};
}
const rankSlots=(rank:number|null)=>Array.from({length:16},(_,index)=>Number(index===(rank===null?15:rank-2)));
/** Candidate index and physical copy IDs never become numerical features. */
export function encodeJwxxcAction(obs:AiObservation,candidate:{play:ResolvedPlay|null}):number[]{
 const play=candidate.play,parts=jwxxcFullHouseParts(obs,play);
 const action=[...encodeProAction(obs,candidate),...faceCounts(parts.main),...faceCounts(parts.attachment),...rankSlots(parts.mainRank),...rankSlots(parts.attachmentRank),
  Number(play?.kind==='fullHouse'),parts.main.filter(c=>isWild(c,obs.rules)).length/2,parts.attachment.filter(c=>isWild(c,obs.rules)).length/2,Number((parts.attachmentRank??0)>=15)];
 if(action.length!==ACTION_DIM||action.some(x=>!Number.isFinite(x)))throw Error('JWXXC action feature shape/value mismatch');return action;
}
