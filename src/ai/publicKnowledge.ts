import { createDeck, isWild, rankStrength } from '../engine/cards';
import { teamOf } from '../engine/rules';
import type { Card, ResolvedPlay, Seat } from '../engine/types';
import type { AiObservation } from './types';

export const PUBLIC_KNOWLEDGE_VERSION='public-ledger-v1';
const physicalKey=(card:Card)=>`${card.deck}:${card.suit}:${card.rank}`;
const universe=createDeck();
const physicalUniverse=new Set(universe.map(physicalKey));
export interface PublicKnowledge {
  version:typeof PUBLIC_KNOWLEDGE_VERSION;
  played:Card[];knownHeld:Array<{player:Seat;card:Card}>;unlocated:Card[];
  playedCounts:Record<string,number>;remainingCounts:number[];passes:number[];
  currentOwner:Seat|null;pendingResponders:Seat[];nextLeaderIfPass:Seat|null;
  publicOwnIds:string[];consistent:boolean;issues:string[];futureEventsIgnored:number;
}
/** Only own cards and public facts. This is a ledger of possibilities, never a hidden deal. */
export function buildPublicKnowledge(obs:AiObservation):PublicKnowledge {
  const issues:string[]=[],played=new Map<string,Card>(),owners=new Map<string,{player:Seat;card:Card}>();
  const seenPhysical=new Map<string,string>(),seenIds=new Map<string,string>();
  const inspect=(card:Card)=>{
    const key=physicalKey(card);
    if(!physicalUniverse.has(key))issues.push('unknown-physical-card');
    if(seenPhysical.has(key)&&seenPhysical.get(key)!==card.id)issues.push('conflicting-physical-id');
    if(seenIds.has(card.id)&&seenIds.get(card.id)!==key)issues.push('conflicting-card-face');
    seenPhysical.set(key,card.id);seenIds.set(card.id,key);
  };
  for(const card of obs.hand)inspect(card);
  // Exchange projections are ordered tribute then return. All exchanges precede ordinary play.
  // The live policy invokes this ledger only in the playing phase; inconsistent projections
  // remain conservative and cannot produce control proofs.
  for(const item of obs.antiTributeEvidence){inspect(item.card);owners.set(item.card.id,{player:item.player,card:item.card});}
  for(const item of obs.publicTransfers){inspect(item.card);owners.set(item.card.id,{player:item.to,card:item.card});}
  const passes=[0,0,0,0];let futureEventsIgnored=0;
  const indices=new Set<number>();
  for(const event of [...obs.history].sort((a,b)=>a.index-b.index)){
    if(!Number.isInteger(event.index)||event.index<0){issues.push('invalid-event-index');continue;}
    if(event.index>=obs.stateVersion){futureEventsIgnored++;continue;}
    if(indices.has(event.index)){issues.push('duplicate-event-index');continue;}indices.add(event.index);
    if(event.type==='pass'){passes[event.player]++;continue;}
    for(const card of event.play?.cards??[]){inspect(card);if(played.has(card.id))issues.push('card-played-twice');played.set(card.id,card);}
  }
  // A fixture or a partial public feed may include the visible target without its event.
  // Union by physical identity prevents counting history + currentPlay twice.
  for(const card of obs.currentPlay?.cards??[]){inspect(card);played.set(card.id,card);}
  for(const id of played.keys())owners.delete(id);
  const ownIds=new Set(obs.hand.map(card=>card.id)),ownPhysical=new Set(obs.hand.map(physicalKey));
  if(ownIds.size!==obs.hand.length||ownPhysical.size!==obs.hand.length)issues.push('duplicate-own-card');
  for(const card of played.values())if(ownIds.has(card.id))issues.push('played-card-still-in-hand');
  for(const item of owners.values())if(ownIds.has(item.card.id)!==(item.player===obs.player))issues.push('ownership-not-yet-consistent');
  const playedPhysical=new Set([...played.values()].map(physicalKey));
  const locatedPhysical=new Set([...owners.values()].filter(item=>item.player!==obs.player).map(item=>physicalKey(item.card)));
  const unlocated=universe.filter(card=>!ownPhysical.has(physicalKey(card))&&!playedPhysical.has(physicalKey(card))&&!locatedPhysical.has(physicalKey(card)));
  if(obs.remainingCounts.length!==4||obs.remainingCounts.some(n=>!Number.isInteger(n)||n<0||n>27)||obs.remainingCounts[obs.player]!==obs.hand.length)issues.push('invalid-counts');
  if(obs.remainingCounts.reduce((a,b)=>a+b,0)+playedPhysical.size!==108)issues.push('incomplete-public-inventory');
  for(const player of [0,1,2,3])if([...owners.values()].filter(item=>item.player===player).length>(obs.remainingCounts[player]??0))issues.push('too-many-known-cards');
  const playedCounts:Record<string,number>={};
  for(const card of played.values()){const key=`${card.rank}:${card.suit}`;playedCounts[key]=(playedCounts[key]??0)+1;}
  return {version:PUBLIC_KNOWLEDGE_VERSION,played:structuredClone([...played.values()]),knownHeld:structuredClone([...owners.values()]),unlocated:structuredClone(unlocated),
    playedCounts,remainingCounts:[...obs.remainingCounts],passes,currentOwner:obs.currentOwner,pendingResponders:[...obs.pendingResponders],nextLeaderIfPass:obs.passOutcome.endsRound?obs.passOutcome.nextLeader:null,
    publicOwnIds:[...owners.values()].filter(item=>item.player===obs.player).map(item=>item.card.id).sort(),consistent:issues.length===0,issues:[...new Set(issues)],futureEventsIgnored};
}
export interface TypeControl { assessed:boolean;higherSameTypePossible:boolean;bombResponsePossible:boolean;scope:'same-type-only' }
/** Conservative feasibility upper bounds: "possible" is never "the opponent has it". */
export function typeControlUpperBound(obs:AiObservation,knowledge:PublicKnowledge,play:ResolvedPlay):TypeControl {
  const ordinary=['single','pair','triple'].includes(play.kind);
  if(!knowledge.consistent||!ordinary)return{assessed:false,higherSameTypePossible:true,bombResponsePossible:true,scope:'same-type-only'};
  let higher=false,bomb=false;
  for(const player of [0,1,2,3] as Seat[]){
    const remaining=obs.remainingCounts[player]!;
    if(teamOf(player)===obs.team||!remaining)continue;
    const known=knowledge.knownHeld.filter(item=>item.player===player).map(item=>item.card);
    const unknownSlots=Math.max(0,remaining-known.length);
    // These pooled cards are only an upper bound for this seat, not an allocation.
    const available=unknownSlots>0?[...known,...knowledge.unlocated]:known;
    const maximumCount=(rank:number,withWild:boolean)=>{
      const matches=(card:Card)=>card.rank===rank||withWild&&isWild(card,obs.rules);
      return known.filter(matches).length+Math.min(unknownSlots,knowledge.unlocated.filter(matches).length);
    };
    if(remaining>=play.size){
      if(play.kind==='single')higher ||= available.some(card=>rankStrength(card.rank,obs.rules)>play.value);
      else for(let rank=2;rank<=16;rank++)if(rankStrength(rank,obs.rules)>play.value&&maximumCount(rank,rank<=14)>=play.size)higher=true;
    }
    if(remaining>=4){
      for(let rank=2;rank<=14;rank++)if(maximumCount(rank,true)>=4)bomb=true;
      if(maximumCount(15,false)>=2&&maximumCount(16,false)>=2)bomb=true;
      // A five-card flush may still be possible; do not claim exclusion from rank counts alone.
      if(remaining>=5)bomb=true;
    }
  }
  return{assessed:true,higherSameTypePossible:higher,bombResponsePossible:bomb,scope:'same-type-only'};
}
