import { createRng } from '../../engine/cards';
import { applyAction, getResult } from '../../engine/reducer';
import { partnerOf, teamOf } from '../../engine/rules';
import type { GameAction, GameState, Rng, Seat } from '../../engine/types';
import { getAiObservation } from '../../game/aiObservation';
import { createMatchProgress, settleMatchProgress } from '../../match/progression';
import { ownAiInput } from '../input';
import type { AiObservation } from '../types';
import { sampleBeliefWorlds, type BeliefDiagnostics } from './belief';

export const ROLLOUT_VERSION = 'belief-rollout-v1';
export const ROLLOUT_OBJECTIVE = 'round-return-nominal-v1';
/** Deliberately no GameState, world index, root action, private cache or authority. */
export type ObservationContinuation = (observation: AiObservation, rng: Rng) => GameAction;
export interface RolloutOptions {
  enabled?: boolean; seed: number; sampleCount?: number; confirmationCount?: number;
  maxRootActions?: number; maxPlies?: number; maxTransitions?: number; maxMillis?: number;
  confidenceAlpha?: number; minImprovement?: number; shouldCancel?: () => boolean; now?: () => number;
}
export const ROLLOUT_SMOKE_OPTIONS = Object.freeze({ enabled: false, sampleCount: 4, confirmationCount: 8,
  maxRootActions: 4, maxPlies: 160, maxTransitions: 4096, maxMillis: 1500, confidenceAlpha: 0.05, minImprovement: 0.1 });
export interface RolloutDiagnostics {
  version: typeof ROLLOUT_VERSION; objectiveId: typeof ROLLOUT_OBJECTIVE; exact: false;
  enabled: boolean; changedAction: boolean; fallbackReason: string | null; transitions: number; policyCalls: number;
  selectionWorlds: number; confirmationWorlds: number; candidateCount: number; elapsedMs: number;
  selectedMeanDifference: number | null; confirmationMeanDifference: number | null; confirmationLowerBound: number | null;
  confidenceAlpha: number; sampling: BeliefDiagnostics[]; intervalsDescribe: 'sample-model-monte-carlo-only';
}
export interface RolloutResult { action: GameAction; diagnostics: RolloutDiagnostics }
const identity = (action: GameAction) => action.type === 'pass' ? 'pass' : `${[...action.cardIds].sort().join(',')}|${action.playKey}`;

/** Rebuild the simulated actor's allowlisted input. Only public match metadata is
 * inherited from the root. The simulator's sampled hands do not cross this call. */
function localObservation(state: GameState, context: AiObservation): AiObservation {
  const actor = state.currentPlayer, obs = getAiObservation(state, actor);
  obs.mode = context.mode; obs.matchContext = context.matchContext ? structuredClone(context.matchContext) : null;
  obs.publicTransfers = structuredClone(context.publicTransfers); obs.antiTributeEvidence = structuredClone(context.antiTributeEvidence);
  if (obs.matchContext) {
    const order = obs.finished.includes(actor) ? obs.finished : [...obs.finished, actor];
    const result = getResult(order);
    const progress = { ...createMatchProgress(obs.mode === 'legacy' ? 'guan-match-v1' : 'guan-classic-house-v1'),
      teamLevels: obs.matchContext.teamLevels, activeTeam: obs.matchContext.levelOwnerTeamId, handNumber: obs.matchContext.handNumber };
    const settled = result ? settleMatchProgress(progress, { ...state, result }) : null;
    obs.finishOutcome.nominalAdvance = settled?.ok ? settled.progress.lastAdvance?.steps ?? null : null;
    obs.finishOutcome.passesAce = settled?.ok ? settled.progress.lastAdvance?.passedAce ?? false : false;
  }
  return ownAiInput(obs);
}
function terminalReturn(state: GameState, actor: Seat): number {
  const result = state.result!;
  const advance = 4 - result.order.indexOf(partnerOf(result.order[0]));
  return (result.winningTeam === teamOf(actor) ? 1 : -1) * advance;
}
function streamSeed(seed: number, world: number, actor: Seat, decision: number): number {
  return (seed ^ Math.imul(world + 1, 0x85ebca6b) ^ Math.imul(actor + 1, 0xc2b2ae35) ^ Math.imul(decision + 1, 0x27d4eb2f)) >>> 0;
}

/** Paired root rollouts, followed by a fresh confirmation batch. This is neither
 * GS2 nor an information-set subgame solver. Truncation has no heuristic payoff. */
