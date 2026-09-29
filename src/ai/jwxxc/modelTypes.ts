export interface JwxxcModelWeights{
 schemaVersion:string;modelId:string;encoderVersion:string;objectiveId:string;
 config:{state_dim:number;history_dim:number;action_dim:number;width:number;heads:number;layers:number;ff_width:number;history_limit:number;event_classes:number;layer_norm_eps:number};
 weights:Record<string,number[]|number[][]>;
}
export interface JwxxcModelManifest{
 schemaVersion:string;modelId:string;objective:'round-return';objectiveId:'jwxxc-round-return-v1';encoderVersion:string;
 architecture:JwxxcModelWeights['config'];weightsSha256:string;runtimePayloadSha256:string;checkpointSha256:string;encoderSha256:string;
 runtimeBackend:'typescript-cpu';source:string;license:string;strengthVerified:boolean;encoderParityVerified:boolean;rulesCompatibilityVerified:boolean;informationIsolationVerified:boolean;valueValidatedForTruncation:boolean;
 training:{gradientSteps:number;completedHands:number;completedMatches:number;sampleSteps:number;seed:number;elapsedSeconds:number;initialWeightsSha256:string;trainedWeightsSha256:string;weightDeltaL2:number;[key:string]:unknown};
 [key:string]:unknown;
}
export interface JwxxcModelScores{
 candidateFingerprint:string;modelHash:string;encoderVersion:string;objectiveId:string;actionIds:string[];values:number[];stateValue:number;
 diagnostics:{backend:string;historyTokens:number;candidateCount:number;inferenceMs:number;stateEncodes:1};
}
