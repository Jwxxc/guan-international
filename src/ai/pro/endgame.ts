import { createDeck } from '../../engine/cards';
import { applyAction } from '../../engine/reducer';
import { resolvePlays } from '../../engine/patterns';
import { canBeat } from '../../engine/compare';
import { teamOf } from '../../engine/rules';
import type { Card, GameAction, GameState, Seat } from '../../engine/types';
import { proveTwoPlayEndgame } from '../endgame/proof';
import { ENDGAME_PROOF_BUDGET } from '../endgame/config';
import { fingerprint } from '../fingerprint';
import { ownAiInput } from '../input';
import type { AiObservation } from '../types';
import { enumerateProActions } from './actions';
import { sampleBeliefWorlds } from './belief';
import type { ProEndgameBudget, ProEndgameResult } from './certificate';
import { PRO_TRANSITION_OBJECTIVE, PRO_TRANSITION_SCOPE, transitionUtility, evaluatePublicFinishOutcome } from './objectives';

export const PRO_ENDGAME_VERSION = 'public-two-active-minimax-v2';
export const PRO_ENDGAME_BUDGET: Readonly<ProEndgameBudget> = Object.freeze({ maxNodes: 2_000, maxActionWork: 250_000, maxActionsPerNode: 40_000, useTwoPlay: true });
const seats: Seat[] = [0, 1, 2, 3];
const face = (card: Card) => `${card.suit}:${card.rank}`;

/** Call only after the frozen proof has replay-validated the full public history.
 * Face deduction is public: 108 faces minus own hand and public plays. Placeholder
 * IDs are unrelated to real opponent IDs. No actual GameState enters this module. */
function reconstructValidatedCurrent(obs: AiObservation, opponent: Seat): GameState {
  const used = new Map<string, number>();
  for (const card of [...obs.hand, ...obs.history.flatMap(event => event.play?.cards ?? [])]) used.set(face(card), (used.get(face(card)) ?? 0) + 1);
  const inferred: Card[] = [];
  const reservedIds = new Set([...obs.hand, ...obs.history.flatMap(event => event.play?.cards ?? [])].map(card => card.id));
  for (const card of createDeck()) {
    const count = used.get(face(card)) ?? 0;
    if (count > 0) { used.set(face(card), count - 1); continue; }
    let id = `pro-proof:${card.suit}:${card.rank}:${card.deck}`;
    while (reservedIds.has(id)) id += ':';
    reservedIds.add(id);
    inferred.push({ ...card, id });
  }
  return { sessionId: obs.sessionId, handId: obs.handId, stateVersion: obs.stateVersion, rules: { ...obs.rules },
    hands: seats.map(seat => seat === obs.player ? structuredClone(obs.hand) : seat === opponent ? inferred : []),
    currentPlayer: obs.currentPlayer, firstPlayer: obs.history[0]!.player, currentPlay: structuredClone(obs.currentPlay),
    currentOwner: obs.currentOwner, pendingResponders: [...obs.pendingResponders], finished: [...obs.finished],
    // Historical legality has been established by the existing proof. These fields
    // are append-only diagnostics, and removing them bounds reducer clone cost.
    played: [], events: [], result: null };
}

/** All future-legality fields plus objective context. Event counters/played history
 * are excluded only after replay validation; the reducer does not consult them. */
export function proEndgameStateKey(state: GameState, objectiveContext: string): string {
  return JSON.stringify([PRO_ENDGAME_VERSION, objectiveContext, state.rules.version, state.rules.levelRank,
    state.hands.map(hand => hand.map(card => [card.id, card.suit, card.rank]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))),
    state.currentPlayer, state.currentPlay?.key ?? null, state.currentOwner, state.pendingResponders, state.finished]);
}

/** Extension of the frozen two-play proof, not a replacement for it. The existing
 * module supplies full public replay validation and frozen settlement outcomes.
 * At most two opposed active seats are covered, with <=12 own / <=8 opponent cards.
 * A truncated search returns unknown and can never override the neural policy. */
