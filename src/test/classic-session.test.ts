import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import legacyPending from './fixtures/legacy-match-v1.json';
import legacyEnded from './fixtures/legacy-match-completed-hand-v1.json';
import completedFixture from './fixtures/classic-complete.json';
import { createSavedGame, decodeSavedGame, STORAGE_KEYS } from '../game/persistence';
import { getObservation } from '../engine/observations';
import { getReplayStates } from '../game/replay';
import { chooseExchangeAction, getExchangeObservation } from '../match/exchange';
import { advanceMatchExchange, beginMatchHand, createMatchSession, decodeMatchSession, encodeMatchSession, nextMatchHand, restoreMatchJournal } from '../match/session';
import { getMatchHistory, getMatchReplayHand } from '../match/replay';
import { clearPracticeSession, loadReplaySource, loadSession, MATCH_STORAGE, saveFinishedPractice, saveMatch, savePracticeSession, saveReplaySource } from '../match/storage';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
const complete = () => restoreMatchJournal(completedFixture);

describe('frozen historical saves', () => {
  it('replays the actual pre-change pending exchange without changing any legacy snapshot', () => {
    const original = JSON.stringify(legacyPending);
    let match = decodeMatchSession(original);
    expect(match.journal.rulesVersion).toBe('guan-match-v1');
    expect(match.exchange!.hands.map(hand => hand.length)).not.toEqual([27,27,27,27]);
    expect(JSON.parse(encodeMatchSession(match))).toEqual(legacyPending);
    while (match.phase === 'exchange') {
      const action = chooseExchangeAction(getExchangeObservation(match.exchange!, match.exchange!.currentPlayer!));
      const next = advanceMatchExchange(match, action); if (!next.ok) throw Error(next.error); match=next.match;
    }
    expect(match.saved.state.hands.map(hand => hand.length)).toEqual([27,27,27,27]);
    expect(beginMatchHand(match).ok).toBe(true);
    expect(decodeMatchSession(encodeMatchSession(match))).toEqual(match);
    expect(JSON.stringify(legacyPending)).toBe(original);
  });
  it('replays the real old completed second hand and its old tribute setup unchanged', () => {
    const match=decodeMatchSession(JSON.stringify(legacyEnded));
    expect(JSON.parse(encodeMatchSession(match))).toEqual(legacyEnded);
    expect(match.saved.setup!.version).toBe('guan-tribute-v1');
    expect(decodeSavedGame(JSON.stringify(match.saved),true)).toEqual(match.saved);
    expect(getReplayStates(match.saved).at(-1)).toEqual(match.saved.state);
    expect(getMatchReplayHand(match,1).frames.at(-1)!.state).toEqual(match.saved.state);
    const returning=getMatchReplayHand(match,1).frames.find(frame=>frame.phase==='return')!;
    expect(returning.exchange!.publicTransfers).toHaveLength(2);
    expect(returning.exchange!.previous).toEqual(match.previousHandResult);
  });
  it('includes genuine old anti-tribute evidence and leader in historical replay without rewriting the legacy log', () => {
    const prior=decodeMatchSession(JSON.stringify(legacyEnded));
    let anti: ReturnType<typeof complete> | undefined;
    for(let seed=1;seed<200;seed++) {const next=nextMatchHand(prior,seed,'old-anti');if(!next.ok)throw Error(next.error);if(next.match.exchange!.antiTribute){anti=next.match;break;}}
    expect(anti).toBeDefined();
    const raw=encodeMatchSession(anti!);
    const frame=getMatchReplayHand(anti!,2).frames.find(f=>f.phase==='ready')!;
    expect(frame.antiTribute).toBe(true);
    expect(frame.exchange!.antiTributeEvidence).toHaveLength(2);
    expect(frame.exchange!.firstPlayer).toBe(prior.saved.state.result!.order[0]);
    expect(frame.exchange).not.toHaveProperty('offers');
    expect(encodeMatchSession(anti!)).toBe(raw);
  });
});

