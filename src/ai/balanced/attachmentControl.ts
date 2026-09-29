import { isWild, rankStrength } from '../../engine/cards';
import { maxDisjointNaturalStraightFlushes, naturalStraightFlushReservedIds } from '../../engine/naturalStructures';
import { teamOf } from '../../engine/rules';
import type { Card, ResolvedPlay, Seat } from '../../engine/types';
import type { AiObservation } from '../types';

export interface AttachmentControlConfig {
  version: string;
  smallJokerPairCost: number;
  bigJokerPairCost: number;
  fullOpportunityCards: number;
  backupControlDiscount: number;
  maxBackupControls: number;
  publicPressureFactor: number;
  partnerNearFinishFactor: number;
}

/** Experimental incremental cost; these coefficients are a versioned preference, not a value proof. */
export const ATTACHMENT_CONTROL_CONFIG: Readonly<AttachmentControlConfig> = Object.freeze({
  version: 'joker-attachment-cost-v1',
  smallJokerPairCost: 32,
  bigJokerPairCost: 40,
  fullOpportunityCards: 8,
  backupControlDiscount: 0.125,
  maxBackupControls: 3,
  publicPressureFactor: 0.25,
  partnerNearFinishFactor: 0.75,
});

export interface FullHouseParts {
  mainRank: number;
  mainCards: Card[];
  attachmentRank: number;
  attachmentCards: Card[];
}

export interface AttachmentControlAssessment {
  cost: number;
  features: Record<string, number | boolean | string | null>;
  diagnostic: {
    mainRank: number | null;
    mainCardIds: string[];
    attachmentRank: number | null;
    attachmentCardIds: string[];
    reason: string;
  };
}

