import type { GameAction } from '../engine/types';
import { advanceSavedGame, createSavedGame } from '../game/persistence';
import { applyExchangeAction, createExchange } from './exchange';
import { createMatchProgress, getMatchLevel, settleMatchProgress } from './progression';
import { CLASSIC_RULES_VERSION, type ExchangeAction, type HandSetup, type MatchRulesVersion } from './types';
import type { MatchHandRecord, MatchJournal, MatchSession, MatchSessionResult } from './sessionTypes';
import type { StrategyStamp as PolicyStamp, SeatPolicies } from '../ai/strategyTypes';
import { readStrategyStamp as readPolicyStamp, readSeatPolicies } from '../ai/descriptors';

const copy=<T,>(value:T):T=>structuredClone(value);
function normalizedRecord(matchId:string,handId:string,levelRank:number,seed:number,started:boolean,firstPlayer?:0|1|2|3,policy?:PolicyStamp,seatPolicies?:SeatPolicies):MatchHandRecord {
  const saved=createSavedGame({sessionId:matchId,handId,levelRank,firstPlayer},seed,undefined,policy,seatPolicies);
  return {seed,config:saved.config,exchangeActions:[],actions:[],started,...(saved.policy?{policy:saved.policy}:{}),...(saved.seatPolicies?{seatPolicies:saved.seatPolicies}:{})};
}
export function createMatchSession(matchId:string,handId:string,seed:number,tributeEnabled=true,rulesVersion:MatchRulesVersion=CLASSIC_RULES_VERSION,policy?:PolicyStamp,seatPolicies?:SeatPolicies):MatchSession {
  if(rulesVersion===CLASSIC_RULES_VERSION&&!tributeEnabled)throw Error('经典升级必须执行进贡还贡规则');
  const record=normalizedRecord(matchId,handId,2,seed,true,undefined,policy,seatPolicies);
  return {journal:{kind:'match',schemaVersion:rulesVersion===CLASSIC_RULES_VERSION?2:1,rulesVersion,matchId,tributeEnabled,records:[record]},
    progress:createMatchProgress(rulesVersion),saved:createSavedGame(record.config,seed,undefined,record.policy,record.seatPolicies),exchange:null,phase:'playing',currentLevelRank:2,levelOwnerTeamId:null,previousHandResult:null};
}
const replaceRecord=(session:MatchSession,record:MatchHandRecord):MatchJournal=>({...session.journal,records:[...session.journal.records.slice(0,-1),record]});

