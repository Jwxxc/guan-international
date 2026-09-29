import { createRng, shuffleDeck } from '../../engine/cards';
import { applyAction } from '../../engine/reducer';
import type { Card, GameAction, GameState, Seat } from '../../engine/types';
import { ownAiInput } from '../input';
import { buildPublicKnowledge } from '../publicKnowledge';
import type { AiObservation } from '../types';

export const BELIEF_VERSION = 'public-joint-uniform-v1';
const seats: Seat[] = [0, 1, 2, 3];
const physical = (card: Card) => `${card.deck}:${card.suit}:${card.rank}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export interface BeliefOptions {
  count: number; seed: number; maxAttempts?: number; maxMillis?: number;
  shouldCancel?: () => boolean; now?: () => number;
}
export interface BeliefDiagnostics {
  version: typeof BELIEF_VERSION; requested: number; accepted: number; attempts: number;
  rejected: number; effectiveSampleSize: number; uniqueWorlds: number; elapsedMs: number;
  reason: string | null; hardConstraintsVerified: boolean; behaviorWeighted: false;
}
/** Synthetic worlds are simulator-private, never a policy argument. */
export interface BeliefResult { worlds: GameState[]; diagnostics: BeliefDiagnostics }

/** Replays every public action against a hypothetical allocation. Passing gives no
 * negative card constraint: the engine permits a legal voluntary pass. */
function replayWorld(obs: AiObservation, hands: Card[][]): GameState | null {
  const playedBySeat: Card[][] = seats.map(() => []);
  for (const event of obs.history) if (event.type === 'play') playedBySeat[event.player].push(...event.play!.cards);
  const initialHands = hands.map((hand, seat) => [...hand, ...playedBySeat[seat]]);
  if (initialHands.some(hand => hand.length !== 27)) return null;
  const first = obs.history[0]?.player ?? obs.currentPlayer;
  let state: GameState = {
    sessionId: obs.sessionId, handId: obs.handId, stateVersion: 0, rules: { ...obs.rules },
    hands: structuredClone(initialHands), currentPlayer: first, firstPlayer: first,
    currentPlay: null, currentOwner: null, pendingResponders: [], finished: [], played: [], events: [], result: null,
  };
  for (const event of obs.history) {
    const stamp = { sessionId: state.sessionId, handId: state.handId, stateVersion: state.stateVersion, player: event.player };
    const action: GameAction = event.type === 'pass' ? { ...stamp, type: 'pass' } : {
      ...stamp, type: 'play', cardIds: event.play!.cards.map(card => card.id), playKey: event.play!.key,
    };
    const next = applyAction(state, action);
    if (!next.ok) return null;
    state = next.state;
    const actual = state.events.at(-1)!;
    if (actual.roundEnded !== event.roundEnded || actual.nextPlayer !== event.nextPlayer || actual.finished !== event.finished) return null;
    if (!same(actual.play ?? null, event.play ?? null)) return null;
  }
  if (state.result || state.currentPlayer !== obs.currentPlayer || state.currentOwner !== obs.currentOwner
    || !same(state.currentPlay, obs.currentPlay) || !same(state.pendingResponders, obs.pendingResponders)
    || !same(state.finished, obs.finished) || !same(state.hands.map(hand => hand.length), obs.remainingCounts)) return null;
  return state;
}

/** Uniform joint allocation subject to inventory, public ownership and full legal
 * public history. It makes no behavioral inference and reads no actual hidden state. */
export function sampleBeliefWorlds(input: AiObservation, options: BeliefOptions): BeliefResult {
  const now = options.now ?? (() => performance.now()), started = now();
  const diagnostics: BeliefDiagnostics = { version: BELIEF_VERSION, requested: options.count, accepted: 0, attempts: 0,
    rejected: 0, effectiveSampleSize: 0, uniqueWorlds: 0, elapsedMs: 0, reason: null, hardConstraintsVerified: false, behaviorWeighted: false };
  const worlds: GameState[] = [], signatures = new Set<string>();
  const finish = (reason: string | null): BeliefResult => {
    diagnostics.reason = reason; diagnostics.accepted = worlds.length; diagnostics.effectiveSampleSize = worlds.length;
    diagnostics.uniqueWorlds = signatures.size; diagnostics.elapsedMs = Math.max(0, now() - started);
    diagnostics.hardConstraintsVerified = worlds.length > 0; return { worlds, diagnostics };
  };
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 256 || !Number.isFinite(options.seed)) return finish('invalid-budget');
  const maxAttempts = options.maxAttempts ?? options.count * 2, maxMillis = options.maxMillis ?? 1000;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4096 || !Number.isFinite(maxMillis) || maxMillis < 0) return finish('invalid-budget');
  let obs: AiObservation;
  try { obs = ownAiInput(input); } catch { return finish('invalid-observation'); }
  if (obs.isOver || obs.player !== obs.currentPlayer || !seats.includes(obs.player)) return finish('not-active-turn');
  if (!Number.isInteger(obs.stateVersion) || obs.stateVersion < 0 || obs.history.length > 4096 || obs.history.length !== obs.stateVersion
    || obs.history.some((event, index) => event.index !== index || !seats.includes(event.player)
      || (event.type === 'play' ? !event.play?.cards.length : event.type !== 'pass' || !!event.play))) return finish('incomplete-public-history');
  const knowledge = buildPublicKnowledge(obs);
  if (!knowledge.consistent) return finish(`inconsistent-public-inventory:${knowledge.issues.join(',')}`);
  // Transfers precede ordinary play. Validate known source chains and public plays
  // against the last public owner instead of merely trusting final card counts.
  const owners = new Map<string, Seat>();
  for (const item of obs.antiTributeEvidence) {
    if (!seats.includes(item.player) || owners.has(item.card.id) && owners.get(item.card.id) !== item.player) return finish('conflicting-public-owner');
    owners.set(item.card.id, item.player);
  }
  for (const item of obs.publicTransfers) {
    if (!seats.includes(item.from) || !seats.includes(item.to) || item.from === item.to
      || owners.has(item.card.id) && owners.get(item.card.id) !== item.from) return finish('conflicting-transfer-source');
    owners.set(item.card.id, item.to);
  }
  for (const event of obs.history) for (const card of event.play?.cards ?? []) {
    if (owners.has(card.id) && owners.get(card.id) !== event.player) return finish('public-transfer-play-owner-mismatch');
    owners.delete(card.id);
  }
  const fixed = seats.map(seat => seat === obs.player ? [...obs.hand] : knowledge.knownHeld.filter(item => item.player === seat).map(item => item.card));
  const slots = seats.map(seat => obs.remainingCounts[seat] - fixed[seat].length);
  if (slots.some(n => n < 0) || slots.reduce((a, b) => a + b, 0) !== knowledge.unlocated.length) return finish('joint-capacity-mismatch');
  const publicIds = new Set([...obs.hand, ...knowledge.played, ...knowledge.knownHeld.map(item => item.card)].map(card => card.id));
  const anonymousPool = knowledge.unlocated.map(card => {
    let id = `belief-only:${physical(card)}`;
    while (publicIds.has(id)) id += ':';
    publicIds.add(id); return { ...card, id };
  });
  const rng = createRng(options.seed);
  while (worlds.length < options.count && diagnostics.attempts < maxAttempts) {
    if (options.shouldCancel?.()) return finish('cancelled');
    if (now() - started >= maxMillis) return finish('time-budget');
    diagnostics.attempts++;
    const pool = shuffleDeck(anonymousPool, rng), hands = fixed.map(hand => [...hand]);
    let cursor = 0;
    for (const seat of seats) { hands[seat].push(...pool.slice(cursor, cursor + slots[seat])); cursor += slots[seat]; }
    if (new Set([...hands.flat(), ...knowledge.played].map(physical)).size !== 108) return finish('joint-card-conservation-failed');
    const world = replayWorld(obs, hands);
    if (!world) { diagnostics.rejected++; continue; }
    signatures.add(hands.map(hand => hand.map(physical).sort().join(',')).join('|'));
    worlds.push(world);
  }
  return finish(worlds.length === options.count ? null : 'attempt-budget');
}
