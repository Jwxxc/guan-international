import { assetUrl } from '../game/assetUrl';
import { useEffect, useId, useState } from 'react';
import '../styles/room-atmosphere.css';

/** The photo and practical lights share one cover transform, keeping each
 * glow attached to its source at every viewport size. All motion is decorative. */
export function RoomAtmosphere() {
  const lightId = useId();
  const [paused, setPaused] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return <div className="room-scene" aria-hidden="true" data-paused={paused}>
    <svg className="room-atmosphere" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <radialGradient id={`${lightId}-warm`}>
          <stop offset="0" stopColor="#ffe8bd" stopOpacity=".72"/>
          <stop offset=".28" stopColor="#efbd70" stopOpacity=".36"/>
          <stop offset=".65" stopColor="#d9943e" stopOpacity=".12"/>
          <stop offset="1" stopColor="#d9943e" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id={`${lightId}-soft`}>
          <stop offset="0" stopColor="#fff1c9" stopOpacity=".44"/>
          <stop offset=".46" stopColor="#e7be7a" stopOpacity=".16"/>
          <stop offset="1" stopColor="#dca965" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id={`${lightId}-paper`} cx="50%" cy="68%" r="72%">
          <stop offset="0" stopColor="#fff0c9" stopOpacity=".9"/>
          <stop offset=".62" stopColor="#ffd995" stopOpacity=".64"/>
          <stop offset="1" stopColor="#efb965" stopOpacity=".24"/>
        </radialGradient>
        <clipPath id={`${lightId}-pendant`}>
          {/* Follow the paper faces, leaving the dark wooden frame intact. */}
          <path d="M996 86L1156 68L1156 122L996 134Z M1170 69L1300 87L1300 134L1170 122Z M1002 144L1156 133L1156 145L1170 145L1170 133L1297 143L1153 154Z"/>
        </clipPath>
        <clipPath id={`${lightId}-felt`}>
          <path d="M850 469L1112 421L1407 459L1190 521Z"/>
        </clipPath>
      </defs>
      <image className="room-original-image" href={assetUrl('assets/club-room-square-v1.png')} width="1672" height="941" preserveAspectRatio="none"/>
      <g className="room-light room-light-pendant-dim" clipPath={`url(#${lightId}-pendant)`}>
        <rect x="985" y="60" width="330" height="100" fill="#39230d"/>
      </g>
      <g className="room-light room-light-pendant-core" clipPath={`url(#${lightId}-pendant)`}>
        <rect x="985" y="60" width="330" height="100" fill={`url(#${lightId}-paper)`}/>
      </g>
      <g className="room-light room-light-pendant">
        <ellipse cx="1150" cy="111" rx="242" ry="132" fill={`url(#${lightId}-warm)`}/>
        <ellipse cx="1150" cy="185" rx="195" ry="125" fill={`url(#${lightId}-soft)`} opacity=".55"/>
      </g>
      <g className="room-light room-light-sconce">
        <ellipse cx="924" cy="202" rx="88" ry="137" fill={`url(#${lightId}-warm)`}/>
      </g>
      <g className="room-light room-light-shelf">
        <ellipse cx="1600" cy="180" rx="143" ry="52" fill={`url(#${lightId}-warm)`}/>
      </g>
      <g className="room-light room-light-niche">
        <ellipse cx="770" cy="190" rx="75" ry="230" fill={`url(#${lightId}-soft)`}/>
      </g>
      <g className="room-light room-light-reflection" clipPath={`url(#${lightId}-felt)`}>
        <ellipse cx="1140" cy="475" rx="205" ry="52" fill={`url(#${lightId}-soft)`}/>
      </g>
    </svg>
  </div>;
}
