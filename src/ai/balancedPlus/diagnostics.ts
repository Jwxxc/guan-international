export interface BalancedPlusDiagnostics {
  version:'balanced-plus-diagnostics-v1';
  objective:string;
  method:'immediate'|'heuristic'|'sampled-forward'|'public-exact';
  sampledWorlds:number;
  samplingReason:string|null;
  publicHistoryReplays:number;
  baseActionKey:string;
  selectedActionKey:string;
  controlAdjusted:boolean;
  forward:{attempted:boolean;changedAction:boolean;reason:string;transitions:number;completed:number;
    roots:number;selectionGain:number|null;confirmationGain:number|null;estimateOnly:true};
  endgame:{status:string;method:string;nodes:number;reason:string;exact:boolean};
}
