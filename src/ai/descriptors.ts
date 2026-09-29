import { AI_WEIGHTS } from './baseline/evaluation';
import { BASELINE_STAMP, readPolicyStamp } from './metadata';
import { COOP_CONFIG, COOP_CONFIG_HASH, COOP_BUDGET } from './coop/config';
import { BALANCED_CONFIG, BALANCED_WORK } from './balanced/config';
import { BALANCED_PLUS_CONFIG, BALANCED_PLUS_WORK } from './balancedPlus/config';
import { BALANCED_PRO_CONFIG, BALANCED_PRO_WORK, BALANCED_PRO_PUBLIC_FINISH_REVISION, BALANCED_PRO_RELAY_REVISION } from './balancedPro/config';
import {PUBLIC_FINISH_BUDGET,PUBLIC_FINISH_VERSION} from './balancedPro/publicFinish';
import {ATTACHMENT_CONTROL_CONFIG} from './balanced/attachmentControl';
import { fingerprint } from './fingerprint';
import {STRATEGIC_CANDIDATE_VERSION} from './candidates/strategic';
import {BALANCED_PLANNER_VERSION} from './balanced/planning';
import {PUBLIC_KNOWLEDGE_VERSION} from './publicKnowledge';
import {ENDGAME_PROOF_BUDGET,ENDGAME_TACTICAL_VERSION} from './endgame/config';
import type { StrategyDescriptor,StrategyId,StrategyStamp,SeatPolicies,EndgameWorkBudget } from './strategyTypes';
import {PRO_MANIFEST} from './models/manifest';
import {ENCODER_VERSION} from './models/encoding';
import {PRO_CANDIDATE_VERSION} from './pro/actions';
import {PRO_WORK} from './pro/budgets';
import {PRO_ENDGAME_VERSION} from './pro/endgame';
import {ROLLOUT_VERSION} from './pro/rollout';
import {DANLM_BACKEND,DANLM_ENCODER_VERSION,DANLM_CLASSIC_ENCODER_VERSION,DANLM_MODEL_HASH,DANLM_OBJECTIVE,nativeDanlmEnabled,isNativeDanlmStrategy} from './pro/nativeInfo';
import {JWXXC_STRATEGY_IDS,isJwxxcStrategy,jwxxcDescriptor} from './jwxxc/descriptor';
import {jwxxcCapability} from './jwxxc/capability';
import {readJwxxcSnapshotReference} from './jwxxc/snapshots';

