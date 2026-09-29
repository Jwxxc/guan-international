import {bundledJwxxcSnapshot,readJwxxcSnapshotReference,sameJwxxcSnapshot,type BetaSnapshotReference} from './snapshots';
import {getJwxxcHandle,installJwxxcModel,pinJwxxcHandle,type JwxxcModelHandle} from './modelAdapter';
import {isPortableDistribution} from '../../game/distribution';

const PREFIX='/api/jwxxc-beta',LATEST_KEY='guan.jwxxc-beta.last-verified.v1';
const MAX_PAYLOAD_BYTES=8*1024*1024,DISK_CACHE_BYTES=64*1024*1024;
export interface JwxxcModelEnvelope {reference:BetaSnapshotReference;payload:unknown}
export interface JwxxcLoadOptions {signal?:AbortSignal;fetcher?:typeof fetch}
let latestVerified:BetaSnapshotReference|undefined;
function aborted(signal?:AbortSignal){if(signal?.aborted)throw Error('JWXXC_MODEL_LOAD_CANCELLED');}
async function database():Promise<IDBDatabase|undefined> {
 if(typeof indexedDB==='undefined')return undefined;
 return await new Promise((resolve,reject)=>{const request=indexedDB.open('guan-jwxxc-verified-models-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('models',{keyPath:'hash'});request.onerror=()=>reject(request.error);request.onblocked=()=>resolve(undefined);request.onsuccess=()=>resolve(request.result);});
}
async function persisted(reference:BetaSnapshotReference):Promise<JwxxcModelEnvelope|undefined> {
 const db=await database();if(!db)return undefined;
 try{return await new Promise((resolve,reject)=>{const request=db.transaction('models','readonly').objectStore('models').get(reference.weightsSha256);request.onsuccess=()=>resolve(request.result?.envelope);request.onerror=()=>reject(request.error);});}finally{db.close();}
}
async function persist(envelope:JwxxcModelEnvelope):Promise<void>{
 const db=await database();if(!db)return;
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('models','readwrite'),store=tx.objectStore('models'),all=store.getAll();all.onsuccess=()=>{const bytes=JSON.stringify(envelope).length*2,total=(all.result as Array<{hash:string;bytes:number}>).filter(row=>row.hash!==envelope.reference.weightsSha256).reduce((sum,row)=>sum+row.bytes,bytes);if(total>DISK_CACHE_BYTES){tx.abort();return;}store.put({hash:envelope.reference.weightsSha256,bytes,envelope});};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(Error('JWXXC model offline cache quota'));});}finally{db.close();}
}
async function readResponse(response:Response):Promise<unknown>{
 if(!response.ok)throw Error(`JWXXC_MODEL_HTTP_${response.status}`);
 const length=Number(response.headers.get('content-length'));if(length>MAX_PAYLOAD_BYTES)throw Error('JWXXC_MODEL_PAYLOAD_TOO_LARGE');
 const text=await response.text();if(text.length>MAX_PAYLOAD_BYTES)throw Error('JWXXC_MODEL_PAYLOAD_TOO_LARGE');return JSON.parse(text);
}
function installEnvelope(value:unknown,reference:BetaSnapshotReference):JwxxcModelHandle{
 if(!value||typeof value!=='object')throw Error('JWXXC_MODEL_RESPONSE_INVALID');const envelope=value as JwxxcModelEnvelope,ref=readJwxxcSnapshotReference(envelope.reference);
 if(!sameJwxxcSnapshot(ref,reference))throw Error('JWXXC_MODEL_REFERENCE_MISMATCH');return installJwxxcModel(ref,envelope.payload);
}
/** Restore never looks up latest: failure leaves the caller's hand identity unchanged. */
export async function loadBoundJwxxcHandle(reference:BetaSnapshotReference,options:JwxxcLoadOptions={}):Promise<JwxxcModelHandle>{
 const ref=readJwxxcSnapshotReference(reference);aborted(options.signal);
 try{return getJwxxcHandle(ref);}catch{/* Missing immutable cache entry: verified disk then fixed-origin catalog. */}
 try{const saved=await persisted(ref);aborted(options.signal);if(saved)return installEnvelope(saved,ref);}catch(error){aborted(options.signal);/* A corrupt local cache is not trusted; request the exact same immutable snapshot. */void error;}
 if(isPortableDistribution)throw Error('此分享版中缺少这副存档绑定的模型；原存档与模型身份已保留。');
 const request=options.fetcher??globalThis.fetch;if(!request)throw Error('JWXXC_BOUND_MODEL_MISSING');
 const body=await readResponse(await request(`${PREFIX}/models/${ref.weightsSha256}`,{signal:options.signal,cache:'no-store',credentials:'same-origin'}));aborted(options.signal);
 const handle=installEnvelope(body,ref);aborted(options.signal);
 void persist(body as JwxxcModelEnvelope).catch(()=>{/* Offline cache unavailable: server remains authoritative; restore reports a missing model if unavailable. */});
 return handle;
}
export function getCurrentVerifiedJwxxcSnapshot():BetaSnapshotReference {return structuredClone(latestVerified??bundledJwxxcSnapshot());}
/** Called once before a NEW hand. Existing hands keep their serialized reference. */
async function captureLatest(options:JwxxcLoadOptions):Promise<BetaSnapshotReference>{
 aborted(options.signal);
 if(!latestVerified){try{const raw=typeof localStorage==='undefined'?null:localStorage.getItem(LATEST_KEY);if(raw){const ref=readJwxxcSnapshotReference(JSON.parse(raw));await loadBoundJwxxcHandle(ref,options);latestVerified=ref;}}catch{aborted(options.signal);}}
 try{
  const request=options.fetcher??globalThis.fetch;if(!request)return getCurrentVerifiedJwxxcSnapshot();
  const reference=readJwxxcSnapshotReference(await readResponse(await request(`${PREFIX}/latest`,{signal:options.signal,cache:'no-store',credentials:'same-origin'})));
  await loadBoundJwxxcHandle(reference,options);aborted(options.signal);
  latestVerified=reference;try{localStorage.setItem(LATEST_KEY,JSON.stringify(reference));}catch{/* Storage disabled: this hand remains pinned in memory. */}
 }catch{aborted(options.signal);/* New hands may keep the previously verified compatible model during service outage. */}
 return getCurrentVerifiedJwxxcSnapshot();
}
export async function retainBoundJwxxcSnapshot(reference:BetaSnapshotReference,options:JwxxcLoadOptions={}):Promise<()=>void>{await loadBoundJwxxcHandle(reference,options);aborted(options.signal);return pinJwxxcHandle(reference);}

/** Slow/offline catalog reads cannot indefinitely delay a new hand. */
export async function captureLatestJwxxcSnapshot(options:JwxxcLoadOptions={}):Promise<BetaSnapshotReference>{
 aborted(options.signal);
 // A standalone edition has no model catalog. New hands explicitly bind its
 // bundled model; restores still require the exact stored reference above.
 if(isPortableDistribution)return structuredClone(bundledJwxxcSnapshot());
 const abort=new AbortController(),cancel=()=>abort.abort();options.signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(cancel,1500);
 try{return await captureLatest({...options,signal:abort.signal});}catch{aborted(options.signal);return getCurrentVerifiedJwxxcSnapshot();}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
}
