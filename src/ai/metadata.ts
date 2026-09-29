import type { PolicyId, PolicyStamp } from './types';

export const DEFAULT_POLICY: PolicyId = 'baseline';
export const POLICY_LABELS: Record<PolicyId, string> = { baseline: '原版 AI', 'coop-v2': 'AI by Astra Pro（试验）' };
export const BASELINE_STAMP: PolicyStamp = { id: 'baseline', version: 'baseline-v0.3-frozen', configHash: '7c06da7a1d80b49c583c9692611241421e4d9bfd29ec170eb6e43c8f878a98c7' };
export const isPolicyId = (value: unknown): value is PolicyId => value === 'baseline' || value === 'coop-v2';
export function readPolicyStamp(value: unknown): PolicyStamp | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw Error('AI 策略记录无效');
  const stamp = value as Record<string, unknown>;
  if (!isPolicyId(stamp.id) || typeof stamp.version !== 'string' || !stamp.version.length || stamp.version.length > 100 || typeof stamp.configHash !== 'string' || !stamp.configHash.length || stamp.configHash.length > 128) throw Error('AI 策略记录无效');
  return { id: stamp.id, version: stamp.version, configHash: stamp.configHash };
}
