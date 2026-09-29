import { describe, expect, it } from 'vitest';
import completeFixture from './fixtures/classic-complete.json';
import legacyFixture from './fixtures/legacy-match-completed-hand-v1.json';
import { decodeSavedGame, createSavedGame } from '../game/persistence';
import { getReplayStates } from '../game/replay';
import { getMatchReplayHand } from '../match/replay';
import { nextMatchHand, restoreMatchJournal } from '../match/session';
import type { MatchJournal, MatchSession } from '../match/sessionTypes';
import { archiveKey, summarizeHand, type AnalysisBundle } from '../archive/model';
import { findReplayArchive, replayFromArchive } from '../archive/replay';
import { restoredMatchEntries } from '../statistics/recording';
import type { HandEntry, MatchEntry } from '../statistics/model';

const complete = restoreMatchJournal(completeFixture);
function bundleFor(match: MatchSession): AnalysisBundle {
  const { saved } = match;
  return { schema: 'guan-analysis-bundle-v1', exportedAt: 500, decisions: [], matchJournal: match.journal,
    hand: { schema: 'guan-analysis-hand-v1', key: archiveKey(saved.state.sessionId, saved.state.handId),
      sessionId: saved.state.sessionId, handId: saved.state.handId, mode: match.journal.rulesVersion === 'guan-classic-house-v1' ? 'classic' : 'legacy',
      handNumber: match.progress.handNumber, firstArchivedAt: 100, updatedAt: 200, completedAt: null, origin: 'recovered', saved, actionTimes: {} } };
}
const prefix = (count: number) => restoreMatchJournal({ ...complete.journal, records: complete.journal.records.slice(0, count) });
const handEntry = (match: MatchSession) => restoredMatchEntries(match).find(entry => entry.kind === 'hand' && entry.handId === match.saved.state.handId) as HandEntry;
const matchEntry = restoredMatchEntries(complete).find(entry => entry.kind === 'match') as MatchEntry;

