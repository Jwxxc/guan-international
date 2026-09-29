import { tx } from '../i18n';
import type { CSSProperties } from 'react';
import { Crown } from 'lucide-react';
import type { VictoryMoment } from '../game/victory';
import '../styles/victory.css';

/** Decorative event layer: no input interception or timing dependency in the game. */
export function VictoryCelebration({moment}:{moment:VictoryMoment}){
  const first=moment.kind==='first';
  return <div key={moment.key} className={`victory-celebration victory-${moment.kind} ${(moment.ours ?? moment.team===0)?'victory-ours':'victory-opponents'} ${moment.reduced?'victory-reduced':''}`}
    data-testid={first?'table-celebration':'result-celebration'} data-kind={moment.kind} data-seat={moment.seat} data-team={moment.team} data-event-key={moment.key}
    aria-hidden={!first} style={{'--victory-duration':`${moment.duration}ms`} as CSSProperties}>
    <div className="victory-halo victory-motion"/><div className="victory-orbit victory-motion"/>
    <div className="victory-confetti victory-motion" aria-hidden="true">{tx(Array.from({length:moment.particles},(_,i)=>{
      const side=i%2===0?-1:1;
      return <i key={i} style={{'--confetti-side':side,'--confetti-x':`${side*(first?24+(i*23)%100:140+(i*37)%260)}px`,
        '--confetti-y':`${first?-18+(i*13)%78:80+(i*31)%360}px`,'--confetti-spin':`${side*(120+(i*59)%380)}deg`,
        '--confetti-delay':`${(i%7)*28}ms`,'--confetti-origin':`${first?50:side===1?80:20}%`,'--confetti-hue':i%3} as CSSProperties}/>;
    }))}</div>
    {tx(first&&<div className="victory-first-medal" role="status" aria-live="polite"><Crown size={22} strokeWidth={1.4}/><strong>{tx(moment.title)}</strong><span>{tx(moment.subtitle)}</span></div>)}
  </div>;
}
