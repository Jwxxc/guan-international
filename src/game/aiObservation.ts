import { getObservation } from '../engine/observations';
import { partnerOf, teamOf } from '../engine/rules';
import type { GameState, Seat } from '../engine/types';
import type { AiObservation } from '../ai/types';
import type { MatchSession } from '../match/sessionTypes';
import { getExchangeObservation } from '../match/exchange';
import { getResult } from '../engine/reducer';
import { createMatchProgress, settleMatchProgress } from '../match/progression';

/** Authority boundary. Only this adapter sees the game/session; policies receive a detached allowlist. */
export function getAiObservation(state: GameState, player: Seat, match?: MatchSession | null): AiObservation {
  const base = getObservation(state, player);
  if (match && (match.saved.state.sessionId !== state.sessionId || match.saved.state.handId !== state.handId || match.saved.state.stateVersion !== state.stateVersion)) throw Error('AI 观察与当前副不一致');
  const order = base.finished.includes(player) ? [...base.finished] : [...base.finished, player];
  const projectedResult = state.result ?? getResult(order);
  const winningTeam = order.length ? teamOf(order[0]) : null;
  const progress = match?.progress ?? { ...createMatchProgress('guan-classic-house-v1'), teamLevels: [base.rules.levelRank, base.rules.levelRank] as [number, number], activeTeam: 0 as const };
  // Reuse the real settlement definition. No hypothetical state crosses the observation boundary.
  const settlement = projectedResult && !state.result ? settleMatchProgress(progress, { ...state, result: projectedResult }) : null;
  const advance = settlement?.ok ? settlement.progress.lastAdvance : null;
  const exchange = match?.exchange ? getExchangeObservation(match.exchange, player) : null;
  const endsRound = !!base.currentPlay && state.pendingResponders.length === 1 && state.pendingResponders[0] === player;
  const owner = base.currentOwner;
  return structuredClone({
    ...base, partner: partnerOf(player), pendingResponders: [...state.pendingResponders],
    mode: match ? match.journal.rulesVersion === 'guan-classic-house-v1' ? 'classic' : 'legacy' : 'practice',
    matchContext: match ? { teamLevels: [...match.progress.teamLevels] as [number, number], levelOwnerTeamId: match.levelOwnerTeamId, handNumber: match.progress.handNumber } : null,
    publicTransfers: exchange?.publicTransfers ?? [], antiTributeEvidence: exchange?.antiTributeEvidence ?? [],
    finishOutcome: {
      place: Math.min(4, order.length) as 1 | 2 | 3 | 4, handEnds: !!projectedResult, winningTeam, doubleUp: projectedResult?.doubleUp ?? false,
      nominalAdvance: advance?.steps ?? null,
      passesAce: !!match && (advance?.passedAce ?? false),
    },
    passOutcome: { endsRound, nextLeader: endsRound && owner !== null ? base.remainingCounts[owner] > 0 ? owner : partnerOf(owner) : null },
  });
}
