import {getLegalMoves} from '../../engine/legalMoves';
import {applyAction} from '../../engine/reducer';
import {getObservation} from '../../engine/observations';
import {partnerOf,teamOf} from '../../engine/rules';
import type {GameAction,GameState,PlayerObservation} from '../../engine/types';
import {createMatchProgress,settleMatchProgress} from '../../match/progression';
import {chooseAiAction} from '../policy';
import type {AiObservation} from '../types';
import type {BalancedPlusWorkBudget} from './config';
import {BALANCED_PLUS_CONFIG} from './config';
import type {BalancedPlusDiagnostics} from './diagnostics';

export const plusActionKey=(action:GameAction)=>action.type==='pass'?'~pass':action.playKey;
export type PlusContinuation=(observation:PlayerObservation)=>GameAction;

/** Each simulated actor receives only its own detached public observation. The
 * same information always yields the same continuation; no sampled-world index,
 * root action or hidden cache influences its choice. */
export const plusContinuation:PlusContinuation=obs=>chooseAiAction(obs,getLegalMoves(obs),()=>0);

/** Hand-boundary utility, not a claimed whole-match win probability. Passing A
 * dominates capped progress. The small winning-team term also values the next
 * hand's head/tribute position when both actual level changes are zero. */
export function plusTerminalUtility(obs:AiObservation,state:GameState):number {
  if(!state.result)throw Error('Plus terminal utility requires a completed deal');
  const sign=state.result.winningTeam===obs.team?1:-1;
  if(obs.mode==='practice'||!obs.matchContext){
    const steps=state.result.doubleUp?3:4-state.result.order.indexOf(partnerOf(state.result.order[0]));
    return sign*(1+steps/3);
  }
  const context=obs.matchContext;
  const progress={...createMatchProgress(obs.mode==='legacy'?'guan-match-v1':'guan-classic-house-v1'),
    teamLevels:[...context.teamLevels] as [number,number],activeTeam:context.levelOwnerTeamId,handNumber:context.handNumber};
  const settled=settleMatchProgress(progress,state);
  if(!settled.ok)throw Error('Plus hypothetical settlement failed');
  if(settled.progress.winner!==null)return settled.progress.winner===obs.team?8:-8;
  const other=obs.team===0?1:0;
  return sign*.5+(settled.progress.teamLevels[obs.team]-context.teamLevels[obs.team]
    -(settled.progress.teamLevels[other]-context.teamLevels[other]))/3;
}

export function runPlusForward(obs:AiObservation,worlds:GameState[],roots:GameAction[],base:GameAction,
  work:BalancedPlusWorkBudget,continuation:PlusContinuation=plusContinuation):{action:GameAction;diagnostics:BalancedPlusDiagnostics['forward']} {
  const diagnostics:BalancedPlusDiagnostics['forward']={attempted:false,changedAction:false,reason:'outside-short-hand-budget',
    transitions:0,completed:0,roots:0,selectionGain:null,confirmationGain:null,estimateOnly:true};
  const finish=(reason:string,action=base)=>{diagnostics.reason=reason;diagnostics.changedAction=plusActionKey(action)!==plusActionKey(base);return{action,diagnostics};};
  if(obs.remainingCounts.reduce((a,b)=>a+b,0)>work.rolloutCardLimit)return finish('outside-short-hand-budget');
  if(worlds.length<work.rolloutSamples*2)return finish('insufficient-independent-samples');
  const candidates=[...new Map([base,...roots].map(action=>[plusActionKey(action),action])).values()].slice(0,work.rolloutRoots);
  if(candidates.length<2)return finish('no-alternative');
  diagnostics.attempted=true;diagnostics.roots=candidates.length;
  const simulate=(world:GameState,root:GameAction):number|null=>{
    let next=applyAction(world,root);diagnostics.transitions++;
    if(!next.ok)throw Error(`Plus sampled root rejected: ${next.error}`);
    let state=next.state;
    for(let ply=0;ply<work.rolloutPlies;ply++){
      if(state.result){diagnostics.completed++;return plusTerminalUtility(obs,state);}
      // History arrays are presentation-only here. The lightweight continuation
      // uses own cards, public counts and current trick; it makes no history inference.
      state={...state,events:[],played:[]};
      const action=continuation(getObservation(state,state.currentPlayer));
      next=applyAction(state,action);diagnostics.transitions++;
      if(!next.ok)throw Error(`Plus continuation rejected: ${next.error}`);
      state=next.state;
    }
    if(state.result){diagnostics.completed++;return plusTerminalUtility(obs,state);}
    return null; // An unfinished simulation never receives an invented win/utility.
  };
  const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
  const selection:number[][]=candidates.map(()=>[]);
  for(let i=0;i<work.rolloutSamples;i++){
    const reference=simulate(worlds[i],base);if(reference===null)return finish('unvalued-truncation');
    selection[0].push(0);
    for(let j=1;j<candidates.length;j++){
      const value=simulate(worlds[i],candidates[j]);if(value===null)return finish('unvalued-truncation');
      selection[j].push(value-reference);
    }
  }
  const means=selection.map(mean),chosen=means.reduce((best,x,index)=>x>means[best]?index:best,0);
  diagnostics.selectionGain=means[chosen];
  if(!chosen||means[chosen]<BALANCED_PLUS_CONFIG.rolloutMinGain)return finish('selection-no-clear-gain');
  const confirmation:number[]=[];
  for(let i=work.rolloutSamples;i<work.rolloutSamples*2;i++){
    const reference=simulate(worlds[i],base),candidate=simulate(worlds[i],candidates[chosen]);
    if(reference===null||candidate===null)return finish('unvalued-truncation');
    confirmation.push(candidate-reference);
  }
  const gain=mean(confirmation);diagnostics.confirmationGain=gain;
  // A conservative consistency check, explicitly not a statistical strength
  // certificate: the model of unknown hands and continuation may be wrong.
  if(gain<BALANCED_PLUS_CONFIG.rolloutMinGain||confirmation.filter(x=>x<0).length>Math.floor(confirmation.length/4))return finish('confirmation-inconclusive');
  return finish('independent-sample-gain',candidates[chosen]);
}
