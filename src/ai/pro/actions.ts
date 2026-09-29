import { isWild } from '../../engine/cards';
import { canBeat } from '../../engine/compare';
import { getPlayTemplates, resolvePlays, resolveTemplate } from '../../engine/patterns';
import type { Card, GameAction, PlayerObservation, ResolvedPlay } from '../../engine/types';

export interface ProLegalAction { id: string; action: GameAction; play: ResolvedPlay | null }
export type ProCandidate = ProLegalAction;
export interface ProActionBudget { maxWork: number; maxActions: number }
export interface ProActionEnumeration {
  actions: ProLegalAction[];
  complete: boolean;
  work: number;
  reason?: 'action-work-budget' | 'action-count-budget';
}
export const PRO_ACTION_VERSION = 'physical-template-enumeration-v1';
export const PRO_CANDIDATE_VERSION = PRO_ACTION_VERSION;
export const PRO_ACTION_BUDGET: Readonly<ProActionBudget> = Object.freeze({ maxWork: 200_000, maxActions: 40_000 });

/** Complete GUAN semantic declarations, including all physical/suit choices. A limit
 * ends enumeration explicitly; callers must never use an incomplete list as proof.
 * This enumerates feasible template combinations rather than all 2^27 subsets. */
export function enumerateProActions(observation: PlayerObservation, limits: Partial<ProActionBudget> = {}): ProActionEnumeration {
  const budget = { ...PRO_ACTION_BUDGET, ...limits };
  if (Object.values(budget).some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('Invalid PRO action budget');
  const output: ProActionEnumeration = { actions: [], complete: true, work: 0 };
  if (observation.isOver || observation.currentPlayer !== observation.player || !observation.hand.length) return output;
  const stamp = { sessionId: observation.sessionId, handId: observation.handId, stateVersion: observation.stateVersion, player: observation.player };
  const seen = new Set<string>();
  const stop = (reason: NonNullable<ProActionEnumeration['reason']>) => { output.complete = false; output.reason = reason; };
  const tick = () => {
    if (!output.complete) return false;
    if (output.work >= budget.maxWork) { stop('action-work-budget'); return false; }
    output.work++; return true;
  };
  const add = (play: ResolvedPlay | null) => {
    if (!output.complete || (play && !canBeat(play, observation.currentPlay, observation.rules))) return;
    const id = play?.key ?? 'pass';
    if (seen.has(id)) return;
    if (output.actions.length >= budget.maxActions) { stop('action-count-budget'); return; }
    seen.add(id);
    output.actions.push({ id, play, action: play
      ? { ...stamp, type: 'play', cardIds: play.cards.map(card => card.id), playKey: play.key }
      : { ...stamp, type: 'pass' } });
  };
  const choose = (cards: Card[], count: number, accept: (chosen: Card[]) => void, index = 0, chosen: Card[] = []): void => {
    if (!tick()) return;
    if (chosen.length === count) { accept(chosen); return; }
    for (let i = index; i <= cards.length - (count - chosen.length) && output.complete; i++) {
      choose(cards, count, accept, i + 1, [...chosen, cards[i]!]);
    }
  };
  if (observation.currentPlay) add(null);
  const hand = [...observation.hand].sort((a, b) => a.id.localeCompare(b.id));
  for (const card of hand) { if (!tick()) break; for (const play of resolvePlays([card], observation.rules)) add(play); }
  const wilds = hand.filter(card => isWild(card, observation.rules));
  const fixed = hand.filter(card => !isWild(card, observation.rules));
  for (const template of getPlayTemplates()) {
    if (!output.complete) break;
    if (template.size > hand.length) continue;
    const groups = template.counts.map(([rank, count]) => ({ rank, count, cards: fixed.filter(card => card.rank === rank && (!template.suit || card.suit === template.suit)) }));
    const visit = (index: number, selected: Card[], deficit: number): void => {
      if (!tick()) return;
      if (index === groups.length) {
        choose(wilds, deficit, selectedWilds => {
          for (const play of resolveTemplate([...selected, ...selectedWilds], template, observation.rules)) add(play);
        });
        return;
      }
      const group = groups[index]!;
      // Jokers may never be substituted by a heart-level wildcard.
      const minimum = group.rank >= 15 ? group.count : Math.max(0, group.count - (wilds.length - deficit));
      for (let count = minimum; count <= Math.min(group.count, group.cards.length) && output.complete; count++) {
        choose(group.cards, count, chosen => visit(index + 1, [...selected, ...chosen], deficit + group.count - count));
      }
    };
    visit(0, [], 0);
  }
  output.actions.sort((a, b) => a.id.localeCompare(b.id));
  return output;
}