export function advanceMatchPlay(session:MatchSession,action:GameAction):MatchSessionResult {
  if(session.phase!=='playing')return {ok:false,error:'请先完成进贡或进入下一副'};
  const result=advanceSavedGame(session.saved,action);
  if(!result.ok)return result;
  const record=session.journal.records.at(-1)!;
  const next:MatchSession={...session,saved:result.saved,journal:replaceRecord(session,{...record,actions:[...record.actions,copy(action)]})};
  if(result.saved.state.result){
    const settled=settleMatchProgress(session.progress,result.saved.state);
    if(!settled.ok)return settled;
    next.progress=settled.progress;next.phase=settled.progress.winner===null?'between':'complete';
  }
  return {ok:true,match:next};
}
export function nextMatchHand(session:MatchSession,seed:number,handId:string,policy?:PolicyStamp,seatPolicies?:SeatPolicies):MatchSessionResult {
  if(session.phase!=='between'||!session.progress.lastResult)return {ok:false,error:'本副尚未结算，或本场已经结束'};
  if(session.journal.records.some(record=>record.config.handId===handId))return {ok:false,error:'新副牌的标识必须唯一'};
  const progress={...session.progress,handNumber:session.progress.handNumber+1};
  const tribute=session.journal.tributeEnabled;
  const record=normalizedRecord(session.journal.matchId,handId,getMatchLevel(progress),seed,!tribute,session.progress.lastResult.order[0],policy,seatPolicies);
  const saved=createSavedGame(record.config,seed,undefined,record.policy,record.seatPolicies);
  const exchange=tribute?createExchange(saved.state,session.progress.lastResult,session.journal.rulesVersion):null;
  const next:MatchSession={journal:{...session.journal,records:[...session.journal.records,record]},progress,saved,exchange,
    phase:exchange?exchange.phase==='done'?'ready':'exchange':'playing',currentLevelRank:saved.state.rules.levelRank,levelOwnerTeamId:progress.activeTeam,previousHandResult:copy(session.progress.lastResult)};
  if(exchange?.phase==='done')next.saved=createSavedGame(record.config,seed,{version:setupVersion(session),previous:exchange.previous,actions:[]},record.policy,record.seatPolicies);
  return {ok:true,match:next};
}
export function advanceMatchExchange(session:MatchSession,action:ExchangeAction):MatchSessionResult {
  if(session.phase!=='exchange'||!session.exchange)return {ok:false,error:'当前不在贡还牌阶段'};
  const result=applyExchangeAction(session.exchange,action);
  if(!result.ok)return result;
  const record=session.journal.records.at(-1)!;
  const updated={...record,exchangeActions:[...record.exchangeActions,copy(action)]};
  const next:MatchSession={...session,exchange:result.exchange,journal:replaceRecord(session,updated)};
  if(result.exchange.phase==='done'){
    const setup:HandSetup={version:setupVersion(session),previous:result.exchange.previous,actions:updated.exchangeActions};
    next.saved=createSavedGame(updated.config,updated.seed,setup,updated.policy,updated.seatPolicies);next.phase='ready';
  }
  return {ok:true,match:next};
}
export function beginMatchHand(session:MatchSession):MatchSessionResult {
  if(session.phase!=='ready'||session.exchange?.phase!=='done')return {ok:false,error:'请先完成全部贡还牌'};
  const record=session.journal.records.at(-1)!;
  return {ok:true,match:{...session,journal:replaceRecord(session,{...record,started:true}),phase:'playing'}};
}

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<200;
const seedValid=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=0xffffffff;
const setupVersion=(session:MatchSession):HandSetup['version']=>session.journal.rulesVersion===CLASSIC_RULES_VERSION?CLASSIC_RULES_VERSION:'guan-tribute-v1';
function assertJournal(value:unknown):asserts value is MatchJournal {
  if(!object(value)||value.kind!=='match'||!((value.schemaVersion===1&&value.rulesVersion==='guan-match-v1')||(value.schemaVersion===2&&value.rulesVersion===CLASSIC_RULES_VERSION&&value.tributeEnabled===true))||!id(value.matchId)||typeof value.tributeEnabled!=='boolean'||!Array.isArray(value.records)||!value.records.length||value.records.length>512)throw Error('升级赛存档格式无效');
  let actions=0;const seen=new Set<string>();
  for(const record of value.records){
    if(!object(record)||!seedValid(record.seed)||!object(record.config)||record.config.sessionId!==value.matchId||!id(record.config.handId)||seen.has(record.config.handId)||!Array.isArray(record.actions)||record.actions.length>1500||!Array.isArray(record.exchangeActions)||record.exchangeActions.length>4||typeof record.started!=='boolean')throw Error('升级赛牌局记录无效');
    seen.add(record.config.handId);actions+=record.actions.length;
    readPolicyStamp(record.policy);
    readSeatPolicies(record.seatPolicies);
  }
  if(actions>40_000)throw Error('升级赛记录过长');
}
/** JSON object member order and omitted undefined fields are irrelevant; stored values and array order are authoritative. */
function same(a:unknown,b:unknown):boolean {
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>same(value,b[index]));
  if(!object(a)||!object(b))return false;
  const keys=Object.keys(a).filter(key=>a[key]!==undefined);
  return keys.length===Object.keys(b).filter(key=>b[key]!==undefined).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
}
/** Rebuild all levels, trades and turns. Never trust a saved score or final snapshot. */
export function restoreMatchJournal(value:unknown):MatchSession {
  assertJournal(value);let session:MatchSession|undefined;
  for(let index=0;index<value.records.length;index++){
    const record=value.records[index];
    if(!session)session=createMatchSession(value.matchId,record.config.handId!,record.seed,value.tributeEnabled,value.rulesVersion,record.policy,record.seatPolicies);
    else {const next=nextMatchHand(session,record.seed,record.config.handId!,record.policy,record.seatPolicies);if(!next.ok)throw Error(next.error);session=next.match;}
    const expected=session.journal.records.at(-1)!;
    // Initial leader is derived from the seed (first deal) or prior result.
    if(record.config.levelRank!==expected.config.levelRank||record.config.firstPlayer!==expected.config.firstPlayer)throw Error('级牌或先手与升级记录不一致');
    for(const action of record.exchangeActions){const next=advanceMatchExchange(session,action);if(!next.ok)throw Error(next.error);session=next.match;}
    if(record.started&&session.phase==='ready'){const next=beginMatchHand(session);if(!next.ok)throw Error(next.error);session=next.match;}
    if(record.started!==session.journal.records.at(-1)!.started)throw Error('开局状态不一致');
    for(const action of record.actions){const next=advanceMatchPlay(session,action);if(!next.ok)throw Error(next.error);session=next.match;}
  }
  return session!;
}
export function encodeMatchSession(session:MatchSession):string {
  return JSON.stringify({...session.journal,check:{progress:session.progress,phase:session.phase,state:session.saved.state,exchange:session.exchange,...(session.saved.policy?{policy:session.saved.policy}:{}),...(session.saved.seatPolicies?{seatPolicies:session.saved.seatPolicies}:{}),...(session.journal.rulesVersion===CLASSIC_RULES_VERSION?{context:handContext(session)}:{})}});
}
const handContext=(session:MatchSession)=>({currentLevelRank:session.currentLevelRank,levelOwnerTeamId:session.levelOwnerTeamId,previousHandResult:session.previousHandResult});
export function decodeMatchSession(raw:string):MatchSession {
  if(raw.length>8_000_000)throw Error('升级赛存档过大');
  const parsed:unknown=JSON.parse(raw);const session=restoreMatchJournal(parsed);
  if(!object(parsed)||!object(parsed.check)||!same(parsed.check.progress,session.progress)||parsed.check.phase!==session.phase||!same(parsed.check.state,session.saved.state)||!same(parsed.check.exchange,session.exchange))throw Error('升级赛存档状态校验失败');
  if(session.journal.rulesVersion===CLASSIC_RULES_VERSION&&!same(parsed.check.context,handContext(session)))throw Error('本副级牌或归属校验失败');
  if(!same(parsed.check.policy,session.saved.policy))throw Error('本副 AI 策略记录不一致');
  if(!same(parsed.check.seatPolicies,session.saved.seatPolicies))throw Error('本副逐席 AI 配置不一致');
  return session;
}