describe('separate versions and preserved storage', () => {
  it('new matches declare classic schema/rules and cannot silently turn off tribute', () => {
    const match=createMatchSession('classic','first',7319921);
    expect(match.journal).toMatchObject({schemaVersion:2,rulesVersion:'guan-classic-house-v1',tributeEnabled:true});
    expect(match.currentLevelRank).toBe(2);expect(match.levelOwnerTeamId).toBeNull();expect(match.previousHandResult).toBeNull();
    expect(()=>createMatchSession('classic','first',1,false)).toThrow();
    expect(decodeMatchSession(encodeMatchSession(match))).toEqual(match);
  });
  it('rejects modified active rank/owner/previous result and cross-version logs', () => {
    const match=createMatchSession('classic','first',17);
    for(const modify of [
      (d:any)=>{d.check.context.currentLevelRank=7;},
      (d:any)=>{d.check.context.levelOwnerTeamId=1;},
      (d:any)=>{d.check.context.previousHandResult=legacyEnded.check.progress.lastResult;},
      (d:any)=>{d.rulesVersion='guan-match-v1';},
      (d:any)=>{d.tributeEnabled=false;},
    ]) { const data=JSON.parse(encodeMatchSession(match));modify(data);expect(()=>decodeMatchSession(JSON.stringify(data))).toThrow(); }
  });
  it('accepts JSON object keys in any order without relaxing snapshot values or array order', () => {
    const reordered = (value: unknown): unknown => Array.isArray(value) ? value.map(reordered)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)])) : value;
    for (const original of [encodeMatchSession(createMatchSession('json-order', 'first', 17)), JSON.stringify(legacyPending), JSON.stringify(completedFixture)]) {
      const parsed = reordered(JSON.parse(original));
      expect(decodeMatchSession(JSON.stringify(parsed))).toEqual(decodeMatchSession(original));
    }
    const changed = JSON.parse(encodeMatchSession(createMatchSession('json-order', 'first', 17)));
    changed.check.state.hands[0].reverse();
    expect(() => decodeMatchSession(JSON.stringify(reordered(changed)))).toThrow('状态校验失败');
    changed.check.state.hands[0].reverse();
    changed.check.state.unrecognizedAuthority = true;
    expect(() => decodeMatchSession(JSON.stringify(reordered(changed)))).toThrow('状态校验失败');
  });
  it('keeps omitted optional fields compatible with the JSON encoding contract', () => {
    const match = decodeMatchSession(JSON.stringify(legacyPending));
    match.exchange!.rulesVersion = undefined;
    match.exchange!.tributePairs = undefined;
    match.exchange!.antiTributeEvidence = undefined;
    match.saved.policy = undefined;
    match.saved.seatPolicies = undefined;
    const raw = encodeMatchSession(match);
    expect(JSON.parse(raw)).toEqual(legacyPending);
    expect(decodeMatchSession(raw)).toEqual(decodeMatchSession(JSON.stringify(legacyPending)));
  });
  it('new classic/practice and resumed legacy saves never replace original v1 bytes', () => {
    const raw=JSON.stringify(legacyPending);localStorage.setItem(STORAGE_KEYS.current,raw);
    expect(loadSession().match?.journal.rulesVersion).toBe('guan-match-v1');
    const old=decodeMatchSession(raw);expect(saveMatch(old)).toBeNull();
    const classic=createMatchSession('new','new-hand',77);expect(saveMatch(classic)).toBeNull();
    expect(loadSession().match).toEqual(classic);
    const practice=createSavedGame({levelRank:9,sessionId:'p',handId:'p1'},1);expect(savePracticeSession(practice)).toBeNull();
    expect(loadSession()).toEqual({saved:practice,match:null});
    expect(localStorage.getItem(STORAGE_KEYS.current)).toBe(raw);
    expect(localStorage.getItem(MATCH_STORAGE.classic)).toBe(encodeMatchSession(classic));
    expect(localStorage.getItem(MATCH_STORAGE.legacy)).toBe(encodeMatchSession(old));
    expect(clearPracticeSession()).toBeNull();expect(loadSession().saved).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.current)).toBe(raw);
  });
  it('keeps incompatible old data raw while allowing a new classic game', () => {
    const raw='{"futureVersion":99}';localStorage.setItem(STORAGE_KEYS.current,raw);
    expect(loadSession().error).toContain('原始数据已保留');
    saveMatch(createMatchSession('new','one',17));expect(loadSession().match).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.current)).toBe(raw);
  });
  it('can restore either mode after finishing practice without losing the paused classic match', () => {
    const legacyPractice=createSavedGame({levelRank:3,sessionId:'old-p',handId:'old-one'},18);
    localStorage.setItem(STORAGE_KEYS.current,JSON.stringify(legacyPractice));
    const match=createMatchSession('paused','one',6);saveMatch(match);
    const practice=createSavedGame({levelRank:5,sessionId:'practice',handId:'one'},9);savePracticeSession(practice);
    expect(loadSession('match').match).toEqual(match);
    expect(loadSession('practice').saved).toEqual(practice);
    clearPracticeSession();
    expect(loadSession('practice').saved).toBeNull();
    expect(loadSession('match').match).toEqual(match);
    expect(localStorage.getItem(STORAGE_KEYS.current)).toBe(JSON.stringify(legacyPractice));
  });
  it('keeps only a completed match as the last match replay and preserves it during a new match', () => {
    const match=complete();expect(match.phase).toBe('complete');
    expect(saveReplaySource({kind:'match',match})).toBeNull();
    expect(loadReplaySource().source).toEqual({kind:'match',match});
    const next=createMatchSession('another','hand',5);saveMatch(next);
    expect(saveReplaySource({kind:'match',match:next})).toContain('尚未结束');
    expect(loadReplaySource().source).toEqual({kind:'match',match});
  });
  it('keeps authoritative memory when quota fails', () => {
    const match=createMatchSession('new','one',17),before=encodeMatchSession(match);
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw Error('quota');}});
    expect(saveMatch(match)).toContain('暂时无法保存');
    expect(encodeMatchSession(match)).toBe(before);
  });
  it('retains the practice checkpoint after replay quota failure and really retries when storage recovers', () => {
    const saved=decodeMatchSession(JSON.stringify(legacyEnded)).saved;
    const checkpoint=createSavedGame(saved.config,saved.seed,saved.setup);
    savePracticeSession(checkpoint);
    const original=localStorage.setItem.bind(localStorage);
    const spy=vi.spyOn(localStorage,'setItem').mockImplementation((key,value)=>{if(key===MATCH_STORAGE.practiceReplay)throw Error('quota');original(key,value);});
    expect(saveFinishedPractice(saved)).toContain('无法保存');
    expect(localStorage.getItem(MATCH_STORAGE.practice)).toBe(JSON.stringify(checkpoint));
    spy.mockRestore();
    expect(saveFinishedPractice(saved)).toBeNull();
    expect(loadReplaySource().source).toEqual({kind:'practice',saved});
    expect(localStorage.getItem(MATCH_STORAGE.practice)).toBeNull();
  });
});

