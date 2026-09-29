import {STORAGE_KEYS,type SavedGame} from '../game/persistence';
import {MATCH_STORAGE} from '../match/storage';
import type {MatchSession} from '../match/sessionTypes';
import type {AiObservation} from '../ai/types';
import type {StrategyDecision} from '../ai/strategyTypes';
import {PRO_CANDIDATE_VERSION} from '../ai/pro/actions';
import {learningHash,type BetaActionReceipt,type BetaLiveEpisode} from '../ai/jwxxc/experienceContract';
import {learningConsented,learningRequest} from './client';

interface Capture {key:string;next:number;receipts:BetaActionReceipt[];blocked?:string}
interface Row {key:string;capture?:Capture;episode?:BetaLiveEpisode;error?:string}
let databasePromise:Promise<IDBDatabase>|undefined;
function database(){return databasePromise??=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('guan-jwxxc-live-experience-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('episodes',{keyPath:'key'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function rows():Promise<Row[]>{const db=await database();return new Promise((resolve,reject)=>{const request=db.transaction('episodes').objectStore('episodes').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function put(row:Row){const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('episodes','readwrite');tx.objectStore('episodes').put(row);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
async function remove(key:string){const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('episodes','readwrite');tx.objectStore('episodes').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
const keyFor=(saved:SavedGame)=>`${saved.state.sessionId}/${saved.state.handId}`;
const captures=new Map<string,Capture>();let queue=Promise.resolve(),flushing=false,hydrating=false,hydrationGeneration=0,hydrationOverflow=false;
const deferred:Array<()=>void>=[];
const defer=(work:()=>void)=>{if(hydrationOverflow)return;if(deferred.length<64)deferred.push(work);else{hydrationOverflow=true;deferred.length=0;captures.clear();experienceNotice='恢复期间采集缓冲超限，此副不接入训练';}};
export let experienceNotice='';
const enqueue=(work:()=>Promise<void>)=>{queue=queue.then(work).catch(error=>{experienceNotice=`学习经验暂未保存：${String(error)}`;});};
/** Incomplete receipts are useful only while their hand can still be resumed.
 * Keep every current mode slot, including old compatibility saves; complete
 * pending episodes are retained independently until the server accepts them. */
async function pruneAbandonedCaptures(saved:SavedGame){
 const retained=new Set([keyFor(saved)]);
 try{
  for(const slot of [MATCH_STORAGE.classic,MATCH_STORAGE.legacy,MATCH_STORAGE.practice,STORAGE_KEYS.current]){
   const raw=localStorage.getItem(slot);if(!raw)continue;
   const value=JSON.parse(raw),config=value?.kind==='match'?value.records?.at(-1)?.config:value?.config;
   // If a slot cannot be read, do not infer that its old receipt is disposable.
   if(typeof config?.sessionId!=='string'||typeof config?.handId!=='string')return;
   retained.add(`${config.sessionId}/${config.handId}`);
  }
 }catch{return;}
 for(const row of await rows())if(row.capture&&!row.episode&&!retained.has(row.key))await remove(row.key);
 for(const key of captures.keys())if(!retained.has(key))captures.delete(key);
}
export async function restoreLearningCapture(saved:SavedGame|null,consentReady:Promise<unknown>=Promise.resolve()){
 const generation=++hydrationGeneration;hydrating=true;hydrationOverflow=false;
 try{await consentReady;if(generation!==hydrationGeneration||!saved||hydrationOverflow)return;
  const row=(await rows()).find(item=>item.key===keyFor(saved));
  if(generation!==hydrationGeneration||hydrationOverflow)return;
  if(row?.capture&&row.capture.next===saved.actions.length&&!saved.state.result)captures.set(row.key,row.capture);
 }catch{/* Missing provenance never recreated from an archive. */}
 finally{if(generation===hydrationGeneration){hydrating=false;const pending=deferred.splice(0),allowed=!hydrationOverflow;hydrationOverflow=false;if(allowed)for(const work of pending)work();else captures.clear();}}
}
export function armLearningCapture(saved:SavedGame):void{
 if(hydrating){defer(()=>armLearningCapture(saved));return;}
 if(!learningConsented()||saved.actions.length!==0||saved.state.stateVersion!==0||saved.state.result)return;
 const policies=saved.seatPolicies??[saved.policy,saved.policy,saved.policy,saved.policy];
 if(!policies.some(p=>p?.id==='jwxxc-pro')||policies.some(p=>!p||p.id.startsWith('pro-')))return;
 const key=keyFor(saved);if(captures.has(key))return;
 const capture:Capture={key,next:0,receipts:[]};captures.set(key,capture);
 enqueue(async()=>{await pruneAbandonedCaptures(saved);const current=await rows();if(current.length>=32){capture.blocked='浏览器经验待发送队列已满';throw Error(capture.blocked);}await put({key,capture:structuredClone(capture)});if(experienceNotice.includes('浏览器经验待发送队列已满'))experienceNotice='';});
}
/** Called only after the unchanged authority accepted this live action. */
export function acceptedLearningAction(before:SavedGame,after:SavedGame,match:MatchSession|null,model?:{observation:AiObservation;decision:StrategyDecision}):void{
 if(hydrating){defer(()=>acceptedLearningAction(before,after,match,model));return;}
 const key=keyFor(before),capture=captures.get(key);if(!capture)return;
 if(!learningConsented()||capture.blocked||capture.next!==before.actions.length){capture.blocked??='中途关闭采集或动作序号不连续';return;}
 const action=after.actions.at(-1)!;
 if(model){const d=model.decision.jwxxcDiagnostics;if(d?.candidatesComplete&&d.objectiveId==='jwxxc-round-return-v1')capture.receipts.push({eventSeq:before.actions.length,beforeObservation:structuredClone(model.observation),selectedActionId:action.type==='pass'?'pass':action.playKey,candidateFingerprint:d.candidateFingerprint,candidateComplete:true,behaviorModelHash:d.modelHash,encoderVersion:d.encoderVersion,candidateVersion:PRO_CANDIDATE_VERSION,objectiveId:'jwxxc-round-return-v1',behavior:d.mode==='model'?'model':'hybrid',exploration:false,hint:false,takeover:false,fallback:false,beforeStateHash:learningHash(before.state),afterStateHash:learningHash(after.state)});else if((before.seatPolicies?.[action.player]??before.policy)?.id==='jwxxc-pro')capture.blocked='缺失完整模型执行诊断';}
 capture.next=after.actions.length;
 const copy=structuredClone(capture);
 if(after.state.result){
  captures.delete(key);
  if(copy.blocked||!copy.receipts.length){enqueue(()=>put({key,capture:copy,error:copy.blocked??'没有 Beta 动作'}));return;}
  const episode:BetaLiveEpisode={schemaVersion:'jwxxc-beta-live-episode-v1',source:'local-live',humanSeat:0,captureStartedStateVersion:0,saved:structuredClone(after),...(match?{matchJournal:structuredClone(match.journal)}:{}),receipts:copy.receipts};
  enqueue(async()=>{await put({key,episode});void flushLearningExperiences().catch(()=>{});});
 }else enqueue(()=>put({key,capture:copy}));
}
export async function flushLearningExperiences(){
 if(flushing||!learningConsented())return;flushing=true;
 try{for(const row of await rows()){if(!row.episode||row.error)continue;try{await learningRequest('/experience',row.episode);await remove(row.key);}catch(error){experienceNotice=`经验待同步：${String(error)}`;break;}}}finally{flushing=false;}
}
export async function clearLocalLearningExperiences(){hydrationGeneration++;hydrating=false;hydrationOverflow=false;deferred.length=0;captures.clear();await queue;const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('episodes','readwrite');tx.objectStore('episodes').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
