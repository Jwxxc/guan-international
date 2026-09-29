import { ownAiInput } from '../input';
import { sampleBeliefWorlds, BELIEF_VERSION, type BeliefOptions, type BeliefDiagnostics } from '../pro/belief';
import type { AiObservation } from '../types';
import type { GameState } from '../../engine/types';

export const JWXXC_BELIEF_VERSION = 'jwxxc-public-joint-replay-v1' as const;
export type JwxxcBeliefOptions = BeliefOptions;
export interface JwxxcBeliefDiagnostics extends Omit<BeliefDiagnostics, 'version'> {
  version: typeof JWXXC_BELIEF_VERSION;
  reusedSamplerVersion: typeof BELIEF_VERSION;
  constraintScope: 'own-hand-counts-public-ownership-and-full-legal-replay';
}
export interface JwxxcBeliefResult { worlds: GameState[]; diagnostics: JwxxcBeliefDiagnostics }

/** Reuses the audited uniform allocation and complete history replay. The extra allowlist boundary
 * is intentional: neither authority state nor a future/private field can reach this sampler. */
export function sampleJwxxcWorlds(input: AiObservation, options: JwxxcBeliefOptions): JwxxcBeliefResult {
  const result = sampleBeliefWorlds(ownAiInput(input), options);
  return { worlds: result.worlds, diagnostics: {
    ...result.diagnostics, version: JWXXC_BELIEF_VERSION, reusedSamplerVersion: BELIEF_VERSION,
    constraintScope: 'own-hand-counts-public-ownership-and-full-legal-replay',
  } };
}
