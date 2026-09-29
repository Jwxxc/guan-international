import { isWild, rankStrength } from '../../engine/cards';
import { bombTier } from '../../engine/compare';
import { resolvePlays } from '../../engine/patterns';
import type { Card,ResolvedPlay } from '../../engine/types';
import type { AiObservation } from '../types';
import { getStrategicCandidates } from '../candidates/strategic';
import type { BalancedPlannerBudget } from './config';
import {createOwnHandPlanner} from '../coop/planning';
import {COOP_CONFIG} from '../coop/config';

export const BALANCED_PLANNER_VERSION='residual-planner-v1';
export interface BalancedPlan {
  groups:ResolvedPlay[];groupCount:number;weakSingles:number;controlResources:number;wildSubstitutions:number;
}
export interface BalancedPlanningResult {
  plans:BalancedPlan[];groupCountExact:boolean;secondaryExact:false;approximate:boolean;
  proof:'one-group'|'complete-search'|'size-lower-bound'|'none';
  stats:{nodes:number;subsetChecks:number;catalogChecks:number;catalogGenerations:number;unvisitedBranches:number;nodeBudgetExhausted:boolean;subsetBudgetExhausted:boolean;catalogBudgetExhausted:boolean};
}
export function summarizePartition(groups:ResolvedPlay[],observation:AiObservation):BalancedPlan {
  return{groups,groupCount:groups.length,weakSingles:groups.filter(play=>play.kind==='single'&&play.value<=10).length,
    controlResources:groups.reduce((n,play)=>n+(bombTier(play.kind,play.size)>0?2:play.size<=3&&play.value>=14?1:0),0),
    wildSubstitutions:groups.reduce((n,play)=>n+play.wildcards.filter(mapping=>mapping.rank!==observation.rules.levelRank||mapping.suit!=='H').length,0)};
}
const planKey=(plan:BalancedPlan)=>plan.groups.map(play=>play.key).sort().join('/');
const comparePlans=(a:BalancedPlan,b:BalancedPlan)=>a.groupCount-b.groupCount||a.weakSingles-b.weakSingles||b.controlResources-a.controlResources||a.wildSubstitutions-b.wildSubstitutions||(planKey(a)<planKey(b)?-1:planKey(a)>planKey(b)?1:0);
function retain(plans:BalancedPlan[],limit:number):BalancedPlan[]{
  const distinct=[...new Map(plans.map(plan=>[planKey(plan),plan])).values()].sort(comparePlans);
  const nondominated=distinct.filter((plan,index)=>!distinct.some((other,j)=>j!==index&&other.groupCount<=plan.groupCount&&other.weakSingles<=plan.weakSingles&&other.controlResources>=plan.controlResources&&other.wildSubstitutions<=plan.wildSubstitutions&&(other.groupCount<plan.groupCount||other.weakSingles<plan.weakSingles||other.controlResources>plan.controlResources||other.wildSubstitutions<plan.wildSubstitutions)));
  return nondominated.slice(0,Math.max(1,limit));
}
/** Cheap feasible cover, never a claim about future turns or other players' cards. */
export function rankCover(observation:AiObservation,cards:readonly Card[]=observation.hand):BalancedPlan {
  const buckets=new Map<number,Card[]>();
  for(const card of cards)buckets.set(card.rank,[...(buckets.get(card.rank)??[]),card]);
  const groups:ResolvedPlay[]=[];
  for(const bucket of buckets.values()){
    const plays=resolvePlays([...bucket],observation.rules);
    if(plays.length)groups.push(plays[0]!);else for(const card of bucket)groups.push(resolvePlays([card],observation.rules)[0]!);
  }
  return summarizePartition(groups,observation);
}
/** A fresh, per-query planner. No candidate can modify a later candidate's catalog or work allocation. */
export function planResidualHand(observation:AiObservation,remaining:readonly Card[],budget:BalancedPlannerBudget):BalancedPlanningResult {
  for(const value of Object.values(budget))if(!Number.isInteger(value)||value<0||value>100_000)throw Error('残余规划预算无效');
  const available=new Set(observation.hand.map(card=>card.id));
  if(remaining.length>27||new Set(remaining.map(card=>card.id)).size!==remaining.length||remaining.some(card=>!available.has(card.id)))throw Error('残余规划只能使用自身实体');
  const cards=[...remaining].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),full=(1<<cards.length)-1;
  const bits=new Map(cards.map((card,index)=>[card.id,1<<index]));
  const groups=new Map<number,ResolvedPlay[]>(),completeCatalogs:number[]=[],checked=new Set<number>();
  const memo=new Map<number,{plans:BalancedPlan[];exact:boolean;proof:BalancedPlanningResult['proof']}>();
  const stats:BalancedPlanningResult['stats']={nodes:0,subsetChecks:0,catalogChecks:0,catalogGenerations:0,unvisitedBranches:0,nodeBudgetExhausted:false,subsetBudgetExhausted:false,catalogBudgetExhausted:false};
  const cardsFor=(mask:number)=>cards.filter((_,i)=>mask&(1<<i));
  const register=(play:ResolvedPlay)=>{
    const mask=play.cards.reduce((m,card)=>{const bit=bits.get(card.id);if(bit===undefined)throw Error('规划候选含外部实体');return m|bit;},0);
    const old=groups.get(mask)??[];if(!old.some(p=>p.key===play.key))groups.set(mask,[...old,play]);
  };
  function catalog(mask:number):boolean{
    if(completeCatalogs.some(parent=>(parent&mask)===mask))return true;
    const own=cardsFor(mask);
    if(own.length<=Math.min(10,budget.exactHandLimit)){
      let complete=true;
      for(let subset=mask;subset;subset=(subset-1)&mask){
        if(checked.has(subset))continue;
        if(stats.subsetChecks>=budget.maxSubsetChecks){stats.subsetBudgetExhausted=true;complete=false;break;}
        checked.add(subset);stats.subsetChecks++;
        for(const play of resolvePlays(cardsFor(subset),observation.rules))register(play);
      }
      if(complete){completeCatalogs.push(mask);return true;}
    }
    const left=Math.max(0,budget.maxCatalogChecks-stats.catalogChecks);
    const batch=getStrategicCandidates({...observation,hand:own,currentPlay:null,currentOwner:null,isOver:false},{maxVariantChecks:left,maxAdditionalCandidates:left,maxChoiceNodes:Math.min(4096,left*24)});
    stats.catalogGenerations++;stats.catalogChecks+=batch.stats.variantChecks;stats.catalogBudgetExhausted ||= batch.stats.truncatedCandidates;
    for(const play of batch.moves)register(play);
    return false;
  }
  function solve(mask:number):{plans:BalancedPlan[];exact:boolean;proof:BalancedPlanningResult['proof']}{
    if(!mask)return{plans:[summarizePartition([],observation)],exact:true,proof:'complete-search'};
    const saved=memo.get(mask);if(saved?.exact)return saved;
    const own=cardsFor(mask),fallback=rankCover(observation,own);
    const whole=own.length<=10?resolvePlays(own,observation.rules):[];
    if(whole.length){const result={plans:retain(whole.map(play=>summarizePartition([play],observation)),budget.alternatives),exact:true,proof:'one-group' as const};memo.set(mask,result);return result;}
    if(stats.nodes>=budget.maxNodes){stats.nodeBudgetExhausted=true;stats.unvisitedBranches++;return{plans:[fallback],exact:false,proof:'none'};}
    stats.nodes++;
    const complete=catalog(mask),first=mask&-mask;
    const possible=[...groups].filter(([group])=>(group&mask)===group);
    const entries=possible.filter(([group])=>(group&first)!==0).flatMap(([group,plays])=>{
      // All interpretations have the same primary group count. Keep useful secondary alternatives.
      const representatives=plays.sort((a,b)=>bombTier(b.kind,b.size)-bombTier(a.kind,a.size)||b.value-a.value||a.key.localeCompare(b.key)).slice(0,2);
      return representatives.map(play=>({group,play}));
    }).sort((a,b)=>b.play.size-a.play.size||a.play.wildcards.length-b.play.wildcards.length||b.play.value-a.play.value||a.play.key.localeCompare(b.play.key));
    const limit=complete?entries.length:Math.max(1,budget.branchesPerNode);
    const branches=entries.slice(0,limit);stats.unvisitedBranches+=entries.length-branches.length;
    let plans=[fallback,...(saved?.plans??[])],exact=complete,proof:BalancedPlanningResult['proof']='none';
    const maximum=Math.max(...possible.flatMap(([,plays])=>plays.map(play=>play.size)),1),lowerBound=Math.ceil(own.length/maximum);
    for(let i=0;i<branches.length;i++){
      if(stats.nodes>=budget.maxNodes){stats.nodeBudgetExhausted=true;stats.unvisitedBranches+=branches.length-i;exact=false;break;}
      const branch=branches[i]!,rest=solve(mask^branch.group);
      exact &&= rest.exact;
      plans=retain([...plans,...rest.plans.map(plan=>summarizePartition([branch.play,...plan.groups],observation))],budget.alternatives);
      if(complete&&plans[0]!.groupCount===lowerBound){exact=true;proof='size-lower-bound';stats.unvisitedBranches+=branches.length-i-1;break;}
    }
    plans=retain(plans,budget.alternatives);
    if(exact&&proof==='none')proof='complete-search';
    const result={plans,exact,proof};memo.set(mask,result);return result;
  }
  const result=solve(full);
  return{plans:result.plans,groupCountExact:result.exact,secondaryExact:false,approximate:!result.exact,proof:result.proof,stats};
}

