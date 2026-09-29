import {retainBoundJwxxcSnapshot} from '../ai/jwxxc/browserModels';
import type {StrategyDecision,StrategyStamp} from '../ai/strategyTypes';
import type {AiObservation} from '../ai/types';
import {armLearningCapture,acceptedLearningAction,restoreLearningCapture,flushLearningExperiences} from '../learning/experience';
import {claimLearningOwner,learningOwner,learningRequest,setLearningConsent,learningActivity,trackLearningInference,LEARNING_CHANGED} from '../learning/client';
import { randomId } from './randomId';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameAction, GameState, PracticeConfig } from '../engine/types';
import { getFixture } from '../test/fixtures';
import { getMatchFixture } from '../test/match-fixtures';
import { isAvailableAssignment, roleAssignment, policyForSeat } from '../ai/roles';
import { playerTier } from './playerTiers';
import {nativeDanlmEnabled,isNativeDanlmStrategy} from '../ai/pro/nativeInfo';
import { getAiObservation } from './aiObservation';
import { startAiTask, type AiTask } from './aiTask';
import { completeDiagnostics, recordDecision } from './aiDiagnostics';
import {recordProLifecycle} from './aiLifecycle';
import { useBackgroundMusic } from '../audio/useBackgroundMusic';
import { getPlayImpact } from './playImpact';
import { advanceSavedGame, createSavedGame, loadSettings, saveSettings, type SavedGame, type Settings } from './persistence';
import { advanceMatchExchange, advanceMatchPlay, beginMatchHand, createMatchSession, nextMatchHand } from '../match/session';
import { chooseExchangeAction, getExchangeObservation } from '../match/exchange';
import { loadReplaySource, loadSession, saveFinishedPractice, saveMatch, savePracticeSession, saveReplaySource } from '../match/storage';
import type { ReplaySource } from '../match/replay';
import type { MatchSession } from '../match/sessionTypes';
import type { ExchangeAction } from '../match/types';
import { currentMatchEntries, importAvailableHistory, practiceEntries } from '../statistics/recording';
import { saveStatistics } from '../statistics/storage';
import { ARCHIVE_CHANGED, archiveCheckpoint, archiveStatus, flushArchive } from '../archive/storage';
import { archiveRecoveredSession, importAnalysisHistory } from '../archive/migration';

