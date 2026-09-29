import { createRng } from '../../engine/cards';
import { bombTier } from '../../engine/compare';
import { applyAction, getResult } from '../../engine/reducer';
import { partnerOf, teamOf } from '../../engine/rules';
import type { GameAction, GameState, PlayKind, Rng, Seat } from '../../engine/types';
import { getAiObservation } from '../../game/aiObservation';
import { createMatchProgress, settleMatchProgress } from '../../match/progression';
import { ownAiInput } from '../input';
import type { AiObservation } from '../types';
import { sampleJwxxcWorlds, type JwxxcBeliefDiagnostics } from './belief';
import { fingerprint } from '../fingerprint';
import { JWXXC_SEARCH_BUDGET } from './budgets';
import { JWXXC_ROUND_OBJECTIVE, jwxxcTerminalReturn } from './objectives';

export const JWXXC_ROLLOUT_VERSION = 'jwxxc-belief-rollout-v1';
export const JWXXC_ROLLOUT_OBJECTIVE = JWXXC_ROUND_OBJECTIVE;
/** Deliberately no GameState, world index, root action, private cache or authority. */
export type JwxxcObservationContinuation = (observation: AiObservation, rng: Rng) => GameAction;
export interface JwxxcRolloutOptions {
  enabled?: boolean; seed: number; sampleCount?: number; confirmationCount?: number;
  maxRootActions?: number; maxPlies?: number; maxTransitions?: number; maxMillis?: number;
  confidenceAlpha?: number; minImprovement?: number; shouldCancel?: () => boolean; now?: () => number;
  /** Optional same-objective model scores, keyed by playKey or pass; never root-array indices. */
  rootScores?: Readonly<Record<string, number>>;
}
export const JWXXC_ROLLOUT_DEFAULTS = JWXXC_SEARCH_BUDGET;
export interface JwxxcRolloutDiagnostics {
  version: typeof JWXXC_ROLLOUT_VERSION; objectiveId: typeof JWXXC_ROLLOUT_OBJECTIVE; exact: false;
  enabled: boolean; changedAction: boolean; fallbackReason: string | null; transitions: number; policyCalls: number;
  selectionWorlds: number; confirmationWorlds: number; candidateCount: number; elapsedMs: number;
  selectedMeanDifference: number | null; confirmationMeanDifference: number | null; confirmationLowerBound: number | null;
  rootActionKeys: string[]; selectionMeanDifferences: Record<string, number>;
  selectionSeed: number; confirmationSeed: number; continuationSeedPolicy: 'same-information-same-seed';
  truncatedValueUsed: false;
  confidenceAlpha: number; sampling: JwxxcBeliefDiagnostics[]; intervalsDescribe: 'sample-model-monte-carlo-only';
}
export interface JwxxcRolloutResult { action: GameAction; diagnostics: JwxxcRolloutDiagnostics }
const identity = (action: GameAction) => action.type === 'pass' ? 'pass' : `${[...action.cardIds].sort().join(',')}|${action.playKey}`;

/** Production roots come from the complete legal-action enumerator. The declared play key's
 * kind and the physical-card count identify a tactical family without changing any Q score. */
function rootFamily(action: GameAction): string {
  if (action.type === 'pass') return 'pass';
  const kind = action.playKey.split(':', 1)[0] as PlayKind;
  return `${kind}:${bombTier(kind, action.cardIds.length)}`;
}

/** Always retain the model's base, then legal PASS, then highest-Q distinct kinds/bomb tiers.
 * The remaining capacity follows Q/key order, preserving alternative physical structures. */
export function selectJwxxcRoots(roots: readonly GameAction[], base: GameAction, limit: number,
  rootScores: Readonly<Record<string, number>> = {}): GameAction[] {
  const unique = new Map<string, GameAction>([[identity(base), base]]);
  for (const root of roots) if (!unique.has(identity(root))) unique.set(identity(root), root);
  const score = (action: GameAction) => rootScores[action.type === 'pass' ? 'pass' : action.playKey] ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 64 || [...unique.values()].some(action => !Number.isFinite(score(action))))
    throw Error('Invalid JWXXC root selection budget or model score');
  const ranked = [...unique.values()].filter(action => identity(action) !== identity(base))
    .sort((a, b) => score(b) - score(a) || identity(a).localeCompare(identity(b)));
  const selected = [base], used = new Set([identity(base)]), families = new Set([rootFamily(base)]);
  const add = (action: GameAction) => {
    if (selected.length >= limit || used.has(identity(action))) return;
    selected.push(action); used.add(identity(action)); families.add(rootFamily(action));
  };
  const pass = ranked.find(action => action.type === 'pass');
  if (pass) add(pass);
  for (const action of ranked) if (!families.has(rootFamily(action))) add(action);
  for (const action of ranked) add(action);
  return selected;
}

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
/** Per-information-set random stream: hidden world number and candidate order are absent.
 * Anonymous physical-copy IDs/deck labels are omitted as they do not reveal different faces.
 * The same actor information and declared search seed always produce the same random stream. */
