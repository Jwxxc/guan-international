import {fingerprint} from '../fingerprint';
import type {StrategyDescriptor} from '../strategyTypes';
import {JWXXC_MODEL_MANIFEST} from './modelManifest';
import {JWXXC_WORK} from './budgets';
import {JWXXC_ENDGAME_VERSION} from './endgame';
import {JWXXC_ROLLOUT_VERSION} from './rollout';
import {PRO_CANDIDATE_VERSION} from '../pro/actions';
import {readJwxxcSnapshotReference,type BetaSnapshotReference} from './snapshots';

export const JWXXC_STRATEGY_IDS=['jwxxc-pro','jwxxc-model-v1','jwxxc-search-v1'] as const;
export type JwxxcStrategyId=typeof JWXXC_STRATEGY_IDS[number];
export const isJwxxcStrategy=(id:string|undefined):id is JwxxcStrategyId=>JWXXC_STRATEGY_IDS.some(value=>value===id);
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value!==null&&typeof value==='object'?`{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`:JSON.stringify(value);

export function jwxxcDescriptor(id:JwxxcStrategyId,reference?:BetaSnapshotReference):StrategyDescriptor{
 const ref=reference?readJwxxcSnapshotReference(reference):undefined;
 const model=ref??JWXXC_MODEL_MANIFEST,work=structuredClone(JWXXC_WORK);
 work.search.enabled=id==='jwxxc-search-v1';
 const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={schemaVersion:'guan-strategy-descriptor-v1',id,
  implementationVersion:ref?'jwxxc-beta-bound-policy-v1':'jwxxc-pro-policy-v1',configVersion:ref?'jwxxc-beta-bound-config-v1':'jwxxc-pro-config-v1',candidateVersion:PRO_CANDIDATE_VERSION,
  config:{...(ref?{modelReference:ref}:{}),modelId:model.modelId,modelHash:model.weightsSha256,checkpointHash:model.checkpointSha256,encoderVersion:model.encoderVersion,objectiveId:model.objectiveId,
   objectiveScope:'per-hand-nominal-round-return-warmup-not-match-win',baseModel:'independently-trained-jwxxc',runtimeBackend:model.runtimeBackend,
   endgameVersion:id==='jwxxc-model-v1'?null:JWXXC_ENDGAME_VERSION,searchVersion:work.search.enabled?JWXXC_ROLLOUT_VERSION:null,
   strength:'experimental-unverified',capabilityChecks:{encoderParity:model.encoderParityVerified,rulesCompatibility:model.rulesCompatibilityVerified,informationIsolation:model.informationIsolationVerified}},
  workBudget:work,runtime:{version:'jwxxc-runtime-v1',browserDeadlineMs:3500,nodeDeadlineMs:4000,nodeFallbackDeadlineMs:250,browserFallbackVersion:'legal-fallback-v1',nodeFallbackVersion:'bounded-baseline-then-legal-v1'},fallbackVersion:'jwxxc-explicit-runtime-failure-v1'};
 const stamp={id,...(ref?{modelRef:ref}:{}),version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonical(definition))}`};
 return{...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonical({...definition,stamp}))}`};
}
