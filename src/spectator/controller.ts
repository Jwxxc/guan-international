import { startAiTask, type AiTask } from '../game/aiTask';
import { randomId } from '../game/randomId';
import { getMatchReplayHand, type MatchReplayFrame } from '../match/replay';
import { advanceMatchExchange, advanceMatchPlay, beginMatchHand, nextMatchHand } from '../match/session';
import { chooseExchangeAction, getExchangeObservation } from '../match/exchange';
import type { MatchSessionResult } from '../match/sessionTypes';
import type { Seat } from '../engine/types';
import { saveStudy } from './storage';
import { captureStudyDecision, currentStudyPolicy, studyFrame, studyKey, studyObservation,
  type StudyBookmark, type StudyCursor, type StudyDecision, type StudyDocument, type StudyPreferences } from './model';

export interface StudySnapshot {
  document: StudyDocument; frames: MatchReplayFrame[];
  running: boolean; targetSeat: Seat | null; thinking: boolean; revealed: boolean;
  pending: StudyDecision | null; error: string | null; saveError: string | null;
}
interface Dependencies {
  startTask?: typeof startAiTask;
  save?: (document: StudyDocument) => Promise<void>;
}
const delays = { slow: 2400, normal: 1200, fast: 300 } as const;
const unwrap = (result: MatchSessionResult) => { if (!result.ok) throw Error(result.error); return result.match; };

/** One authority for all four actors. Replay cursor, viewer and model execution
 * are independent. Only commands at the live frontier can mutate the match. */
export class StudyController {
  private snapshot: StudySnapshot;
  private listeners = new Set<() => void>();
  private task: AiTask | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private saves: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private startTask: typeof startAiTask;
  private save: (document: StudyDocument) => Promise<void>;

