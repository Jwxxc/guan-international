import type {AiObservation} from '../ai/types';
import type {StrategyStamp} from '../ai/strategyTypes';

export type AiLifecycleStage='requested'|'computed'|'failed'|'cancelled'|'discarded'|'submitted'|'submission-rejected';
export interface AiLifecycleRecord {
  sessionId:string;handId:string;stateVersion:number;player:number;requested:StrategyStamp;
  stage:AiLifecycleStage;reason:string|null;atMs:number;
}
const records:AiLifecycleRecord[]=[];
/** Bounded current-page operational telemetry. No hands, guesses, or RNG calls.
 * This supplements accepted-action archives; it never turns a failed request into
 * a decision record. Restored historical attempts cannot be reconstructed. */
export function recordProLifecycle(obs:Pick<AiObservation,'sessionId'|'handId'|'stateVersion'|'player'>,requested:StrategyStamp,stage:AiLifecycleStage,reason:string|null=null):void {
  if(requested.id!=='balanced-pro-v1')return;
  records.push({sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,player:obs.player,requested:{...requested},stage,reason,atMs:performance.now()});
  if(records.length>640)records.shift();
}
export function getProLifecycle(handId:string):AiLifecycleRecord[]{return structuredClone(records.filter(record=>record.handId===handId));}
