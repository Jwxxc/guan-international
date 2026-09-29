import type {GameAction} from '../../engine/types';
import type {StrategyDecision} from '../strategyTypes';
import type {EndgameAnalysis} from './types';
const key=(action:GameAction)=>action.type==='play'?action.playKey:'~pass';
/** Selection tiers, not a fabricated score bonus. Ordinary unproved behavior is unchanged. */
export function applyEndgamePriority(original:StrategyDecision,analysis:EndgameAnalysis):StrategyDecision{
 const certificate=structuredClone(analysis.certificate);
 if(original.reasonCodes.includes('FINISH_HAND')||certificate.reason==='single-hand-finish-priority')return{...original,tacticalCertificate:certificate,decisionTier:'single-hand-finish'};
 if(certificate.status!=='proved'||!certificate.eligibleOverride||!analysis.choices.length)return{...original,tacticalCertificate:certificate,decisionTier:'ordinary'};
 const eligible=new Map(analysis.choices.map(choice=>[key(choice.first),choice]));
 // Retain the original choice when it already certifies the same terminal result. Otherwise
 // consult its ordinary diagnostic ranking among proved choices; no extra RNG is consumed.
 const candidate=eligible.get(key(original.action))??original.topCandidates.map(row=>eligible.get(key(row.action))).find(Boolean)
  ??[...analysis.choices].sort((a,b)=>key(a.first)<key(b.first)?-1:key(a.first)>key(b.first)?1:0)[0]!;
 certificate.selectedRoute={first:structuredClone(candidate.first),forcedPass:structuredClone(candidate.forcedPass),finish:structuredClone(candidate.finish)};
 const selected=original.topCandidates.find(row=>key(row.action)===key(candidate.first));
 return{...original,action:structuredClone(candidate.first),reasonCodes:['PROVED_TWO_PLAY_FINISH'],
  explanation:'这手无法被压过，重新领出后可一手出完，争取三游并改善本副结算。',
  // Scores are untouched. The tactical tier explains why a numerically lower action wins.
  topCandidates:selected?[selected,...original.topCandidates.filter(row=>row!==selected)]:original.topCandidates,
  tacticalCertificate:certificate,decisionTier:'proved-two-play-finish'};
}
