import { createPracticeGame } from '../engine/reducer';
import type { Card, GameAction, Seat } from '../engine/types';
import { rankName } from '../engine/rules';
import { decodeSavedGame } from '../game/persistence';
import { getReplayStates } from '../game/replay';
import { seatName } from '../game/tableView';
import type { AnalysisBundle, ArchivedDecision } from './model';
import { readArchive } from './storage';

const cardText = (card: Card) => `${({ S: '♠', H: '♥', C: '♣', D: '♦', J: '' })[card.suit]}${card.rank === 15 ? '小王' : card.rank === 16 ? '大王' : rankName(card.rank)} [${card.id}]`;
const cardsText = (cards: Card[]) => cards.map(cardText).join('、') || '无';
const jsonBlock = (value: unknown) => '```json\n' + JSON.stringify(value, null, 2) + '\n```';
const actionText = (action: GameAction, cards: Card[]) => action.type === 'pass' ? '不出' : action.cardIds.map(id => { const card = cards.find(card => card.id === id); return card ? cardText(card) : id; }).join('、');
const timeText = (time?: number | null) => time ? new Date(time).toISOString() : '未记录（不推测历史时间）';
function decisionMarkdown(record: ArchivedDecision): string {
  const { decision, observation } = record;
  const lines = [
    `#### ${record.role === 'bot' ? 'AI 实际决策' : '真人提示（不等于实际出牌）'} · v${record.stateVersion}`,
    `记录时间：${timeText(record.recordedAt)}；座位：${seatName(record.player as Seat)}。`,
    `当时所见手牌：${cardsText(observation.hand)}`,
    `各座余牌：${observation.remainingCounts.join(' / ')}；桌面：${observation.currentPlay?.label ?? '自由领出'}。`,
    `选择：${actionText(decision.action, observation.hand)}`,
    `理由：${decision.explanation}；原因代码：${decision.reasonCodes.join('、') || '无'}。`,
    `策略：${decision.policyVersion}；配置：${decision.configVersion} / ${decision.configHash}；决策随机流：${record.decisionSeed}。`,
    `等待至返回：${record.elapsedMs.toFixed(2)} ms；计算：${record.computeMs.toFixed(2)} ms。`,
    '请求策略、实际策略与降级信息：', jsonBlock(record.identity ?? { status: '旧记录未包含运行身份' }),
    `候选总数：${decision.stats.candidateCount}；评估数：${decision.stats.evaluatedCandidates}；近似计算：${decision.stats.approximate ? '是' : '否'}。`,
    `以下为策略实际返回的 ${decision.topCandidates.length} 个候选；不是全部合法出牌的穷举，也不是事后重算：`,
  ];
  if(decision.balancedProDiagnostics)lines.push('均衡 Pro 实际修订、基础动作、最终来源与结果证明（证明不折算成启发式分数）：',
    jsonBlock({execution:record.execution??'旧记录未单列提交状态',balancedPro:decision.balancedProDiagnostics}));
  decision.topCandidates.forEach((candidate, index) => lines.push(
    `${index + 1}. ${actionText(candidate.action, observation.hand)}；评分 ${candidate.score}；原因 ${candidate.reasonCodes.join('、')}`,
    jsonBlock({ action: candidate.action, features: candidate.features }),
  ));
  lines.push('计算预算、搜索和公开信息诊断：', jsonBlock({ descriptor: record.decisionDescriptor, budget: record.budget, timing: record.timing, stats: decision.stats, candidates: decision.candidateDiagnostics, planner: decision.plannerDiagnostics, knowledge: decision.knowledgeDiagnostics, tacticalCertificate: decision.tacticalCertificate, decisionTier: decision.decisionTier }),
    '当时观测（仅该座手牌和公开事实，公共动作历史见本副逐步记录）：', jsonBlock(observation));
  return lines.join('\n\n');
}
export function analysisMarkdown(bundle: AnalysisBundle): string {
  const { hand, decisions, matchJournal } = bundle;
  const saved = decodeSavedGame(JSON.stringify(hand.saved), true);
  const frames = getReplayStates(saved);
  const bots = saved.actions.filter(action => action.player !== 0);
  const recorded = bots.filter(action => decisions.some(record => record.role === 'bot' && JSON.stringify(record.decision.action) === JSON.stringify(action))).length;
  const lines = [
    '# GUAN 对局与 AI 分析档案',
    `场次：${hand.sessionId}\n\n副 ID：${hand.handId}\n\n玩法：${hand.mode}；第 ${hand.handNumber} 副；级牌：${rankName(saved.state.rules.levelRank)}。`,
    `结算时间：${timeText(hand.completedAt)}\n\n首次归档：${timeText(hand.firstArchivedAt)}\n\n导出：${timeText(bundle.exportedAt)}`,
    '## 记录完整性',
    `实际动作 ${saved.actions.length} 步；AI 出牌/不出 ${bots.length} 步，其中 ${recorded} 步有当时决策实录，${bots.length - recorded} 步缺少当时决策细节；真人提示 ${decisions.filter(record => record.role === 'hint').length} 条。`,
    '出牌过程来自引擎验证过的存档。缺失的旧决策理由、评分和耗时不补造；回放重建手牌不代表重新运行 AI。提示与实际提交分开记录。',
    '本文件为本地模式赛后全信息分析；AI 运行时始终只接收自己的观测。进还贡保存实际命令，未记录的选择理由不推测。',
    '## 规则、策略与结算',
    jsonBlock({ rulesVersion: matchJournal?.rulesVersion ?? saved.rulesVersion, rngVersion: saved.rngVersion, seed: saved.seed, config: saved.config, policy: saved.policy, seatPolicies: saved.seatPolicies, result: saved.state.result }),
    '## 原始发牌（交换前）',
    ...createPracticeGame(saved.config, saved.seed).hands.map((cards, seat) => `${seatName(seat as Seat)}：${cardsText(cards)}`),
    '## 进还贡与开局',
    jsonBlock({ setup: saved.setup ?? null, exchangeActions: matchJournal?.records[hand.handNumber - 1]?.exchangeActions ?? [], tributeEnabled: matchJournal?.tributeEnabled ?? false }),
    ...frames[0].hands.map((cards, seat) => `${seatName(seat as Seat)}开局手牌：${cardsText(cards)}`),
    '## 逐步对局记录',
  ];
  saved.actions.forEach((action, index) => {
    const before = frames[index], after = frames[index + 1], event = after.events.at(-1);
    lines.push(`### 第 ${index + 1} 步 · ${seatName(action.player)} · ${event?.message ?? action.type}`,
      `版本 v${action.stateVersion} → v${after.stateVersion}；提交时间：${timeText(hand.actionTimes[action.stateVersion])}`,
      `动作：${actionText(action, before.hands[action.player])}`,
      `行动前手牌：${cardsText(before.hands[action.player])}`,
      `行动后手牌：${cardsText(after.hands[action.player])}`,
      `各座余牌：${after.hands.map(cards => cards.length).join(' / ')}；下位行动者：${after.result ? '本副结束' : seatName(after.currentPlayer)}。`,
      jsonBlock({ action, event }));
    const linked = decisions.filter(record => record.stateVersion === action.stateVersion && record.player === action.player);
    if (action.player !== 0 && !linked.some(record => record.role === 'bot')) lines.push('AI 决策细节：未记录，无法还原当时理由或耗时。');
    linked.forEach(record => lines.push(decisionMarkdown(record)));
  });
  lines.push('## 结算时余牌', ...saved.state.hands.map((cards, seat) => `${seatName(seat as Seat)}：${cardsText(cards)}`),
    '## 分析提示', '比较实际动作与候选评分，重点检查同一不出基线、同花顺保护、队友配合和对手即将走完时的应对。候选排名是当前启发式评分，不代表最优解证明。配套 JSON 保留可复算的原始动作、配置及截至本副的比赛日志。');
  if(bundle.runtimeAttempts?.records.length)lines.push('## 本次页面中的 Pro 请求状态',
    '这里只保存当前页面有界记录中的请求、计算完成、取消、失效、失败与提交状态；刷新前记录可能缺失。计算完成不等于已提交，正常预算截断不等于运行故障。',jsonBlock(bundle.runtimeAttempts));
  return lines.join('\n\n') + '\n';
}
export { downloadTextFile as downloadAnalysisFile } from '../game/download';
import { downloadTextFile as downloadAnalysisFile } from '../game/download';
export async function exportAnalysis(key: string, format: 'md' | 'json') {
  const bundle = await readArchive(key);
  const filename = `GUAN-对局分析-${bundle.hand.sessionId}-${bundle.hand.handId}`.replace(/[^\p{L}\p{N}._-]/gu, '_');
  downloadAnalysisFile(`${filename}.${format}`, format === 'md' ? analysisMarkdown(bundle) : JSON.stringify(bundle, null, 2), format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json');
}
