import { teamOf } from '../../engine/rules';
import type { GameAction, PlayerObservation, ResolvedPlay, Rng } from '../../engine/types';
import { AI_WEIGHTS, rankAiMoves } from './evaluation';
export { rankAiMoves } from './evaluation';

/** Observation-only API. Randomness is supplied by an AI stream, never the deal stream. */
export function chooseAiAction(observation: PlayerObservation, legalMoves: ResolvedPlay[], rng: Rng): GameAction {
  if (observation.isOver || observation.currentPlayer !== observation.player) throw new Error('AI 只能为当前行动者生成动作');
  const stamp = { sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion, player: observation.player };
  const ranked = rankAiMoves(observation, legalMoves);
  const partnerLeading = observation.currentOwner !== null && teamOf(observation.currentOwner) === observation.team;
  const passScore = partnerLeading ? AI_WEIGHTS.partnerPass : AI_WEIGHTS.normalPass;
  if (observation.currentPlay && (!ranked.length || ranked[0].score < passScore)) return { ...stamp, type: 'pass' };
  if (!ranked.length) throw new Error('AI 首出时没有合法候选；候选生成器必须包含单张');
  const best = ranked.filter((move) => Math.abs(move.score - ranked[0].score) < 0.001);
  const chosen = best[Math.min(best.length - 1, Math.floor(rng() * best.length))].play;
  return { ...stamp, type: 'play', cardIds: chosen.cards.map((card) => card.id), playKey: chosen.key };
}
