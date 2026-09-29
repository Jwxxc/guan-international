import weights from '../../../models/pro/blueprint.json' with {type:'json'};
import {ProNetwork,type ModelWeights} from '../models/network';
import {PRO_MANIFEST,assertTrainedManifest} from '../models/manifest';
import {assertRuntimePayload} from '../models/integrity';
import {encodeProAction,encodeProObservation,ENCODER_VERSION} from '../models/encoding';
import {candidateFingerprint,type BlueprintScores} from '../models/contract';
import type {AiObservation} from '../types';
import type {ProCandidate} from './actions';

let network:ProNetwork|undefined;
export function loadedBlueprint():ProNetwork {
 assertTrainedManifest();
 if(!network){
  // Keep the verified cached model detached from the shared JSON module object.
  const artifact=structuredClone(weights);assertRuntimePayload(artifact,PRO_MANIFEST);
  network=new ProNetwork(artifact as ModelWeights);
 }
 return network;
}
export function scoreBlueprint(obs:AiObservation,candidates:ProCandidate[],now=()=>performance.now()):BlueprintScores {
  const at=now(),model=loadedBlueprint(),encoded=encodeProObservation(obs),context=model.encode(encoded);
  const values=model.score(context,candidates.map(candidate=>encodeProAction(obs,candidate)));
  if(values.some(v=>!Number.isFinite(v)))throw Error('PRO non-finite model output');
  return{candidateFingerprint:candidateFingerprint(candidates),modelHash:PRO_MANIFEST.weightsSha256,encoderVersion:ENCODER_VERSION,objectiveId:PRO_MANIFEST.objectiveId,
    actionIds:candidates.map(c=>c.id),values,diagnostics:{backend:PRO_MANIFEST.runtimeBackend,historyTokens:encoded.history.length,candidateCount:candidates.length,inferenceMs:now()-at}};
}
