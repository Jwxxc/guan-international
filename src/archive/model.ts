import type { AiObservation } from '../ai/types';
import type { DecisionRecord } from '../game/aiDiagnostics';
import type { SavedGame } from '../game/persistence';
import type { MatchJournal } from '../match/sessionTypes';
import type { StrategyDescriptor } from '../ai/strategyTypes';

export const archiveKey = (sessionId: string, handId: string) => JSON.stringify([sessionId, handId]);
export interface ArchivedHand {
  schema: 'guan-analysis-hand-v1'; key: string; sessionId: string; handId: string;
  mode: 'practice' | 'classic' | 'legacy'; handNumber: number;
  firstArchivedAt: number; updatedAt: number; completedAt: number | null;
  origin: 'live' | 'recovered'; saved: SavedGame;
  /** Only newly accepted actions get wall-clock timestamps. */
  actionTimes: Record<number, number>;
}
export interface ArchivedDecision extends DecisionRecord {
  key: string; handKey: string; recordedAt: number; decisionSeed: number;
  /** The actor's view only. Public history is already in the replay. */
  observation: Omit<AiObservation, 'history'>;
  decisionDescriptor: StrategyDescriptor;
}
export interface AnalysisBundle {
  schema: 'guan-analysis-bundle-v1'; exportedAt: number; hand: ArchivedHand;
  decisions: ArchivedDecision[]; matchJournal?: MatchJournal;
  runtimeAttempts?: {coverage:'current-page-bounded-pro-attempts';records:import('../game/aiLifecycle').AiLifecycleRecord[]};
}
export type ArchiveSummary = Omit<ArchivedHand, 'saved' | 'actionTimes'> & {
  completed: boolean; levelRank: number; actionCount: number;
};
export function summarizeHand(hand: ArchivedHand): ArchiveSummary {
  const { saved, actionTimes: _times, ...summary } = hand;
  return { ...summary, completed: !!saved.state.result, levelRank: saved.state.rules.levelRank, actionCount: saved.actions.length };
}
export function mergeHand(previous: ArchivedHand | undefined, next: ArchivedHand): ArchivedHand {
  if (!previous) return next;
  const shorter = previous.saved.actions.length <= next.saved.actions.length ? previous : next;
  const longer = shorter === previous ? next : previous;
  if (previous.key !== next.key || previous.saved.seed !== next.saved.seed
    || JSON.stringify(shorter.saved.actions) !== JSON.stringify(longer.saved.actions.slice(0, shorter.saved.actions.length))) {
    throw Error('同一副档案发生冲突，已有记录已保留。');
  }
  if (previous.saved.actions.length > next.saved.actions.length || previous.saved.state.result && !next.saved.state.result) return previous;
  return { ...next, firstArchivedAt: previous.firstArchivedAt, origin: previous.origin,
    completedAt: previous.completedAt ?? next.completedAt, actionTimes: { ...next.actionTimes, ...previous.actionTimes } };
}