export function beliefRollout(input: AiObservation, roots: GameAction[], base: GameAction,
  continuation: ObservationContinuation, options: RolloutOptions): RolloutResult {
  const config = { ...ROLLOUT_SMOKE_OPTIONS, ...options };
  const now = options.now ?? (() => performance.now()), started = now();
  const diagnostics: RolloutDiagnostics = { version: ROLLOUT_VERSION, objectiveId: ROLLOUT_OBJECTIVE, exact: false,
    enabled: config.enabled, changedAction: false, fallbackReason: null, transitions: 0, policyCalls: 0,
    selectionWorlds: 0, confirmationWorlds: 0, candidateCount: 0, elapsedMs: 0,
    selectedMeanDifference: null, confirmationMeanDifference: null, confirmationLowerBound: null,
    confidenceAlpha: config.confidenceAlpha, sampling: [], intervalsDescribe: 'sample-model-monte-carlo-only' };
  const finish = (reason: string | null, action = base): RolloutResult => {
    diagnostics.fallbackReason = reason; diagnostics.changedAction = identity(action) !== identity(base);
    diagnostics.elapsedMs = Math.max(0, now() - started); return { action: structuredClone(action), diagnostics };
  };
  if (!config.enabled) return finish('search-disabled');
  if (!Number.isFinite(config.seed) || !Number.isFinite(config.maxMillis) || config.maxMillis < 0
    || !Number.isFinite(config.confidenceAlpha) || config.confidenceAlpha <= 0 || config.confidenceAlpha >= 1
    || !Number.isFinite(config.minImprovement) || config.minImprovement < 0
    || [config.sampleCount, config.confirmationCount, config.maxRootActions, config.maxPlies, config.maxTransitions].some(n => !Number.isInteger(n) || n < 1)
    || config.sampleCount > 256 || config.confirmationCount > 256 || config.maxRootActions > 64 || config.maxPlies > 4096 || config.maxTransitions > 1000000) return finish('invalid-budget');
  const obs = ownAiInput(input);
  const unique = new Map<string, GameAction>([[identity(base), base]]);
  for (const root of roots) if (!unique.has(identity(root))) unique.set(identity(root), root);
  const candidates = [...unique.values()].slice(0, config.maxRootActions);
  diagnostics.candidateCount = candidates.length;
  if (candidates.length < 2) return finish('no-alternative');
  let stopped: string | null = null;
  const exhausted = () => {
    if (options.shouldCancel?.()) stopped = 'cancelled';
    else if (now() - started >= config.maxMillis) stopped = 'time-budget';
    else if (diagnostics.transitions >= config.maxTransitions) stopped = 'transition-budget';
    return stopped !== null;
  };
  const simulate = (world: GameState, root: GameAction, worldIndex: number, batchSeed: number): number | null => {
    if (exhausted()) return null;
    let next = applyAction(world, root); diagnostics.transitions++;
    if (!next.ok) { stopped = 'invalid-root-action'; return null; }
    let state = next.state;
    const perActorDecisions = [0, 0, 0, 0];
    for (let ply = 0; ply < config.maxPlies; ply++) {
      if (state.result) return terminalReturn(state, obs.player);
      if (exhausted()) return null;
      const actor = state.currentPlayer;
      // Common random numbers indexed by actor's decision ordinal, independent
      // of root candidate iteration order or another actor's sampling usage.
      const rng = createRng(streamSeed(batchSeed, worldIndex, actor, perActorDecisions[actor]++));
      let action: GameAction;
      try { action = continuation(localObservation(state, obs), rng); } catch { stopped = 'continuation-error'; return null; }
      diagnostics.policyCalls++;
      if (exhausted()) return null;
      next = applyAction(state, action); diagnostics.transitions++;
      if (!next.ok) { stopped = 'invalid-continuation-action'; return null; }
      state = next.state;
    }
    if (state.result) return terminalReturn(state, obs.player);
    stopped = 'unvalued-truncation'; return null;
  };
  const sample = (count: number, seed: number) => {
    const sampled = sampleBeliefWorlds(obs, { count, seed, maxAttempts: count * 2,
      maxMillis: Math.max(0, config.maxMillis - (now() - started)), shouldCancel: options.shouldCancel, now });
    diagnostics.sampling.push(sampled.diagnostics);
    if (sampled.worlds.length !== count) { stopped = `sampling:${sampled.diagnostics.reason ?? 'incomplete'}`; return null; }
    return sampled.worlds;
  };
  const selection = sample(config.sampleCount, config.seed ^ 0x243f6a88);
  if (!selection) return finish(stopped);
  const differences = candidates.map(() => [] as number[]);
  for (let i = 0; i < selection.length; i++) {
    const reference = simulate(selection[i], base, i, config.seed ^ 0x13198a2e);
    if (reference === null) return finish(stopped);
    differences[0].push(0);
    for (let j = 1; j < candidates.length; j++) {
      const reward = simulate(selection[i], candidates[j], i, config.seed ^ 0x13198a2e);
      if (reward === null) return finish(stopped);
      differences[j].push(reward - reference);
    }
    diagnostics.selectionWorlds++;
  }
  const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
  const means = differences.map(mean);
  const selected = means.reduce((best, value, index) => value > means[best] ? index : best, 0);
  diagnostics.selectedMeanDifference = means[selected];
  if (selected === 0 || means[selected] <= config.minImprovement) return finish('selection-no-improvement');
  const confirmation = sample(config.confirmationCount, config.seed ^ 0xa4093822);
  if (!confirmation) return finish(stopped);
  const confirmed: number[] = [];
  for (let i = 0; i < confirmation.length; i++) {
    const reference = simulate(confirmation[i], base, i, config.seed ^ 0x082efa98);
    if (reference === null) return finish(stopped);
    const reward = simulate(confirmation[i], candidates[selected], i, config.seed ^ 0x082efa98);
    if (reward === null) return finish(stopped);
    confirmed.push(reward - reference); diagnostics.confirmationWorlds++;
  }
  diagnostics.confirmationMeanDifference = mean(confirmed);
  // Fixed-size one-sided Hoeffding bound. The difference lies in [-6, 6].
  // Selection worlds are excluded from this bound and cannot inflate n.
  diagnostics.confirmationLowerBound = diagnostics.confirmationMeanDifference - 12 * Math.sqrt(Math.log(1 / config.confidenceAlpha) / (2 * confirmed.length));
  if (diagnostics.confirmationLowerBound <= config.minImprovement) return finish('confirmation-inconclusive');
  return finish(null, candidates[selected]);
}
