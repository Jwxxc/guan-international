import type {AiObservation} from '../types';
import type {SavedGame} from '../../game/persistence';
import type {MatchJournal} from '../../match/sessionTypes';
import {sha256Text} from '../models/integrity';
export function stableJson(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stableJson(v)).join(',')+'}';
 return JSON.stringify(value);
}
export const learningHash=(value:unknown)=>sha256Text(stableJson(value));
export interface BetaActionReceipt {
 eventSeq:number;beforeObservation:AiObservation;selectedActionId:string;candidateFingerprint:string;candidateComplete:true;
 behaviorModelHash:string;encoderVersion:string;candidateVersion:string;objectiveId:'jwxxc-round-return-v1';
 behavior:'model'|'hybrid';exploration:false;hint:false;takeover:boolean;fallback:false;beforeStateHash:string;afterStateHash:string;
}
export interface BetaLiveEpisode {
 schemaVersion:'jwxxc-beta-live-episode-v1';source:'local-live';humanSeat:0;captureStartedStateVersion:0;saved:SavedGame;matchJournal?:MatchJournal;receipts:BetaActionReceipt[];
}
