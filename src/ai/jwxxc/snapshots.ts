import type {JwxxcModelManifest,JwxxcModelWeights} from './modelTypes';
import {JWXXC_MODEL_MANIFEST,assertJwxxcModelManifest} from './modelManifest';
import {PRO_CANDIDATE_VERSION} from '../pro/actions';
import {JWXXC_ENCODER_VERSION} from './encoding';

/** Deliberately excludes training data, checkpoint paths, optimizer state and arbitrary URLs. */
export interface BetaSnapshotReference {
 schemaVersion:'guan-jwxxc-snapshot-ref-v1';familyId:'jwxxc-pro';revision:number;modelId:string;
 weightsSha256:string;runtimePayloadSha256:string;checkpointSha256:string;
 encoderVersion:string;candidateVersion:string;objectiveId:'jwxxc-round-return-v1';runtimeBackend:'typescript-cpu';
 architecture:JwxxcModelWeights['config'];encoderParityVerified:true;rulesCompatibilityVerified:true;informationIsolationVerified:true;backendParityVerified:true;
}
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function readJwxxcSnapshotReference(value:unknown):BetaSnapshotReference {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JWXXC_MODEL_REFERENCE_INVALID');
 const x=value as BetaSnapshotReference;
 if(x.schemaVersion!=='guan-jwxxc-snapshot-ref-v1'||x.familyId!=='jwxxc-pro'||!Number.isSafeInteger(x.revision)||x.revision<0
  ||typeof x.modelId!=='string'||!x.modelId.length||x.modelId.length>160||!hash(x.weightsSha256)||!hash(x.runtimePayloadSha256)||!hash(x.checkpointSha256)
  ||x.encoderVersion!==JWXXC_ENCODER_VERSION||x.candidateVersion!==PRO_CANDIDATE_VERSION||x.objectiveId!=='jwxxc-round-return-v1'||x.runtimeBackend!=='typescript-cpu'
  ||x.encoderParityVerified!==true||x.rulesCompatibilityVerified!==true||x.informationIsolationVerified!==true||x.backendParityVerified!==true
  ||canonical(x.architecture)!==canonical(JWXXC_MODEL_MANIFEST.architecture))throw Error('JWXXC_MODEL_REFERENCE_INCOMPATIBLE');
 const result:BetaSnapshotReference={schemaVersion:x.schemaVersion,familyId:x.familyId,revision:x.revision,modelId:x.modelId,weightsSha256:x.weightsSha256,runtimePayloadSha256:x.runtimePayloadSha256,checkpointSha256:x.checkpointSha256,encoderVersion:x.encoderVersion,candidateVersion:x.candidateVersion,objectiveId:x.objectiveId,runtimeBackend:x.runtimeBackend,architecture:structuredClone(x.architecture),encoderParityVerified:true,rulesCompatibilityVerified:true,informationIsolationVerified:true,backendParityVerified:true};
 if(canonical(result)!==canonical(x))throw Error('JWXXC_MODEL_REFERENCE_UNKNOWN_FIELDS');
 return result;
}
export function createJwxxcSnapshotReference(manifest:JwxxcModelManifest,revision:number,backendParityVerified:boolean):BetaSnapshotReference {
 assertJwxxcModelManifest(manifest);
 return readJwxxcSnapshotReference({schemaVersion:'guan-jwxxc-snapshot-ref-v1',familyId:'jwxxc-pro',revision,modelId:manifest.modelId,weightsSha256:manifest.weightsSha256,runtimePayloadSha256:manifest.runtimePayloadSha256,checkpointSha256:manifest.checkpointSha256,encoderVersion:manifest.encoderVersion,candidateVersion:PRO_CANDIDATE_VERSION,objectiveId:manifest.objectiveId,runtimeBackend:manifest.runtimeBackend,architecture:manifest.architecture,encoderParityVerified:manifest.encoderParityVerified,rulesCompatibilityVerified:manifest.rulesCompatibilityVerified,informationIsolationVerified:manifest.informationIsolationVerified,backendParityVerified});
}
/** Bundled 196-hand artifact is an immutable reference, never rewritten by learning. */
export function bundledJwxxcSnapshot():BetaSnapshotReference{return createJwxxcSnapshotReference(JWXXC_MODEL_MANIFEST,0,true);}
export const sameJwxxcSnapshot=(a:BetaSnapshotReference,b:BetaSnapshotReference):boolean=>canonical(a)===canonical(b);
