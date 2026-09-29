import type { AiObservation } from '../ai/types';
import type {StrategyDecision,StrategyDescriptor,RuntimeStrategyIdentity,StrategyTiming} from '../ai/strategyTypes';
import {resolveStrategy} from '../ai/descriptors';
import { fingerprint } from '../ai/fingerprint';
import { archiveDecision } from '../archive/storage';
import {getProLifecycle} from './aiLifecycle';

export interface DecisionRecord { source: 'recorded-runtime'; role: 'bot' | 'hint'; sessionId: string; handId: string; stateVersion: number; player: number; observationFingerprint: string; elapsedMs: number; computeMs: number; budget: StrategyDescriptor['workBudget']; decision: StrategyDecision; identity?:RuntimeStrategyIdentity;timing?:StrategyTiming; execution?:'submitted'|'hint-presented' }
const records: DecisionRecord[] = [];
const completed = new Set<string>();
let dropped = 0;
/** DEV-only bounded records, no hidden state or observations stored in diagnostics. */
export function recordDecision(obs: AiObservation, decision: StrategyDecision, role: DecisionRecord['role'], elapsedMs: number, computeMs: number, identity?:RuntimeStrategyIdentity, timing?:StrategyTiming): void {
  const record: DecisionRecord = structuredClone({ source: 'recorded-runtime', role, sessionId: obs.sessionId, handId: obs.handId, stateVersion: obs.stateVersion, player: obs.player, observationFingerprint: fingerprint(obs), elapsedMs, computeMs, budget: resolveStrategy(identity?.requested ?? decision.policyVersion).workBudget, decision, ...(identity?{identity}:{}), ...(timing?{timing}:{}),...(decision.policyVersion==='balanced-pro-v1'?{execution:role==='bot'?'submitted':'hint-presented'}:{}) });
  const decisionSeed = role === 'bot' ? ((obs.stateVersion + 1) * 2654435761 + obs.player * 971) >>> 0 : ((obs.stateVersion + 1) * 2246822519 + 0x48494e54) >>> 0;
  archiveDecision(record, obs, decisionSeed);
  if (!import.meta.env.DEV) return;
  records.push(record);
  if (records.length > 320) { records.shift(); dropped++; }
}
export function completeDiagnostics(handId: string): void {
  if (!import.meta.env.DEV) return;
  completed.add(handId);
  if (completed.size > 8) completed.delete(completed.values().next().value!);
}
export function getCompletedDiagnostics(handId: string) {
  if (!completed.has(handId)) throw Error('仅能导出本次运行中已结束的副；恢复前的决策不伪造为实录。');
  const selected = records.filter(record => record.handId === handId);
  return { schema: 'guan-ai-runtime-diagnostics-v1', source: 'recorded-runtime', handId, droppedFromRing: dropped, coverage: '仅本次页面运行中已提交的电脑动作和已显示的真人提示；不是完整回放，也不是事后重算。', records: structuredClone(selected),proLifecycle:getProLifecycle(handId) };
}
export function exportCompletedDiagnostics(handId: string): void {
  const report = getCompletedDiagnostics(handId);
  const markdown = `# GUAN AI 决策实录\n\n${report.coverage}\n\n- 副：${handId}\n- 记录：${report.records.length}\n- 环形缓存累计淘汰：${report.droppedFromRing}\n\n` + report.records.map(record => `- v${record.stateVersion} / ${record.role} / 座位 ${record.player} / ${record.decision.policyVersion} / ${record.elapsedMs.toFixed(1)} ms：${record.decision.explanation}`).join('\n');
  for (const [suffix, value, type] of [['json', JSON.stringify(report, null, 2), 'application/json'], ['md', markdown, 'text/markdown']] as const) {
    const url = URL.createObjectURL(new Blob([value], { type }));
    const link = document.createElement('a'); link.href = url; link.download = `GUAN-AI-${handId}.${suffix}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const canExportDiagnostics = (handId: string): boolean => import.meta.env.DEV && completed.has(handId);
