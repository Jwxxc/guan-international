import { rankStrength } from '../../engine/cards';
import { bombTier } from '../../engine/compare';
import { partnerOf, teamOf } from '../../engine/rules';
import type { GameAction, ResolvedPlay, Rng, Seat } from '../../engine/types';
import { rankAiMoves } from '../evaluation';
import type { AiBudget, AiCandidateDiagnostic, AiDecision, AiObservation } from '../types';
import { COOP_BUDGET, COOP_CONFIG, configHash, type CoopConfig } from './config';
import { createOwnHandPlanner } from './planning';

const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const actionKey = (action: GameAction) => action.type === 'pass' ? '~pass' : action.playKey;
const explanations: Record<string, string> = {
  FINISH_MATCH: '这手可以合法出完，并按当前公开名次满足我方过 A 条件。',
  FINISH_HAND: '这手可以合法出完你剩下的全部手牌。',
  NO_LEGAL_RESPONSE: '当前没有能压过待压牌的合法组合。',
  ACCEPT_WIND: '你是本轮最后的回应者，不出后将由你接风领出。',
  PARTNER_LEAD: '对家当前领先，先保留自己的组合与控制牌。',
  RELAY_SINGLE: '对家只剩一张，领出较小单张尝试接力；其牌面仍未知。',
  LIMIT_SHORT_REPLY: '这组牌可避免给余牌很少的对手直接同型出完的机会。',
  DENY_OPPONENT_WIND: '若现在不出，将给余牌很少的对手接风；这手争取领出权。',
  CONTEST_SHORT_OPPONENT: '对手余牌很少，权衡后用这手争取控制权。',
  CONTEST_SECOND_PLACE: '对方已有头游，接手争取二游，降低双下风险。',
  CONTEST_THIRD_PLACE: '头游和二游已有归属，接手争取三游，改善我方名次。',
  FEWER_GROUPS: '按当前找到的可行分组，这手能减少剩余手牌的组数。',
  PRESERVE_STRUCTURE: '有其他回应会拆开完整组合，这手优先保留它们。',
  KEEP_CONTROL: '这次跟牌需要耗费较重要的组合，先保留控制资源。',
  LEGAL_PLAN: '在合法候选中，综合剩余分组与当前公开局面作出选择。',
};
export function explainCoopReasons(codes: readonly string[]): string {
  return codes.map(code => explanations[code]).find(Boolean) ?? explanations.LEGAL_PLAN;
}