export type Screen = 'home' | 'table' | 'replay' | 'spectator';
export type Dialog = 'settings' | 'rules' | 'restart' | 'statistics' | null;
const AI_FAILURE_NOTICE='电脑计算暂时失败，已暂停这一回合，不会自动“不出”。请点“重试电脑”。';
export function useGameController() {
  const [boot] = useState(() => {
    const fixture = import.meta.env.DEV ? getFixture(new URLSearchParams(location.search).get('fixture') ?? '') : null;
    const matchFixture = import.meta.env.DEV ? getMatchFixture(new URLSearchParams(location.search).get('match-fixture') ?? '') : null;
    return { current: matchFixture ? { saved:matchFixture.saved, match:matchFixture, error:undefined } : fixture ? { saved:fixture, match:null, error:undefined } : loadSession(), replay: loadReplaySource(), settings: loadSettings(), fixture: !!fixture || !!matchFixture, practiceFixture: !!fixture };
  });
  const [saved,setSaved]=useState<SavedGame|null>(boot.current.saved);
  const [match,setMatch]=useState<MatchSession|null>(boot.current.match);
  const [archive,setArchive]=useState<ReplaySource|null>(boot.replay.source);
  const [replaySource,setReplaySource]=useState<ReplaySource|null>(boot.replay.source);
  const [replayHandId,setReplayHandId]=useState<string>();
  const [replayKeepsTable,setReplayKeepsTable]=useState(false);
  const replayReturn=useRef<{screen:Screen;dialog:Dialog}>({screen:'home',dialog:null});
  const [settings,setSettings]=useState<Settings>(boot.settings.value);
  const [mode,updateMode]=useState<'match'|'practice'>(boot.practiceFixture?'practice':boot.current.saved?boot.current.match?'match':'practice':boot.settings.value.playMode??'match');
  const [screen,setScreen]=useState<Screen>(new URLSearchParams(location.search).get('view')==='spectator'?'spectator':boot.fixture?'table':'home');
  const [dialog,updateDialog]=useState<Dialog>(null);
  const taskGeneration=useRef(0);
  const setDialog=useCallback((value:Dialog)=>{taskGeneration.current++;updateDialog(value);},[]);
  const [notice,setNotice]=useState(boot.current.error??boot.replay.error??boot.settings.error??'');
  const [hidden,setHidden]=useState(document.hidden);
  const [dealing,setDealing]=useState(false);
  const authority=useRef(saved),matchAuthority=useRef(match);
  const modeCache=useRef(new Map<'match'|'practice',{saved:SavedGame|null;match:MatchSession|null}>());
  const updateSettings=useCallback((patch:Partial<Settings>)=>{if('aiPolicy' in patch||'levelRank' in patch||'playMode' in patch)taskGeneration.current++;setSettings(previous=>{const next={...previous,...patch};const error=saveSettings(next);if(error)setNotice(error);return next;});},[]);
  const {musicStatus,sound}=useBackgroundMusic(settings,musicTrack=>updateSettings({musicTrack}));
  const [thinking,setThinking]=useState(false);
  const [aiFailure,setAiFailure]=useState<string|null>(null);
  const [aiRetry,setAiRetry]=useState(0);
  const retryAi=useCallback(()=>{taskGeneration.current++;setAiFailure(null);setNotice('');setAiRetry(value=>value+1);},[]);
  const mounted=useRef(true),busy=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const changed=()=>{taskGeneration.current++;setHidden(document.hidden);};document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
  const notifySave=(error:string|null)=>{if(error)setNotice(error);};
  useEffect(() => { const error = importAvailableHistory(); if (error) setNotice(current => current || error); }, []);
  useEffect(() => {
    let previousError = '';
    const report = () => {
      const { error } = archiveStatus();
      // Background archive work must not replace a recovery, saving or AI
      // failure already shown by the active game. It may update its own error.
      const previousArchiveError = previousError;
      if (error) setNotice(current => !current || current === previousArchiveError ? error : current);
      else if (previousError) { const resolved = previousError; setNotice(current => current === resolved ? '' : current); }
      previousError = error;
    };
    window.addEventListener(ARCHIVE_CHANGED, report);
    const error = importAnalysisHistory(); if (error) setNotice(current => current || error);
    if (boot.current.saved) archiveRecoveredSession(boot.current.saved, boot.current.match);
    return () => window.removeEventListener(ARCHIVE_CHANGED, report);
  }, [boot]);
  useEffect(()=>{
    claimLearningOwner();
    let live=true;
    const refresh=async()=>{if(!learningOwner())return;try{const status=await learningRequest<{consent:boolean}>('/status');if(live){setLearningConsent(status.consent);void flushLearningExperiences().catch(()=>{});}}catch{if(live)setLearningConsent(false);}};
    void restoreLearningCapture(boot.current.saved,refresh());const timer=window.setInterval(()=>{void refresh();},15000);
    return()=>{live=false;window.clearInterval(timer);};
  },[boot]);
  useEffect(()=>{
    // Keep this immutable handle pinned even while its hand is paused or hidden.
    const refs=[saved?.policy,...(saved?.seatPolicies??[])].flatMap(p=>p?.modelRef?[p.modelRef]:[]);
    let cancelled=false;const releases:Array<()=>void>=[];
    for(const ref of new Map(refs.map(ref=>[ref.weightsSha256,ref])).values())void retainBoundJwxxcSnapshot(ref).then(release=>{if(cancelled)release();else releases.push(release);}).catch(()=>{/* The normal AI retry path reports exact-model load failures. */});
    return()=>{cancelled=true;for(const release of releases)release();};
  },[saved?.state.handId,saved?.policy?.configHash]);
  useEffect(()=>{
    const report=()=>{void learningActivity((screen==='spectator'||screen==='table'&&!saved?.state.result)&&!hidden);};report();
    const timer=window.setInterval(report,10000);window.addEventListener(LEARNING_CHANGED,report);
    return()=>{window.clearInterval(timer);window.removeEventListener(LEARNING_CHANGED,report);};
  },[screen,hidden,saved?.state.handId,!!saved?.state.result]);
  const publishMatch=useCallback((next:MatchSession)=>{
    matchAuthority.current=next;authority.current=next.saved;setMatch(next);setSaved(next.saved);notifySave(saveMatch(next));
    notifySave(saveStatistics(currentMatchEntries(next, Date.now())));
    archiveCheckpoint(next.saved, next, 'live', next.phase === 'playing' || next.phase === 'between' || next.phase === 'complete');
  },[]);
  const commit=useCallback((action:GameAction,learning?:{observation:AiObservation;decision:StrategyDecision}):boolean=>{
    const current=authority.current;if(!current||busy.current)return false;
    busy.current=true;
    try{
      const activeMatch=matchAuthority.current;
      if(activeMatch){
        const next=advanceMatchPlay(activeMatch,action);if(!next.ok){setNotice(next.error);return false;}
        publishMatch(next.match);
        if(next.match.phase==='complete'){const source:ReplaySource={kind:'match',match:next.match};setArchive(source);notifySave(saveReplaySource(source));}
        if(action.type==='play')sound(getPlayImpact(next.match.saved.state.events.at(-1)?.play)?.sound??'play');
      }else{
        const next=advanceSavedGame(current,action);if(!next.ok){setNotice(next.error);return false;}
        authority.current=next.saved;setSaved(next.saved);
        archiveCheckpoint(next.saved, null, 'live', true);
        notifySave(saveStatistics(practiceEntries(next.saved, Date.now())));
        if(next.saved.state.result){const source:ReplaySource={kind:'practice',saved:next.saved};setArchive(source);notifySave(saveFinishedPractice(next.saved));}
        else notifySave(savePracticeSession(next.saved));
        if(action.type==='play')sound(getPlayImpact(next.saved.state.events.at(-1)?.play)?.sound??'play');
      }
      if(authority.current)acceptedLearningAction(current,authority.current,matchAuthority.current,learning);
      if(authority.current?.state.result)completeDiagnostics(authority.current.state.handId);
      return true;
    }finally{busy.current=false;}
  },[sound,publishMatch]);
  const commitExchange=useCallback((action:ExchangeAction):boolean=>{
    const current=matchAuthority.current;if(!current||busy.current)return false;
    busy.current=true;
    try{const next=advanceMatchExchange(current,action);if(!next.ok){setNotice(next.error);return false;}publishMatch(next.match);sound('play');return true;}
    finally{busy.current=false;}
  },[publishMatch,sound]);
  const randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0]!;
  const start=useCallback(async()=>{
    if(settings.unrecognizedAiPolicy!==undefined&&!settings.aiPolicy){setNotice('保存的电脑牌技版本无法识别，请在设置中主动选择兼容档位；原设置已保留。');return;}
    if(isNativeDanlmStrategy(playerTier(settings.aiPolicy))&&!nativeDanlmEnabled()){setNotice('本机模型尚未连接，请用 GUAN 启动器打开游戏。现有存档已保留。');return;}
    taskGeneration.current++;setNotice('');setAiFailure(null);
    const assignment=roleAssignment(playerTier(settings.aiPolicy));
    if(mode==='match')publishMatch(createMatchSession(randomId(),randomId(),randomSeed(),true,'guan-classic-house-v1',assignment.policy,assignment.seatPolicies));
    else {
      const config:PracticeConfig={levelRank:settings.levelRank,sessionId:randomId(),handId:randomId()};
      const fresh=createSavedGame(config,randomSeed(),undefined,assignment.policy,assignment.seatPolicies);matchAuthority.current=null;setMatch(null);authority.current=fresh;setSaved(fresh);notifySave(savePracticeSession(fresh));
      archiveCheckpoint(fresh);
    }
    if(authority.current)armLearningCapture(authority.current);
    setScreen('table');setDialog(null);setDealing(!settings.reducedMotion);sound('select');
  },[mode,settings.levelRank,settings.reducedMotion,settings.aiPolicy,settings.unrecognizedAiPolicy,publishMatch,setDialog,sound]);
  const nextHand=useCallback(async()=>{
    if(settings.unrecognizedAiPolicy!==undefined&&!settings.aiPolicy){setNotice('保存的电脑牌技版本无法识别，请先主动选择兼容档位；当前牌局已保留。');return;}
    if(isNativeDanlmStrategy(playerTier(settings.aiPolicy))&&!nativeDanlmEnabled()){setNotice('本机模型尚未连接，请用 GUAN 启动器继续游戏。现有存档已保留。');return;}
    const current=matchAuthority.current;if(!current)return;
    if(isNativeDanlmStrategy(playerTier(settings.aiPolicy))&&current.journal.rulesVersion!=='guan-classic-house-v1'){setNotice('DanLM 支持经典升级；这场旧版比赛请选择休闲或均衡，或新开经典升级赛。');return;}
    const assignment=roleAssignment(playerTier(settings.aiPolicy));
    const next=nextMatchHand(current,randomSeed(),randomId(),assignment.policy,assignment.seatPolicies);if(!next.ok){setNotice(next.error);return;}
    taskGeneration.current++;setAiFailure(null);publishMatch(next.match);armLearningCapture(next.match.saved);setDialog(null);setScreen('table');setDealing(false);
  },[publishMatch,setDialog,settings.aiPolicy,settings.unrecognizedAiPolicy]);
  const beginHand=useCallback(()=>{
    const current=matchAuthority.current;if(!current)return;
    const next=beginMatchHand(current);if(!next.ok){setNotice(next.error);return;}
    taskGeneration.current++;publishMatch(next.match);armLearningCapture(next.match.saved);setDealing(!settings.reducedMotion);sound('select');
  },[publishMatch,settings.reducedMotion,sound]);
  useEffect(()=>{if(!dealing)return;const timer=window.setTimeout(()=>setDealing(false),800);return()=>window.clearTimeout(timer);},[dealing,saved?.state.handId]);
  useEffect(()=>{
    const current=saved?.state;setThinking(false);
    if(!saved||!current||screen!=='table'||dialog||hidden||dealing||aiFailure)return;
    const generation=taskGeneration.current;
    if(match?.phase==='exchange'&&match.exchange&&match.exchange.currentPlayer!==null&&match.exchange.currentPlayer!==0){
      const observation=getExchangeObservation(match.exchange!,match.exchange!.currentPlayer!);
      const action=chooseExchangeAction(observation);setThinking(true);
      const timer=window.setTimeout(()=>{
        const latest=matchAuthority.current?.exchange;
        if(!mounted.current||document.hidden||generation!==taskGeneration.current||matchAuthority.current?.phase!=='exchange'||!latest||latest.handId!==action.handId||latest.stateVersion!==action.stateVersion||latest.currentPlayer!==action.player)return;
        commitExchange(action);
      },import.meta.env.DEV&&new URLSearchParams(location.search).get('fast')==='1'?0:500);
      return()=>window.clearTimeout(timer);
    }
    if(match&&match.phase!=='playing'||current.result||current.currentPlayer===0)return;
    if(!isAvailableAssignment(saved)){setNotice('这副记录的 AI 版本当前不可用，存档和回放已保留。请重新开局，已有动作不会重算。');return;}
    const stamp={sessionId:current.sessionId,handId:current.handId,stateVersion:current.stateVersion,player:current.currentPlayer};
    const observation=getAiObservation(current,current.currentPlayer,match);
    const streamSeed=(current.stateVersion+1)*2654435761+current.currentPlayer*971;
    const finishLearningInference=trackLearningInference();
    const task=startAiTask(observation,policyForSeat(saved,current.currentPlayer),streamSeed>>>0);setThinking(true);
    const delay=import.meta.env.DEV&&new URLSearchParams(location.search).get('fast')==='1'?0:settings.reducedMotion?450:680;
    let timer:number|undefined;
    let cancelled=false;
    let awaitingSubmission:StrategyStamp|undefined;
    const fresh=()=>{
      const latest=authority.current?.state;
      return !cancelled&&mounted.current&&!document.hidden&&generation===taskGeneration.current&&!!latest&&!latest.result&&latest.sessionId===stamp.sessionId&&latest.handId===stamp.handId&&latest.stateVersion===stamp.stateVersion&&latest.currentPlayer===stamp.player&&(!matchAuthority.current||matchAuthority.current.phase==='playing');
    };
    void task.promise.then(result=>{
      finishLearningInference(result?.elapsedMs);
      if(!result)return;
      if(!fresh()){recordProLifecycle(observation,result.identity.requested,'discarded','state-or-view-changed');return;}
      if(result.identity.fallbackReason){
        const reason=result.errorDetail??result.identity.fallbackReason;
        setThinking(false);setAiFailure(reason);setNotice(AI_FAILURE_NOTICE);
        if(nativeDanlmEnabled()&&isNativeDanlmStrategy(result.identity.requested.id))void fetch('/__pro/native/failure',{method:'POST',headers:{'Content-Type':'application/json','X-Guan-Pro':'classic-and-practice'},body:JSON.stringify({policy:result.identity.requested.id,reason})}).catch(()=>{});
        return;
      }
      awaitingSubmission=result.identity.requested;
      timer=window.setTimeout(()=>{
        awaitingSubmission=undefined;
        if(!fresh()){recordProLifecycle(observation,result.identity.requested,'discarded','state-changed-before-submit');return;}
        setAiFailure(null);
        setNotice(value=>value===AI_FAILURE_NOTICE?'':value);
        if(commit(result.decision.action,{observation,decision:result.decision})){
          recordProLifecycle(observation,result.identity.requested,'submitted');
          recordDecision(observation,result.decision,'bot',result.elapsedMs,result.computeMs,result.identity,result.timing);
        }else recordProLifecycle(observation,result.identity.requested,'submission-rejected','authority-rejected-action');
      },Math.max(0,delay-result.elapsedMs));
    });
    return()=>{cancelled=true;if(awaitingSubmission)recordProLifecycle(observation,awaitingSubmission,'discarded','view-changed-before-submit');task.cancel();finishLearningInference();window.clearTimeout(timer);};
  },[saved,match,screen,dialog,hidden,dealing,settings.reducedMotion,commit,commitExchange,aiRetry,aiFailure]);
  const requestHint=useCallback(():AiTask=>{
    const current=authority.current;
    if(!current||current.state.currentPlayer!==0||current.state.result)return {promise:Promise.resolve(null),cancel:()=>{}};
    if(!nativeDanlmEnabled()||matchAuthority.current?.journal.rulesVersion==='guan-match-v1'){
      setNotice(!nativeDanlmEnabled()?'DanLM 本机模型尚未连接，请用 GUAN 启动器打开游戏。':'DanLM 暂不支持这场旧版升级赛，请在经典升级或单副练习中使用。');
      return {promise:Promise.resolve(null),cancel:()=>{}};
    }
    const generation=taskGeneration.current;
    const observation=getAiObservation(current.state,0,matchAuthority.current);
    // Separate deterministic hint stream; no bot RNG is advanced or shared.
    const finishLearningInference=trackLearningInference();
    const task=startAiTask(observation,'pro-danlm-classic-v1',((observation.stateVersion+1)*2246822519+0x48494e54)>>>0);
    return {cancel:()=>{task.cancel();finishLearningInference();},promise:task.promise.then(result=>{
      finishLearningInference(result?.elapsedMs);
      const latest=authority.current?.state;
      if(!result||!mounted.current||document.hidden||generation!==taskGeneration.current||!latest||latest.sessionId!==observation.sessionId||latest.handId!==observation.handId||latest.stateVersion!==observation.stateVersion||latest.currentPlayer!==0)return null;
      if(result.identity.fallbackReason){setNotice(`DanLM 提示暂时失败，请重试；选牌已保留。原因：${result.errorDetail??result.identity.fallbackReason}`);return null;}
      setNotice(value=>value.startsWith('DanLM 提示暂时失败')||value.startsWith('提示计算暂时失败')?'':value);
      recordDecision(observation,result.decision,'hint',result.elapsedMs,result.computeMs,result.identity,result.timing);return result;
    })};
  },[]);
  const setMode=useCallback((next:'match'|'practice')=>{
    taskGeneration.current++;setAiFailure(null);setNotice(value=>value===AI_FAILURE_NOTICE?'':value);
    if(authority.current)modeCache.current.set(matchAuthority.current?'match':'practice',{saved:authority.current,match:matchAuthority.current});
    const loaded=modeCache.current.get(next)??loadSession(next);
    authority.current=loaded.saved;matchAuthority.current=loaded.match;setSaved(loaded.saved);setMatch(loaded.match);
    if('error' in loaded&&typeof loaded.error==='string')setNotice(loaded.error);
    updateMode(next);updateSettings({playMode:next});
  },[updateSettings]);
  const retrySave=useCallback(()=>{
    const currentMatch=matchAuthority.current,current=authority.current;
    const error=currentMatch?saveMatch(currentMatch):current?current.state.result?saveFinishedPractice(current):savePracticeSession(current):null;
    const statisticsError = saveStatistics(currentMatch ? currentMatchEntries(currentMatch, null) : current ? practiceEntries(current, null) : []);
    setNotice(error??statisticsError??'');
    if(current)archiveCheckpoint(current,currentMatch,'recovered');
    void flushArchive().catch(error => setNotice(current => current || error.message));
    if(currentMatch?.phase==='complete')notifySave(saveReplaySource({kind:'match',match:currentMatch}));
  },[]);
  const home=useCallback(()=>{retrySave();setAiFailure(null);setScreen('home');setDialog(null);setDealing(false);},[setDialog,retrySave]);
  const canContinue=!!match||!!saved&&!saved.state.result;
  const continueMode=match?match.journal.rulesVersion==='guan-classic-house-v1'?'经典升级 · 掼蛋规则':'旧版连续升级':'单副练习';
  const continueGame=useCallback(()=>{
    if(authority.current&&(matchAuthority.current||!authority.current.state.result)){retrySave();updateMode(matchAuthority.current?'match':'practice');setScreen('table');setDialog(null);}
  },[setDialog,retrySave]);
  const openReplay=useCallback(()=>{
    const currentMatch=matchAuthority.current,current=authority.current;
    const source:ReplaySource|null=screen==='table'&&current?.state.result?(currentMatch?{kind:'match',match:currentMatch}:{kind:'practice',saved:current}):archive;
    if(source){replayReturn.current={screen:'home',dialog:null};setReplayKeepsTable(false);setReplayHandId(undefined);setReplaySource(source);setScreen('replay');setDialog(null);}
  },[archive,screen,setDialog]);
  // Archived playback is a presentation route. The active session, frozen AI
  // assignments and any paused failure remain owned by the current game.
  const openArchivedReplay=useCallback((source:ReplaySource,handId?:string)=>{
    replayReturn.current={screen:screen==='replay'?'home':screen,dialog:'statistics'};
    setReplayKeepsTable(screen==='table');
    setReplayHandId(handId);setReplaySource(source);setScreen('replay');setDialog(null);
  },[screen,setDialog]);
  const exitReplay=useCallback(()=>{
    setReplayHandId(undefined);setReplayKeepsTable(false);setScreen(replayReturn.current.screen);setDialog(replayReturn.current.dialog);
  },[setDialog]);
  const canReplay=!!archive;
  const exchangeObservation=match?.exchange?getExchangeObservation(match.exchange,0):null;
  return {saved,match,replaySource,replayHandId,replayKeepsTable,canReplay,continueMode,retrySave,settings,mode,setMode,canContinue,exchangeObservation,commitExchange,nextHand,beginHand,musicStatus,screen,setScreen,dialog,setDialog,notice,setNotice,hidden,dealing,thinking,aiFailure,retryAi,start,commit,requestHint,updateSettings,sound,home,continueGame,openReplay,openArchivedReplay,exitReplay};
}
export function actionStamp(state:GameState){return {sessionId:state.sessionId,handId:state.handId,stateVersion:state.stateVersion,player:state.currentPlayer};}
