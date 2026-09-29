import {randomId} from './randomId';
import type {AiObservation} from '../ai/types';
import {resolveStrategy} from '../ai/descriptors';
import {ownAiInput} from '../ai/input';
import {emergencyComputation,emergencyDecision,matchesStrategyComputation,observationAllowsAction} from '../ai/emergency';
import type {StrategyComputation,StrategyDescriptor,StrategyId,StrategyStamp} from '../ai/strategyTypes';
import {isJwxxcStrategy} from '../ai/jwxxc/descriptor';
import {loadBoundJwxxcHandle} from '../ai/jwxxc/browserModels';
import {getJwxxcHandle,jwxxcPayloadForWorker,pinJwxxcHandle,type JwxxcModelHandle} from '../ai/jwxxc/modelAdapter';
import type {BetaSnapshotReference} from '../ai/jwxxc/snapshots';
import {recordProLifecycle} from './aiLifecycle';

export interface AiTaskResult extends StrategyComputation {elapsedMs:number;computeMs:number;errorDetail?:string}
export interface AiTask {promise:Promise<AiTaskResult|null>;cancel():void}
type WorkerLike=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
const createWorker=():WorkerLike=>new Worker(new URL('../ai/worker.ts',import.meta.url),{type:'module'});
let idleProWorker:WorkerLike|undefined,idleTimer:ReturnType<typeof setTimeout>|undefined;
const workerModelHashes=new WeakMap<WorkerLike,Set<string>>();
const idleJwxxc=new Map<string,{worker:WorkerLike;timer:ReturnType<typeof setTimeout>}>();
function acquireJwxxcWorker(hash:string):WorkerLike{const item=idleJwxxc.get(hash);if(item){clearTimeout(item.timer);idleJwxxc.delete(hash);return item.worker;}return createWorker();}
function retainJwxxcWorker(hash:string,worker:WorkerLike):void{
 const old=idleJwxxc.get(hash);if(old){clearTimeout(old.timer);old.worker.terminate();}
 worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;
 const timer=setTimeout(()=>{const item=idleJwxxc.get(hash);if(item?.worker===worker){worker.terminate();idleJwxxc.delete(hash);}},30_000);
 idleJwxxc.delete(hash);idleJwxxc.set(hash,{worker,timer});
 while(idleJwxxc.size>4){const [key,stale]=idleJwxxc.entries().next().value!;clearTimeout(stale.timer);stale.worker.terminate();idleJwxxc.delete(key);}
}
function acquireProWorker():WorkerLike {if(idleTimer)clearTimeout(idleTimer);idleTimer=undefined;const worker=idleProWorker;idleProWorker=undefined;return worker??createWorker();}
function retainProWorker(worker:WorkerLike):void {idleProWorker?.terminate();if(idleTimer)clearTimeout(idleTimer);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;idleProWorker=worker;idleTimer=setTimeout(()=>{if(idleProWorker===worker){worker.terminate();idleProWorker=undefined;}},30_000);}
export const fallbackDecision=(obs:AiObservation,policy:StrategyId,reason:string)=>emergencyDecision(obs,resolveStrategy(policy),reason);

