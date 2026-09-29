import { tx } from '../i18n';
import { BRAND_MOTTO } from './Brand';
import '../styles/brand-motto.css';

/** Decorative cloud and water motion; the original motto remains readable text. */
export function BrandMotto() {
  return <span className="brand-motto-scene">
    <span className="motto-phrase motto-cloud">
      <svg className="motto-atmosphere" viewBox="0 0 80 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <g className="motto-cloud-drift">
          <path d="M-12 9H7C10 9 10 6 14 6C14 1 23 0 27 5C33 2 38 5 38 8H55C60 8 60 5 65 5C67 0 75 1 77 6H96"/>
          <path d="M-8 14H19C25 14 27 11 32 11H45M49 12H70C75 12 78 9 84 9H98"/>
        </g>
      </svg>
      <span className="motto-ink">{tx(BRAND_MOTTO.slice(0, 4))}</span>
    </span>
    <span className="motto-phrase motto-water">
      <svg className="motto-atmosphere" viewBox="0 0 64 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <g className="motto-water-current">
          <path d="M-32 21q8-5 16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0"/>
        </g>
        <g className="motto-water-current motto-water-current-back">
          <path d="M-32 25q8-3 16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0t16 0"/>
        </g>
      </svg>
      <span className="motto-ink">{tx(BRAND_MOTTO.slice(4))}</span>
    </span>
  </span>;
}
