import type {GameAction} from '../../engine/types';
import type {ProCapability} from '../models/manifest';
import type {ProEndgameCertificate} from './certificate';
import type {RolloutDiagnostics} from './rollout';
export interface ProDiagnostics {
 version:'pro-diagnostics-v1';mode:'certified'|'neural-search'|'neural';capability:ProCapability;
 modelHash:string;checkpointHash:string;encoderVersion:string;objectiveId:string;candidateFingerprint:string;
 candidatesComplete:boolean;actionWork:number;baseAction:GameAction;endgame:ProEndgameCertificate|null;
 search:RolloutDiagnostics|null;searchGate:string;runtimeBackend:string;
 native?:Record<string,unknown>;
}
