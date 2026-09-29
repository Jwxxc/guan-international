import {canBeat} from '../../engine/compare';
import {resolvePlays} from '../../engine/patterns';
import {teamOf} from '../../engine/rules';
import type {ResolvedPlay,Seat} from '../../engine/types';
import type {PublicKnowledge} from '../publicKnowledge';
import type {AiObservation} from '../types';

export interface ProRelayAssessment {
  applicable:boolean;
  multiplier:number;
  reason:string;
  opponentsBeforePartner:Seat[];
  shortOpponentsBeforePartner:Seat[];
  partnerCardKnown:boolean;
  partnerCanFinish:boolean|null;
  recaptureProven:false;
  teamImprovementProven:false;
}

/** A soft proposal only. A known last card can establish a legal reply, never
 * an uninterrupted relay; public result certificates arbitrate above this. */
export function assessProRelay(obs:AiObservation,play:ResolvedPlay,knowledge:PublicKnowledge):ProRelayAssessment {
  const assessment:ProRelayAssessment={applicable:!obs.currentPlay&&play.kind==='single'&&obs.remainingCounts[obs.partner]===1,
    multiplier:0,reason:'not-a-single-relay',opponentsBeforePartner:[],shortOpponentsBeforePartner:[],
    partnerCardKnown:false,partnerCanFinish:null,recaptureProven:false,teamImprovementProven:false};
  if(!assessment.applicable)return assessment;
  for(let offset=1;offset<4;offset++){
    const seat=((obs.player+offset)%4) as Seat;
    if(seat===obs.partner)break;
    if(obs.remainingCounts[seat]>0&&teamOf(seat)!==obs.team)assessment.opponentsBeforePartner.push(seat);
  }
  assessment.shortOpponentsBeforePartner=assessment.opponentsBeforePartner.filter(seat=>obs.remainingCounts[seat]<=2);
  const known=knowledge.consistent?knowledge.knownHeld.filter(item=>item.player===obs.partner):[];
  if(known.length===1){
    assessment.partnerCardKnown=true;
    assessment.partnerCanFinish=resolvePlays([known[0].card],obs.rules).some(reply=>canBeat(reply,play,obs.rules));
  }
  if(assessment.partnerCanFinish===false){assessment.reason='known-partner-card-cannot-beat';return assessment;}
  if(assessment.shortOpponentsBeforePartner.length){assessment.reason='short-opponent-acts-before-partner';return assessment;}
  // Unknown ownership, interception and later reclaim are not result proofs.
  // Retain a modest cooperation preference instead of treating one card as certainty.
  assessment.multiplier=assessment.partnerCanFinish===true?0.6:0.2;
  assessment.reason=assessment.partnerCanFinish===true?'known-legal-partner-reply-interception-unproved':'partner-last-card-unknown';
  return assessment;
}
