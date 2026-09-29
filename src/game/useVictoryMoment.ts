import { useEffect, useRef, useState } from 'react';
import { getVictoryMoment, type VictoryMoment, type VictoryOptions, type VictoryState } from './victory';

const stamp=(state:VictoryState|null|undefined)=>({session:state?.sessionId,hand:state?.handId,index:state?.events.at(-1)?.index??-1});
/** Mount/restore establish a baseline; only a newly accepted live event can celebrate. */
export function useVictoryMoment(state:VictoryState|null|undefined, enabled:boolean, reduced:boolean, matchWinner?:0|1|null, options: VictoryOptions = {}){
  const seen=useRef(stamp(state));
  const epoch = options.presentationEpoch ?? 0;
  const seenEpoch = useRef(epoch);
  const [moment,setMoment]=useState<VictoryMoment|null>(null);
  useEffect(()=>{
    const prior=seen.current,next=stamp(state);
    seen.current=next;
    const sameEpoch = seenEpoch.current === epoch;
    seenEpoch.current = epoch;
    const sameHand=prior.session===next.session&&prior.hand===next.hand;
    if(!enabled||!sameHand||!sameEpoch){setMoment(null);return;}
    if(state&&next.index>prior.index){
      const achievement=getVictoryMoment(state,matchWinner,options);
      if(achievement){
        const quiet=reduced||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setMoment({...achievement,reduced:quiet,duration:quiet?750:achievement.duration});
      }
    }
  },[state,enabled,reduced,matchWinner,epoch,options.viewerSeat,options.seatNames]);
  useEffect(()=>{
    if(!moment)return;
    const timer=window.setTimeout(()=>setMoment(null),moment.duration);
    return()=>window.clearTimeout(timer);
  },[moment]);
  return moment;
}
