import {bombTier} from '../../engine/compare';
import type {GameAction,ResolvedPlay} from '../../engine/types';
import type {AiCandidateDiagnostic} from '../types';
import {proActionKey} from './forward';

/** Keep qualitatively different plays before filling spare slots by score.
 * The preferred proposals are cheap standalone policies, never nested search. */
export function selectProRoots(rows:AiCandidateDiagnostic[],plays:Map<string,ResolvedPlay>,base:GameAction,
  preferred:readonly GameAction[],limit:number):GameAction[]{
  const selected:GameAction[]=[],seen=new Set<string>(),families=new Set<string>(),structures=new Set<string>();
  const byKey=new Map(rows.map(row=>[proActionKey(row.action),row]));
  const family=(action:GameAction)=>{
    if(action.type==='pass')return'pass';
    const play=plays.get(action.playKey);return play?`${play.kind}:${play.size}:${bombTier(play.kind,play.size)}`:'unknown';
  };
  const structure=(action:GameAction)=>{
    const features=byKey.get(proActionKey(action))?.features??{};
    return [family(action),features.wildsRemaining??0,features.controlResourcesAfter??0,
      features.groupsAfter??0,Number(features.attachmentControlCost??0)>0].join(':');
  };
  const add=(action:GameAction|undefined)=>{
    if(!action||selected.length>=limit||seen.has(proActionKey(action)))return;
    seen.add(proActionKey(action));families.add(family(action));structures.add(structure(action));selected.push(action);
  };
  add(base);
  add(rows.find(row=>row.action.type==='pass')?.action);
  for(const action of preferred)if(rows.some(row=>proActionKey(row.action)===proActionKey(action)))add(action);
  const shapeLimit=Math.max(selected.length,limit-2);
  for(const row of rows)if(selected.length<shapeLimit&&!families.has(family(row.action)))add(row.action);
  for(const row of rows)if(families.has(family(row.action))&&!structures.has(structure(row.action)))add(row.action);
  for(const row of rows)add(row.action);
  return selected;
}