export const STRATEGY_IDS = ['baseline','coop-v2','balanced-v1','balanced-attachment-v1','balanced-plus-v1','balanced-pro-v1','coop-endgame-v1','balanced-endgame-v1','pro-neural-v1','pro-endgame-v1','pro-search-v1','pro-danlm-v1','pro-danlm-classic-v1',...JWXXC_STRATEGY_IDS] as const;
export const isStrategyId=(value:unknown):value is StrategyId=>typeof value==='string'&&(STRATEGY_IDS as readonly string[]).includes(value);
export const STRATEGY_LABELS:Record<StrategyId,string>={baseline:'原版 AI（兼容）','coop-v2':'休闲','balanced-v1':'均衡（旧版试验）','balanced-attachment-v1':'均衡（试验）','balanced-plus-v1':'均衡 Plus（试验）','balanced-pro-v1':'均衡 Pro（试验）','coop-endgame-v1':'休闲 · 残局修复（试验）','balanced-endgame-v1':'均衡 · 残局修复（试验）','pro-neural-v1':'PRO 基础模型（训练试验）','pro-endgame-v1':'PRO 模型＋残局（训练试验）','pro-search-v1':'PRO 前瞻（研究试验）','pro-danlm-v1':'PRO · DanLM 本机（旧单副）','pro-danlm-classic-v1':'PRO · DanLM 本机','jwxxc-pro':'Jwxxc Beta','jwxxc-model-v1':'JWXXC 基础模型（研究）','jwxxc-search-v1':'JWXXC 前瞻（研究）'};
export function canonicalDescriptor(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonicalDescriptor).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>`${JSON.stringify(key)}:${canonicalDescriptor(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const runtime={version:'bounded-runtime-v1',browserDeadlineMs:800,nodeDeadlineMs:2000,nodeFallbackDeadlineMs:250,browserFallbackVersion:'legal-fallback-v1',nodeFallbackVersion:'bounded-baseline-then-legal-v1'};
type Definition=Omit<StrategyDescriptor,'stamp'|'descriptorHash'> & {legacyStamp?:StrategyStamp};
const originalIds=['baseline','coop-v2','balanced-v1'] as const;
const definitions:Record<typeof originalIds[number],Definition>={
  baseline:{schemaVersion:'guan-strategy-descriptor-v1',id:'baseline',implementationVersion:'baseline-v0.3-frozen',configVersion:'baseline-v0.3-frozen',candidateVersion:'legacy-physical-representatives-v1',config:{...AI_WEIGHTS},workBudget:null,runtime,fallbackVersion:'bounded-baseline-then-legal-v1',legacyStamp:BASELINE_STAMP},
  'coop-v2':{schemaVersion:'guan-strategy-descriptor-v1',id:'coop-v2',implementationVersion:'coop-v2',configVersion:COOP_CONFIG.version,candidateVersion:'legacy-physical-representatives-v1',config:{...COOP_CONFIG},workBudget:{...COOP_BUDGET},runtime,fallbackVersion:'bounded-baseline-then-legal-v1',legacyStamp:{id:'coop-v2',version:'coop-v2',configHash:COOP_CONFIG_HASH}},
  'balanced-v1':{schemaVersion:'guan-strategy-descriptor-v1',id:'balanced-v1',implementationVersion:'balanced-policy-v1.1',configVersion:BALANCED_CONFIG.version,candidateVersion:STRATEGIC_CANDIDATE_VERSION,config:{...BALANCED_CONFIG,plannerVersion:BALANCED_PLANNER_VERSION,knowledgeVersion:PUBLIC_KNOWLEDGE_VERSION},workBudget:structuredClone(BALANCED_WORK),runtime,fallbackVersion:'bounded-baseline-then-legal-v1'},
};
const descriptors=Object.fromEntries(originalIds.map(id=>{
  const {legacyStamp,...definition}=definitions[id];
  const behaviorHash=`${id}-${fingerprint(canonicalDescriptor(definition))}`;
  const stamp=legacyStamp??{id,version:definition.implementationVersion,configHash:behaviorHash};
  return [id,{...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`}];
})) as Record<StrategyId,StrategyDescriptor>;
let balancedProV1Descriptor: StrategyDescriptor;
{
  const id='balanced-attachment-v1' as const,base=descriptors['balanced-v1'];
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={
    schemaVersion:base.schemaVersion,id,implementationVersion:'balanced-attachment-policy-v1',configVersion:ATTACHMENT_CONTROL_CONFIG.version,
    candidateVersion:base.candidateVersion,config:{baseId:base.id,baseVersion:base.stamp.version,baseConfigHash:base.stamp.configHash,baseDescriptorHash:base.descriptorHash,baseConfig:structuredClone(base.config),attachmentControl:{...ATTACHMENT_CONTROL_CONFIG},tacticalVersion:ENDGAME_TACTICAL_VERSION},
    workBudget:{version:'endgame-work-v1',base:structuredClone(BALANCED_WORK),proof:structuredClone(ENDGAME_PROOF_BUDGET)},
    runtime:structuredClone(base.runtime),fallbackVersion:base.fallbackVersion,
  };
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}
{
  const id='balanced-plus-v1' as const,base=descriptors['balanced-attachment-v1'];
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={
    schemaVersion:base.schemaVersion,id,implementationVersion:'balanced-plus-policy-v1',configVersion:BALANCED_PLUS_CONFIG.version,
    candidateVersion:base.candidateVersion,config:{...BALANCED_PLUS_CONFIG,baseId:base.id,baseVersion:base.stamp.version,baseConfigHash:base.stamp.configHash,baseDescriptorHash:base.descriptorHash},
    workBudget:structuredClone(BALANCED_PLUS_WORK),
    runtime:{...base.runtime,version:'balanced-plus-runtime-v1',browserDeadlineMs:1500,nodeDeadlineMs:3000,browserFallbackVersion:'pause-and-retry-v1',nodeFallbackVersion:'pause-and-retry-v1'},fallbackVersion:'pause-and-retry-v1',
  };
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}
{
  const id='balanced-pro-v1' as const,base=descriptors['balanced-plus-v1'];
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={
    schemaVersion:base.schemaVersion,id,implementationVersion:'balanced-pro-policy-v1',configVersion:BALANCED_PRO_CONFIG.version,
    candidateVersion:base.candidateVersion,config:{...BALANCED_PRO_CONFIG,baseId:base.id,baseVersion:base.stamp.version,baseConfigHash:base.stamp.configHash,baseDescriptorHash:base.descriptorHash},
    workBudget:structuredClone(BALANCED_PRO_WORK),
    runtime:{...base.runtime,version:'balanced-pro-runtime-v1',browserDeadlineMs:2500,nodeDeadlineMs:5000},fallbackVersion:'pause-and-retry-v1',
  };
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}
{
  const id='balanced-pro-v1' as const;
  balancedProV1Descriptor=structuredClone(descriptors[id]);
  const {stamp:_stamp,descriptorHash:_hash,...previous}=balancedProV1Descriptor;
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={...previous,
    implementationVersion:'balanced-pro-policy-v2-public-finish',configVersion:'balanced-pro-config-v2-public-finish',
    config:{...previous.config,publicFinishRevision:BALANCED_PRO_PUBLIC_FINISH_REVISION,relayRevision:BALANCED_PRO_RELAY_REVISION,
      publicFinishVersion:PUBLIC_FINISH_VERSION,publicFinishBudget:{...PUBLIC_FINISH_BUDGET},
      publicFinishScope:'public-unbeatable-head-or-team-double-up',publicLedgerVersion:'physical-public-ledger-v1'},
  };
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}
/** Exact historical descriptor for saved-hand continuation and reproducible rollback.
 * Not a player-facing tier. No old journal is relabelled with the new revision. */
