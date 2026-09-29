import type { AiBudget, AiDecision, PolicyId } from './types';
import type { BalancedWorkBudget } from './balanced/config';
import type { BalancedPlusWorkBudget } from './balancedPlus/config';
import type { BalancedProWorkBudget } from './balancedPro/config';
import type { EndgameProofBudget, TacticalCertificate } from './endgame/types';
import type {ProWorkBudget} from './pro/budgets';
import type {ProDiagnostics} from './pro/diagnostics';
import type {JwxxcWorkBudget} from './jwxxc/budgets';
import type {JwxxcDiagnostics} from './jwxxc/diagnostics';
import type {BetaSnapshotReference} from './jwxxc/snapshots';

/** Legacy PolicyId/AiDecision remain narrow so the frozen v0.4 runner keeps its original semantics. */
export type StrategyId = PolicyId | 'balanced-v1' | 'balanced-attachment-v1' | 'balanced-plus-v1' | 'balanced-pro-v1' | 'coop-endgame-v1' | 'balanced-endgame-v1' | 'pro-neural-v1' | 'pro-endgame-v1' | 'pro-search-v1' | 'pro-danlm-v1' | 'pro-danlm-classic-v1' | 'jwxxc-pro' | 'jwxxc-model-v1' | 'jwxxc-search-v1';
export interface EndgameWorkBudget { version:'endgame-work-v1';base:AiBudget|BalancedWorkBudget|null;proof:EndgameProofBudget }
export interface StrategyStamp { id:StrategyId; version:string; configHash:string;modelRef?:BetaSnapshotReference }
export interface StrategyDescriptor {
  schemaVersion:'guan-strategy-descriptor-v1'; id:StrategyId; stamp:StrategyStamp;
  implementationVersion:string; configVersion:string; candidateVersion:string;
  config:Record<string,unknown>;
  workBudget:AiBudget|BalancedWorkBudget|BalancedPlusWorkBudget|BalancedProWorkBudget|EndgameWorkBudget|ProWorkBudget|JwxxcWorkBudget|null;
  runtime:{version:string;browserDeadlineMs:number;nodeDeadlineMs:number;nodeFallbackDeadlineMs:number;browserFallbackVersion:string;nodeFallbackVersion:string};
  fallbackVersion:string; descriptorHash:string;
}
export interface StrategyDecision extends Omit<AiDecision,'policyVersion'> {
  policyVersion:StrategyId;
  stats:AiDecision['stats'] & {approximationReason?:string};
  tacticalCertificate?:TacticalCertificate;
  plusDiagnostics?:import('./balancedPlus/diagnostics').BalancedPlusDiagnostics;
  balancedProDiagnostics?:import('./balancedPro/diagnostics').BalancedProDiagnostics;
  proDiagnostics?:ProDiagnostics;
  jwxxcDiagnostics?:JwxxcDiagnostics;
  decisionTier?:'single-hand-finish'|'proved-two-play-finish'|'ordinary';
  /** Local diagnostics only; excluded from public seat observations. Null scores were not evaluated. */
  attachmentDiagnostics?:{
    version:string;
    candidates:Array<{action:AiDecision['action'];selectedForPlanning:boolean;coarseScore:number;oldScore:number|null;score:number|null;cost:number|null;features:Record<string,number|boolean|string|null>;baseBreakdown:Record<string,number>}>;
    tiedActionKeys:string[];tieSample:number|null;scoringSelectedActionKey:string;selectedActionKey:string;
    selectionMethod:'score'|'single-hand-finish'|'no-legal-response'|'proved-two-play-finish';rootCandidatesSkipped:number;
  };
  candidateDiagnostics?:{version:string;base:number;added:number;variantChecks:number;choiceNodes:number;truncatedCandidates:boolean};
  plannerDiagnostics?:{version:string;perCandidate:boolean;analyzed:number;nodes:number;subsetChecks:number;catalogChecks:number;unvisitedBranches:number;exactGroupCounts:number;approximatePlans:number;nodeBudgetExhausted:boolean;subsetBudgetExhausted:boolean;catalogBudgetExhausted:boolean;rootCandidatesSkipped:number};
  knowledgeDiagnostics?:{version:string;playedEntities:number;knownHeldEntities:number;unlocatedEntities:number;consistent:boolean;futureEventsIgnored:number;scoringEnabled?:boolean};
}
export interface StrategyTiming { descriptorMs:number;candidateMs:number;knowledgeMs:number;plannerMs:number|null;scoringMs:number|null;policyMs:number;computeMs:number;tacticalMs?:number;inferenceMs?:number;searchMs?:number }
export interface EffectiveStrategy { id:StrategyId|'emergency-legal';version:string;configHash:string;descriptorHash?:string }
export interface RuntimeStrategyIdentity {
  requested:StrategyStamp;requestedDescriptorHash:string;effective:EffectiveStrategy;
  fallbackReason?:string;fallbackVersion:string;
}
export interface StrategyComputation { decision:StrategyDecision;candidateVersion:string;timing:StrategyTiming;identity:RuntimeStrategyIdentity }
export type SeatPolicies = [StrategyStamp,StrategyStamp,StrategyStamp,StrategyStamp];
export type AiTier = 'casual'|'balanced'|'balanced-plus'|'balanced-pro'|'jwxxc-pro'|'pro';
