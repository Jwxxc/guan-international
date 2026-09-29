import { isWild, rankStrength } from '../engine/cards';
import { maxDisjointNaturalStraightFlushes } from '../engine/naturalStructures';
import { resolvePlays } from '../engine/patterns';
import { partnerOf, rankName } from '../engine/rules';
import type { Card, ResolvedPlay } from '../engine/types';
import type { StrategyDecision } from '../ai/strategyTypes';
import type { ExchangeObservation } from '../match/types';
import type { TableView } from './tableView';

/** Post-decision facts, not model rationale or a second policy. No hidden hands,
 * new inference, candidate reranking, confidence scores or strength claims. */
export interface HintExplanation { lines: string[] }
type VisibleTable = Pick<TableView, 'myHand' | 'rules' | 'viewerSeat' | 'currentPlay' | 'currentOwner' | 'remainingCounts'>;
const countRank = (cards: readonly Card[], rank: number) => cards.filter(card => card.rank === rank).length;
const ranks = (cards: readonly Card[]) => [...new Set(cards.map(card => card.rank))];
const bombs = new Set(['bomb', 'straightFlush', 'jokerBomb']);
const faceName = (card: Card) => card.rank === 16 ? '大王' : card.rank === 15 ? '小王' : `${({ S: '黑桃', H: '红心', C: '梅花', D: '方块', J: '' })[card.suit]}${rankName(card.rank)}`;
const groupName = (count: number) => count >= 4 ? '炸弹' : count === 3 ? '三张' : '对子';

function straightWindows(cards: readonly Card[]): number {
  const sequence = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], present = new Set(cards.map(card => card.rank));
  let windows = 0;
  for (let i = 0; i <= sequence.length - 5; i++) if (sequence.slice(i, i + 5).every(rank => present.has(rank))) windows++;
  return windows;
}
/** Describe concrete changes, including costs when the model breaks a group. */
function structureChange(before: readonly Card[], after: readonly Card[], played?: ResolvedPlay): string | undefined {
  const flushBefore = maxDisjointNaturalStraightFlushes(before), flushAfter = maxDisjointNaturalStraightFlushes(after);
  if (flushAfter < flushBefore && played?.kind !== 'straightFlush') return '这一步会拆开现成的同花顺，后面会少一种强力接牌的选择。';
  const splitBomb = ranks(before).find(rank => rank < 15 && countRank(before, rank) >= 4 && countRank(after, rank) > 0 && countRank(after, rank) < countRank(before, rank));
  if (splitBomb !== undefined && played?.kind === 'bomb') return `这次没有把${rankName(splitBomb)}的同点牌全部打出，留下的${countRank(after, splitBomb)}张还需要再处理。`;
  if (splitBomb !== undefined) return countRank(after, splitBomb) >= 4
    ? `${rankName(splitBomb)}这组炸弹还在，但张数变少了，威力也会降低。`
    : `需要留意：这一步会拆开${rankName(splitBomb)}的炸弹，换来眼前这次处理手牌的机会。`;
  if (before.filter(card => card.suit === 'J').length === 4 && after.filter(card => card.suit === 'J').length < 4 && played?.kind !== 'jokerBomb') return '这一步会拆开四王炸，之后就不能再把四张王一起出了。';
  const splitGroup = ranks(before).find(rank => [2, 3].includes(countRank(before, rank)) && countRank(after, rank) > 0 && countRank(after, rank) < countRank(before, rank));
  if (splitGroup !== undefined) return `这一步会拆开${rankName(splitGroup)}的${groupName(countRank(before, splitGroup))}；留下的同点牌需要重新安排。`;
  if (straightWindows(after) < straightWindows(before) && played?.kind !== 'straight') return '这一步会拆开原本能连成顺子的牌，之后需要重新搭配。';
  if (flushAfter > 0) return '手里现成的同花顺仍然保留着，后面还可以用来压牌。';
  const preservedBomb = ranks(after).find(rank => rank < 15 && countRank(after, rank) >= 4 && countRank(after, rank) === countRank(before, rank));
  if (preservedBomb !== undefined) return `${rankName(preservedBomb)}的炸弹完整保留下来，后面仍有一手较强的接牌选择。`;
  if (ranks(after).some(rank => countRank(after, rank) >= 2)) return '其他同点数的组合没有被拆开，后面还能继续成组地出。';
  return undefined;
}