export function jwxxcContinuationSeed(input: AiObservation, seed: number): number {
  const obs = ownAiInput(input);
  const faces = (cards: readonly {rank:number;suit:string}[]) => cards.map(card => `${card.suit}:${card.rank}`).sort();
  const play = (value: AiObservation['currentPlay']) => value ? {
    kind:value.kind,size:value.size,value:value.value,cards:faces(value.cards),
    wildcards:value.wildcards.map(item=>`${item.rank}:${item.suit}`).sort(),
  } : null;
  const information = {
    player:obs.player,team:obs.team,partner:obs.partner,hand:faces(obs.hand),rules:obs.rules,
    remainingCounts:obs.remainingCounts,currentPlayer:obs.currentPlayer,currentPlay:play(obs.currentPlay),
    currentOwner:obs.currentOwner,pendingResponders:obs.pendingResponders,finished:obs.finished,stateVersion:obs.stateVersion,
    history:obs.history.map(event=>({index:event.index,player:event.player,type:event.type,play:play(event.play??null),
      roundEnded:event.roundEnded,nextPlayer:event.nextPlayer,finished:event.finished??null})),
    mode:obs.mode,matchContext:obs.matchContext,finishOutcome:obs.finishOutcome,passOutcome:obs.passOutcome,
    publicTransfers:obs.publicTransfers.map(item=>[item.from,item.to,item.type,item.card.suit,item.card.rank]),
    antiTributeEvidence:obs.antiTributeEvidence.map(item=>[item.player,item.card.suit,item.card.rank]),
  };
  return (seed ^ Number.parseInt(fingerprint(information), 16) ^ 0x9e3779b9) >>> 0;
}

/** Paired root rollouts, followed by a fresh confirmation batch. This is neither
 * GS2 nor an information-set subgame solver. Truncation has no heuristic payoff. */
