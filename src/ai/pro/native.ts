import type {AiObservation} from '../types';
import type {StrategyComputation,StrategyDescriptor} from '../strategyTypes';
import {cleanProObservation} from '../models/encoding';
import {candidateFingerprint} from '../models/contract';
import {enumerateProActions,PRO_CANDIDATE_VERSION} from './actions';
import {DANLM_BACKEND,DANLM_ENCODER_VERSION,DANLM_CLASSIC_ENCODER_VERSION,DANLM_MODEL_HASH,DANLM_OBJECTIVE,nativeDanlmEnabled} from './nativeInfo';
import {validateNativeObservation} from './nativeContract';
import type {ProWorkBudget} from './budgets';

/** Local-only pure-observation HTTP bridge. Python runs in the host's restricted
 * process; no hidden hand, deal seed, full state or private cache is transmitted. */
export async function computeNativeDanlm(input:AiObservation,descriptor:StrategyDescriptor,requestId:string):Promise<StrategyComputation>{
 const started=performance.now();
 if(!nativeDanlmEnabled())throw Error('DanLM local backend not started');
 const obs=cleanProObservation(input);
 const encoderVersion=descriptor.id==='pro-danlm-classic-v1'?DANLM_CLASSIC_ENCODER_VERSION:DANLM_ENCODER_VERSION;
 if(descriptor.config.encoderVersion!==encoderVersion)throw Error('DanLM descriptor encoder mismatch');
 validateNativeObservation(obs,encoderVersion);
 const work=descriptor.workBudget as ProWorkBudget,enumeration=enumerateProActions(obs,work.actions),candidateMs=performance.now()-started;
 if(!enumeration.complete||!enumeration.actions.length)throw Error('DanLM complete candidate enumeration unavailable');
 const candidates=[...enumeration.actions.filter(c=>c.play),...enumeration.actions.filter(c=>!c.play)];
 const at=performance.now();
 const response=await fetch('/__pro/native/score',{method:'POST',headers:{'Content-Type':'application/json','X-Guan-Pro':encoderVersion===DANLM_CLASSIC_ENCODER_VERSION?'classic-and-practice':'practice-only'},body:JSON.stringify({requestId,observation:obs,legalPlays:candidates.filter(c=>c.play).map(c=>c.play),includePass:candidates.some(c=>!c.play),encoderVersion}),signal:AbortSignal.timeout(2200)});
 if(!response.ok){const failure=await response.json().catch(()=>null) as {error?:unknown}|null;throw Error(`DanLM ${response.status}: ${typeof failure?.error==='string'?failure.error.slice(0,220):'local inference unavailable'}`);}
 const result=await response.json() as {requestId:string;modelHash:string;encoderVersion:string;objectiveId:string;values:number[];diagnostics:Record<string,unknown>};
 if(result.requestId!==requestId||result.modelHash!==DANLM_MODEL_HASH||result.encoderVersion!==encoderVersion||result.objectiveId!==DANLM_OBJECTIVE||!Array.isArray(result.values)||result.values.length!==candidates.length||result.values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('DanLM response identity mismatch');
 const inferenceMs=performance.now()-at,rows=candidates.map((candidate,i)=>({candidate,value:result.values[i]})).sort((a,b)=>b.value-a.value||(a.candidate.id<b.candidate.id?-1:1));
 const action=rows[0].candidate.action;
 return{candidateVersion:PRO_CANDIDATE_VERSION,identity:{requested:{...descriptor.stamp},requestedDescriptorHash:descriptor.descriptorHash,effective:{...descriptor.stamp,descriptorHash:descriptor.descriptorHash},fallbackVersion:descriptor.fallbackVersion},
  timing:{descriptorMs:0,candidateMs,knowledgeMs:0,plannerMs:null,scoringMs:inferenceMs,policyMs:inferenceMs,computeMs:performance.now()-started,inferenceMs,searchMs:0,tacticalMs:0},
  decision:{action,policyVersion:descriptor.id,configVersion:descriptor.configVersion,configHash:descriptor.stamp.configHash,reasonCodes:[obs.mode==='classic'?'DANLM_TRAINED_NATIVE_CLASSIC':'DANLM_TRAINED_NATIVE_PRACTICE'],
   explanation:obs.mode==='classic'?'DanLM 根据本副手牌与公开贡还信息给出建议；升级与过 A 由 GUAN 规则结算。':'DanLM 本机学习模型的单副建议；由 GUAN 规则筛选合法动作。',
   topCandidates:rows.slice(0,5).map(row=>({action:row.candidate.action,score:row.value,reasonCodes:['DANLM_RAW_ROUND_Q'],features:{rawQ:row.value,probability:false,modelHash:DANLM_MODEL_HASH}})),
   stats:{nodes:0,subsetChecks:0,candidateCount:candidates.length,evaluatedCandidates:candidates.length,approximate:true,budgetExhausted:false},
   proDiagnostics:{version:'pro-diagnostics-v1',mode:'neural',capability:{codeReady:true,artifactPresent:true,modelLoaded:true,encoderParityVerified:true,rulesCompatibilityVerified:true,informationIsolationVerified:true,strengthVerified:false,searchEnabled:false,runtimeBackend:DANLM_BACKEND,fallbackReason:null},
    modelHash:DANLM_MODEL_HASH,checkpointHash:DANLM_MODEL_HASH,encoderVersion,objectiveId:DANLM_OBJECTIVE,candidateFingerprint:candidateFingerprint(candidates),candidatesComplete:true,actionWork:enumeration.work,baseAction:action,endgame:null,search:null,searchGate:'native-blueprint-only',runtimeBackend:DANLM_BACKEND,native:result.diagnostics}},};
}
