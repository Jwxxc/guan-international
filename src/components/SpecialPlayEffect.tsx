import { tx } from '../i18n';
import { useEffect, useRef, type CSSProperties } from 'react';
import type { Seat } from '../engine/types';
import type { PlayImpact } from '../game/playImpact';
import '../styles/special-play.css';

export interface ActivePlayImpact { key: string; seat: Seat; eventIndex: number; impact: PlayImpact }

/** A bounded, non-interactive flourish living inside its actual owner's slot. */
export function SpecialPlayEffect({ event, onDone }: { event: ActivePlayImpact; onDone: (key: string) => void }) {
  const { impact } = event;
  const root = useRef<HTMLDivElement>(null);
  const royal = impact.tier === 'royal';
  const flush = impact.kind === 'straightFlush';
  const spreadX = royal ? 150 : impact.tier === 'strong' ? 124 : 106;
  const spreadY = royal ? 50 : impact.tier === 'strong' ? 44 : 37;
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !!root.current?.closest('.reduced-motion');
    const timer = window.setTimeout(() => onDone(event.key), reduced ? 750 : impact.duration);
    return () => window.clearTimeout(timer);
  }, [event.key, impact.duration, onDone]);
  return <div ref={root} className={`special-play-effect special-play-${impact.kind} special-play-${impact.tier}`}
    data-testid="special-play-effect" data-kind={impact.kind} data-tier={impact.tier}
    data-owner={event.seat} data-event-key={event.key} aria-hidden="true"
    style={{ '--impact-duration': `${impact.duration}ms` } as CSSProperties}>
    <div className="special-play-burst special-play-motion"/>
    <div className="special-play-aura special-play-motion"/>
    <div className="special-play-pressure special-play-motion"/>
    <div className="special-play-ring special-play-motion"/>
    <div className="special-play-echo special-play-motion"/>
    {tx(royal && <><div className="special-play-ring special-play-ring-outer special-play-motion"/><div className="special-play-crown special-play-motion">{tx([0, 1, 2, 3].map(index => <i key={index} style={{ '--crown-index': index } as CSSProperties}/>))}</div></>)}
    {tx(flush && <><div className="special-play-sweep special-play-motion"/><div className="special-play-streams special-play-motion">{tx([0, 1, 2].map(index => <i key={index} style={{ '--stream-index': index } as CSSProperties}/>))}</div></>)}
    <div className="special-play-sparks special-play-motion">{tx(Array.from({ length: impact.particles }, (_, i) => {
      const angle = i * Math.PI * 2 / impact.particles;
      return <i key={i} className={i % 3 === 0 ? 'special-play-shard' : undefined}
        style={{ '--spark-x': `${Math.cos(angle) * (spreadX + i % 5 * 7)}px`, '--spark-y': `${Math.sin(angle) * (spreadY + i % 4 * 5)}px`,
          '--spark-delay': `${i % 4 * 34}ms`, '--spark-angle': `${i * 47}deg`, '--spark-size': `${2 + i % 3}px` } as CSSProperties}/>;
    }))}</div>
    <div className="special-play-plaque"><span>✦</span><strong>{tx(impact.label)}</strong><span>✦</span></div>
  </div>;
}
