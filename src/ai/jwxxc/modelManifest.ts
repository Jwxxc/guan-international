import manifest from '../../../models/jwxxc/manifest.json' with {type:'json'};
import type {JwxxcModelManifest} from './modelTypes';
import type {BetaSnapshotReference} from './snapshots';
import {JWXXC_ENCODER_VERSION,STATE_DIM,HISTORY_DIM,ACTION_DIM} from './encoding';
export const JWXXC_MODEL_MANIFEST=manifest as JwxxcModelManifest;
export function assertJwxxcModelManifest(value:JwxxcModelManifest=JWXXC_MODEL_MANIFEST):void{
 const t=value.training,hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
 if(value.schemaVersion!=='guan-jwxxc-model-manifest-v1'||value.encoderVersion!==JWXXC_ENCODER_VERSION||value.objectiveId!=='jwxxc-round-return-v1'||value.objective!=='round-return'||value.runtimeBackend!=='typescript-cpu'||!t||t.gradientSteps<1||t.completedHands<1||t.sampleSteps<1||!(t.weightDeltaL2>0)||!hash(value.weightsSha256)||!hash(value.runtimePayloadSha256)||!hash(value.checkpointSha256)||!hash(t.initialWeightsSha256)||!hash(t.trainedWeightsSha256)||t.initialWeightsSha256===t.trainedWeightsSha256||value.architecture.state_dim!==STATE_DIM||value.architecture.history_dim!==HISTORY_DIM||value.architecture.action_dim!==ACTION_DIM)throw Error('JWXXC 模型未就绪或版本不兼容');
}
export function jwxxcModelCapability(modelLoaded=false,reference?:BetaSnapshotReference){
 let fallbackReason:string|null=null;try{assertJwxxcModelManifest();}catch(error){fallbackReason=error instanceof Error?error.message:String(error);}
 return{codeReady:true,artifactPresent:!fallbackReason,modelLoaded:modelLoaded&&!fallbackReason,encoderParityVerified:(reference??JWXXC_MODEL_MANIFEST).encoderParityVerified===true,rulesCompatibilityVerified:(reference??JWXXC_MODEL_MANIFEST).rulesCompatibilityVerified===true,informationIsolationVerified:(reference??JWXXC_MODEL_MANIFEST).informationIsolationVerified===true,strengthVerified:false,backendSupported:true,searchEnabled:false,runtimeBackend:'typescript-cpu',fallbackReason,valueValidatedForTruncation:false};
}
