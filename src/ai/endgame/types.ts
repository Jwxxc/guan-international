import type {GameAction,Seat} from '../../engine/types';

export interface EndgameProofBudget {
 maxOwnCards:number;maxOpponentCards:number;maxHistoryEvents:number;
 maxReplySubsets:number;maxFirstCandidates:number;
}
export interface EndgameOutcome {
 place:3|4;winningTeam:0|1;order:Seat[];nominalAdvance:number;actualAdvance:number;
 teamLevelsBefore:[number,number];teamLevelsAfter:[number,number];passesAce:boolean;matchWinner:0|1|null;
 nextExchange:null|{kind:'single';tributeFrom:Seat;tributeTo:Seat;returnFrom:Seat;returnTo:Seat;firstLeaderIfNoAnti:Seat;firstLeaderIfAnti:Seat};
}
export interface TacticalCertificate {
 status:'proved'|'not-proved'|'not-applicable'|'budget-exhausted';
 certificateScope:'two-active-players';version:string;reason:string;eligibleOverride:boolean;
 proofWorkBudget:EndgameProofBudget;
 work:{historySteps:number;firstCandidates:number;replySubsets:number;replyInterpretations:number;replyComparisons:number;pathTransitions:number};
 checkedReplyCount:number;forcedResponder?:Seat;
 expectedPlace?:3;expectedWinningTeam?:0|1;nominalAdvance?:number;actualAdvance?:number;
 selfThirdOutcome?:EndgameOutcome;opponentThirdOutcome?:EndgameOutcome;
 benefit?:'more-own-advance'|'less-opponent-advance'|'own-passed-ace'|'opponent-pass-ace-denied'|'placement-only-no-actual-benefit';
 orderingScope?:'current-hand-actual-progress-and-pass-A';
 selectedRoute?:{first:GameAction;forcedPass:GameAction;finish:GameAction};
}
export interface EndgameChoice {first:GameAction;finish:GameAction;forcedPass:GameAction}
export interface EndgameAnalysis {certificate:TacticalCertificate;choices:EndgameChoice[]}