export function startAiTask(obs:AiObservation,policy:StrategyId|StrategyStamp|StrategyDescriptor,decisionSeed:number,options:{workerFactory?:()=>WorkerLike;timeoutMs?:number;modelLoader?:(ref:BetaSnapshotReference,options:{signal:AbortSignal})=>Promise<JwxxcModelHandle>}={}):AiTask{
 const descriptor=resolveStrategy(policy),started=performance.now();
 recordProLifecycle(obs,descriptor.stamp,'requested');
 const abort=new AbortController();let releaseModel:(()=>void)|undefined;
 let worker:WorkerLike|undefined,timer:ReturnType<typeof setTimeout>|undefined,finished=false;
 let resolve!:(value:AiTaskResult|null)=>void;
 const promise=new Promise<AiTaskResult|null>(done=>{resolve=done;});
 const navigation=typeof window==='undefined'?undefined:window;
 const finish=(result:AiTaskResult|null)=>{if(finished)return;finished=true;navigation?.removeEventListener('pagehide',cancel);navigation?.removeEventListener('beforeunload',cancel);abort.abort();releaseModel?.();if(timer)clearTimeout(timer);if(worker){if(!options.workerFactory&&isJwxxcStrategy(descriptor.id)&&result&&!result.identity.fallbackReason)retainJwxxcWorker(String(descriptor.config.modelHash),worker);else if(!options.workerFactory&&descriptor.id.startsWith('pro-')&&result&&!result.identity.fallbackReason)retainProWorker(worker);else{worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}}resolve(result);};
 const cancel=()=>{if(!finished)recordProLifecycle(obs,descriptor.stamp,'cancelled','task-cancelled');finish(null);};
 // Full document navigation does not wait for React effect cleanup. Cancel the
 // task before its module imports or model download can fail in a dying page.
 navigation?.addEventListener('pagehide',cancel);
 navigation?.addEventListener('beforeunload',cancel);
 const degrade=(reason:string,detail?:string)=>{if(finished)return;recordProLifecycle(obs,descriptor.stamp,'failed',reason);try{finish({...emergencyComputation(obs,descriptor,reason),elapsedMs:performance.now()-started,computeMs:0,...(detail?{errorDetail:detail.slice(0,300)}:{})});}catch{finish(null);}};
 const requestId=randomId();
 timer=setTimeout(()=>degrade('deadline'),Math.min(options.timeoutMs??descriptor.runtime.browserDeadlineMs,descriptor.runtime.browserDeadlineMs));
 const launch=()=>{if(finished)return;try{
  worker=(options.workerFactory??(isJwxxcStrategy(descriptor.id)?()=>acquireJwxxcWorker(String(descriptor.config.modelHash)):descriptor.id.startsWith('pro-')?acquireProWorker:createWorker))();
  worker.onmessage=(event:MessageEvent)=>{
   if(finished)return;
   const response=event.data;if(response?.requestId!==requestId)return;
   if(response.error||!response.result?.decision){degrade('worker-error',typeof response.error==='string'?response.error:undefined);return;}
   const result=response.result as StrategyComputation,action=result.decision.action;
   if(!action||action.sessionId!==obs.sessionId||action.handId!==obs.handId||action.stateVersion!==obs.stateVersion||action.player!==obs.player){degrade('response-mismatch');return;}
   if(!observationAllowsAction(obs,action)){degrade('illegal-response');return;}
   if(!matchesStrategyComputation(result,descriptor,obs)){degrade('policy-response-mismatch');return;}
   recordProLifecycle(obs,descriptor.stamp,'computed');
   finish({...result,elapsedMs:performance.now()-started,computeMs:result.timing.computeMs});
  };
  worker.onerror=(event)=>degrade('worker-error',event.message);worker.onmessageerror=()=>degrade('message-error');
  const ref=descriptor.stamp.modelRef;let jwxxcModel:undefined|{reference:BetaSnapshotReference;payload:unknown};
  if(ref){releaseModel=pinJwxxcHandle(ref);const hashes=workerModelHashes.get(worker)??new Set<string>();if(!hashes.has(ref.weightsSha256)){jwxxcModel={reference:ref,payload:jwxxcPayloadForWorker(ref)};hashes.add(ref.weightsSha256);workerModelHashes.set(worker,hashes);}}
  worker.postMessage({requestId,observation:ownAiInput(obs),descriptor,decisionSeed,...(jwxxcModel?{jwxxcModel}:{})});
 }catch(error){degrade('worker-unavailable',error instanceof Error?error.message:String(error));}};
 const ref=descriptor.stamp.modelRef;
 if(ref){
  try{getJwxxcHandle(ref);launch();}catch{void (options.modelLoader??loadBoundJwxxcHandle)(ref,{signal:abort.signal}).then(()=>{if(!finished)launch();}).catch(error=>{if(!finished)degrade('model-load-failed',error instanceof Error?error.message:String(error));});}
 }else launch();
 return{promise,cancel};
}