export function legacyBalancedProDescriptor():StrategyDescriptor{return structuredClone(balancedProV1Descriptor);}
for(const [id,baseId] of [['coop-endgame-v1','coop-v2'],['balanced-endgame-v1','balanced-v1']] as const){
  const base=descriptors[baseId];
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={
    schemaVersion:'guan-strategy-descriptor-v1',id,implementationVersion:id,configVersion:ENDGAME_TACTICAL_VERSION,
    candidateVersion:base.candidateVersion,
    config:{baseId,baseVersion:base.stamp.version,baseConfigHash:base.stamp.configHash,baseDescriptorHash:base.descriptorHash,baseConfig:structuredClone(base.config),tacticalVersion:ENDGAME_TACTICAL_VERSION},
    workBudget:{version:'endgame-work-v1',base:structuredClone(base.workBudget) as EndgameWorkBudget['base'],proof:structuredClone(ENDGAME_PROOF_BUDGET)},
    runtime:structuredClone(base.runtime),fallbackVersion:base.fallbackVersion,
  };
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}

for(const id of ['pro-neural-v1','pro-endgame-v1','pro-search-v1'] as const){
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={
    schemaVersion:'guan-strategy-descriptor-v1',id,implementationVersion:'guan-pro-controller-v1',configVersion:'guan-pro-config-v1',candidateVersion:PRO_CANDIDATE_VERSION,
    config:{modelId:PRO_MANIFEST.modelId,modelHash:PRO_MANIFEST.weightsSha256,checkpointHash:PRO_MANIFEST.checkpointSha256,encoderVersion:ENCODER_VERSION,objectiveId:PRO_MANIFEST.objectiveId,
      endgameVersion:id==='pro-neural-v1'?null:PRO_ENDGAME_VERSION,searchVersion:id==='pro-search-v1'?ROLLOUT_VERSION:null,runtimeBackend:PRO_MANIFEST.runtimeBackend,strength:'unverified-training-trial'},
    workBudget:structuredClone(PRO_WORK),runtime:{version:'pro-runtime-v1',browserDeadlineMs:id==='pro-search-v1'?3500:1500,nodeDeadlineMs:id==='pro-search-v1'?4000:2000,nodeFallbackDeadlineMs:250,browserFallbackVersion:'legal-fallback-v1',nodeFallbackVersion:'bounded-baseline-then-legal-v1'},fallbackVersion:'bounded-baseline-then-legal-v1',
  };
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}

