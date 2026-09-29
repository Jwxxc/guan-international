import { chooseAiAction } from '../ai/policy';
import { createRng } from '../engine/cards';
import { getLegalMoves } from '../engine/legalMoves';
import { getObservation } from '../engine/observations';
import { advanceMatchPlay, createMatchSession, decodeMatchSession } from '../match/session';
import type { MatchSession } from '../match/sessionTypes';
const cache=new Map<string,MatchSession>();
const classicFixtures=import.meta.env.DEV?import.meta.glob<unknown>('./fixtures/classic-*.json',{eager:true,import:'default'}):{};
/** Naturally dealt, fully legal match histories, excluded from production builds. */
export function getMatchFixture(name:string):MatchSession|null {
  if(import.meta.env.DEV&&name.startsWith('classic-')){
    const data=classicFixtures[`./fixtures/${name}.json`];
    if(!data)return null;
    if(!cache.has(name))cache.set(name,decodeMatchSession(JSON.stringify(data)));
    return structuredClone(cache.get(name)!);
  }
  if(!import.meta.env.DEV||!['near-win','between'].includes(name))return null;
  if(cache.has(name))return structuredClone(cache.get(name)!);
  for(let seed=1;seed<=100;seed++){
    let session=createMatchSession(`match-fixture-${name}`,`match-fixture-${name}-1`,seed);
    const rng=createRng(seed+9000);
    for(let step=0;step<400&&session.phase==='playing';step++){
      const obs=getObservation(session.saved.state,session.saved.state.currentPlayer);
      const action=chooseAiAction(obs,getLegalMoves(obs),rng);
      const next=advanceMatchPlay(session,action);if(!next.ok)throw Error(next.error);
      if(next.match.saved.state.result?.winningTeam===0&&session.saved.state.currentPlayer===0){
        const chosen=name==='between'?next.match:session;cache.set(name,chosen);return structuredClone(chosen);
      }
      session=next.match;
    }
  }
  throw Error('No natural match fixture found');
}
