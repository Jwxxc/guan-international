import { isWild } from '../../engine/cards';
import { bombTier, canBeat } from '../../engine/compare';
import { getLegalMoves } from '../../engine/legalMoves';
import { getPlayTemplates, resolvePlays, resolveTemplate, templateValue, type PlayTemplate } from '../../engine/patterns';
import type { Card, ResolvedPlay } from '../../engine/types';
import type { CandidateBatch, CandidateBudget, CandidateObservation } from './types';

export const STRATEGIC_CANDIDATE_VERSION = 'structure-candidates-v1';
export const STRATEGIC_CANDIDATE_BUDGET: Readonly<CandidateBudget> = Object.freeze({ maxVariantChecks: 384, maxAdditionalCandidates: 192, maxChoiceNodes: 8192 });
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Publicly identified physical copies must not disappear into suit/rank equivalence. */
export function publiclyKnownOwnIds(observation: CandidateObservation): Set<string> {
  const own = new Set(observation.hand.map(card => card.id));
  return new Set([...(observation.publicTransfers ?? []).map(item => item.card.id), ...(observation.antiTributeEvidence ?? []).map(item => item.card.id)].filter(id => own.has(id)));
}
export function residualSignature(cards: readonly Card[], publicIds: ReadonlySet<string> = new Set()): string {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = publicIds.has(card.id) ? `known:${card.id}` : `${card.rank}:${card.suit}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => order(a,b)).map(([key,count]) => `${key}=${count}`).join('|');
}
export function candidateStructureKey(observation: CandidateObservation, play: ResolvedPlay, publicIds = publiclyKnownOwnIds(observation)): string {
  const used = new Set(play.cards.map(card => card.id));
  // Keep the declared wildcard mapping as well as the effective kind/strength.
  // Only genuinely interchangeable natural copies are compressed.
  return `${play.kind}:${play.size}:${play.value}/${residualSignature(observation.hand.filter(card => !used.has(card.id)),publicIds)}/${play.wildcards.map((wild,index)=>`${publicIds.has(wild.cardId)?wild.cardId:`wild-${index}`}=${wild.rank}${wild.suit}`).join(',')}`;
}
function templateCanRespond(template: PlayTemplate, observation: CandidateObservation): boolean {
  const current = observation.currentPlay;
  if (!current) return true;
  const tier = bombTier(template.kind,template.size), targetTier = bombTier(current.kind,current.size);
  if (tier !== targetTier) return tier > targetTier;
  if (tier) return templateValue(template,observation.rules) > current.value;
  return template.kind === current.kind && template.size === current.size && templateValue(template,observation.rules) > current.value;
}

/** The old provider stays untouched. New representatives are a bounded supplement. */
export function getStrategicCandidates(observation: CandidateObservation, budget: CandidateBudget = STRATEGIC_CANDIDATE_BUDGET): CandidateBatch {
  for (const value of Object.values(budget)) if (!Number.isInteger(value) || value < 0 || value > 100_000) throw Error('候选预算必须为有界非负整数');
  if (observation.hand.length > 27 || new Set(observation.hand.map(card=>card.id)).size !== observation.hand.length) throw Error('候选只能使用自己的至多 27 张实体牌');
  const moves = [...getLegalMoves(observation)];
  const stats: CandidateBatch['stats'] = { version:STRATEGIC_CANDIDATE_VERSION,baseCandidates:moves.length,addedCandidates:0,variantChecks:0,choiceNodes:0,truncatedCandidates:false,allPhysicalPlaysEnumerated:false };
  const batch = { moves,legalPass:!!observation.currentPlay && !observation.isOver,stats };
  if (observation.isOver || !observation.hand.length) return batch;
  const hand = [...observation.hand].sort((a,b)=>order(a.id,b.id));
  const publicIds = publiclyKnownOwnIds(observation);
  const keys = new Set(moves.map(play=>play.key));
  const structures = new Set(moves.map(play=>candidateStructureKey(observation,play,publicIds)));
  // Finishing interpretations are mandatory even at zero optional candidate budget.
  if (hand.length <= 10) for (const play of resolvePlays(hand,observation.rules)) if (canBeat(play,observation.currentPlay,observation.rules) && !keys.has(play.key)) {
    keys.add(play.key);structures.add(candidateStructureKey(observation,play,publicIds));moves.push(play);
  }
  const add = (play: ResolvedPlay) => {
    if (!canBeat(play,observation.currentPlay,observation.rules) || keys.has(play.key)) return;
    const signature = candidateStructureKey(observation,play,publicIds);
    if (structures.has(signature)) return;
    if (stats.addedCandidates >= budget.maxAdditionalCandidates) { stats.truncatedCandidates=true;return; }
    keys.add(play.key);structures.add(signature);moves.push(play);stats.addedCandidates++;
  };
  const withinBudget = () => {
    const ok = stats.variantChecks < budget.maxVariantChecks && stats.choiceNodes < budget.maxChoiceNodes && stats.addedCandidates < budget.maxAdditionalCandidates;
    if (!ok) stats.truncatedCandidates=true;
    return ok;
  };
  // All real single-suit alternatives are cheap and particularly important for wild flushes.
  if (!observation.currentPlay || observation.currentPlay.kind==='single') for (const card of hand) {
    if (!withinBudget()) break;
    stats.variantChecks++;for (const play of resolvePlays([card],observation.rules)) add(play);
  }
  const wilds = hand.filter(card=>isWild(card,observation.rules));
  const byRank = new Map<number,Card[]>();
  for (const card of hand) if (!isWild(card,observation.rules)) byRank.set(card.rank,[...(byRank.get(card.rank)??[]),card]);
  function* select(cards: readonly Card[], count: number): Generator<Card[]> {
    if (!count) { yield [];return; }
    const buckets = new Map<string,Card[]>();
    for (const card of cards) {
      const key = publicIds.has(card.id) ? `known:${card.id}` : `${card.rank}:${card.suit}`;
      buckets.set(key,[...(buckets.get(key)??[]),card]);
    }
    const groups=[...buckets.values()];
    function* visit(index:number, needed:number, chosen:Card[]):Generator<Card[]> {
      if (stats.choiceNodes >= budget.maxChoiceNodes) { stats.truncatedCandidates=true;return; }
      stats.choiceNodes++;
      if (!needed) { yield chosen;return; }
      if (index>=groups.length || groups.slice(index).reduce((n,group)=>n+group.length,0)<needed) return;
      const group=groups[index]!;
      for(let take=Math.min(group.length,needed);take>=0;take--) yield* visit(index+1,needed-take,[...chosen,...group.slice(0,take)]);
    }
    yield* visit(0,count,[]);
  }
  function* realizations(template:PlayTemplate):Generator<Card[]> {
    const requirements=template.counts.map(([rank,count])=>({rank,count,cards:(byRank.get(rank)??[]).filter(card=>!template.suit||card.suit===template.suit)}));
    if (requirements.some(item=>item.rank>=15&&item.cards.length<item.count) || requirements.reduce((n,item)=>n+Math.max(0,item.count-item.cards.length),0)>wilds.length) return;
    function* visit(index:number,usedWilds:number,chosen:Card[]):Generator<Card[]> {
      if(stats.choiceNodes>=budget.maxChoiceNodes){stats.truncatedCandidates=true;return;}
      stats.choiceNodes++;
      if(index===requirements.length){for(const chosenWilds of select(wilds,usedWilds))yield [...chosen,...chosenWilds];return;}
      const item=requirements[index]!, maximum=Math.min(item.count,item.cards.length);
      const minimum=item.rank>=15?item.count:Math.max(0,item.count-(wilds.length-usedWilds));
      // Deliberate wildcard use is considered even when enough natural cards exist.
      for(let natural=maximum;natural>=minimum;natural--)for(const chosenNaturals of select(item.cards,natural))yield* visit(index+1,usedWilds+item.count-natural,[...chosen,...chosenNaturals]);
    }
    yield* visit(0,0,[]);
  }
  // Round robin across templates prevents one full-house/bomb family consuming every optional slot.
  let active=getPlayTemplates().filter(template=>template.size<=hand.length&&templateCanRespond(template,observation)).map(template=>({template,iterator:realizations(template)}));
  while(active.length && withinBudget()){
    const remaining:typeof active=[];
    for(const entry of active){
      if(!withinBudget())break;
      const next=entry.iterator.next();
      if(next.done)continue;
      stats.variantChecks++;
      for(const play of resolveTemplate(next.value,entry.template,observation.rules))add(play);
      remaining.push(entry);
    }
    active=remaining;
  }
  return batch;
}
