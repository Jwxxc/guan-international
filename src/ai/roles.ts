import {partnerOf} from '../engine/rules';
import type {Seat} from '../engine/types';
import {isAvailableStrategy,strategyStamp} from './descriptors';
import type {AiTier,SeatPolicies,StrategyId,StrategyStamp} from './strategyTypes';
export interface PolicyAssignment {policy?:StrategyStamp;seatPolicies?:SeatPolicies}
/** New player-facing tiers apply to the whole table. Saved per-seat assignments
 * remain authoritative; retired experiment presets keep their original roles. */
export function roleAssignment(id:StrategyId,perspective:Seat=0):PolicyAssignment{
 const policy=strategyStamp(id);
 if(id==='baseline'||id==='coop-v2'||id==='coop-endgame-v1')return{policy};
 if(id==='balanced-v1'||id==='balanced-attachment-v1'||id==='balanced-plus-v1'||id==='balanced-pro-v1'||id==='pro-danlm-classic-v1'||id==='jwxxc-pro'||id==='jwxxc-model-v1'||id==='jwxxc-search-v1')return{policy,seatPolicies:[strategyStamp(id),strategyStamp(id),strategyStamp(id),strategyStamp(id)]};
 if(id!=='balanced-endgame-v1'&&!id.startsWith('pro-'))throw Error('尚未定义此策略的角色配置');
 const partner=partnerOf(perspective);
 const casual=id==='balanced-endgame-v1'?'coop-endgame-v1':'coop-v2';
 const seatPolicies=([0,1,2,3] as Seat[]).map(seat=>strategyStamp(seat===perspective||seat===partner?casual:id)) as SeatPolicies;
 return{policy,seatPolicies};
}
export const policyForSeat=(assignment:PolicyAssignment,seat:Seat):StrategyStamp=>assignment.seatPolicies?.[seat]??assignment.policy??strategyStamp('baseline');
export const policyForHint=(assignment:PolicyAssignment):StrategyStamp=>assignment.policy??strategyStamp('baseline');
export const isAvailableAssignment=(assignment:PolicyAssignment):boolean=>isAvailableStrategy(assignment.policy)&&(assignment.seatPolicies??[]).every(isAvailableStrategy);
export const hasEndgameFix=(id:StrategyId|undefined):boolean=>id==='coop-endgame-v1'||id==='balanced-endgame-v1';
export function withoutEndgameFix(id:StrategyId):StrategyId{return id==='coop-endgame-v1'?'coop-v2':id==='balanced-endgame-v1'?'balanced-v1':id;}
export function withEndgameFix(id:StrategyId,enabled:boolean):StrategyId{
 if(id.startsWith('pro-'))return id;
 const base=withoutEndgameFix(id);
 if(!enabled)return base;
 if(base==='coop-v2')return'coop-endgame-v1';if(base==='balanced-v1')return'balanced-endgame-v1';
 throw Error('旧版兼容策略不提供残局修复');
}
export function idForTier(tier:AiTier,endgameFix=false):StrategyId{if(tier==='casual')return endgameFix?'coop-endgame-v1':'coop-v2';if(tier==='balanced')return endgameFix?'balanced-endgame-v1':'balanced-attachment-v1';if(tier==='balanced-plus')return'balanced-plus-v1';if(tier==='balanced-pro')return'balanced-pro-v1';if(tier==='jwxxc-pro')return'jwxxc-pro';if(tier==='pro')return'pro-endgame-v1';throw Error('未知电脑档位');}
