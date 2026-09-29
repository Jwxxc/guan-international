import type { GameResult, GameState } from '../engine/types';
import { rankName, SEATS } from '../engine/rules';
import type { SavedGame } from '../game/persistence';
import { getExchangeObservation } from './exchange';
import { advanceMatchExchange, advanceMatchPlay, beginMatchHand, createMatchSession, nextMatchHand } from './session';
import type { MatchSession, MatchSessionResult } from './sessionTypes';
import type { ExchangeObservation, MatchAdvance, MatchProgress } from './types';

export type ReplaySource = { kind: 'practice'; saved: SavedGame } | { kind: 'match'; match: MatchSession };
export interface MatchHandSummary {
  handNumber: number; handId: string; levelRank: number; result: GameResult | null;
  levelsBefore: [number, number]; levelsAfter: [number, number]; advance: MatchAdvance | null;
}
export interface MatchReplayFrame {
  phase: 'deal' | 'tribute' | 'return' | 'ready' | 'playing' | 'between' | 'complete';
  state: GameState; progress: MatchProgress; exchange: ExchangeObservation | null; antiTribute: boolean; label: string;
}
export interface MatchReplayHand { summary: MatchHandSummary; frames: MatchReplayFrame[]; startIndex: number; resultIndex: number }
const unwrap = (result: MatchSessionResult): MatchSession => { if (!result.ok) throw Error(`回放动作无效：${result.error}`); return result.match; };
const historyCache = new WeakMap<MatchSession['journal'], MatchHandSummary[]>();

/** Replay actual commands, retaining snapshots only for the selected hand. */
function walk(match: MatchSession, selected = -1): { history: MatchHandSummary[]; frames: MatchReplayFrame[] } {
  let session: MatchSession | undefined;
  const history: MatchHandSummary[] = [], frames: MatchReplayFrame[] = [];
  const journal = match.journal;
  const push = (index: number, phase: MatchReplayFrame['phase'], label: string) => {
    if (index !== selected || !session) return;
    const source=session.exchange;
    let exchange=source?getExchangeObservation(source,0):null;
    // Enrich presentation of old logs with public facts at this historical frame only.
    if(source&&exchange&&journal.rulesVersion==='guan-match-v1')exchange={...exchange,previous:source.previous,
      currentPlayer:source.currentPlayer,firstPlayer:source.firstPlayer,publicTransfers:source.transfers,
      antiTributeEvidence:source.antiTribute?source.donors.flatMap(player=>source.hands[player].filter(card=>card.rank===16).map(card=>({player,card}))):[]};
    frames.push({ phase, state: session.saved.state, progress: session.progress,
      exchange, antiTribute:source?.antiTribute??false, label });
  };
  for (let index = 0; index < journal.records.length; index++) {
    const record = journal.records[index];
    session = session ? unwrap(nextMatchHand(session, record.seed, record.config.handId!, record.policy,record.seatPolicies))
      : createMatchSession(journal.matchId, record.config.handId!, record.seed, journal.tributeEnabled, journal.rulesVersion, record.policy,record.seatPolicies);
    const levelsBefore = [...session.progress.teamLevels] as [number, number];
    push(index, 'deal', `第 ${index + 1} 副发牌 · 全桌打 ${rankName(session.currentLevelRank)} · 每人 27 张`);
    if (session.exchange) push(index, session.phase === 'ready' ? 'ready' : session.exchange.phase === 'tribute' ? 'tribute' : 'return', session.exchange.antiTribute ? '两张真实大王抗贡，本副无需交换。' : '依据上一副名次，开始进贡。');
    for (const action of record.exchangeActions) {
      session = unwrap(advanceMatchExchange(session, action));
      const phase = session.phase === 'ready' ? 'ready' : session.exchange!.phase === 'tribute' ? 'tribute' : 'return';
      const label = session.phase === 'ready' ? '全部确认，贡还牌交换完成。'
        : action.type === 'tribute' && session.exchange!.phase === 'return' ? '贡牌已全部确认，公开配对；接下来选择还贡。'
          : `${SEATS[action.player].name}已确认${action.type === 'tribute' ? '进贡' : '还贡'}，等待本阶段其他人确认。`;
      push(index, phase, label);
    }
    if (record.started && session.phase === 'ready') session = unwrap(beginMatchHand(session));
    if (record.started && session.exchange) push(index, 'playing', `${SEATS[session.saved.state.firstPlayer].name}先出。`);
    for (const action of record.actions) {
      session = unwrap(advanceMatchPlay(session, action));
      const phase = session.phase === 'complete' ? 'complete' : session.phase === 'between' ? 'between' : 'playing';
      let label = session.saved.state.events.at(-1)?.message ?? '本次动作已完成';
      if (session.saved.state.result) {
        const advance = session.progress.lastAdvance!;
        label += ` · ${advance.team === 0 ? '我方' : '对方'} ${rankName(advance.from)} → ${rankName(advance.to)}${advance.passedAce ? ' · 过 A，整场结束' : ` · 按名次升 ${advance.steps} 级`}`;
      }
      push(index, phase, label);
    }
    history.push({ handNumber: index + 1, handId: record.config.handId!, levelRank: session.currentLevelRank,
      levelsBefore, levelsAfter: [...session.progress.teamLevels], result: session.saved.state.result,
      advance: session.saved.state.result ? session.progress.lastAdvance : null });
    if (selected >= 0 && index === selected) break;
  }
  return { history, frames };
}
export function getMatchHistory(match: MatchSession): MatchHandSummary[] {
  let history = historyCache.get(match.journal);
  if (!history) { history = walk(match).history; historyCache.set(match.journal, history); }
  return history;
}
export function getMatchReplayHand(match: MatchSession, handIndex: number): MatchReplayHand {
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= match.journal.records.length) throw Error('回放副数无效');
  const { history, frames } = walk(match, handIndex);
  return { summary: history.at(-1)!, frames, startIndex: 0, resultIndex: frames.length - 1 };
}