export function proveProEndgame(input: AiObservation, limits: Partial<ProEndgameBudget> = {}): ProEndgameResult {
  const budget = { ...PRO_ENDGAME_BUDGET, ...limits };
  if ([budget.maxNodes, budget.maxActionWork, budget.maxActionsPerNode].some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('Invalid PRO endgame budget');
  const obs = ownAiInput(input);
  const tactical = proveTwoPlayEndgame(obs, { ...ENDGAME_PROOF_BUDGET, maxFirstCandidates: budget.useTwoPlay ? ENDGAME_PROOF_BUDGET.maxFirstCandidates : 0 });
  const result: ProEndgameResult = { action: null, tactical, certificate: {
    version: PRO_ENDGAME_VERSION, workBudget: { ...budget }, objectiveId: PRO_TRANSITION_OBJECTIVE, scope: PRO_TRANSITION_SCOPE,
    rulesVersion: obs.mode === 'classic' ? 'guan-classic-house-v1' : obs.mode === 'legacy' ? 'guan-match-v1' : obs.rules.version,
    publicInputFingerprint: fingerprint(obs), status: 'not-applicable', method: 'none', reason: tactical.certificate.reason,
    eligibleOverride: false, lowerBound: null, upperBound: null, nodes: 0, actionWork: 0,
    transpositions: { exact: 0, lower: 0, upper: 0, hits: 0 }, rootActionsComplete: false,
    checkedReplyCount: tactical.certificate.checkedReplyCount,
  } };
  const cert = result.certificate;
  // The frozen heuristic layer assumes its ordinary policy always takes a legal
  // immediate finish. A learned blueprint has no such guarantee. PRO must prove
  // and retain the final action of its certified two-play route itself.
  if (tactical.certificate.reason === 'single-hand-finish-priority') {
    cert.method = 'single-play';
    if (!budget.maxNodes || !budget.maxActionWork || !budget.maxActionsPerNode || obs.history.length > ENDGAME_PROOF_BUDGET.maxHistoryEvents) {
      cert.status = 'unknown'; cert.reason = 'single-play-proof-budget-exhausted'; return result;
    }
    // In this exact two-active scope, all non-own remaining cards belong to one
    // opponent. One public sampler allocation therefore has no hidden ambiguity.
    // It replays the entire history and validates 108-card/public-owner conservation.
    const sampled = sampleBeliefWorlds(obs, { count: 1, seed: 0, maxAttempts: 1, maxMillis: 1, now: () => 0 });
    const model = sampled.worlds[0], opponent = tactical.certificate.forcedResponder;
    if (!model || opponent === undefined) { cert.status = 'unknown'; cert.reason = 'invalid-single-play-public-history'; return result; }
    const own = evaluatePublicFinishOutcome(obs, model, obs.player), other = evaluatePublicFinishOutcome(obs, model, opponent);
    const play = resolvePlays(obs.hand, obs.rules).find(candidate => canBeat(candidate, obs.currentPlay, obs.rules));
    if (!own || !other || !play) { cert.status = 'unknown'; cert.reason = 'invalid-single-play-boundary'; return result; }
    const action: GameAction = { sessionId: obs.sessionId, handId: obs.handId, stateVersion: obs.stateVersion, player: obs.player,
      type: 'play', cardIds: play.cards.map(card => card.id), playKey: play.key };
    const moved = applyAction(model, action); cert.nodes = 1; cert.actionWork = 1;
    if (!moved.ok || !moved.state.result || JSON.stringify(moved.state.result.order) !== JSON.stringify(own.order)) {
      cert.status = 'unknown'; cert.reason = 'invalid-single-play-transition'; return result;
    }
    const ownValue = transitionUtility(own, obs.team), otherValue = transitionUtility(other, obs.team);
    cert.outcomes = { selfThird: own, opponentThird: other }; cert.status = 'exact';
    cert.lowerBound = ownValue; cert.upperBound = ownValue;
    cert.reason = ownValue > otherValue ? 'legal-entire-hand-finish-improves-actual-boundary' : 'placement-only-no-actual-benefit';
    if (ownValue > otherValue) { result.action = action; cert.action = action; cert.eligibleOverride = true; }
    return result;
  }
  const own = tactical.certificate.selfThirdOutcome, other = tactical.certificate.opponentThirdOutcome;
  // These two outcomes are emitted only AFTER the frozen module has replayed every
  // public event and checked current board, ownership, responders and all 108 faces.
  if (!own || !other || tactical.certificate.forcedResponder === undefined) {
    if (tactical.certificate.status === 'budget-exhausted') cert.status = 'unknown';
    return result;
  }
  cert.outcomes = { selfThird: own, opponentThird: other };
  const ownValue = transitionUtility(own, obs.team), otherValue = transitionUtility(other, obs.team);
  const low = Math.min(ownValue, otherValue), high = Math.max(ownValue, otherValue);
  cert.lowerBound = low; cert.upperBound = high;
  if (budget.useTwoPlay && tactical.certificate.status === 'proved') {
    cert.status = 'exact'; cert.method = 'two-play'; cert.reason = tactical.certificate.reason;
    cert.lowerBound = ownValue; cert.upperBound = ownValue;
    // The two possible outcomes bound the objective. A guaranteed maximal route is
    // sufficient even though all alternative root moves need not be enumerated.
    if (ownValue > otherValue && tactical.choices[0]) {
      result.action = tactical.choices[0].first; cert.action = result.action; cert.eligibleOverride = true;
    }
    return result;
  }
  const model = reconstructValidatedCurrent(obs, tactical.certificate.forcedResponder);
  type Entry = { value: number; flag: 'exact' | 'lower' | 'upper' };
  const table = new Map<string, Entry>();
  const context = JSON.stringify([PRO_TRANSITION_OBJECTIVE, obs.mode, obs.matchContext, obs.team]);
  const exhausted = Symbol('proof-budget');
  const save = (key: string, value: number, flag: Entry['flag']) => { table.set(key, { value, flag }); cert.transpositions[flag]++; };
  const actionsFor = (state: GameState) => {
    const enumeration = enumerateProActions({ sessionId: state.sessionId, handId: state.handId, stateVersion: state.stateVersion,
      player: state.currentPlayer, team: teamOf(state.currentPlayer), hand: state.hands[state.currentPlayer]!, rules: state.rules,
      remainingCounts: state.hands.map(hand => hand.length), currentPlayer: state.currentPlayer, currentPlay: state.currentPlay,
      currentOwner: state.currentOwner, finished: state.finished, history: [], isOver: !!state.result },
    { maxWork: Math.max(0, budget.maxActionWork - cert.actionWork), maxActions: budget.maxActionsPerNode });
    cert.actionWork += enumeration.work;
    if (!enumeration.complete || !enumeration.actions.length) throw exhausted;
    return enumeration.actions.sort((a, b) => (b.play?.size ?? 0) - (a.play?.size ?? 0) || a.id.localeCompare(b.id));
  };
  const advance = (state: GameState, action: GameAction) => {
    const moved = applyAction(state, action);
    if (!moved.ok) throw Error(`PRO generated illegal action: ${moved.error}`);
    return moved.state;
  };
  const visit = (state: GameState, alpha: number, beta: number): number => {
    if (cert.nodes >= budget.maxNodes) throw exhausted;
    cert.nodes++;
    if (state.result) return state.result.order[2] === obs.player ? ownValue : otherValue;
    const key = proEndgameStateKey(state, context), entry = table.get(key);
    const originalAlpha = alpha, originalBeta = beta;
    if (entry) {
      cert.transpositions.hits++;
      if (entry.flag === 'exact') return entry.value;
      if (entry.flag === 'lower') alpha = Math.max(alpha, entry.value); else beta = Math.min(beta, entry.value);
      if (alpha >= beta) return entry.value;
    }
    const maximizing = teamOf(state.currentPlayer) === obs.team;
    let value = maximizing ? -Infinity : Infinity;
    for (const candidate of actionsFor(state)) {
      const child = visit(advance(state, candidate.action), alpha, beta);
      value = maximizing ? Math.max(value, child) : Math.min(value, child);
      if (maximizing) alpha = Math.max(alpha, value); else beta = Math.min(beta, value);
      if (alpha >= beta) break;
    }
    save(key, value, value <= originalAlpha ? 'upper' : value >= originalBeta ? 'lower' : 'exact');
    return value;
  };
  cert.method = 'alpha-beta';
  try {
    if (budget.maxNodes === 0) throw exhausted;
    const roots = actionsFor(model); cert.rootActionsComplete = true;
    let best = -Infinity, chosen: GameAction | null = null;
    for (const candidate of roots) {
      const value = visit(advance(model, candidate.action), best, Infinity);
      if (value > best) { best = value; chosen = candidate.action; }
    }
    cert.status = 'exact'; cert.reason = 'all-root-actions-solved-for-current-hand-boundary';
    cert.lowerBound = best; cert.upperBound = best;
    // Equal capped outcomes carry no strict progress advantage. Keeping the base
    // action avoids inventing a whole-match ordering from tribute/placement alone.
    if (best > low && chosen) { result.action = chosen; cert.action = chosen; cert.eligibleOverride = true; }
  } catch (error) {
    if (error !== exhausted) throw error;
    cert.status = 'unknown'; cert.reason = 'proof-work-budget-exhausted';
    result.action = null; cert.eligibleOverride = false;
  }
  return result;
}
