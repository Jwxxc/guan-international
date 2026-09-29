import type {StrategyId} from '../ai/strategyTypes';

/** Player-facing choices. Retired implementations remain readable for journals,
 * but cannot accidentally be selected for a new hand through an old preference. */
const PLAYER_TIER_DEFINITIONS=[
 {id:'coop-v2',label:'休闲',order:10,roomTier:'casual',description:'熟悉的原版体验，三个电脑都使用休闲策略。'},
 {id:'balanced-attachment-v1',label:'均衡',order:20,roomTier:'balanced',description:'侧重组合规划，减少把王对当作三带二附件的试验策略；三个电脑统一使用。尚未证实强于休闲。'},
 {id:'balanced-plus-v1',label:'均衡 Plus',order:25,roomTier:'balanced-plus',description:'在均衡基础上加入公开牌推演、团队配合和更完整的残局计算；三个电脑统一使用。独立试验策略，强度以对战评测为准。'},
 {id:'balanced-pro-v1',label:'均衡 Pro',order:30,roomTier:'balanced-pro',description:'在均衡 Plus 基础上探索更充分的公开牌推演、团队配合与残局计算；三个电脑统一使用。独立试验策略，强度以对战评测为准。'},
 {id:'pro-danlm-classic-v1',label:'DanLM',order:40,roomTier:null,description:'已训练的本机模型，支持经典升级和单副；三个电脑都使用 DanLM。'},
] as const;
/** Display numbers never enter saved preferences or the wire protocol. */
export const PLAYER_TIERS=Object.freeze([...PLAYER_TIER_DEFINITIONS].sort((a,b)=>a.order-b.order));
export type PlayerTierId=typeof PLAYER_TIERS[number]['id'];
export function playerTier(id:StrategyId|undefined):PlayerTierId {
 if(id==='balanced-pro-v1')return'balanced-pro-v1';
 if(id==='balanced-plus-v1')return'balanced-plus-v1';
 if(id==='balanced-v1'||id==='balanced-endgame-v1'||id==='balanced-attachment-v1')return'balanced-attachment-v1';
 if(id?.startsWith('pro-'))return'pro-danlm-classic-v1';
 return'coop-v2';
}
export function savedTierLabel(id:StrategyId|undefined):string {
 if(id==='jwxxc-pro')return'Jwxxc Beta';
 if(id==='jwxxc-model-v1'||id==='jwxxc-search-v1')return'Jwxxc Beta（研究配置）';
 if(id==='pro-neural-v1'||id==='pro-endgame-v1'||id==='pro-search-v1')return'旧存档试验策略';
 if(id==='baseline'||!id)return'原版兼容策略';
 if(id==='balanced-v1')return'均衡（旧版）';
 return PLAYER_TIERS.find(t=>t.id===playerTier(id))!.label;
}
