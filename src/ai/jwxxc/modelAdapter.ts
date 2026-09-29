import {ACTION_DIM,HISTORY_DIM,HISTORY_LIMIT,STATE_DIM,type EncodedJwxxcObservation as EncodedObservation} from './encoding';
import type {JwxxcModelWeights as ModelWeights,JwxxcModelScores} from './modelTypes';
import weights from '../../../models/jwxxc/blueprint.json' with {type:'json'};
import {JWXXC_MODEL_MANIFEST,assertJwxxcModelManifest} from './modelManifest';
import {bundledJwxxcSnapshot,readJwxxcSnapshotReference,sameJwxxcSnapshot,type BetaSnapshotReference} from './snapshots';
import {sha256Text} from '../models/integrity';
import {encodeJwxxcAction,encodeJwxxcObservation,JWXXC_ENCODER_VERSION} from './encoding';
import {candidateFingerprint} from '../models/contract';
import type {AiObservation} from '../types';
import type {ProCandidate} from '../pro/actions';

const relu=(x:number[])=>x.map(n=>Math.max(0,n));
const add=(a:number[],b:number[])=>a.map((v,i)=>v+b[i]);

/** Original inference implementation; no third-party checkpoint deserialization. */
export class JwxxcNetwork {
  readonly config:ModelWeights['config'];
  constructor(private readonly artifact:ModelWeights){
    const c=this.config=artifact.config;
    if(artifact.schemaVersion!=='guan-jwxxc-weights-v1'||c.state_dim!==STATE_DIM||c.history_dim!==HISTORY_DIM||c.action_dim!==ACTION_DIM||c.history_limit!==HISTORY_LIMIT||c.width<4||c.width>128||c.heads<1||c.width%c.heads||c.layers<1||c.layers>4||c.layer_norm_eps!==1e-5)throw Error('JWXXC model/encoder incompatibility');
    const vector=(name:string,n:number)=>{const x=artifact.weights[name];if(!Array.isArray(x)||x.length!==n||x.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('JWXXC invalid tensor '+name);};
    const matrix=(name:string,rows:number,cols:number)=>{const x=artifact.weights[name];if(!Array.isArray(x)||x.length!==rows||x.some(row=>!Array.isArray(row)||row.length!==cols||row.some(v=>typeof v!=='number'||!Number.isFinite(v))))throw Error('JWXXC invalid tensor '+name);};
    const linear=(name:string,out:number,input:number)=>{matrix(name+'.weight',out,input);vector(name+'.bias',out);};
    const norm=(name:string)=>{vector(name+'.weight',c.width);vector(name+'.bias',c.width);};
    matrix('position',HISTORY_LIMIT,c.width);linear('historyIn',c.width,HISTORY_DIM);norm('historyNorm');
    linear('state1',c.width,STATE_DIM);linear('state2',c.width,c.width);linear('action1',c.width,ACTION_DIM);linear('action2',c.width,c.width);
    linear('q1',c.width,c.width*3);linear('q2',1,c.width);linear('v1',c.width,c.width*2);linear('v2',1,c.width);linear('eventHead',c.event_classes,c.width*2);
    for(let i=0;i<c.layers;i++){const p=`layers.${i}.`;norm(p+'norm1');norm(p+'norm2');for(const name of ['q','k','v','o'])linear(p+name,c.width,c.width);linear(p+'ff1',c.ff_width,c.width);linear(p+'ff2',c.width,c.ff_width);}
  }
  private linear(name:string,x:number[]):number[]{
    const w=this.artifact.weights[name+'.weight'] as number[][],b=this.artifact.weights[name+'.bias'] as number[];
    return w.map((row,i)=>{let v=b[i];for(let j=0;j<row.length;j++)v+=row[j]*x[j];return v;});
  }
  private norm(name:string,x:number[]):number[]{
    const w=this.artifact.weights[name+'.weight'] as number[],b=this.artifact.weights[name+'.bias'] as number[];
    const mean=x.reduce((a,n)=>a+n,0)/x.length,variance=x.reduce((a,n)=>a+(n-mean)**2,0)/x.length,denom=Math.sqrt(variance+this.config.layer_norm_eps);
    return x.map((v,i)=>(v-mean)/denom*w[i]+b[i]);
  }
  encode(input:EncodedObservation):number[]{
    if(input.state.some(x=>!Number.isFinite(x))||input.history.some(row=>row.some(x=>!Number.isFinite(x)))||input.state.length!==STATE_DIM||input.history.length<1||input.history.length>HISTORY_LIMIT||input.history.some(row=>row.length!==HISTORY_DIM))throw Error('JWXXC invalid feature shape');
    const c=this.config,positions=this.artifact.weights.position as number[][],headWidth=c.width/c.heads;
    let x=input.history.map((row,i)=>add(this.linear('historyIn',row),positions[i]));
    for(let layer=0;layer<c.layers;layer++){
      const p=`layers.${layer}.`,norm=x.map(row=>this.norm(p+'norm1',row));
      const queries=norm.map(row=>this.linear(p+'q',row)),keys=norm.map(row=>this.linear(p+'k',row)),values=norm.map(row=>this.linear(p+'v',row));
      x=x.map((row,t)=>{
        const attended=Array<number>(c.width).fill(0);
        for(let head=0;head<c.heads;head++){
          const offset=head*headWidth,logits=[];let max=-Infinity;
          for(let s=0;s<=t;s++){let dot=0;for(let j=0;j<headWidth;j++)dot+=queries[t][offset+j]*keys[s][offset+j];const v=dot/Math.sqrt(headWidth);logits.push(v);max=Math.max(max,v);}
          const probs=logits.map(v=>Math.exp(v-max)),sum=probs.reduce((a,v)=>a+v,0);
          for(let s=0;s<=t;s++)for(let j=0;j<headWidth;j++)attended[offset+j]+=probs[s]/sum*values[s][offset+j];
        }
        const residual=add(row,this.linear(p+'o',attended));
        return add(residual,this.linear(p+'ff2',relu(this.linear(p+'ff1',this.norm(p+'norm2',residual)))));
      });
    }
    return [...this.norm('historyNorm',x.at(-1)!),...relu(this.linear('state2',relu(this.linear('state1',input.state))))];
  }
  score(context:number[],actions:number[][]):number[]{
    return actions.map(action=>{if(action.some(x=>!Number.isFinite(x))||action.length!==ACTION_DIM)throw Error('JWXXC invalid action shape');const a=relu(this.linear('action2',relu(this.linear('action1',action))));return this.linear('q2',relu(this.linear('q1',[...context,...a])))[0];});
  }
  value(context:number[]):number{return this.linear('v2',relu(this.linear('v1',context)))[0];}
  nextEvent(context:number[]):number[]{return this.linear('eventHead',context);}
}

/** Each handle owns a deeply frozen payload. No optimizer can mutate a live hand. */
export interface JwxxcModelHandle extends BetaSnapshotReference {readonly manifest:Readonly<BetaSnapshotReference>;readonly network:Readonly<JwxxcNetwork>}
interface CacheEntry {handle:JwxxcModelHandle;payload:ModelWeights;bytes:number;pins:number;touched:number}
const handles=new Map<string,CacheEntry>();
const CACHE_BYTES=32*1024*1024;
function deepFreeze<T>(value:T):T {if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))deepFreeze(item);Object.freeze(value);}return value;}
function trimHandles(protectedHash?:string){let size=[...handles.values()].reduce((sum,item)=>sum+item.bytes,0);for(const [hash,item] of [...handles].sort((a,b)=>a[1].touched-b[1].touched)){if(size<=CACHE_BYTES)break;if(item.pins||hash===protectedHash||hash===JWXXC_MODEL_MANIFEST.weightsSha256)continue;handles.delete(hash);size-=item.bytes;}}
export const JWXXC_INFERENCE_BATCH_SIZE=256;
export function verifyJwxxcPayload(artifact:unknown=weights,reference:BetaSnapshotReference=bundledJwxxcSnapshot()):void{
 const ref=readJwxxcSnapshotReference(reference);if(!artifact||typeof artifact!=='object')throw Error('JWXXC model missing');const value=artifact as ModelWeights;
 if(value.schemaVersion!=='guan-jwxxc-weights-v1'||value.modelId!==ref.modelId||value.encoderVersion!==ref.encoderVersion||value.objectiveId!==ref.objectiveId)throw Error('JWXXC payload identity mismatch');
 if(sha256Text(JSON.stringify(artifact))!==ref.runtimePayloadSha256)throw Error('JWXXC payload hash mismatch');
 if(JSON.stringify(Object.entries(value.config).sort())!==JSON.stringify(Object.entries(ref.architecture).sort()))throw Error('JWXXC payload architecture mismatch');
}
export function installJwxxcModel(reference:BetaSnapshotReference,artifact:unknown):JwxxcModelHandle {
 const ref=readJwxxcSnapshotReference(reference);verifyJwxxcPayload(artifact,ref);
 const old=handles.get(ref.weightsSha256);
 if(old){if(!sameJwxxcSnapshot(old.handle.manifest as BetaSnapshotReference,ref))throw Error('JWXXC same hash has different immutable reference');old.touched=performance.now();return old.handle;}
 const bytes=JSON.stringify(artifact).length*2;if([...handles.values()].filter(entry=>entry.pins>0).reduce((sum,entry)=>sum+entry.bytes,bytes)>CACHE_BYTES)throw Error('JWXXC_MODEL_CACHE_BUSY');
 const payload=deepFreeze(structuredClone(artifact) as ModelWeights),manifest=deepFreeze(ref),network=Object.freeze(new JwxxcNetwork(payload));
 const handle=Object.freeze({...manifest,manifest,network});handles.set(ref.weightsSha256,{handle,payload,bytes,pins:0,touched:performance.now()});trimHandles(ref.weightsSha256);return handle;
}
export function getJwxxcHandle(reference:BetaSnapshotReference=bundledJwxxcSnapshot()):JwxxcModelHandle {
 const ref=readJwxxcSnapshotReference(reference),entry=handles.get(ref.weightsSha256);
 if(entry){if(!sameJwxxcSnapshot(entry.handle.manifest as BetaSnapshotReference,ref))throw Error('JWXXC immutable reference mismatch');entry.touched=performance.now();return entry.handle;}
 if(sameJwxxcSnapshot(ref,bundledJwxxcSnapshot())){assertJwxxcModelManifest();return installJwxxcModel(ref,weights);}
 throw Error(`JWXXC_BOUND_MODEL_MISSING:${ref.weightsSha256}`);
}
/** Pin for the entire game-hand lifetime; return idempotent release on hand disposal. */
export function pinJwxxcHandle(reference:BetaSnapshotReference):()=>void {getJwxxcHandle(reference);const entry=handles.get(reference.weightsSha256)!;entry.pins++;let released=false;return()=>{if(released)return;released=true;entry.pins--;trimHandles();};}
export function jwxxcPayloadForWorker(reference:BetaSnapshotReference):ModelWeights {getJwxxcHandle(reference);return handles.get(reference.weightsSha256)!.payload;}
export function jwxxcHandleCacheStats(){return [...handles].map(([hash,item])=>({hash,bytes:item.bytes,pins:item.pins}));}
export function loadJwxxcModel():Readonly<JwxxcNetwork>{return getJwxxcHandle().network;}
export function scoreJwxxcModel(obs:AiObservation,candidates:ProCandidate[],now:()=>number=()=>performance.now(),handle:JwxxcModelHandle=getJwxxcHandle()):JwxxcModelScores{
 if(!candidates.length||new Set(candidates.map(c=>c.id)).size!==candidates.length)throw Error('JWXXC empty or duplicate candidate set');
 const at=now(),model=handle.network,encoded=encodeJwxxcObservation(obs),context=model.encode(encoded);
 const values:number[]=[];
 for(let offset=0;offset<candidates.length;offset+=JWXXC_INFERENCE_BATCH_SIZE){
  values.push(...model.score(context,candidates.slice(offset,offset+JWXXC_INFERENCE_BATCH_SIZE).map(c=>encodeJwxxcAction(obs,c))));
 }
 const stateValue=model.value(context);
 if(values.some(v=>!Number.isFinite(v))||!Number.isFinite(stateValue))throw Error('JWXXC nonfinite model output');
 return{candidateFingerprint:candidateFingerprint(candidates),modelHash:handle.weightsSha256,encoderVersion:handle.encoderVersion,objectiveId:handle.objectiveId,actionIds:candidates.map(c=>c.id),values,stateValue,diagnostics:{backend:handle.runtimeBackend,historyTokens:encoded.history.length,candidateCount:candidates.length,inferenceMs:now()-at,stateEncodes:1}};
}
