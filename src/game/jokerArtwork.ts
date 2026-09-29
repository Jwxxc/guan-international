import type { CardDetail } from './cardAppearance';
import { assetUrl } from './assetUrl';

/** The visible part of a card; presentation only, independent of its identity. */
export type JokerExposure = 'full' | 'left' | 'top';

export function jokerArtwork(rank: number, detail: CardDetail, exposure: JokerExposure) {
  const big = rank === 16;
  const motif = exposure === 'left' ? big ? 'scepter' : 'hat-upright'
    : exposure === 'top' || detail === 'tiny' ? big ? 'crown' : 'hat'
    : `${big ? 'big' : 'small'}-${{ large: 'full', medium: 'bust', small: 'head' }[detail]}`;
  return { motif, src: assetUrl(`assets/jokers/bear-${motif}-v1.svg`) };
}
