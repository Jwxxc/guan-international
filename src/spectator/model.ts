import type { AiTaskResult } from '../game/aiTask';
import type { GameAction, GameState, Seat } from '../engine/types';
import { validateAction } from '../engine/reducer';
import { getAiObservation } from '../game/aiObservation';
import { strategyStamp } from '../ai/descriptors';
import { roleAssignment } from '../ai/roles';
import { DANLM_CLASSIC_ENCODER_VERSION, DANLM_MODEL_HASH } from '../ai/pro/nativeInfo';
import { matchesStrategyComputation } from '../ai/emergency';
import { resolveStrategy } from '../ai/descriptors';
import type { StrategyStamp } from '../ai/strategyTypes';
import { createMatchSession, restoreMatchJournal } from '../match/session';
import { getMatchReplayHand, type MatchReplayFrame } from '../match/replay';
import { getExchangeObservation } from '../match/exchange';
import type { MatchJournal, MatchSession } from '../match/sessionTypes';

export const STUDY_POLICY = 'pro-danlm-classic-v1' as const;
export const STUDY_SEATS = [0, 1, 2, 3] as const;
export const STUDY_NAMES = { 0: '南席', 1: '东席', 2: '北席', 3: '西席' } as const;
export type StudySpeed = 'slow' | 'normal' | 'fast';
export interface StudyCursor { hand: number; frame: number }
export interface StudyPreferences {
  viewer: Seat; allHands: boolean; follow: boolean; thinkFirst: boolean; speed: StudySpeed;
}
export interface StudyDecision {
  handId: string; stateVersion: number; player: Seat; action: GameAction;
  candidates: Array<{ action: GameAction; score: number }>;
  modelHash: string; encoderVersion: string; policy: StrategyStamp; computeMs: number;
}
export interface StudyBookmark extends StudyCursor { viewer: Seat }
export interface StudyDocument {
  match: MatchSession; decisions: StudyDecision[]; bookmarks: StudyBookmark[];
  cursor: StudyCursor; preferences: StudyPreferences; createdAt: number; updatedAt: number;
}
export interface StoredStudy extends Omit<StudyDocument, 'match'> {
  schema: 'guan-spectator-v1'; journal: MatchJournal;
}
export const studyKey = (state: Pick<GameState, 'handId' | 'stateVersion'>) => `${state.handId}:${state.stateVersion}`;
export const sameAction = (a: GameAction, b: GameAction): boolean => a.sessionId === b.sessionId
  && a.handId === b.handId && a.stateVersion === b.stateVersion && a.player === b.player && a.type === b.type
  && (a.type === 'pass' || b.type === 'play' && a.playKey === b.playKey
    && [...a.cardIds].sort().join(',') === [...b.cardIds].sort().join(','));

export function createStudy(matchId: string, handId: string, seed: number, now = Date.now()): StudyDocument {
  const assignment = roleAssignment(STUDY_POLICY);
  return { match: createMatchSession(matchId, handId, seed, true, 'guan-classic-house-v1', assignment.policy, assignment.seatPolicies),
    decisions: [], bookmarks: [], cursor: { hand: 0, frame: 0 },
    preferences: { viewer: 0, allHands: true, follow: false, thinkFirst: false, speed: 'normal' }, createdAt: now, updatedAt: now };
}

/** The four open hands belong to the local renderer. Only this seat's normal
 * observation crosses the AI boundary; viewer preferences are never inputs. */
export function studyObservation(match: MatchSession) {
  if (match.phase !== 'playing' || match.saved.state.result) throw Error('当前不在出牌回合');
  return getAiObservation(match.saved.state, match.saved.state.currentPlayer, match);
}

export function captureStudyDecision(match: MatchSession, result: AiTaskResult): StudyDecision {
  const state = match.saved.state, policy = match.saved.seatPolicies?.[state.currentPlayer];
  if (!policy || policy.id !== STUDY_POLICY) throw Error('观战座位未绑定 DanLM');
  if (result.identity.fallbackReason || result.decision.stats.fallbackReason
    || !matchesStrategyComputation(result, resolveStrategy(policy))) throw Error(result.errorDetail ?? result.identity.fallbackReason ?? 'DanLM 策略身份不匹配');
  const native = result.decision.proDiagnostics;
  if (native?.modelHash !== DANLM_MODEL_HASH || native.encoderVersion !== DANLM_CLASSIC_ENCODER_VERSION
    || !native.candidatesComplete || native.mode !== 'neural') throw Error('DanLM 模型或候选记录不完整');
  const candidates = result.decision.topCandidates.map(row => ({ action: structuredClone(row.action), score: row.score }));
  const decision: StudyDecision = { handId: state.handId, stateVersion: state.stateVersion, player: state.currentPlayer,
    action: structuredClone(result.decision.action), candidates, modelHash: native.modelHash,
    encoderVersion: native.encoderVersion, policy: structuredClone(policy), computeMs: result.computeMs };
  validateStudyDecision(decision, state);
  return decision;
}

