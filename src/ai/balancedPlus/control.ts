import {getLegalMoves} from '../../engine/legalMoves';
import {canBeat} from '../../engine/compare';
import {teamOf} from '../../engine/rules';
import type {GameAction,GameState,ResolvedPlay,Seat} from '../../engine/types';
import type {AiObservation} from '../types';

export interface SampleControl {secure:number;opponentFinish:number;partnerFinish:number}
/** Catalogs are simulator-private, produced only from public-consistent sampled
 * allocations. No actual opponent hand enters this function or its caller. */
export function createSampleControl(obs:AiObservation,worlds:GameState[]):(action:GameAction,play:ResolvedPlay|null)=>SampleControl {
  const seats=[0,1,2,3] as Seat[];
  const catalogs=worlds.map(world=>seats.map(seat=>seat===obs.player||!world.hands[seat].length?[]:getLegalMoves({
    ...obs,player:seat,team:teamOf(seat),hand:world.hands[seat],currentPlay:null,currentOwner:null,
  })));
  const cache=new Map<string,SampleControl>();
  return (action,play)=>{
    const target=action.type==='pass'?obs.currentPlay:play;
    if(!target||!worlds.length)return{secure:0,opponentFinish:0,partnerFinish:0};
    const responders=action.type==='pass'?obs.pendingResponders.filter(seat=>seat!==obs.player)
      :seats.filter(seat=>seat!==obs.player&&obs.remainingCounts[seat]>0);
    const friendlyOwner=action.type==='play'||obs.currentOwner!==null&&teamOf(obs.currentOwner)===obs.team;
    const key=[target.kind,target.size,target.value,friendlyOwner,...responders].join(':');
    const cached=cache.get(key);if(cached)return cached;
    let secure=0,opponentFinish=0,partnerFinish=0;
    for(const catalog of catalogs){
      let enemyReply=false,enemyOut=false,mateOut=false;
      for(const seat of responders){
        const replies=catalog[seat].filter(reply=>canBeat(reply,target,obs.rules));
        const out=replies.some(reply=>reply.size===obs.remainingCounts[seat]);
        if(teamOf(seat)!==obs.team){enemyReply ||= replies.length>0;enemyOut ||= out;}
        else mateOut ||= out;
      }
      secure+=friendlyOwner&&!enemyReply?1:0;opponentFinish+=enemyOut?1:0;partnerFinish+=mateOut?1:0;
    }
    const result={secure:secure/worlds.length,opponentFinish:opponentFinish/worlds.length,partnerFinish:partnerFinish/worlds.length};
    cache.set(key,result);return result;
  };
}