describe('verified archive replay navigation', () => {
  it('opens real classic and legacy completed hand journals, retaining exchange frames and original commands', () => {
    for (const match of [prefix(2), restoreMatchJournal(legacyFixture)]) {
      const bundle = bundleFor(match), original = JSON.stringify(bundle);
      const replay = replayFromArchive(bundle, handEntry(match));
      expect(replay.handId).toBe(match.saved.state.handId);
      expect(replay.source.kind).toBe('match');
      if (replay.source.kind !== 'match') throw Error('wrong replay kind');
      expect(replay.source.match).toEqual(match);
      const frames = getMatchReplayHand(replay.source.match, match.progress.handNumber - 1);
      expect(frames.frames.at(-1)!.state).toEqual(match.saved.state);
      expect(frames.frames.some(frame => frame.exchange !== null)).toBe(true);
      expect(frames.summary.result).toEqual(match.saved.state.result);
      expect(JSON.stringify(bundle)).toBe(original);
    }
  });
  it('opens a completed practice hand through engine-validated actions with no made-up state', () => {
    const original = bundleFor(prefix(1));
    const bundle: AnalysisBundle = { ...original, matchJournal: undefined, hand: { ...original.hand, mode: 'practice' } };
    const replay = replayFromArchive(bundle);
    expect(replay.source.kind).toBe('practice');
    if (replay.source.kind !== 'practice') throw Error('wrong replay kind');
    const states = getReplayStates(replay.source.saved);
    expect(states).toHaveLength(bundle.hand.saved.actions.length + 1);
    expect(states.at(-1)).toEqual(decodeSavedGame(JSON.stringify(bundle.hand.saved), true).state);
  });
  it('opens a complete match only when its verified winner and hand count match the statistic', () => {
    const replay = replayFromArchive(bundleFor(complete), matchEntry);
    expect(replay.source.kind === 'match' && replay.source.match.phase).toBe('complete');
    expect(() => replayFromArchive(bundleFor(prefix(2)), { ...matchEntry, handCount: 2 })).toThrow('完整结算');
    expect(() => replayFromArchive(bundleFor(complete), { ...matchEntry, winningTeam: matchEntry.winningTeam === 0 ? 1 : 0 })).toThrow('完整结算');
  });
  it('cuts future incomplete hands from the returned source before any replay or all-hands view', () => {
    const ended = prefix(2);
    const next = nextMatchHand(ended, 924, 'private-live-hand');
    expect(next.ok).toBe(true);
    if (!next.ok) throw Error(next.error);
    const replay = replayFromArchive({ ...bundleFor(ended), matchJournal: next.match.journal }, handEntry(ended));
    if (replay.source.kind !== 'match') throw Error('wrong replay kind');
    expect(replay.source.match.journal.records).toHaveLength(2);
    expect(JSON.stringify(replay.source)).not.toContain('private-live-hand');
    expect(replay.source.match.saved.state.result).not.toBeNull();
  });
  it('rejects missing or truncated match journals, snapshot-only completion, and invalid action history', () => {
    const bundle = bundleFor(prefix(2));
    expect(() => replayFromArchive({ ...bundle, matchJournal: undefined })).toThrow('缺少');
    expect(() => replayFromArchive({ ...bundle, matchJournal: { ...bundle.matchJournal!, records: bundle.matchJournal!.records.slice(0, 1) } })).toThrow('缺少');
    const truncated = structuredClone(bundle); truncated.hand.saved.actions.pop();
    expect(() => replayFromArchive(truncated)).toThrow();
    const journalTruncated = structuredClone(bundle); journalTruncated.matchJournal!.records.at(-1)!.actions.pop();
    expect(() => replayFromArchive(journalTruncated)).toThrow('不一致');
    const illegal = structuredClone(bundle); illegal.hand.saved.actions[0].player = ((illegal.hand.saved.actions[0].player + 1) % 4) as 0 | 1 | 2 | 3;
    expect(() => replayFromArchive(illegal)).toThrow();
  });
  it('requires actual completion and validates stored engine and archive versions', () => {
    const unfinished = createSavedGame({}, 17);
    const current = bundleFor(prefix(1));
    expect(() => replayFromArchive({ ...current, hand: { ...current.hand, saved: unfinished } })).toThrow('尚未结束');
    const mutations: Array<(bundle: AnalysisBundle) => void> = [
      bundle => { bundle.schema = 'future-archive' as AnalysisBundle['schema']; },
      bundle => { bundle.hand.schema = 'future-hand' as AnalysisBundle['hand']['schema']; },
      bundle => { bundle.hand.saved.rulesVersion = 'future-rules' as typeof bundle.hand.saved.rulesVersion; },
      bundle => { bundle.hand.saved.rngVersion = 'future-rng' as typeof bundle.hand.saved.rngVersion; },
      bundle => { bundle.matchJournal!.schemaVersion = 99 as MatchJournal['schemaVersion']; },
      bundle => { bundle.hand.saved.state.result!.winningTeam = bundle.hand.saved.state.result!.winningTeam === 0 ? 1 : 0; },
    ];
    for (const mutate of mutations) {
      const bundle = structuredClone(current); mutate(bundle);
      expect(() => replayFromArchive(bundle)).toThrow();
    }
  });
  it('rejects a mismatched statistic, archive identity, or different rules instead of opening a different game', () => {
    const match = prefix(2), bundle = bundleFor(match), entry = handEntry(match);
    expect(() => replayFromArchive(bundle, { ...entry, handId: 'different-hand' })).toThrow('不一致');
    expect(() => replayFromArchive(bundle, { ...entry, levelRank: 14 })).toThrow('不一致');
    expect(() => replayFromArchive(bundle, { ...entry, mode: 'online' })).toThrow('没有对应');
    expect(() => replayFromArchive(bundle, { ...entry, viewerSeat: 2 })).toThrow('没有对应');
    expect(() => replayFromArchive({ ...bundle, hand: { ...bundle.hand, mode: 'legacy' } })).toThrow('玩法');
    expect(() => replayFromArchive({ ...bundle, hand: { ...bundle.hand, handId: 'wrong-id' } })).toThrow('格式');
  });
  it('locates only the exact local archived hand or final match hand and leaves missing/online records unavailable', () => {
    const entry = handEntry(prefix(2)), bundle = bundleFor(prefix(2)), row = summarizeHand(bundle.hand);
    expect(findReplayArchive(entry, [row])).toEqual(row);
    expect(findReplayArchive(entry, [])).toBeUndefined();
    expect(findReplayArchive(entry, [{ ...row, completed: false }])).toBeUndefined();
    expect(findReplayArchive(entry, [{ ...row, handNumber: 3 }])).toBeUndefined();
    expect(findReplayArchive({ ...entry, mode: 'online' }, [row])).toBeUndefined();
    expect(findReplayArchive({ ...entry, viewerSeat: 3 }, [row])).toBeUndefined();
    expect(findReplayArchive(matchEntry, [row])).toBeUndefined();
    const final = summarizeHand(bundleFor(complete).hand);
    expect(findReplayArchive(matchEntry, [row, final])).toEqual(final);
  });
});
