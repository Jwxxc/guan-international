import record from '../../../models/pro/manifest.json' with {type:'json'};
import {ENCODER_VERSION} from './encoding';

export interface ProCapability {
  codeReady:boolean;artifactPresent:boolean;modelLoaded:boolean;encoderParityVerified:boolean;
  rulesCompatibilityVerified:boolean;informationIsolationVerified:boolean;strengthVerified:boolean;
  searchEnabled:boolean;runtimeBackend:string;fallbackReason:string|null;
}
export interface ProManifest {
  schemaVersion:string;modelId:string;objectiveId:string;objective:string;encoderVersion:string;
  weightsSha256:string;runtimePayloadSha256:string;checkpointSha256:string;source:string;license:string;runtimeBackend:string;
  training:{gradientSteps:number;completedHands:number;completedMatches:number;sampleSteps:number;seed:number;elapsedSeconds:number;initialWeightsSha256:string;weightDeltaL2:number};
  strengthVerified:boolean;encoderParityVerified?:boolean;rulesCompatibilityVerified?:boolean;informationIsolationVerified?:boolean;
}
export const PRO_MANIFEST:ProManifest=record as ProManifest;
export function assertTrainedManifest(manifest:ProManifest=PRO_MANIFEST):void{
  const training=manifest.training,hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  if(manifest.schemaVersion!=='guan-pro-model-manifest-v1'||manifest.encoderVersion!==ENCODER_VERSION
    ||!['round-return','match-win'].includes(manifest.objective)||manifest.objectiveId!==manifest.objective+'-v1'
    ||manifest.runtimeBackend!=='typescript-cpu'||!training
    ||!Number.isSafeInteger(training.gradientSteps)||training.gradientSteps<1||!Number.isSafeInteger(training.sampleSteps)||training.sampleSteps<1
    ||!Number.isFinite(training.weightDeltaL2)||training.weightDeltaL2<=0||!Number.isFinite(training.elapsedSeconds)||training.elapsedSeconds<=0
    ||!Number.isSafeInteger(training.completedHands)||training.completedHands<1||!Number.isSafeInteger(training.completedMatches)||training.completedMatches<0
    ||manifest.objective==='match-win'&&training.completedMatches<1
    ||!hash(manifest.weightsSha256)||!hash(manifest.runtimePayloadSha256)||!hash(manifest.checkpointSha256)||!hash(training.initialWeightsSha256)
    ||manifest.weightsSha256===training.initialWeightsSha256)throw Error('PRO trained artifact unavailable or incompatible');
}
export function proCapability(modelLoaded=false):ProCapability {
  let reason:string|null=null;try{assertTrainedManifest();}catch(error){reason=String(error);}
  return{codeReady:true,artifactPresent:reason===null,modelLoaded:modelLoaded&&reason===null,
    encoderParityVerified:PRO_MANIFEST.encoderParityVerified===true,rulesCompatibilityVerified:PRO_MANIFEST.rulesCompatibilityVerified===true,
    informationIsolationVerified:PRO_MANIFEST.informationIsolationVerified===true,strengthVerified:PRO_MANIFEST.strengthVerified===true,
    searchEnabled:false,runtimeBackend:PRO_MANIFEST.runtimeBackend,fallbackReason:reason};
}
export function proTrialAvailable():boolean {const c=proCapability();return c.artifactPresent&&c.encoderParityVerified&&c.rulesCompatibilityVerified&&c.informationIsolationVerified;}
