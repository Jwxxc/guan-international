import { createRng } from '../engine/cards';
import { computeStrategy } from './strategies';
import type { AiObservation } from './types';
import type { StrategyDescriptor } from './strategyTypes';
import {computeNativeDanlm} from './pro/native';
import {isNativeDanlmStrategy} from './pro/nativeInfo';
import {installJwxxcModel,pinJwxxcHandle} from './jwxxc/modelAdapter';
import {sameJwxxcSnapshot,type BetaSnapshotReference} from './jwxxc/snapshots';

interface Request { requestId: string; observation: AiObservation; descriptor: StrategyDescriptor; decisionSeed: number; jwxxcModel?:{reference:BetaSnapshotReference;payload:unknown} }
self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  let release:(()=>void)|undefined;
  try {
    const ref=request.descriptor.stamp.modelRef;
    if(request.jwxxcModel){if(!ref||!sameJwxxcSnapshot(ref,request.jwxxcModel.reference))throw Error('JWXXC_WORKER_BOUND_REFERENCE_MISMATCH');installJwxxcModel(ref,request.jwxxcModel.payload);}
    if(ref)release=pinJwxxcHandle(ref);
    const result = isNativeDanlmStrategy(request.descriptor.id)
      ? await computeNativeDanlm(request.observation,request.descriptor,request.requestId)
      : computeStrategy(request.observation, request.descriptor, createRng(request.decisionSeed), () => performance.now());
    self.postMessage({ requestId: request.requestId, result });
  } catch (error) {
    self.postMessage({ requestId: request.requestId, error: error instanceof Error?error.message.slice(0,300):'计算失败' });
  }finally{release?.();}
};