/** Pure, bounded, observation-only policy. No hidden world, storage, clock, or shared private cache. */
export function chooseCoopAction(observation: AiObservation, legalMoves: ResolvedPlay[], config: CoopConfig = COOP_CONFIG,
  rng: Rng = () => 0, budget: AiBudget = COOP_BUDGET): AiDecision {
  if (observation.isOver || observation.currentPlayer !== observation.player || !observation.hand.length) throw Error('策略只能为当前仍在场的行动者决策');
  for (const value of Object.values(budget)) if (!Number.isInteger(value) || value < 0 || value > 100_000) throw Error('策略预算必须为有界非负整数');
  const stamp = { sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion, player: observation.player };
  const playAction = (play: ResolvedPlay): GameAction => ({ ...stamp, type: 'play', cardIds: play.cards.map(card => card.id), playKey: play.key });
  const pass: GameAction = { ...stamp, type: 'pass' };
  const candidates = [...legalMoves].sort((a, b) => lexical(a.key, b.key));
  const finishers = candidates.filter(play => play.cards.length === observation.hand.length);
  const identity = { policyVersion: 'coop-v2' as const, configVersion: config.version, configHash: configHash(config) };
  if (finishers.length) {
    const sorted = finishers.map(play => ({ play, score: 100_000 + bombTier(play.kind, play.size) * 10 + play.value }));
    sorted.sort((a, b) => b.score - a.score || lexical(a.play.key, b.play.key));
    const codes = observation.finishOutcome.passesAce && observation.finishOutcome.winningTeam === observation.team ? ['FINISH_MATCH', 'FINISH_HAND'] : ['FINISH_HAND'];
    const rows = sorted.slice(0, 5).map(({ play, score }) => ({ action: playAction(play), score, reasonCodes: codes,
      features: { finishesHand: true, finishPlace: observation.finishOutcome.place, handEnds: observation.finishOutcome.handEnds,
        winningTeam: observation.finishOutcome.winningTeam, nominalAdvance: observation.finishOutcome.nominalAdvance, passesAce: observation.finishOutcome.passesAce } }));
    return { ...identity, action: rows[0].action, reasonCodes: codes, explanation: explainCoopReasons(codes), topCandidates: rows,
      stats: { nodes: 0, subsetChecks: 0, candidateCount: candidates.length, evaluatedCandidates: 0, approximate: false, budgetExhausted: false } };
  }
  if (!candidates.length) {
    if (!observation.currentPlay) throw Error('空桌必须有合法领出动作');
    return { ...identity, action: pass, reasonCodes: ['NO_LEGAL_RESPONSE'], explanation: explanations.NO_LEGAL_RESPONSE,
      topCandidates: [{ action: pass, score: 0, reasonCodes: ['NO_LEGAL_RESPONSE'], features: { legalResponses: 0 } }],
      stats: { nodes: 0, subsetChecks: 0, candidateCount: 0, evaluatedCandidates: 0, approximate: false, budgetExhausted: false } };
  }
  const base = rankAiMoves(observation, candidates);
  const planner = createOwnHandPlanner(observation, config, budget);
  const before = planner.analyze();
  const ownTeamHasHead = observation.finished.length > 0 && teamOf(observation.finished[0]) === observation.team;
  const partnerLeading = observation.currentOwner === observation.partner;
  const head = observation.finished[0];
  const opposingSurvivor = head !== undefined && teamOf(head) !== observation.team ? partnerOf(head) : null;
  // A known opposing head changes the placement objective. If its partner is
  // already leading with at most five cards, preserving every resource can
  // simply hand back a chance at double-up. This is a risk weight, not a claim
  // that those hidden cards form a finishing combination; never displace our
  // own partner just to apply this bonus.
  const contestSecond = opposingSurvivor !== null && !partnerLeading && observation.currentOwner === opposingSurvivor
    && observation.remainingCounts[opposingSurvivor] > 0 && observation.remainingCounts[opposingSurvivor] <= 5;
  const opponents = ([0, 1, 2, 3] as Seat[]).filter(seat => teamOf(seat) !== observation.team && observation.remainingCounts[seat] > 0);
  const near = opponents.filter(seat => observation.remainingCounts[seat] <= 3);
  const relevantNear = near.filter(seat => !observation.currentPlay || observation.pendingResponders.includes(seat) || observation.currentOwner === seat);
  const oneOpponent = near.some(seat => observation.remainingCounts[seat] === 1);
  const current = observation.currentPlay;
  const sameShapeThreat = !!current && relevantNear.some(seat => observation.remainingCounts[seat] === current.size && current.size <= 3);
  const unbeatableShortTarget = !!current && ['single', 'pair'].includes(current.kind) && current.value === rankStrength(16, observation.rules);
  const urgent = sameShapeThreat && !unbeatableShortTarget;
  const wind = observation.passOutcome;
  const acceptWind = !!current && wind.endsRound && wind.nextLeader === observation.player;
  const denyWind = !!current && wind.endsRound && wind.nextLeader !== null && teamOf(wind.nextLeader) !== observation.team && observation.remainingCounts[wind.nextLeader] > 0 && observation.remainingCounts[wind.nextLeader] <= 2;
  // Secondary search only. Every original legal action still receives a score.
  const selected = new Set<string>();
  const representatives = new Set<string>();
  for (const row of base) {
    const category = `${row.play.kind}:${bombTier(row.play.kind, row.play.size)}`;
    if (!representatives.has(category)) { representatives.add(category); selected.add(row.play.key); }
  }
  for (const row of base) { if (selected.size >= budget.maxCandidates) break; selected.add(row.play.key); }
  // Mandatory representatives may exceed a very small optional search cap; they
  // retain cheap scores but do not consume unbounded secondary evaluations.
  let evaluated = 0;
  const rows: AiCandidateDiagnostic[] = base.map(row => {
    const play = row.play, mask = planner.remainingMask(play);
    const deep = selected.has(play.key) && evaluated < budget.maxCandidates;
    if (deep) evaluated++;
    const after = deep ? planner.analyze(mask) : planner.quick(mask);
    const planning = (before.groupCount - after.groupCount) * config.planningWeight + (before.weakSingles - after.weakSingles) * config.weakSingleWeight;
    const ordinary = bombTier(play.kind, play.size) === 0;
    const limitsShortReply = !current && ordinary && near.some(seat => observation.remainingCounts[seat] < 4 && play.size > observation.remainingCounts[seat]);
    const relay = !current && observation.remainingCounts[observation.partner] === 1 && !oneOpponent && play.kind === 'single' && play.value <= 10;
    const relayScore = relay ? config.relayBonus - play.value * .4 : 0;
    const pressure = urgent ? config.urgentFollow + (play.kind === current?.kind ? play.value * config.urgentRank : 0) : 0;
    const windScore = denyWind ? config.denyWind : acceptWind ? -config.acceptWind : 0;
    const shortShape = limitsShortReply ? config.shortOpponentLead : 0;
    const placementScore = contestSecond ? config.opponentHeadPressure : 0;
    const score = row.score + planning + relayScore + pressure + windScore + shortShape + placementScore;
    const reasons: string[] = [];
    if (denyWind) reasons.push('DENY_OPPONENT_WIND');
    if (urgent) reasons.push('CONTEST_SHORT_OPPONENT');
    if (contestSecond) reasons.push(observation.finished.length === 1 ? 'CONTEST_SECOND_PLACE' : 'CONTEST_THIRD_PLACE');
    if (limitsShortReply) reasons.push('LIMIT_SHORT_REPLY');
    if (relay) reasons.push('RELAY_SINGLE');
    if (row.breakdown?.structureCost === 0 && base.some(other => (other.breakdown?.structureCost ?? 0) > 0)) reasons.push('PRESERVE_STRUCTURE');
    if (after.groupCount < before.groupCount) reasons.push('FEWER_GROUPS');
    if (ownTeamHasHead) reasons.push('TEAM_HAS_HEAD');
    if (!reasons.length) reasons.push('LEGAL_PLAN');
    return { action: playAction(play), score, reasonCodes: reasons, features: {
      baseScore: row.score, planningScore: planning, relayScore, pressureScore: pressure, windScore, shortShapeScore: shortShape, placementScore,
      remainingCards: observation.hand.length - play.cards.length, groupsBefore: before.groupCount, groupsAfter: after.groupCount,
      planExact: after.exact, weakSinglesAfter: after.weakSingles, wildcardsUsed: play.wildcards.length,
      structureCost: row.breakdown?.structureCost ?? 0, partnerLeading, partnerCards: observation.remainingCounts[observation.partner],
      relevantShortOpponents: relevantNear.length, pendingResponders: observation.pendingResponders.length,
      limitsShortReply, ownTeamHasHead, contestSecond, secondarySearch: deep,
    } };
  });
  if (current) {
    const reasons = acceptWind ? ['ACCEPT_WIND'] : partnerLeading ? ['PARTNER_LEAD'] : ['KEEP_CONTROL'];
    let score = partnerLeading ? config.partnerPass : 0;
    if (acceptWind) score += config.acceptWind;
    if (denyWind) score -= config.denyWind;
    if (partnerLeading && urgent) score -= config.urgentFollow * .5;
    rows.push({ action: pass, score, reasonCodes: reasons, features: { partnerLeading, acceptWind, denyWind, relevantShortOpponents: relevantNear.length, pendingResponders: observation.pendingResponders.length } });
  }
  rows.sort((a, b) => b.score - a.score || lexical(actionKey(a.action), actionKey(b.action)));
  const tied = rows.filter(row => Math.abs(row.score - rows[0].score) < .000001);
  let chosen = tied[0];
  if (tied.length > 1) { const sample = rng(); if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw Error('策略随机源无效'); chosen = tied[Math.floor(sample * tied.length)]; }
  const approximate = before.approximate || rows.some(row => row.features.planExact === false);
  return { ...identity, action: chosen.action, reasonCodes: chosen.reasonCodes, explanation: explainCoopReasons(chosen.reasonCodes),
    topCandidates: [chosen, ...rows.filter(row => row !== chosen)].slice(0, 5),
    stats: { nodes: planner.stats.nodes, subsetChecks: planner.stats.subsetChecks, candidateCount: candidates.length, evaluatedCandidates: evaluated,
      approximate, budgetExhausted: planner.stats.exhausted,
      ...(planner.stats.exhausted ? { fallbackReason: 'planning-budget-exhausted: feasible own-hand partition retained' } : {}) } };
}