  constructor(document: StudyDocument, dependencies: Dependencies = {}) {
    this.startTask = dependencies.startTask ?? startAiTask;
    this.save = dependencies.save ?? saveStudy;
    this.snapshot = { document, frames: getMatchReplayHand(document.match, document.cursor.hand).frames,
      running: false, targetSeat: null, thinking: false, revealed: false, pending: null, error: null, saveError: null };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<StudySnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private document(patch: Partial<StudyDocument>, presentation: Partial<StudySnapshot> = {}) {
    this.update({ ...presentation, document: { ...this.snapshot.document, ...patch, updatedAt: Date.now() } });
  }
  get frame() { return this.snapshot.frames[this.snapshot.document.cursor.frame]; }
  get live() {
    return this.snapshot.document.cursor.hand === this.snapshot.document.match.journal.records.length - 1
      && this.snapshot.document.cursor.frame === this.snapshot.frames.length - 1;
  }
  get canStep() {
    return this.snapshot.document.cursor.frame < this.snapshot.frames.length - 1
      || this.live && !['between', 'complete'].includes(this.snapshot.document.match.phase);
  }
  private stopWork() {
    this.generation++;
    clearTimeout(this.timer); this.timer = undefined;
    this.task?.cancel(); this.task = null;
  }
  pause = () => {
    this.stopWork(); this.update({ running: false, targetSeat: null, thinking: false });
  };
  dispose = () => { this.stopWork(); this.disposed = true; this.listeners.clear(); };

  /** Persist immutable revisions in order, including when the user exits while
   * a previous transaction is still finishing. Failure pauses, never skips. */
  persist = async (): Promise<boolean> => {
    const document = this.snapshot.document, revision = ++this.saveRevision;
    const operation = this.saves.then(() => this.save(document));
    this.saves = operation.catch(() => {});
    try {
      await operation;
      if (revision === this.saveRevision) this.update({ saveError: null });
      return true;
    } catch (error) {
      if (revision === this.saveRevision) {
        this.pause(); this.update({ saveError: error instanceof Error ? error.message : '观战保存失败，请重试保存' });
      }
      return false;
    }
  };

  setPreferences = (patch: Partial<StudyPreferences>) => {
    const preferences = { ...this.snapshot.document.preferences, ...patch };
    if (patch.follow && !this.frame.state.result) preferences.viewer = this.frame.state.currentPlayer;
    this.document({ preferences });
    if (patch.thinkFirst !== undefined) this.update({ revealed: false });
    void this.persist();
  };
  setViewer = (viewer: Seat) => {
    // Do not cancel or repeat a model request just because the camera moved.
    this.setPreferences({ viewer, follow: false });
  };
  seek = (cursor: StudyCursor) => {
    this.pause();
    const document = this.snapshot.document;
    if (!Number.isInteger(cursor.hand) || cursor.hand < 0 || cursor.hand >= document.match.journal.records.length) return;
    const frames = cursor.hand === document.cursor.hand ? this.snapshot.frames : getMatchReplayHand(document.match, cursor.hand).frames;
    const next = { hand: cursor.hand, frame: Math.max(0, Math.min(frames.length - 1, Math.trunc(cursor.frame) || 0)) };
    const preferences = document.preferences.follow ? { ...document.preferences, viewer: frames[next.frame].state.currentPlayer } : document.preferences;
    this.document({ cursor: next, preferences }, { frames, revealed: false });
    void this.persist();
  };
  latest = () => {
    const hand = this.snapshot.document.match.journal.records.length - 1;
    const frames = getMatchReplayHand(this.snapshot.document.match, hand).frames;
    this.seek({ hand, frame: frames.length - 1 });
  };
  toggleBookmark = () => {
    const { cursor, preferences, bookmarks } = this.snapshot.document;
    const exists = bookmarks.some(item => item.hand === cursor.hand && item.frame === cursor.frame && item.viewer === preferences.viewer);
    if (!exists && bookmarks.length >= 500) return;
    this.document({ bookmarks: exists ? bookmarks.filter(item => !(item.hand === cursor.hand && item.frame === cursor.frame && item.viewer === preferences.viewer))
      : [...bookmarks, { ...cursor, viewer: preferences.viewer }] });
    void this.persist();
  };
  openBookmark = (bookmark: StudyBookmark) => { this.seek(bookmark); this.setViewer(bookmark.viewer); };

  private async decision(generation: number): Promise<StudyDecision | null> {
    const { document, pending } = this.snapshot;
    const state = document.match.saved.state;
    if (pending && studyKey(pending) === studyKey(state)) return pending;
    const observation = studyObservation(document.match);
    const policy = document.match.saved.seatPolicies![state.currentPlayer];
    this.update({ thinking: true, error: null });
    const task = this.startTask(observation, policy, ((state.stateVersion + 1) * 2654435761 + state.currentPlayer * 971) >>> 0);
    this.task = task;
    const result = await task.promise;
    if (this.disposed || generation !== this.generation) return null;
    this.task = null; this.update({ thinking: false });
    if (!result) throw Error('DanLM 请求未完成，请重试；当前牌面未改变');
    const captured = captureStudyDecision(document.match, result);
    this.update({ pending: captured });
    return captured;
  }
  reveal = async () => {
    if (this.snapshot.thinking) return;
    this.pause();
    const generation = this.generation;
    try {
      if (this.live && this.snapshot.document.match.phase === 'playing') await this.decision(generation);
      if (generation === this.generation && !this.disposed) this.update({ revealed: true });
    } catch (error) { this.failure(error, generation); }
  };
  private failure(error: unknown, generation: number) {
    if (generation !== this.generation || this.disposed) return;
    this.pause();
    this.update({ error: error instanceof Error ? error.message : 'DanLM 计算失败，已暂停，请重试' });
  }
  retry = () => { this.update({ error: null }); void this.reveal(); };

  private async advance(generation: number): Promise<boolean> {
    const { document, frames } = this.snapshot;
    if (document.cursor.frame < frames.length - 1) {
      const cursor = { ...document.cursor, frame: document.cursor.frame + 1 };
      const preferences = document.preferences.follow ? { ...document.preferences, viewer: frames[cursor.frame].state.currentPlayer } : document.preferences;
      this.document({ cursor, preferences }); this.update({ revealed: false });
      return this.persist();
    }
    if (!this.live || !this.canStep) return false;
    const match = document.match;
    let next = match;
    let decision: StudyDecision | null = null;
    if (match.phase === 'exchange') {
      const exchange = match.exchange!;
      next = unwrap(advanceMatchExchange(match, chooseExchangeAction(getExchangeObservation(exchange, exchange.currentPlayer!))));
    } else if (match.phase === 'ready') {
      next = unwrap(beginMatchHand(match));
    } else {
      decision = await this.decision(generation);
      if (!decision || generation !== this.generation || this.disposed) return false;
      next = unwrap(advanceMatchPlay(match, decision.action));
    }
    if (generation !== this.generation || this.disposed) return false;
    const nextFrames = [...frames, studyFrame(next)];
    // Preferences can change while inference is in flight. Preserve the current camera.
    const preferences = this.snapshot.document.preferences.follow
      ? { ...this.snapshot.document.preferences, viewer: next.saved.state.currentPlayer } : this.snapshot.document.preferences;
    this.document({ match: next, decisions: decision ? [...document.decisions, decision] : document.decisions,
      cursor: { hand: document.cursor.hand, frame: nextFrames.length - 1 }, preferences }, { frames: nextFrames, pending: null, revealed: false, error: null });
    return this.persist();
  }

  step = async () => {
    if (this.snapshot.thinking || this.snapshot.saveError) return;
    this.pause(); const generation = this.generation;
    try { await this.advance(generation); } catch (error) { this.failure(error, generation); }
  };
  play = (targetSeat: Seat | null = null) => {
    this.pause();
    if (!this.canStep || this.snapshot.saveError) return;
    if (targetSeat !== null && this.atTarget(targetSeat)) return;
    this.update({ running: true, targetSeat, error: null });
    this.schedule(this.generation, 0);
  };
  private atTarget(seat: Seat) {
    return !this.frame.state.result && (this.frame.phase === 'playing' || this.snapshot.document.cursor.hand === 0 && this.frame.phase === 'deal')
      && this.frame.state.currentPlayer === seat;
  }
  private schedule(generation: number, delay: number) {
    this.timer = setTimeout(() => { void this.tick(generation); }, delay);
  }
  private async tick(generation: number) {
    if (this.disposed || generation !== this.generation || !this.snapshot.running) return;
    try {
      const progressed = await this.advance(generation);
      if (this.disposed || generation !== this.generation || !this.snapshot.running) return;
      if (!progressed || !this.canStep || this.snapshot.targetSeat !== null && this.atTarget(this.snapshot.targetSeat)) { this.pause(); return; }
      this.schedule(generation, delays[this.snapshot.document.preferences.speed]);
    } catch (error) { this.failure(error, generation); }
  }

  nextHand = async () => {
    this.pause();
    const { document } = this.snapshot;
    if (document.cursor.hand < document.match.journal.records.length - 1) {
      this.seek({ hand: document.cursor.hand + 1, frame: 0 }); return;
    }
    try {
      const policy = currentStudyPolicy();
      const match = unwrap(nextMatchHand(document.match, crypto.getRandomValues(new Uint32Array(1))[0], randomId(), policy, [policy, policy, policy, policy]));
      const hand = match.journal.records.length - 1;
      const frames = getMatchReplayHand(match, hand).frames;
      this.document({ match, cursor: { hand, frame: 0 } }, { frames, pending: null, revealed: false, error: null });
      await this.persist();
    } catch (error) { this.failure(error, this.generation); }
  };
}
