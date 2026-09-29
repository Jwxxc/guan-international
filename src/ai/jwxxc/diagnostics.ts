import type {GameAction} from '../../engine/types';
import type {JwxxcEndgameCertificate} from './certificates';
import type {JwxxcRolloutDiagnostics} from './rollout';
import type {jwxxcModelCapability} from './modelManifest';
export interface JwxxcDiagnostics {
 version:'jwxxc-diagnostics-v1';mode:'model'|'certified'|'model-search'|'immediate-finish';
 modelId:string;modelHash:string;checkpointHash:string;encoderVersion:string;objectiveId:string;runtimeBackend:string;
 capability:ReturnType<typeof jwxxcModelCapability>;candidateFingerprint:string;candidatesComplete:boolean;actionWork:number;
 stateValue:number;valueValidatedForTruncation:false;baseAction:GameAction;endgame:JwxxcEndgameCertificate|null;
 search:JwxxcRolloutDiagnostics|null;searchGate:string;actualSearchEnabled:boolean;searchFallback:string|null;
}