describe('actual whole-match replay', () => {
  it('rebuilds all real hands, exchange stages and the final passed-A state', () => {
    const match=complete(),history=getMatchHistory(match);
    expect(history).toHaveLength(match.journal.records.length);
    expect(history[0].levelsBefore).toEqual([2,2]);
    expect(history.at(-1)!.advance?.passedAce).toBe(true);
    let exchanged=0;
    for(let i=0;i<history.length;i++){
      const hand=getMatchReplayHand(match,i);
      expect(hand.summary).toEqual(history[i]);
      expect(hand.frames[0].state.hands.map(h=>h.length)).toEqual([27,27,27,27]);
      expect(hand.frames[hand.resultIndex].state.result).toEqual(history[i].result);
      for(const frame of hand.frames){
        expect(frame.state.handId).toBe(history[i].handId);
        expect(frame.state.rules.levelRank).toBe(history[i].levelRank);
        if(frame.phase==='return'){exchanged++;expect(frame.exchange!.publicTransfers?.every(t=>t.type==='tribute')).toBe(true);expect(frame.exchange!.hand).toHaveLength(27);}
      }
    }
    expect(exchanged).toBeGreaterThan(0);
    const last=getMatchReplayHand(match,history.length-1).frames.at(-1)!;
    expect(last.state).toEqual(match.saved.state);expect(last.progress).toEqual(match.progress);expect(last.phase).toBe('complete');
  });
  it('future hand commands and seeds cannot affect a previous replay frame or player observation', () => {
    const match=complete(),before=getMatchReplayHand(match,0);
    const altered=structuredClone(match);altered.journal.records[1].seed^=12345;altered.journal.records[1].actions=[];
    const after=getMatchReplayHand(altered,0);expect(after).toEqual(before);
    expect(getObservation(after.frames[0].state,1)).toEqual(getObservation(before.frames[0].state,1));
    expect(()=>getMatchReplayHand(match,-1)).toThrow();expect(()=>getMatchReplayHand(match,historyLength(match))).toThrow();
  });
});
const historyLength=(match:ReturnType<typeof complete>)=>match.journal.records.length;
