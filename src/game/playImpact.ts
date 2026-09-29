import type { ResolvedPlay } from '../engine/types';

export type PowerSound = 'bomb' | 'largeBomb' | 'straightFlush' | 'jokerBomb';
export interface PlayImpact {
  kind: 'bomb' | 'straightFlush' | 'jokerBomb';
  tier: 'warm' | 'strong' | 'royal';
  label: string;
  sound: PowerSound;
  duration: number;
  particles: number;
}

const numbers: Record<number, string> = { 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };

/** Presentation comes from the committed interpretation, never the selected cards. */
export function getPlayImpact(play: Pick<ResolvedPlay, 'kind' | 'size'> | null | undefined): PlayImpact | null {
  if (!play) return null;
  if (play.kind === 'jokerBomb') return { kind: 'jokerBomb', tier: 'royal', label: '四王炸', sound: 'jokerBomb', duration: 1750, particles: 40 };
  if (play.kind === 'straightFlush') return { kind: 'straightFlush', tier: 'strong', label: '同花顺', sound: 'straightFlush', duration: 1600, particles: 26 };
  if (play.kind === 'bomb' && numbers[play.size]) {
    const strong = play.size >= 6;
    return { kind: 'bomb', tier: strong ? 'strong' : 'warm', label: `${numbers[play.size]}张炸弹`, sound: strong ? 'largeBomb' : 'bomb',
      duration: strong ? 1580 + (play.size - 6) * 25 : 1400 + (play.size - 4) * 60,
      particles: strong ? 26 + (play.size - 6) * 2 : 18 + (play.size - 4) * 2 };
  }
  return null;
}
