import type {Card, GameEvent, ResolvedPlay, Seat} from '../../engine/types';
import {ownAiInput} from '../input';
import type {AiObservation} from '../types';

export const ENCODER_VERSION = 'guan-pro-observation-v1';
export const STATE_DIM = 420;
export const HISTORY_DIM = 144;
export const ACTION_DIM = 122;
export const HISTORY_LIMIT = 64;
export const PLAY_KINDS = ['single','pair','triple','fullHouse','straight','pairs','plate','bomb','straightFlush','jokerBomb'] as const;
// Eleven slots include an explicit no-play declaration, shared across languages.
const one = (size:number, index:number) => Array.from({length:size},(_,i)=>Number(i===index));
export const relativeSeat = (seat:Seat, actor:Seat) => (seat-actor+4)%4;
export function faceIndex(card:Pick<Card,'suit'|'rank'>):number {
  if(card.suit==='J' && (card.rank===15||card.rank===16)) return card.rank-15+52;
  const suit=['S','H','C','D'].indexOf(card.suit);
  if(suit<0||!Number.isInteger(card.rank)||card.rank<2||card.rank>14) throw Error('PRO invalid card face');
  return suit*13+card.rank-2;
}
export function faceCounts(cards:ReadonlyArray<Pick<Card,'suit'|'rank'>>):number[]{
  const out=Array<number>(54).fill(0);for(const card of cards)out[faceIndex(card)]+=0.5;return out;
}
const declared = (play:ResolvedPlay|null|undefined) => faceCounts(play?.wildcards??[]);
const kind = (play:ResolvedPlay|null|undefined) => one(11,play?PLAY_KINDS.indexOf(play.kind):10);

/** Whitelist first; IDs are used only for public dedup/joins, never numeric inputs. */
export function cleanProObservation(value:AiObservation):AiObservation {
  const obs=ownAiInput(value), events=new Map<number,GameEvent>();
  for(const event of obs.history){
    if(!Number.isInteger(event.index))throw Error('PRO invalid public event index');
    const previous=events.get(event.index);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(event))throw Error('PRO conflicting public event');
    events.set(event.index,event);
  }
  obs.history=[...events.values()].sort((a,b)=>a.index-b.index);
  if(obs.history.length!==obs.stateVersion||obs.history.some((e,i)=>e.index!==i))throw Error('PRO incomplete public history');
  if(obs.rules.version!=='guan-practice-v1'||obs.rules.levelRank<2||obs.rules.levelRank>14||obs.isOver||obs.currentPlayer!==obs.player)throw Error('PRO unsupported decision state');
  if(obs.mode!=='practice'&&!obs.matchContext)throw Error('PRO missing match context');
  return obs;
}

export interface EncodedObservation {state:number[];history:number[][]}
export function encodeProObservation(value:AiObservation):EncodedObservation {
  const obs=cleanProObservation(value), rel=(seat:Seat)=>relativeSeat(seat,obs.player);
  const seats=[0,1,2,3].map(n=>(obs.player+n)%4 as Seat);
  const played=new Map<string,Card>();for(const event of obs.history)for(const card of event.play?.cards??[])played.set(card.id,card);
  const held=new Map<string,{player:Seat;card:Card}>();
  for(const item of obs.antiTributeEvidence)held.set(item.card.id,{player:item.player,card:item.card});
  for(const item of obs.publicTransfers)held.set(item.card.id,{player:item.to,card:item.card});
  for(const id of played.keys())held.delete(id);
  const state=[...faceCounts(obs.hand),...faceCounts([...played.values()]),...faceCounts(obs.currentPlay?.cards??[]),
    ...seats.map(s=>obs.remainingCounts[s]/27),...seats.map(s=>(obs.finished.indexOf(s)+1)/4),
    ...seats.map(s=>Number(obs.pendingResponders.includes(s))),...one(5,obs.currentOwner===null?4:rel(obs.currentOwner)),
    ...one(13,obs.rules.levelRank-2),
    ...[obs.team,(1-obs.team) as 0|1].map(t=>(obs.matchContext?.teamLevels[t]??obs.rules.levelRank)/14),
    ...one(3,obs.matchContext?.levelOwnerTeamId==null?2:obs.matchContext.levelOwnerTeamId===obs.team?0:1),
    ...one(3,['practice','classic','legacy'].indexOf(obs.mode)),Number(!!obs.currentPlay),obs.stateVersion/512,
    (obs.matchContext?.handNumber??1)/100,Number(obs.finishOutcome.passesAce),
    ...seats.flatMap(s=>faceCounts([...held.values()].filter(x=>x.player===s).map(x=>x.card)))];
  const token=(type:number, actor:Seat, target:Seat|null, play:ResolvedPlay|null, cards:Card[], roundEnd=false,index=0,finished:Seat|undefined=undefined)=>[
    ...one(7,type),...one(4,rel(actor)),...one(5,target===null?4:rel(target)),...kind(play),...faceCounts(cards),...declared(play),
    (play?.size??cards.length)/10,(play?.value??0)/20,Number(roundEnd),index/512,...one(5,finished===undefined?4:rel(finished))];
  const history=[token(0,obs.player,null,null,[])];
  for(const transfer of obs.publicTransfers)history.push(token(transfer.type==='tribute'?3:4,transfer.from,transfer.to,null,[transfer.card]));
  for(const evidence of obs.antiTributeEvidence)history.push(token(5,evidence.player,null,null,[evidence.card]));
  for(const event of obs.history)history.push(token(event.type==='pass'?2:1,event.player,event.nextPlayer,event.play??null,event.play?.cards??[],event.roundEnded,event.index,event.finished));
  const result={state,history:history.slice(-HISTORY_LIMIT)};
  if(state.length!==STATE_DIM||result.history.some(row=>row.length!==HISTORY_DIM)||state.some(x=>!Number.isFinite(x)))throw Error('PRO encoding shape mismatch');
  return result;
}

export function encodeProAction(_obs:AiObservation,candidate:{play:ResolvedPlay|null}):number[]{
  const play=candidate.play;
  const out=[...faceCounts(play?.cards??[]),...declared(play),...kind(play),(play?.size??0)/10,(play?.value??0)/20,Number(!play)];
  if(out.length!==ACTION_DIM)throw Error('PRO action shape mismatch');return out;
}
export const nextEventClass=(event:GameEvent):number=>event.type==='pass'?0:PLAY_KINDS.indexOf(event.play!.kind)+1;