/** Read the physical membership from the declared substitutions, never from comparison strength. */
export function resolveFullHouseParts(observation: AiObservation, play: ResolvedPlay): FullHouseParts | null {
  if (play.kind !== 'fullHouse' || play.size !== 5 || play.cards.length !== 5) return null;
  const own = new Map(observation.hand.map(card => [card.id, card]));
  const used = new Set<string>();
  const mappings = new Map(play.wildcards.map(mapping => [mapping.cardId, mapping]));
  if (mappings.size !== play.wildcards.length) return null;
  const groups = new Map<number, Card[]>();
  for (const card of play.cards) {
    const original = own.get(card.id);
    if (used.has(card.id) || !original || original.rank !== card.rank || original.suit !== card.suit || original.deck !== card.deck) return null;
    used.add(card.id);
    const mapping = mappings.get(card.id);
    if (isWild(card, observation.rules)) {
      if (!mapping || !Number.isInteger(mapping.rank) || mapping.rank < 2 || mapping.rank > 14 || !['S', 'H', 'C', 'D'].includes(mapping.suit)) return null;
    } else if (mapping) return null;
    const effectiveRank = mapping?.rank ?? card.rank;
    groups.set(effectiveRank, [...(groups.get(effectiveRank) ?? []), card]);
  }
  if ([...mappings.keys()].some(id => !used.has(id)) || groups.size !== 2) return null;
  const main = [...groups].find(([, cards]) => cards.length === 3);
  const attachment = [...groups].find(([, cards]) => cards.length === 2);
  if (!main || !attachment || main[0] > 14) return null;
  return {
    mainRank: main[0], mainCards: [...main[1]].sort((a, b) => a.id.localeCompare(b.id)),
    attachmentRank: attachment[0], attachmentCards: [...attachment[1]].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** A cheap, conservative count of disjoint OWN resources, not a prediction of winning future tricks. */
function remainingControlGroups(observation: AiObservation, cards: readonly Card[]): number {
  const flushes = maxDisjointNaturalStraightFlushes(cards);
  // Reserve all natural flush members before counting rank groups, so a physical card is not
  // simultaneously credited to a flush and a high pair/bomb. Overlapping flushes may over-reserve.
  const reserved = naturalStraightFlushReservedIds(cards);
  const counts = new Map<number, number>();
  for (const card of cards) if (!reserved.has(card.id)) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  let controls = flushes;
  for (const [rank, count] of counts) if (count >= 4 || rankStrength(rank, observation.rules) >= 14) controls++;
  return controls;
}

/**
 * Local opportunity-cost overlay for the new balanced identity only. It does not alter legal
 * moves, candidate membership, or the historical scorer. The small existing residual-control
 * credit remains in oldBalancedScore: this is an explicitly incremental surcharge, not a
 * replacement or another per-joker charge. The policy owns any certified finish-route waiver.
 */
export function assessAttachmentControl(observation: AiObservation, play: ResolvedPlay,
  config: Readonly<AttachmentControlConfig> = ATTACHMENT_CONTROL_CONFIG): AttachmentControlAssessment {
  // A supplied configuration is for explicitly identified development comparisons only.
  if (!config.version || Object.entries(config).some(([key, value]) => key !== 'version' &&
      (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)) ||
      config.fullOpportunityCards <= 0 || config.publicPressureFactor > 1 || config.partnerNearFinishFactor > 1) {
    throw Error('附件控制成本配置必须为有界有限值');
  }
  const parts = resolveFullHouseParts(observation, play);
  const diagnostic: AttachmentControlAssessment['diagnostic'] = {
    mainRank: parts?.mainRank ?? null, mainCardIds: parts?.mainCards.map(card => card.id) ?? [],
    attachmentRank: parts?.attachmentRank ?? null, attachmentCardIds: parts?.attachmentCards.map(card => card.id) ?? [],
    reason: play.kind === 'fullHouse' ? 'invalid-full-house-membership' : 'not-full-house',
  };
  const features: AttachmentControlAssessment['features'] = {
    attachmentControlVersion: config.version, attachmentControlCost: 0, attachmentControlApplied: false,
    attachmentCostIsIncremental: true,
    attachmentMainRank: diagnostic.mainRank, attachmentMainCardIds: diagnostic.mainCardIds.join(','),
    attachmentRank: diagnostic.attachmentRank, attachmentCardIds: diagnostic.attachmentCardIds.join(','),
    attachmentJokerPair: false, attachmentFourJokerDeduplicated: false,
    attachmentBaseCost: 0, attachmentRemainingCards: 0, attachmentOpportunityFactor: 0,
    attachmentRemainingControlGroups: 0, attachmentBackupControlFactor: 1,
    attachmentPublicPressure: false, attachmentPressureFactor: 1,
    attachmentPartnerNearFinish: false, attachmentPartnerFactor: 1,
  };
  const finish = (reason: string, cost = 0): AttachmentControlAssessment => {
    diagnostic.reason = reason;
    features.attachmentControlReason = reason;
    features.attachmentControlCost = cost;
    features.attachmentControlApplied = cost > 0;
    return { cost, features, diagnostic };
  };
  if (!parts) return finish(diagnostic.reason);
  const realJokerPair = parts.attachmentRank >= 15 && parts.attachmentCards.every(card =>
    card.suit === 'J' && card.rank === parts.attachmentRank && !play.wildcards.some(mapping => mapping.cardId === card.id));
  if (!realJokerPair) return finish('ordinary-attachment-out-of-scope');
  features.attachmentJokerPair = true;
  const ids = new Set(play.cards.map(card => card.id));
  const remaining = observation.hand.filter(card => !ids.has(card.id));
  features.attachmentRemainingCards = remaining.length;
  if (!remaining.length) return finish('finishes-hand');
  // The shared scorer already charges 29 for splitting the four-joker bomb. Keep that single
  // protection intact; do not add attachment/pair/per-card charges for the same source resource.
  if (observation.hand.filter(card => card.suit === 'J' && card.rank === 15).length === 2 &&
      observation.hand.filter(card => card.suit === 'J' && card.rank === 16).length === 2) {
    features.attachmentFourJokerDeduplicated = true;
    return finish('existing-four-joker-structure-cost');
  }
  const opponents = ([0, 1, 2, 3] as Seat[]).filter(seat => teamOf(seat) !== observation.team && observation.remainingCounts[seat]! > 0);
  const relevant = opponents.filter(seat => !observation.currentPlay || observation.currentOwner === seat || observation.pendingResponders.includes(seat));
  const shortOpponent = relevant.some(seat => observation.remainingCounts[seat]! <= 3);
  const head = observation.finished[0];
  const placementPressure = head !== undefined && teamOf(head) !== observation.team &&
    observation.currentOwner !== null && opponents.includes(observation.currentOwner) &&
    observation.remainingCounts[observation.currentOwner]! <= 5;
  const nextLeader = observation.passOutcome.nextLeader;
  const denyWind = observation.passOutcome.endsRound && nextLeader !== null &&
    opponents.includes(nextLeader) && observation.remainingCounts[nextLeader]! <= 2;
  const pressure = shortOpponent || placementPressure || denyWind;
  const partnerNearFinish = observation.remainingCounts[observation.partner] === 1;
  const base = parts.attachmentRank === 16 ? config.bigJokerPairCost : config.smallJokerPairCost;
  const opportunity = Math.min(1, remaining.length / config.fullOpportunityCards);
  const controls = remainingControlGroups(observation, remaining);
  const backup = 1 / (1 + config.backupControlDiscount * Math.min(config.maxBackupControls, controls));
  const pressureFactor = pressure ? config.publicPressureFactor : 1;
  const partnerFactor = partnerNearFinish && !pressure ? config.partnerNearFinishFactor : 1;
  Object.assign(features, {
    attachmentBaseCost: base, attachmentOpportunityFactor: opportunity,
    attachmentRemainingControlGroups: controls, attachmentBackupControlFactor: backup,
    attachmentPublicPressure: pressure, attachmentPressureFactor: pressureFactor,
    attachmentPartnerNearFinish: partnerNearFinish, attachmentPartnerFactor: partnerFactor,
  });
  return finish('joker-pair-future-control', base * opportunity * backup * pressureFactor * partnerFactor);
}