{
  const id='pro-danlm-v1' as const;
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={schemaVersion:'guan-strategy-descriptor-v1',id,implementationVersion:'danlm-local-observation-v1',configVersion:'danlm-practice-config-v1',candidateVersion:PRO_CANDIDATE_VERSION,
    config:{modelId:'DanLM_v1_pinned_16ace5ada4db',modelHash:DANLM_MODEL_HASH,checkpointHash:DANLM_MODEL_HASH,encoderVersion:DANLM_ENCODER_VERSION,objectiveId:DANLM_OBJECTIVE,endgameVersion:null,searchVersion:null,runtimeBackend:DANLM_BACKEND,scope:'practice-only',licenseUse:'personal-noncommercial-confirmed-by-user',strength:'development-only'},
    workBudget:structuredClone(PRO_WORK),runtime:{version:'danlm-local-runtime-v1',browserDeadlineMs:2500,nodeDeadlineMs:2000,nodeFallbackDeadlineMs:250,browserFallbackVersion:'legal-fallback-v1',nodeFallbackVersion:'bounded-baseline-then-legal-v1'},fallbackVersion:'bounded-baseline-then-legal-v1'};
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}
{
  const id='pro-danlm-classic-v1' as const;
  const previous=descriptors['pro-danlm-v1'];
  const definition:Omit<StrategyDescriptor,'stamp'|'descriptorHash'>={schemaVersion:previous.schemaVersion,id,implementationVersion:'danlm-local-classic-v1',configVersion:'danlm-classic-config-v1',candidateVersion:previous.candidateVersion,
    config:{...previous.config,encoderVersion:DANLM_CLASSIC_ENCODER_VERSION,scope:'practice-and-classic',matchRulesVersion:'guan-classic-house-v1',exchangePolicy:'frozen-classic-exchange-observation',objectiveScope:'per-hand-round-return-not-match-win',publicExchangeEncoding:'original-danlm-tribute-prefix-v1'},
    workBudget:structuredClone(previous.workBudget),runtime:structuredClone(previous.runtime),fallbackVersion:previous.fallbackVersion};
  const stamp={id,version:definition.implementationVersion,configHash:`${id}-${fingerprint(canonicalDescriptor(definition))}`};
  descriptors[id]={...definition,stamp,descriptorHash:`descriptor-${fingerprint(canonicalDescriptor({...definition,stamp}))}`};
}
export function strategyDescriptor(id:StrategyId):StrategyDescriptor {
  if(!isStrategyId(id))throw Error('未知 AI 策略');
  if(isJwxxcStrategy(id))return jwxxcDescriptor(id);
  return structuredClone(descriptors[id]);
}
export const strategyStamp=(id:StrategyId):StrategyStamp=>strategyDescriptor(id).stamp;
export function readStrategyStamp(value:unknown):StrategyStamp|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||!isStrategyId((value as StrategyStamp).id))throw Error('AI 策略记录无效');
  if((value as StrategyStamp).id==='baseline'||(value as StrategyStamp).id==='coop-v2')return readPolicyStamp(value);
  const stamp=value as Record<string,unknown>;
  if(typeof stamp.version!=='string'||!stamp.version.length||stamp.version.length>100||typeof stamp.configHash!=='string'||!stamp.configHash.length||stamp.configHash.length>128)throw Error('AI 策略记录无效');
  if(stamp.modelRef!==undefined&&!isJwxxcStrategy(stamp.id as string))throw Error('AI model reference is invalid for this strategy');
  return {id:stamp.id as StrategyId,version:stamp.version,configHash:stamp.configHash,...(stamp.modelRef!==undefined?{modelRef:readJwxxcSnapshotReference(stamp.modelRef)}:{})};
}
/** Decode can retain known historical stamps for replay; execution always resolves the complete identity. */
export function resolveStrategy(value:StrategyId|StrategyStamp|StrategyDescriptor):StrategyDescriptor {
  if(typeof value==='string')return strategyDescriptor(value);
  if(!value||typeof value!=='object'||!isStrategyId(value.id))throw Error('未知 AI 策略');
  const ref='schemaVersion' in value?value.stamp?.modelRef:value.modelRef;
  if(ref!==undefined&&!isJwxxcStrategy(value.id))throw Error('AI model reference is invalid for this strategy');
  const suppliedStamp='schemaVersion' in value?value.stamp:value;
  const isLegacyPro=value.id==='balanced-pro-v1'&&suppliedStamp?.version===balancedProV1Descriptor.stamp.version&&suppliedStamp?.configHash===balancedProV1Descriptor.stamp.configHash;
  const expected=isLegacyPro?legacyBalancedProDescriptor():isJwxxcStrategy(value.id)&&ref?jwxxcDescriptor(value.id,readJwxxcSnapshotReference(ref)):strategyDescriptor(value.id);
  if('schemaVersion' in value){if(canonicalDescriptor(value)!==canonicalDescriptor(expected))throw Error('AI 描述符或预算版本不兼容');}
  else if(value.version!==expected.stamp.version||value.configHash!==expected.stamp.configHash)throw Error('AI 策略版本或配置不兼容');
  return expected;
}
export function isAvailableStrategy(stamp:StrategyStamp|undefined):boolean {try{const d=resolveStrategy(stamp??'baseline');return isJwxxcStrategy(d.id)?jwxxcCapability({backend:'browser',mode:'classic'}).available:!isNativeDanlmStrategy(d.id)||nativeDanlmEnabled();}catch{return false;}}
export function readSeatPolicies(value:unknown):SeatPolicies|undefined {
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length!==4)throw Error('逐席 AI 配置无效');
  const result=value.map(item=>readStrategyStamp(item));
  if(result.some(item=>!item))throw Error('逐席 AI 配置无效');
  return result as SeatPolicies;
}
