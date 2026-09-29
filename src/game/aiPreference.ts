import type { StrategyId } from '../ai/strategyTypes';

// Release choice for new hands only; separate from the frozen strategy implementation.
// Missing policy metadata in an existing save always means baseline, regardless of this value.
export const DEFAULT_NEW_HAND_POLICY = 'coop-v2' satisfies StrategyId;

/** Removed choices may still exist in old settings; only new deals use this mapping. */
export const newHandPolicy = (id: StrategyId | undefined): Exclude<StrategyId,'baseline'> => id==='balanced-pro-v1'?'balanced-pro-v1':id==='balanced-plus-v1'?'balanced-plus-v1':id === 'balanced-v1'||id === 'balanced-attachment-v1' ? 'balanced-attachment-v1' : id === 'coop-endgame-v1'||id === 'balanced-endgame-v1'||id==='pro-neural-v1'||id==='pro-endgame-v1'||id==='pro-search-v1'||id==='pro-danlm-v1'||id==='pro-danlm-classic-v1' ? id : DEFAULT_NEW_HAND_POLICY;
/** Only future deals adopt the classic-capable DanLM identity. Existing saved
 * practice hands and their replay retain the old v1 stamp byte-for-byte. */
export const newHandPolicyForMode=(id:StrategyId|undefined,mode:'practice'|'match')=>mode==='match'&&id==='pro-danlm-v1'?'pro-danlm-classic-v1':newHandPolicy(id);
