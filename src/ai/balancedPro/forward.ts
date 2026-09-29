import {applyAction} from '../../engine/reducer';
import {getObservation} from '../../engine/observations';
import {partnerOf} from '../../engine/rules';
import type {GameAction,GameState,PlayerObservation} from '../../engine/types';
import type {AiObservation} from '../types';
import {plusTerminalUtility,plusActionKey} from '../balancedPlus/forward';
import {chooseProContinuation} from './continuation';
import {choosePlannedProContinuation} from './plannedContinuation';
import {BALANCED_PRO_CONFIG,type BalancedProWorkBudget} from './config';
import type {BalancedProDiagnostics} from './diagnostics';

export type ProContinuation=(observation:PlayerObservation)=>GameAction;
export const proContinuation:ProContinuation=obs=>obs.hand.length<=BALANCED_PRO_CONFIG.plannedContinuationHandLimit
  ?choosePlannedProContinuation(obs):chooseProContinuation(obs,BALANCED_PRO_CONFIG.rolloutStyle);
export const proActionKey=plusActionKey;

/** Practice settles one deal, so prioritize the team's actual win. Placement
 * is a small tie preference. Classic keeps the actual level/pass-A boundary. */
export function proTerminalUtility(obs:AiObservation,state:GameState):number{
  if(!state.result)throw Error('Pro terminal utility requires a completed deal');
  if(obs.mode!=='practice'&&obs.matchContext)return plusTerminalUtility(obs,state);
  const sign=state.result.winningTeam===obs.team?1:-1;
  const steps=state.result.doubleUp?3:4-state.result.order.indexOf(partnerOf(state.result.order[0]));
  return sign*(1+(steps-1)*BALANCED_PRO_CONFIG.practiceUpgradeWeight);
}
export interface ProSimulatedOutcome {value:number;teamWin:boolean}
/** A practice placement tie-break is not a lost deal. Classic still evaluates
 * its real level/pass-A utility, including lower progress with the same head. */
export function isProConfirmationLoss(mode:AiObservation['mode'],reference:ProSimulatedOutcome,candidate:ProSimulatedOutcome):boolean{
  return mode==='practice'?reference.teamWin&&!candidate.teamWin:candidate.value<reference.value;
}

/** Fixed-stage adaptive allocation. Pilot data selects a smaller contender set;
 * a disjoint confirmation batch decides whether to override. These are decision
 * heuristics, never sequential confidence intervals or proofs of optimality. */
