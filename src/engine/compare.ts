import type { PlayKind, ResolvedPlay, RuleConfig } from './types';

export function bombTier(kind: PlayKind, size: number): number {
  if (kind === 'jokerBomb') return 9;
  if (kind === 'straightFlush') return 3;
  if (kind === 'bomb') return size <= 5 ? size - 3 : size - 2;
  return 0;
}

export function canBeat(candidate: ResolvedPlay, current: ResolvedPlay | null, _rules: RuleConfig): boolean {
  if (!current) return true;
  const candidateTier = bombTier(candidate.kind, candidate.size);
  const currentTier = bombTier(current.kind, current.size);
  if (candidateTier || currentTier) {
    if (candidateTier !== currentTier) return candidateTier > currentTier;
    return candidateTier > 0 && candidate.value > current.value;
  }
  return candidate.kind === current.kind && candidate.size === current.size && candidate.value > current.value;
}