export function explainPlayHint(view: VisibleTable, decision: StrategyDecision): HintExplanation | undefined {
  const action = decision.action, hand = view.myHand;
  const partner = partnerOf(view.viewerSeat), partnerLeading = view.currentOwner === partner;
  if (action.type === 'pass') {
    if (decision.proDiagnostics?.candidatesComplete && decision.stats.candidateCount === 1) return { lines: ['目前没有能压过桌面这手牌的合法出法，这一轮需要不出。', '手里的牌保持不变，等下一次轮到你时再处理。'] };
    const lines = [partnerLeading
      ? '目前是对家在上手。不接牌可以让对家继续保持本轮领先，也省下自己的一手牌。'
      : '这次先不接，保留手里的牌和组合；代价是对手仍然领先这一轮。'];
    if (partnerLeading) lines.push(view.remainingCounts[partner] === 0
      ? '对家已经出完；如果其他人也不接，这轮结束后会由你接风领出。'
      : '如果其他人也不接，这轮结束后会由对家继续领出。');
    else if (decision.topCandidates.some(candidate => candidate.action.type === 'play' && resolvePlays(hand.filter(card => candidate.action.type === 'play' && candidate.action.cardIds.includes(card.id)), view.rules).some(play => candidate.action.type === 'play' && play.key === candidate.action.playKey && bombs.has(play.kind)))) lines.push('可选的接法中包括炸弹；现在不接，能把这样的强牌留到后面。');
    else lines.push('这只是这一轮不出，之后有人再出牌，轮到你时仍然可以接。');
    return { lines };
  }
  const picked = hand.filter(card => action.cardIds.includes(card.id));
  const play = resolvePlays(picked, view.rules).find(play => play.key === action.playKey);
  if (!play || picked.length !== action.cardIds.length) return undefined;
  const remaining = hand.filter(card => !action.cardIds.includes(card.id));
  if (!remaining.length) return { lines: [`这手${play.label}能把你剩下的牌一次出完，直接完成自己的出牌。`, '因此这一步不用再为自己保留后续牌型。'] };
  const lines: string[] = [];
  if (view.currentPlay) lines.push(partnerLeading
    ? `这手可以压过对家的${view.currentPlay.label}，继续减少自己的手牌；同时会接过本轮的领先位置。`
    : `这手可以压过桌面的${view.currentPlay.label}，让本轮暂时由你领先。`);
  else if (play.kind === 'single') lines.push(rankStrength(picked[0].rank, view.rules) <= 10 && remaining.some(card => rankStrength(card.rank, view.rules) > rankStrength(picked[0].rank, view.rules))
    ? '先处理较小的单张，把较大的牌留着，后面遇到单张时还有接牌的余地。'
    : '这轮由你领出，先走一张牌；接下来其他人需要出更大的单张，或使用炸弹。');
  else lines.push(`用${play.label}一次送走${picked.length}张，手里还剩${remaining.length}张。`);
  const structure = structureChange(hand, remaining, play);
  if (structure) lines.push(structure);
  const wildUsed = picked.filter(card => isWild(card, view.rules)).length;
  const shortOpponent = ([0, 1, 2, 3] as const).find(seat => seat !== view.viewerSeat && seat !== partner && view.remainingCounts[seat] > 0 && view.remainingCounts[seat] <= 2);
  if (wildUsed) lines.push(`这次会用掉${wildUsed}张逢人配，后面灵活补牌的余地会减少。`);
  else if (shortOpponent !== undefined && !bombs.has(play.kind) && picked.length > view.remainingCounts[shortOpponent]) lines.push(`有对手只剩${view.remainingCounts[shortOpponent]}张，这种${picked.length}张的牌型让它无法直接跟上。`);
  else if (play.kind === 'jokerBomb') lines.push('四王炸是本版最大的炸弹，别人无法再压；这四张王也会一次用掉。');
  else if (bombs.has(play.kind)) lines.push('炸弹能用来压制这一轮，但用过就少一手强牌；本轮也仍可能被更大的炸弹接住。');
  else if (!view.currentPlay && play.kind !== 'single') lines.push('先出成组的牌，可以避免立刻进入逐张比大小的单张回合。');
  return { lines: lines.slice(0, 3) };
}

export function explainExchangeHint(obs: ExchangeObservation, cardId: string): HintExplanation | undefined {
  const card = obs.hand.find(card => card.id === cardId && obs.eligibleCardIds.includes(card.id));
  if (!card || obs.phase === 'done') return undefined;
  const eligible = obs.hand.filter(card => obs.eligibleCardIds.includes(card.id));
  if (obs.phase === 'tribute' && eligible.length === 1) return { lines: ['进贡必须送最大的非逢人配牌。你只有这一张符合条件，不能改送更小的牌。', '这一步主要由进贡规则决定，确认后才能继续交换。'] };
  if (obs.phase === 'tribute' && eligible.every(other => other.rank === card.rank && other.suit === card.suit)) return { lines: ['可进贡的几张牌牌面相同，都是最大的非逢人配牌。', '送出其中任何一张，留下的牌面组合都一样；这里为你选中了一个实际牌张。'] };
  const incoming = (obs.publicTransfers ?? []).filter(t => t.type === 'tribute' && t.to === obs.player).map(t => t.card);
  const before = [...obs.hand, ...incoming], after = before.filter(item => item.id !== cardId);
  const lines = [obs.phase === 'tribute'
    ? '这几张都属于最大的非逢人配牌，区别主要在花色，以及送出后能保留哪些组合。'
    : obs.returnRule === 'fallback'
      ? '手里没有可正常还出的2—10非级牌，必须按规则从最小的非级普通牌中选。'
      : `${faceName(card)}在允许还出的范围内，这次用它完成交换。`];
  const structure = structureChange(before, after);
  if (structure) lines.push(structure);
  const completed = incoming.find(item => countRank(obs.hand, item.rank) < 4 && countRank(after, item.rank) >= 4);
  if (obs.phase === 'return' && completed) lines.push(`收到的${faceName(completed)}能把手里的${rankName(completed.rank)}凑成炸弹，这张还牌能把它保留下来。`);
  else if (obs.phase === 'return' && countRank(before, card.rank) === 1) lines.push(card.rank === Math.min(...eligible.map(item => item.rank))
    ? '它是可还牌中最小的点数，也没有同点搭子，送出后能少留一张单独的牌。'
    : '这张没有同点搭子，送出它不会把同点数的对子或三张拆开。');
  else if (obs.phase === 'return') lines.push('还出的牌会交给进贡给你的那位玩家；后续出牌时，要记得这张牌在那位玩家手里。');
  return { lines: lines.slice(0, 3) };
}
