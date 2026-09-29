import { decodeSavedGame } from '../game/persistence';
import type { ReplaySource } from '../match/replay';
import { restoreMatchJournal } from '../match/session';
import type { StatisticsEntry } from '../statistics/model';
import { archiveKey, type AnalysisBundle, type ArchiveSummary } from './model';

export interface ArchiveReplay { source: ReplaySource; handId: string }

/** Summary rows only locate a candidate; the full journal is validated on opening. */
export function findReplayArchive(entry: StatisticsEntry, rows: ArchiveSummary[]): ArchiveSummary | undefined {
  if (entry.mode === 'online' || entry.viewerSeat !== 0) return undefined;
  return rows.find(row => row.completed && row.mode === entry.mode && row.sessionId === entry.sessionId
    && (entry.kind === 'hand' ? row.handId === entry.handId && row.handNumber === entry.handNumber : row.handNumber === entry.handCount));
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

/** Reuse the same engine validation as save restoration; never trust archive snapshots. */
export function replayFromArchive(bundle: AnalysisBundle, entry?: StatisticsEntry): ArchiveReplay {
  const hand = bundle?.hand;
  if (bundle?.schema !== 'guan-analysis-bundle-v1' || hand?.schema !== 'guan-analysis-hand-v1'
    || !['practice', 'classic', 'legacy'].includes(hand.mode)
    || !Number.isInteger(hand.handNumber) || hand.handNumber < 1 || hand.handNumber > 512
    || hand.key !== archiveKey(hand.sessionId, hand.handId)) throw Error('这份回放档案格式无效或版本不兼容。');
  if (!hand.saved?.state?.result) throw Error('本副尚未结束，结算后才能查看完整回放。');
  const saved = decodeSavedGame(JSON.stringify(hand.saved), true);
  if (saved.state.sessionId !== hand.sessionId || saved.state.handId !== hand.handId) throw Error('回放档案的对局身份不一致。');
  let source: ReplaySource;
  if (hand.mode === 'practice') {
    if (hand.handNumber !== 1 || bundle.matchJournal) throw Error('单副回放的玩法记录不一致。');
    source = { kind: 'practice', saved };
  } else {
    const journal = bundle.matchJournal;
    if (!journal || !Array.isArray(journal.records) || journal.records.length < hand.handNumber) throw Error('缺少这场升级赛的完整过程，暂时无法回放。');
    if (journal.matchId !== hand.sessionId || journal.rulesVersion !== (hand.mode === 'classic' ? 'guan-classic-house-v1' : 'guan-match-v1')) throw Error('回放档案的玩法或比赛身份不一致。');
    // The archive can be read while a later hand is in progress. Only the verified
    // prefix through this completed hand is allowed into the replay screen.
    const match = restoreMatchJournal({ ...journal, records: journal.records.slice(0, hand.handNumber) });
    if (!match.saved.state.result || match.progress.handNumber !== hand.handNumber || canonical(match.saved) !== canonical(saved)) throw Error('回放过程与这副已结算记录不一致，原档案已保留。');
    source = { kind: 'match', match };
  }
  if (entry) {
    if (entry.mode === 'online' || entry.viewerSeat !== 0 || entry.mode !== hand.mode || entry.sessionId !== hand.sessionId) throw Error('这条战绩没有对应的本地回放。');
    if (entry.kind === 'hand') {
      if (entry.handId !== hand.handId || entry.handNumber !== hand.handNumber || entry.levelRank !== saved.state.rules.levelRank
        || canonical(entry.result) !== canonical(saved.state.result)) throw Error('回放与这条战绩的结算结果不一致。');
    } else if (source.kind !== 'match' || source.match.phase !== 'complete' || entry.handCount !== hand.handNumber
      || entry.winningTeam !== source.match.progress.winner) throw Error('整场升级赛的完整结算记录尚不可回放。');
  }
  return { source, handId: hand.handId };
}
