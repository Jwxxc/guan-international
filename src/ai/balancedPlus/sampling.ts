import { createRng, shuffleDeck } from '../../engine/cards';
import type { Card, GameState, Seat } from '../../engine/types';
import { ownAiInput } from '../input';
import { sampleBeliefWorlds } from '../pro/belief';
import { buildPublicKnowledge } from '../publicKnowledge';
import type { AiObservation } from '../types';

export const BALANCED_PLUS_SAMPLING_VERSION = 'balanced-plus-public-reallocation-v1';
const seats: Seat[] = [0, 1, 2, 3];
const physical = (card: Card) => `${card.deck}:${card.suit}:${card.rank}`;

export interface BalancedPlusSamplingDiagnostics {
  version: typeof BALANCED_PLUS_SAMPLING_VERSION;
  requested: number;
  accepted: number;
  uniqueWorlds: number;
  reason: string | null;
  hardConstraintsVerified: boolean;
  behaviorWeighted: false;
  publicHistoryReplays: number;
  publicHistorySteps: number;
}
export interface BalancedPlusSamplingResult {
  /** Simulator-private. Reattach the original public history before constructing
   * any continuation policy observation; these worlds retain only future events. */
  worlds: GameState[];
  diagnostics: BalancedPlusSamplingDiagnostics;
}

/** Validate a single uniform public world with the audited full-history sampler,
 * then reallocate only anonymous cards that have never appeared in a play. Every
 * seat retains its current card count and publicly known held cards. Historical
 * actions use the same cards, so their legality and finish order cannot change.
 * Voluntary PASS is legal regardless of held cards and adds no negative evidence.
 * This is uniform possibility sampling, never an inference of real hidden hands.
 */
export function sampleBalancedPlusWorlds(input: AiObservation, count: number, seed: number): BalancedPlusSamplingResult {
  const diagnostics: BalancedPlusSamplingDiagnostics = {
    version: BALANCED_PLUS_SAMPLING_VERSION, requested: count, accepted: 0, uniqueWorlds: 0,
    reason: null, hardConstraintsVerified: false, behaviorWeighted: false,
    publicHistoryReplays: 0, publicHistorySteps: 0,
  };
  const worlds: GameState[] = [];
  const finish = (reason: string | null): BalancedPlusSamplingResult => {
    diagnostics.reason = reason;
    diagnostics.accepted = worlds.length;
    diagnostics.hardConstraintsVerified = worlds.length > 0;
    return { worlds, diagnostics };
  };
  if (!Number.isInteger(count) || count < 1 || count > 256 || !Number.isFinite(seed)) return finish('invalid-budget');
  let obs: AiObservation;
  try { obs = ownAiInput(input); } catch { return finish('invalid-observation'); }
  const validated = sampleBeliefWorlds(obs, { count: 1, seed, maxAttempts: 1, maxMillis: 1, now: () => 0 });
  diagnostics.publicHistoryReplays = validated.diagnostics.attempts;
  const template = validated.worlds[0];
  if (!template) return finish(validated.diagnostics.reason ?? 'public-history-validation-failed');
  diagnostics.publicHistorySteps = obs.history.length;
  const knowledge = buildPublicKnowledge(obs);
  const fixed = seats.map(seat => seat === obs.player ? obs.hand : knowledge.knownHeld.filter(item => item.player === seat).map(item => item.card));
  const fixedIds = new Set(fixed.flat().map(card => card.id));
  // Stable ordering removes the validator's sampled allocation from subsequent
  // seed consumption, and keeps worlds independent of the display hand order.
  const anonymous = template.hands.flat().filter(card => !fixedIds.has(card.id)).sort((a, b) => a.id.localeCompare(b.id));
  const slots = seats.map(seat => obs.remainingCounts[seat]! - fixed[seat]!.length);
  if (!knowledge.consistent || slots.some(n => n < 0) || slots.reduce((sum, n) => sum + n, 0) !== anonymous.length) {
    return finish('joint-capacity-mismatch');
  }
  const rng = createRng(seed), signatures = new Set<string>();
  for (let index = 0; index < count; index++) {
    const pool = shuffleDeck(anonymous, rng);
    let cursor = 0;
    const hands = fixed.map((hand, seat) => {
      const next = [...hand, ...pool.slice(cursor, cursor + slots[seat]!)].map(card => ({ ...card }));
      cursor += slots[seat]!;
      return next;
    });
    signatures.add(hands.map(hand => hand.map(physical).sort().join(',')).join('|'));
    // Clone mutable board fields per world. History is known and already checked;
    // retaining it here would make every reducer transition clone it repeatedly.
    worlds.push({ ...template, rules: { ...template.rules }, hands,
      currentPlay: structuredClone(template.currentPlay), pendingResponders: [...template.pendingResponders],
      finished: [...template.finished], played: [], events: [], result: null });
  }
  diagnostics.uniqueWorlds = signatures.size;
  return finish(null);
}