export function validateStudyDecision(decision: StudyDecision, before: GameState): void {
  if (!decision || decision.handId !== before.handId || decision.stateVersion !== before.stateVersion
    || decision.player !== before.currentPlayer || decision.policy?.id !== STUDY_POLICY
    || decision.modelHash !== DANLM_MODEL_HASH || decision.encoderVersion !== DANLM_CLASSIC_ENCODER_VERSION
    || !Number.isFinite(decision.computeMs) || decision.computeMs < 0
    || !Array.isArray(decision.candidates) || !decision.candidates.length || decision.candidates.length > 5
    || !validateAction(before, decision.action).ok) throw Error('观战决策与出牌前局面不一致');
  if (!sameAction(decision.action, decision.candidates[0].action)) throw Error('DanLM 实际动作与首选不一致');
  for (const [index, row] of decision.candidates.entries()) {
    if (!Number.isFinite(row.score) || index > 0 && row.score > decision.candidates[index - 1].score
      || !validateAction(before, row.action).ok) throw Error('观战候选评分或动作无效');
  }
}

export function studyFrame(match: MatchSession): MatchReplayFrame {
  const exchange = match.exchange ? getExchangeObservation(match.exchange, 0) : null;
  const phase = match.phase === 'exchange' ? match.exchange!.phase === 'tribute' ? 'tribute' : 'return' : match.phase;
  const last = match.saved.state.events.at(-1);
  const label = phase === 'tribute' ? '进贡选择中 · 使用现有交换策略'
    : phase === 'return' ? '贡牌已公开 · 还贡选择中 · 使用现有交换策略'
      : phase === 'ready' ? match.exchange?.antiTribute ? '两张真实大王抗贡，准备开始本副。' : '贡还牌交换完成，准备开始本副。'
        : last?.message ?? '发牌完成，每人 27 张。';
  return { phase, state: match.saved.state, progress: match.progress, exchange, antiTribute: match.exchange?.antiTribute ?? false, label };
}

export function studyLabel(label: string): string {
  const labels: Record<string, string> = { 你: '南席', 南山: '东席', 青禾: '北席', 松风: '西席', 我方: 'A 队', 对方: 'B 队' };
  return label.replace(/我方|对方|南山|青禾|松风|你/g, name => labels[name]);
}

export function storeStudy(document: StudyDocument): StoredStudy {
  const { match, ...rest } = document;
  return { ...rest, schema: 'guan-spectator-v1', journal: match.journal };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function restoreStudy(value: unknown): StudyDocument {
  if (!object(value) || value.schema !== 'guan-spectator-v1' || !Array.isArray(value.decisions)
    || value.decisions.length > 40_000 || !Array.isArray(value.bookmarks) || value.bookmarks.length > 500
    || !object(value.preferences) || !object(value.cursor) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) throw Error('观战存档格式无效，原记录已保留');
  const stored = value as unknown as StoredStudy;
  const match = restoreMatchJournal(stored.journal);
  if (match.journal.rulesVersion !== 'guan-classic-house-v1'
    || match.journal.records.some(record => record.policy?.id !== STUDY_POLICY || record.seatPolicies?.length !== 4 || record.seatPolicies.some(policy => policy.id !== STUDY_POLICY))) throw Error('观战存档必须是四家 DanLM 的经典升级');
  const byKey = new Map(stored.decisions.map(decision => [studyKey(decision), decision]));
  if (byKey.size !== stored.decisions.length) throw Error('观战决策重复');
  const counts: number[] = [];
  let actionCount = 0;
  for (let hand = 0; hand < match.journal.records.length; hand++) {
    const record = match.journal.records[hand];
    const frames = getMatchReplayHand(match, hand).frames;
    counts.push(frames.length);
    for (const action of record.actions) {
      const decision = byKey.get(studyKey(action));
      const before = frames.find(frame => frame.state.stateVersion === action.stateVersion && (frame.phase === 'playing' || hand === 0 && frame.phase === 'deal'))?.state;
      if (!decision || !before || !sameAction(action, decision.action)) throw Error('观战缺少对应的原始决策');
      validateStudyDecision(decision, before);
      const policy = record.seatPolicies![action.player];
      if (decision.policy.version !== policy.version || decision.policy.configHash !== policy.configHash) throw Error('观战决策策略版本不一致');
      actionCount++;
    }
  }
  if (actionCount !== stored.decisions.length) throw Error('观战记录包含未发生的决策');
  const cursorValid = (cursor: StudyCursor) => Number.isInteger(cursor.hand) && cursor.hand >= 0 && cursor.hand < counts.length
    && Number.isInteger(cursor.frame) && cursor.frame >= 0 && cursor.frame < counts[cursor.hand];
  const seatValid = (seat: Seat) => STUDY_SEATS.includes(seat);
  if (!cursorValid(stored.cursor) || stored.bookmarks.some(bookmark => !cursorValid(bookmark) || !seatValid(bookmark.viewer))) throw Error('观战观看位置无效');
  const prefs = stored.preferences;
  if (!seatValid(prefs.viewer) || !['slow', 'normal', 'fast'].includes(prefs.speed)
    || [prefs.allHands, prefs.follow, prefs.thinkFirst].some(value => typeof value !== 'boolean')) throw Error('观战显示偏好无效');
  return structuredClone({ match, decisions: stored.decisions, bookmarks: stored.bookmarks,
    cursor: stored.cursor, preferences: prefs, createdAt: stored.createdAt, updatedAt: stored.updatedAt });
}

export const currentStudyPolicy = () => strategyStamp(STUDY_POLICY);
