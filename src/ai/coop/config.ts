import type { AiBudget } from '../types';
export interface CoopConfig {
  version: string; exactHandLimit: number; branchesPerNode: number; nodesPerLargePlan: number;
  planningWeight: number; weakSingleWeight: number; partnerPass: number; relayBonus: number;
  shortOpponentLead: number; urgentFollow: number; urgentRank: number; acceptWind: number; denyWind: number;
  opponentHeadPressure: number;
}
export const COOP_CONFIG: Readonly<CoopConfig> = Object.freeze({
  version: 'coop-config-v1', exactHandLimit: 10, branchesPerNode: 4, nodesPerLargePlan: 10,
  planningWeight: 12, weakSingleWeight: 2, partnerPass: 26, relayBonus: 24,
  shortOpponentLead: 32, urgentFollow: 34, urgentRank: 1.5, acceptWind: 44, denyWind: 72,
  opponentHeadPressure: 24,
});
export const COOP_BUDGET: Readonly<AiBudget> = Object.freeze({ maxNodes: 256, maxCandidates: 24, maxSubsetChecks: 1536 });
/** Deterministic configuration identity; not a cryptographic integrity claim. */
export function configHash(config: CoopConfig): string {
  const raw = JSON.stringify(Object.fromEntries(Object.keys(config).sort().map(key => [key, config[key as keyof CoopConfig]])));
  let value = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) value = Math.imul(value ^ raw.charCodeAt(i), 0x01000193);
  return `coop-${(value >>> 0).toString(16).padStart(8, '0')}`;
}
export const COOP_CONFIG_HASH = configHash(COOP_CONFIG);
