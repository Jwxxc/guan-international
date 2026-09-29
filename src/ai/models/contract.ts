import type {AiObservation} from '../types';
import type {GameAction} from '../../engine/types';
import type {ProCandidate} from '../pro/actions';
import {fingerprint} from '../fingerprint';
import {cleanProObservation,ENCODER_VERSION} from './encoding';
import {resolvePlays} from '../../engine/patterns';
import {canBeat} from '../../engine/compare';

export interface ProRequest {
  requestId:string;matchId:string;handId:string;stateVersion:number;actorId:number;
  observation:AiObservation;legalActions:ProCandidate[];modelHash:string;encoderVersion:string;objectiveId:string;
}
export interface BlueprintScores {
  candidateFingerprint:string;modelHash:string;encoderVersion:string;objectiveId:string;
  actionIds:string[];values:number[];diagnostics:{backend:string;historyTokens:number;candidateCount:number;inferenceMs:number};
}
export function candidateFingerprint(candidates:ProCandidate[]):string{return fingerprint(JSON.stringify(candidates.map(c=>c.id)));}
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
function assertRequestShape(value:ProRequest):void {
  if(!value||!nonempty(value.requestId)||!nonempty(value.matchId)||!nonempty(value.handId)
    ||!Number.isInteger(value.stateVersion)||value.stateVersion<0||!Number.isInteger(value.actorId)||value.actorId<0||value.actorId>3
    ||!/^[a-f0-9]{64}$/.test(value.modelHash)||value.encoderVersion!==ENCODER_VERSION||!nonempty(value.objectiveId)
    ||!Array.isArray(value.legalActions)||!value.legalActions.length)throw Error('PRO invalid request shape');
  if(!value.observation||value.matchId!==value.observation.sessionId||value.handId!==value.observation.handId
    ||value.stateVersion!==value.observation.stateVersion||value.actorId!==value.observation.player)throw Error('PRO request identity mismatch');
  for(let i=0;i<value.legalActions.length;i++)if(!value.legalActions[i]||!nonempty(value.legalActions[i].id))throw Error('PRO invalid candidate identity');
}
export function ownProRequest(value:ProRequest):ProRequest {
  assertRequestShape(value);
  const obs=cleanProObservation(value.observation);
  if(value.handId!==obs.handId||value.matchId!==obs.sessionId||value.stateVersion!==obs.stateVersion||value.actorId!==obs.player||value.encoderVersion!==ENCODER_VERSION)throw Error('PRO request identity mismatch');
  // Never clone arbitrary request fields, descriptor extras, UI stores or caches.
  const legalActions=value.legalActions.map((c):ProCandidate=>{
    const a=c.action,stamp={sessionId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,player:obs.player};
    if(!a||a.sessionId!==stamp.sessionId||a.handId!==stamp.handId||a.stateVersion!==stamp.stateVersion||a.player!==stamp.player)throw Error('PRO stale candidate');
    if(a.type==='pass'){if(!obs.currentPlay||c.id!=='pass'||c.play!==null)throw Error('PRO invalid PASS');return{id:'pass',action:{...stamp,type:'pass'},play:null};}
    if(a.type!=='play'||!Array.isArray(a.cardIds)||!a.cardIds.length||a.cardIds.length>10||!nonempty(a.playKey))throw Error('PRO invalid play shape');
    for(let i=0;i<a.cardIds.length;i++)if(!nonempty(a.cardIds[i]))throw Error('PRO invalid physical card identity');
    const cards=obs.hand.filter(card=>a.cardIds.includes(card.id));
    if(cards.length!==a.cardIds.length||new Set(a.cardIds).size!==a.cardIds.length)throw Error('PRO foreign candidate card');
    const play=resolvePlays(cards,obs.rules).find(p=>p.key===a.playKey&&canBeat(p,obs.currentPlay,obs.rules));
    if(!play||c.id!==play.key)throw Error('PRO invalid candidate');
    return{id:play.key,play,action:{...stamp,type:'play',cardIds:play.cards.map(card=>card.id),playKey:play.key}};
  });
  if(new Set(legalActions.map(c=>c.id)).size!==legalActions.length)throw Error('PRO duplicate candidate');
  return {requestId:value.requestId,matchId:obs.sessionId,handId:obs.handId,stateVersion:obs.stateVersion,actorId:obs.player,observation:obs,
    legalActions,modelHash:value.modelHash,encoderVersion:value.encoderVersion,objectiveId:value.objectiveId};
}
export function actionFromScores(request:ProRequest,scores:BlueprintScores):GameAction {
  assertRequestShape(request);
  if(!scores||!Array.isArray(scores.values)||!Array.isArray(scores.actionIds)||scores.actionIds.length!==request.legalActions.length
    ||scores.modelHash!==request.modelHash||scores.encoderVersion!==request.encoderVersion||scores.objectiveId!==request.objectiveId||scores.candidateFingerprint!==candidateFingerprint(request.legalActions)||scores.values.length!==request.legalActions.length)throw Error('PRO score identity mismatch');
  // Indexed checks also reject sparse arrays; Array.some/every skips holes.
  for(let i=0;i<scores.values.length;i++)if(scores.actionIds[i]!==request.legalActions[i].id||!Number.isFinite(scores.values[i]))throw Error('PRO score identity mismatch');
  const d=scores.diagnostics;
  if(!d||!nonempty(d.backend)||!Number.isInteger(d.historyTokens)||d.historyTokens<1||!Number.isInteger(d.candidateCount)||d.candidateCount!==scores.values.length||!Number.isFinite(d.inferenceMs)||d.inferenceMs<0)throw Error('PRO score diagnostics mismatch');
  if(!scores.values.length)throw Error('PRO empty legal action set');
  let best=0;for(let i=1;i<scores.values.length;i++)if(scores.values[i]>scores.values[best]||scores.values[i]===scores.values[best]&&scores.actionIds[i]<scores.actionIds[best])best=i;
  return request.legalActions[best].action;
}