export function jwxxcBeliefRollout(input: AiObservation, roots: GameAction[], base: GameAction,
  continuation: JwxxcObservationContinuation, options: JwxxcRolloutOptions): JwxxcRolloutResult {
  const config = { ...JWXXC_ROLLOUT_DEFAULTS, ...options };
  const now = options.now ?? (() => performance.now()), started = now();
  const diagnostics: JwxxcRolloutDiagnostics = { version: JWXXC_ROLLOUT_VERSION, objectiveId: JWXXC_ROLLOUT_OBJECTIVE, exact: false,
    enabled: config.enabled, changedAction: false, fallbackReason: null, transitions: 0, policyCalls: 0,
    selectionWorlds: 0, confirmationWorlds: 0, candidateCount: 0, elapsedMs: 0,
    selectedMeanDifference: null, confirmationMeanDifference: null, confirmationLowerBound: null,
    rootActionKeys: [], selectionMeanDifferences: {}, selectionSeed: (config.seed ^ 0x243f6a88) >>> 0,
    confirmationSeed: (config.seed ^ 0xa4093822) >>> 0, continuationSeedPolicy: 'same-information-same-seed', truncatedValueUsed: false,
    confidenceAlpha: config.confidenceAlpha, sampling: [], intervalsDescribe: 'sample-model-monte-carlo-only' };
  const finish = (reason: string | null, action = base): JwxxcRolloutResult => {
    diagnostics.fallbackReason = reason; diagnostics.changedAction = identity(action) !== identity(base);
    diagnostics.elapsedMs = Math.max(0, now() - started); return { action: structuredClone(action), diagnostics };
  };
  if (!config.enabled) return finish('search-disabled');
  if (!Number.isFinite(config.seed) || !Number.isFinite(config.maxMillis) || config.maxMillis < 0 || config.maxMillis > 1500
    || !Number.isFinite(config.confidenceAlpha) || config.confidenceAlpha <= 0 || config.confidenceAlpha >= 1
    || !Number.isFinite(config.minImprovement) || config.minImprovement < 0
    || [config.sampleCount, config.confirmationCount, config.maxRootActions, config.maxPlies, config.maxTransitions].some(n => !Number.isInteger(n) || n < 1)
    || config.sampleCount > 256 || config.confirmationCount > 256 || config.maxRootActions > 64 || config.maxPlies > 4096 || config.maxTransitions > 1000000) return finish('invalid-budget');
  const obs = ownAiInput(input);
  let candidates: GameAction[];
  try { candidates = selectJwxxcRoots(roots, base, config.maxRootActions, options.rootScores); }
  catch { return finish('invalid-root-scores'); }
  diagnostics.rootActionKeys = candidates.map(action=>action.type==='pass'?'pass':action.playKey);
  diagnostics.candidateCount = candidates.length;
  if (candidates.length < 2) return finish('no-alternative');
  let stopped: string | null = null;
  const exhausted = () => {
    if (options.shouldCancel?.()) stopped = 'cancelled';
    else if (now() - started >= config.maxMillis) stopped = 'time-budget';
    else if (diagnostics.transitions >= config.maxTransitions) stopped = 'transition-budget';
    return stopped !== null;
  };
  const simulate = (world: GameState, root: GameAction): number | null => {
    if (exhausted()) return null;
    let next = applyAction(world, root); diagnostics.transitions++;
    if (!next.ok) { stopped = 'invalid-root-action'; return null; }
    let state = next.state;
    for (let ply = 0; ply < config.maxPlies; ply++) {
      if (state.result) return jwxxcTerminalReturn(state, obs.player);
      if (exhausted()) return null;
      const local = localObservation(state, obs);
      // One common declared seed across selection and confirmation. World sampling uses
      // independent streams, while a continuation with the same information is identical.
      const rng = createRng(jwxxcContinuationSeed(local, config.seed));
      let action: GameAction;
      try { action = continuation(local, rng); } catch { stopped = 'continuation-error'; return null; }
      diagnostics.policyCalls++;
      if (exhausted()) return null;
      next = applyAction(state, action); diagnostics.transitions++;
      if (!next.ok) { stopped = 'invalid-continuation-action'; return null; }
      state = next.state;
    }
    if (state.result) return jwxxcTerminalReturn(state, obs.player);
    stopped = 'unvalued-truncation'; return null;
  };
  const sample = (count: number, seed: number) => {
    const sampled = sampleJwxxcWorlds(obs, { count, seed, maxAttempts: count * 2,
      maxMillis: Math.max(0, config.maxMillis - (now() - started)), shouldCancel: options.shouldCancel, now });
    diagnostics.sampling.push(sampled.diagnostics);
    if (sampled.worlds.length !== count) { stopped = `sampling:${sampled.diagnostics.reason ?? 'incomplete'}`; return null; }
    return sampled.worlds;
  };
  const selection = sample(config.sampleCount, diagnostics.selectionSeed);
  if (!selection) return finish(stopped);
  const differences = candidates.map(() => [] as number[]);
  for (let i = 0; i < selection.length; i++) {
    const reference = simulate(selection[i], base);
    if (reference === null) return finish(stopped);
    differences[0].push(0);
    for (let j = 1; j < candidates.length; j++) {
      const reward = simulate(selection[i], candidates[j]);
      if (reward === null) return finish(stopped);
      differences[j].push(reward - reference);
    }
    diagnostics.selectionWorlds++;
  }
  const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
  const means = differences.map(mean);
  candidates.forEach((action,index)=>{diagnostics.selectionMeanDifferences[action.type==='pass'?'pass':action.playKey]=means[index]!;});
  const selected = means.reduce((best, value, index) => value > means[best] ? index : best, 0);
  diagnostics.selectedMeanDifference = means[selected];
  if (selected === 0 || means[selected] <= config.minImprovement) return finish('selection-no-improvement');
  const confirmation = sample(config.confirmationCount, diagnostics.confirmationSeed);
  if (!confirmation) return finish(stopped);
  const confirmed: number[] = [];
  for (let i = 0; i < confirmation.length; i++) {
    const reference = simulate(confirmation[i], base);
    if (reference === null) return finish(stopped);
    const reward = simulate(confirmation[i], candidates[selected]);
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