export function runProForward(obs:AiObservation,selectionWorlds:GameState[],confirmationWorlds:GameState[],
  roots:GameAction[],base:GameAction,work:BalancedProWorkBudget,continuation:ProContinuation=proContinuation):{
    action:GameAction;diagnostics:BalancedProDiagnostics['forward'];
  } {
  const diagnostics:BalancedProDiagnostics['forward']={attempted:false,changedAction:false,reason:'not-needed',
    transitions:0,completed:0,initialRoots:0,refinedRoots:0,selectionSamples:0,confirmationSamples:0,
    selectionGain:null,confirmationGain:null,estimateOnly:true};
  const finish=(reason:string,action=base)=>{diagnostics.reason=reason;diagnostics.changedAction=proActionKey(action)!==proActionKey(base);return{action,diagnostics};};
  if(obs.mode==='practice'&&obs.finished.length>0&&2*BALANCED_PRO_CONFIG.practiceUpgradeWeight<BALANCED_PRO_CONFIG.minGain)return finish('team-win-already-fixed');
  if(obs.remainingCounts.reduce((a,b)=>a+b,0)>work.cardLimit)return finish('outside-forward-budget');
  if(selectionWorlds.length<work.pilotSamples+work.refineSamples||confirmationWorlds.length<work.confirmationSamples)return finish('insufficient-disjoint-samples');
  const candidates=[...new Map([base,...roots].map(action=>[proActionKey(action),action])).values()].slice(0,work.rootCandidates);
  if(candidates.length<2)return finish('no-alternative');
  diagnostics.attempted=true;diagnostics.initialRoots=candidates.length;
  const exhausted=Symbol('bounded-forward-work');
  const simulate=(world:GameState,root:GameAction):ProSimulatedOutcome=>{
    const advance=(state:GameState,action:GameAction):GameState=>{
      if(diagnostics.transitions>=work.maxTransitions)throw exhausted;
      const moved=applyAction(state,action);diagnostics.transitions++;
      if(!moved.ok)throw Error(`Pro sampled action rejected: ${moved.error}`);
      const next=moved.state;
      // Keep only the publicly visible current-trick history. Correct absolute
      // event indices after the reducer operated on the short simulation buffer.
      const event=next.events.at(-1)!;
      return{...next,played:[],events:[...next.events.slice(0,-1),{...event,index:next.stateVersion-1}].slice(-4)};
    };
    let state=advance({...world,events:structuredClone(obs.history.slice(-4)),played:[]},root);
    for(let ply=0;ply<work.maxPlies;ply++){
      if(state.result){diagnostics.completed++;return{value:proTerminalUtility(obs,state),teamWin:state.result.winningTeam===obs.team};}
      const action=continuation(getObservation(state,state.currentPlayer));
      state=advance(state,action);
    }
    if(state.result){diagnostics.completed++;return{value:proTerminalUtility(obs,state),teamWin:state.result.winningTeam===obs.team};}
    throw exhausted; // No leaf value model exists in Pro v1; do not invent a payoff.
  };
  const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const differences=candidates.map(()=>[] as number[]);
  try{
    for(let i=0;i<work.pilotSamples;i++){
      const reference=simulate(selectionWorlds[i],base);differences[0].push(0);
      for(let j=1;j<candidates.length;j++)differences[j].push(simulate(selectionWorlds[i],candidates[j]).value-reference.value);
      diagnostics.selectionSamples++;
    }
    const ranking=candidates.map((_,index)=>index).sort((a,b)=>mean(differences[b])-mean(differences[a])||a-b);
    const first=ranking[0],second=ranking[1];
    if(first===0&&ranking.slice(1).every(i=>differences[i].every(x=>x<=0)&&mean(differences[i])<=-BALANCED_PRO_CONFIG.minGain))return finish('pilot-retains-base');
    const decisive=mean(differences[first])-mean(differences[second])>=BALANCED_PRO_CONFIG.clearPilotGap;
    const limit=decisive?2:work.refinedCandidates;
    const retained=[...new Set([0,...ranking])].slice(0,Math.max(2,limit));
    diagnostics.refinedRoots=retained.length;
    for(let i=work.pilotSamples;i<work.pilotSamples+work.refineSamples;i++){
      const reference=simulate(selectionWorlds[i],base);differences[0].push(0);
      for(const j of retained)if(j)differences[j].push(simulate(selectionWorlds[i],candidates[j]).value-reference.value);
      diagnostics.selectionSamples++;
    }
    const chosen=retained.reduce((best,j)=>mean(differences[j])>mean(differences[best])?j:best,0);
    const gain=mean(differences[chosen]);diagnostics.selectionGain=gain;
    if(!chosen||gain<BALANCED_PRO_CONFIG.minGain)return finish('selection-no-clear-gain');
    const confirmation:number[]=[];let losses=0;
    for(let i=0;i<work.confirmationSamples;i++){
      const reference=simulate(confirmationWorlds[i],base),alternative=simulate(confirmationWorlds[i],candidates[chosen]);
      confirmation.push(alternative.value-reference.value);losses+=isProConfirmationLoss(obs.mode,reference,alternative)?1:0;diagnostics.confirmationSamples++;
    }
    diagnostics.confirmationGain=mean(confirmation);
    const lossFraction=obs.mode==='practice'?BALANCED_PRO_CONFIG.maxPracticeConfirmationLossFraction:BALANCED_PRO_CONFIG.maxConfirmationLossFraction;
    if(diagnostics.confirmationGain<BALANCED_PRO_CONFIG.minGain
      ||losses>Math.floor(confirmation.length*lossFraction))return finish('confirmation-inconclusive');
    return finish('independent-confirmation-gain',candidates[chosen]);
  }catch(error){if(error!==exhausted)throw error;return finish('unvalued-budget-exhaustion');}
}
