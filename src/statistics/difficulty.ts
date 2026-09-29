import type { Seat } from '../engine/types';
import type { PolicyAssignment } from '../ai/roles';
import type { MatchSession } from '../match/sessionTypes';
import type { LocalDifficulty } from './model';

const tier = (id: string | undefined): LocalDifficulty => id==='balanced-pro-v1'?'balanced-pro':id==='balanced-plus-v1'?'balanced-plus':id==='jwxxc-pro'||id==='jwxxc-model-v1'||id==='jwxxc-search-v1'?'jwxxc':id==='pro-danlm-v1'||id==='pro-danlm-classic-v1' ? 'danlm' : id?.startsWith('pro-') ? 'pro' : id === 'balanced-v1'||id === 'balanced-endgame-v1'||id === 'balanced-attachment-v1' ? 'balanced' : id === 'coop-v2'||id === 'coop-endgame-v1' ? 'casual' : 'legacy';

/** Use the two opponents' saved policies, not the hint or partner policy. */
export function handDifficulty(saved: PolicyAssignment, viewer: Seat = 0): LocalDifficulty {
  const opponents = ([0, 1, 2, 3] as Seat[]).filter(seat => seat % 2 !== viewer % 2);
  const tiers = opponents.map(seat => tier((saved.seatPolicies?.[seat] ?? saved.policy)?.id));
  return tiers[0] === tiers[1] ? tiers[0] : 'mixed';
}

/** A whole match belongs to one difficulty only if every settled hand agrees. */
export function matchDifficulty(match: MatchSession): LocalDifficulty {
  const settled = new Set(match.progress.settledHandIds);
  const tiers = new Set(match.journal.records.filter(record => settled.has(record.config.handId!)).map(record => handDifficulty(record)));
  return tiers.size === 1 ? [...tiers][0] : 'mixed';
}