export function residualWildCount(cards:readonly Card[],observation:AiObservation):number{return cards.filter(card=>isWild(card,observation.rules)).length;}
export function highSingleCount(cards:readonly Card[],observation:AiObservation):number{return cards.filter(card=>rankStrength(card.rank,observation.rules)>=14).length;}

/** Development-only matched-budget ablation: old full-hand catalog, no shared mutation between roots. */
export function planLegacyCatalogForExperiment(observation:AiObservation,remaining:readonly Card[],budget:BalancedPlannerBudget):BalancedPlanningResult{
 const planner=createOwnHandPlanner(observation,{...COOP_CONFIG,exactHandLimit:budget.exactHandLimit,branchesPerNode:budget.branchesPerNode,nodesPerLargePlan:budget.maxNodes},{maxNodes:budget.maxNodes,maxCandidates:0,maxSubsetChecks:budget.maxSubsetChecks});
 const plan=planner.analyze(planner.maskFor(remaining));
 return{plans:[summarizePartition(plan.groups,observation)],groupCountExact:plan.exact,secondaryExact:false,approximate:plan.approximate,proof:plan.exact?(plan.groupCount===1?'one-group':'complete-search'):'none',stats:{nodes:planner.stats.nodes,subsetChecks:planner.stats.subsetChecks,catalogChecks:0,catalogGenerations:1,unvisitedBranches:planner.stats.exhausted?1:0,nodeBudgetExhausted:planner.stats.exhausted&&planner.stats.nodes>=budget.maxNodes,subsetBudgetExhausted:planner.stats.exhausted&&planner.stats.subsetChecks>=budget.maxSubsetChecks,catalogBudgetExhausted:false}};
}
