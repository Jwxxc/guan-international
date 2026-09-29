import type {AiObservation} from '../types';
import {buildPublicKnowledge} from '../publicKnowledge';
import {partnerOf,teamOf} from '../../engine/rules';
import {isWild} from '../../engine/cards';
import {DANLM_CLASSIC_ENCODER_VERSION,DANLM_ENCODER_VERSION} from './nativeInfo';

/** Validate only facts available to the current seat. Hidden donor hands and
 * pending exchange choices are never reconstructed to satisfy this contract. */
export function validateNativeObservation(obs:AiObservation,encoderVersion:string):void {
 if(![DANLM_ENCODER_VERSION,DANLM_CLASSIC_ENCODER_VERSION].includes(encoderVersion))throw Error('native encoder unavailable');
 if(![0,1,2,3].includes(obs.player)||obs.currentPlayer!==obs.player||obs.isOver||obs.team!==teamOf(obs.player)||obs.partner!==partnerOf(obs.player))throw Error('native request is not an active own observation');
 if(obs.rules.version!=='guan-practice-v1'||!Number.isInteger(obs.rules.levelRank)||obs.rules.levelRank<2||obs.rules.levelRank>14)throw Error('native unsupported rule configuration');
 if(!Number.isSafeInteger(obs.stateVersion)||obs.stateVersion<0||obs.history.length!==obs.stateVersion||obs.history.some((e,i)=>e.index!==i))throw Error('native incomplete public history');
 const knowledge=buildPublicKnowledge(obs);
 if(!knowledge.consistent)throw Error('native inconsistent public inventory: '+knowledge.issues.join(','));
 if(obs.mode==='practice'){
  if(obs.matchContext!==null||obs.publicTransfers.length||obs.antiTributeEvidence.length)throw Error('native practice must not contain match/exchange state');
  return;
 }
 if(obs.mode!=='classic'||encoderVersion!==DANLM_CLASSIC_ENCODER_VERSION)throw Error('native classic mode requires the classic encoder');
 const context=obs.matchContext;
 if(!context||context.teamLevels.length!==2||context.teamLevels.some(n=>!Number.isInteger(n)||n<2||n>14)||!Number.isSafeInteger(context.handNumber)||context.handNumber<1||![null,0,1].includes(context.levelOwnerTeamId))throw Error('native invalid classic match context');
 if(context.handNumber===1){
  if(context.levelOwnerTeamId!==null||context.teamLevels.some(n=>n!==2)||obs.rules.levelRank!==2||obs.publicTransfers.length||obs.antiTributeEvidence.length)throw Error('native invalid classic opening');
  return;
 }
 if(context.levelOwnerTeamId===null||context.teamLevels[context.levelOwnerTeamId]!==obs.rules.levelRank)throw Error('native level/owner context mismatch');
 const transfers=obs.publicTransfers,anti=obs.antiTributeEvidence;
 if(anti.length){
  if(transfers.length||anti.length!==2||anti.some(item=>![0,1,2,3].includes(item.player)||item.card.rank!==16||item.card.suit!=='J')||teamOf(anti[0].player)!==teamOf(anti[1].player)||anti[0].card.id===anti[1].card.id||anti[0].card.deck===anti[1].card.deck)throw Error('native invalid public anti-tribute evidence');
  return;
 }
 if(transfers.length!==2&&transfers.length!==4)throw Error('native incomplete classic exchange');
 const count=transfers.length/2,gives=transfers.slice(0,count),backs=transfers.slice(count);
 const giveIds=new Set(gives.map(t=>t.card.id));
 if(new Set(transfers.map(t=>t.card.id)).size!==transfers.length||new Set(gives.map(t=>t.from)).size!==count||new Set(gives.map(t=>t.to)).size!==count)throw Error('native conflicting public exchange');
 for(const give of gives){
  if(give.type!=='tribute'||![0,1,2,3].includes(give.from)||![0,1,2,3].includes(give.to)||give.from===give.to||isWild(give.card,obs.rules))throw Error('native invalid public tribute');
  const back=backs.filter(t=>t.type==='return'&&t.from===give.to&&t.to===give.from);
  if(back.length!==1||back[0].card.rank>=15||back[0].card.rank===obs.rules.levelRank||giveIds.has(back[0].card.id))throw Error('native invalid or pending return');
 }
 if(count===2&&(teamOf(gives[0].from)!==teamOf(gives[1].from)||teamOf(gives[0].to)!==teamOf(gives[1].to)||teamOf(gives[0].from)===teamOf(gives[0].to)))throw Error('native invalid double tribute teams');
}
