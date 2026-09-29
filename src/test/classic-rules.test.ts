import { describe, expect, it } from 'vitest';
import { createDeck, isWild, rankStrength } from '../engine/cards';
import { createPracticeGame } from '../engine/reducer';
import { nextSeatOf, partnerOf, previousSeatOf, SEATS } from '../engine/rules';
import type { Card, GameResult, GameState, Seat } from '../engine/types';
import { applyExchangeAction, chooseExchangeAction, createExchange, finishExchangeGame, getEligibleExchangeCards, getExchangeObservation } from '../match/exchange';
import { chooseExchangeAction as legacyChoose, createExchange as legacyCreate } from '../match/legacyExchange';
import { createMatchProgress, getMatchLevel, settleMatchProgress } from '../match/progression';
import { CLASSIC_RULES_VERSION, type ExchangeAction, type ExchangeState, type MatchProgress } from '../match/types';

const seats: Seat[] = SEATS.map(seat => seat.id);
function result(order: Seat[]): GameResult {
  return { winningTeam: order[0] % 2 as 0 | 1, order, doubleUp: order.length === 2,
    last: order.length === 2 ? null : order[3], doubleDown: order.length === 2 ? seats.filter(seat => !order.includes(seat)) : [] };
}
/** Real deck fixtures always fill all four 27-card hands, preserving physical IDs. */
function deal(forced: Partial<Record<Seat, string[]>> = {}, allowed: Partial<Record<Seat, (card: Card) => boolean>> = {}, levelRank = 2): GameState {
  const deck = createDeck(); const used = new Set<string>();
  const hands = seats.map(seat => (forced[seat] ?? []).map(id => {
    const card = deck.find(item => item.id === id);
    if (!card || used.has(id)) throw Error(`Invalid fixture ${id}`);
    used.add(id); return card;
  }));
  for (const seat of [...seats].sort((a, b) => Number(Boolean(allowed[b])) - Number(Boolean(allowed[a])))) {
    for (const card of deck) if (hands[seat].length < 27 && !used.has(card.id) && (!allowed[seat] || allowed[seat]!(card))) { hands[seat].push(card); used.add(card.id); }
    if (hands[seat].length !== 27) throw Error(`Cannot fill seat ${seat}`);
  }
  return { ...createPracticeGame({ sessionId: 'classic-test', handId: 'fresh-hand', levelRank, firstPlayer: 0 }, 1), hands };
}
const fresh = (game = deal({ 0: ['0-J-16'], 1: ['1-J-16'] }), order: Seat[] = [0, 1, 2, 3]) => createExchange(game, result(order), CLASSIC_RULES_VERSION);
function act(exchange: ExchangeState, cardId?: string): ExchangeState {
  const action = chooseExchangeAction(getExchangeObservation(exchange, exchange.currentPlayer!));
  const out = applyExchangeAction(exchange, cardId ? { ...action, cardId } : action);
  if (!out.ok) throw Error(out.error); return out.exchange;
}
function finish(exchange: ExchangeState): ExchangeState {
  for (let step = 0; step < 4 && exchange.phase !== 'done'; step++) exchange = act(exchange);
  expect(exchange.phase).toBe('done'); return exchange;
}
function conserved(exchange: ExchangeState) {
  expect(exchange.hands.map(hand => hand.length)).toEqual([27, 27, 27, 27]);
  expect(exchange.hands.flat().map(card => card.id).sort()).toEqual(createDeck().map(card => card.id).sort());
}
function settle(progress: MatchProgress, order: Seat[], handId: string): MatchProgress {
  const out = settleMatchProgress(progress, { ...createPracticeGame({ levelRank: getMatchLevel(progress), handId }, 1), result: result(order) });
  if (!out.ok) throw Error(out.error); return out.progress;
}

describe('classic progression follows the frozen contract independently of legacy exchanges', () => {
  it.each([{ order: [0, 2], steps: 3 }, { order: [0, 1, 2, 3], steps: 2 }, { order: [0, 1, 3, 2], steps: 1 }])('advances $steps from the winning team own level', ({ order, steps }) => {
    const start = createMatchProgress(CLASSIC_RULES_VERSION); const next = settle(start, order as Seat[], 'one');
    expect(next.version).toBe(CLASSIC_RULES_VERSION); expect(next.teamLevels).toEqual([2 + steps, 2]);
    const swap = settle(next, [1, 0, 3, 2], 'two'); expect(swap.teamLevels).toEqual([2 + steps, 4]); expect(getMatchLevel(swap)).toBe(4);
    expect(start.teamLevels).toEqual([2, 2]);
  });
  it.each([11, 12, 13])('caps %i at A without granting an early match win', level => {
    const start = { ...createMatchProgress(CLASSIC_RULES_VERSION), teamLevels: [level, 2] as [number, number], activeTeam: 0 as const };
    const next = settle(start, [0, 2], 'reach-a'); expect(next.teamLevels[0]).toBe(14); expect(next.winner).toBeNull();
  });
  it('requires an already A team, a shared A hand, and partner second/third; duplicate settlement rejects', () => {
    const start = { ...createMatchProgress(CLASSIC_RULES_VERSION), teamLevels: [14, 5] as [number, number], activeTeam: 1 as const };
    const regain = settle(start, [0, 2], 'lower'); expect(regain.winner).toBeNull();
    const failed = settle(regain, [0, 1, 3, 2], 'failed'); expect(failed.winner).toBeNull();
    const won = settle(failed, [0, 1, 2, 3], 'won'); expect(won.winner).toBe(0);
    expect(settleMatchProgress(won, { ...createPracticeGame({ levelRank: 14, handId: 'won' }, 1), result: result([0, 2]) }).ok).toBe(false);
    const both = { ...start, teamLevels: [14, 14] as [number, number] }; expect(settle(both, [1, 3], 'both').winner).toBe(1);
  });
});

describe('classic tribute mapping, candidates and public anti-tribute evidence', () => {
  it.each(seats)('equal double tribute uses the upstream seat of head %i', head => {
    const partner = partnerOf(head); const upstream = previousSeatOf(head); const downstream = nextSeatOf(head);
    const game = deal({ [head]: ['0-J-16'], [partner]: ['1-J-16'], [upstream]: ['0-J-15'], [downstream]: ['1-J-15'] });
    let exchange = fresh(game, [head, partner]);
    expect(exchange.previous.doubleDown).toEqual(seats.filter(seat => seat !== head && seat !== partner));
    exchange = act(act(exchange));
    expect(exchange.tributePairs?.map(t => [t.from, t.to]).sort()).toEqual([[upstream, head], [downstream, partner]].sort());
    expect(exchange.firstPlayer).toBe(upstream); expect(exchange.hands).toEqual(game.hands);
    expect(finish(exchange).transfers.filter(t => t.type === 'return').map(t => [t.from, t.to])).toEqual([[head, upstream], [partner, downstream]]);
  });
  it('unequal tribute sends higher to head and uses that actual donor as leader', () => {
    let exchange = fresh(deal({ 0: ['0-J-16'], 3: ['1-J-16'], 1: ['0-J-15'] }, { 1: c => c.rank !== 16 }), [0, 2]);
    exchange = act(act(exchange));
    expect(exchange.tributePairs?.map(t => [t.from, t.to, t.card.rank])).toEqual([[3, 0, 16], [1, 2, 15]]);
    expect(exchange.firstPlayer).toBe(3); conserved(exchange);
  });
  it('single tribute still applies when head and last are teammates', () => {
    const exchange = finish(fresh(undefined, [0, 1, 3, 2]));
    expect(exchange.transfers.map(t => [t.from, t.to])).toEqual([[2, 0], [0, 2]]); expect(exchange.firstPlayer).toBe(2);
  });
  it('uses the new level, excludes only heart-level wildcards from maximum tribute, and allows all equal entities', () => {
    const game = deal({ 0: ['0-J-16'], 1: ['1-J-16'], 2: ['0-J-15', '1-J-15'], 3: ['0-H-7', '1-H-7', '0-S-7', '1-S-7', '0-C-2'] }, {}, 7);
    const exchange = fresh(game); const eligible = getEligibleExchangeCards(exchange);
    expect(eligible.some(c => c.id === '0-S-7')).toBe(true); expect(eligible.some(c => c.id === '1-S-7')).toBe(true);
    expect(eligible.every(c => c.rank === 7 && !isWild(c, game.rules))).toBe(true);
    const valid = chooseExchangeAction(getExchangeObservation(exchange, 3));
    expect(applyExchangeAction(exchange, { ...valid, cardId: '0-C-2' }).ok).toBe(false);
    expect(applyExchangeAction(exchange, { ...valid, cardId: '0-H-7' }).ok).toBe(false);
    for (const card of eligible) expect(applyExchangeAction(exchange, { ...valid, cardId: card.id }).ok).toBe(true);
  });
  it.each([
    { order: [0, 1, 2, 3], forced: { 3: ['0-J-16', '1-J-16'] }, owners: [3, 3] },
    { order: [0, 2], forced: { 1: ['0-J-16'], 3: ['1-J-16'] }, owners: [1, 3] },
    { order: [2, 0], forced: { 1: ['0-J-16', '1-J-16'] }, owners: [1, 1] },
  ])('automatically cancels the entire exchange for valid anti-tribute $owners', ({ order, forced, owners }) => {
    const game = deal(forced); const exchange = fresh(game, order as Seat[]); const observation = getExchangeObservation(exchange, 0);
    expect(exchange.phase).toBe('done'); expect(exchange.antiTribute).toBe(true); expect(exchange.firstPlayer).toBe(order[0]);
    expect(observation.antiTributeEvidence?.map(e => e.player).sort()).toEqual(owners);
    expect(observation.antiTributeEvidence?.map(e => e.card.id).sort()).toEqual(['0-J-16', '1-J-16']);
    expect(observation.publicTransfers).toEqual([]); expect(exchange.hands).toEqual(game.hands); conserved(exchange);
  });
  it('single anti-tribute ignores a non-donor partner joker, and wilds do not substitute', () => {
    const exchange = fresh(deal({ 1: ['0-J-16'], 3: ['1-J-16', '0-H-2', '1-H-2'] }));
    expect(exchange.antiTribute).toBe(false); expect(getExchangeObservation(exchange, 0).antiTributeEvidence).toEqual([]);
  });
  it('rejects forged public anti-tribute card faces even when their IDs match', () => {
    const game = deal({ 3: ['0-J-16', '1-J-16'] }); const exchange = fresh(game);
    exchange.antiTributeEvidence![0].card.rank = 15;
    expect(() => finishExchangeGame(game, exchange)).toThrow();
  });
});

describe('classic original-hand returns and atomic exchange', () => {
  it('keeps all original hands until the last return, then exchanges exactly once', () => {
    const game = deal({ 0: ['0-J-16'], 2: ['1-J-16'], 1: ['0-J-15'], 3: ['1-J-15'] });
    let exchange = fresh(game, [0, 2]); const snapshots = [exchange];
    while (exchange.phase !== 'done') { const before = structuredClone(exchange); exchange = act(exchange); expect(snapshots.at(-1)).toEqual(before); snapshots.push(exchange); conserved(exchange); }
    for (const pending of snapshots.slice(0, -1)) { expect(pending.hands).toEqual(game.hands); expect(pending.transfers).toEqual([]); }
    expect(exchange.transfers).toHaveLength(4); expect(new Set(exchange.transfers.map(t => t.card.id)).size).toBe(4);
    for (const transfer of exchange.transfers) { expect(exchange.hands[transfer.to].some(c => c.id === transfer.card.id)).toBe(true); expect(exchange.hands[transfer.from].some(c => c.id === transfer.card.id)).toBe(false); }
    const ready = finishExchangeGame(game, exchange); expect(ready.hands).toEqual(exchange.hands); expect(ready.currentPlayer).toBe(3);
    expect(ready.events).toEqual([]); expect(ready.stateVersion).toBe(0);
    const repeated = { sessionId: exchange.sessionId, handId: exchange.handId, stateVersion: exchange.stateVersion - 1, player: 2 as Seat, type: 'return' as const, cardId: exchange.returnOffers[1].card.id };
    expect(applyExchangeAction(exchange, repeated).ok).toBe(false);
  });
  it('return candidates are original natural 2–10 excluding every level card, joker and A', () => {
    const game = deal({ 0: ['0-H-5', '0-S-5', '0-C-10', '0-J-16', '0-C-14'], 1: ['1-J-16'] }, {}, 5);
    const exchange = act(fresh(game)); const observation = getExchangeObservation(exchange, 0);
    expect(observation.hand).toEqual(game.hands[0]); expect(observation.returnRule).toBe('normal');
    const eligible = getEligibleExchangeCards(exchange);
    expect(eligible.every(c => c.rank >= 2 && c.rank <= 10 && c.rank !== 5)).toBe(true);
    expect(eligible.some(c => c.id === '0-C-10')).toBe(true);
    const incoming = exchange.tributePairs![0].card.id;
    expect(observation.hand.some(c => c.id === incoming)).toBe(false); expect(observation.eligibleCardIds).not.toContain(incoming);
    expect(applyExchangeAction(exchange, { ...chooseExchangeAction(observation), cardId: incoming }).ok).toBe(false);
  });
  it('no normal return falls back to the lowest natural ordinary non-level rank only', () => {
    const game = deal({ 0: ['0-H-7', '0-S-7', '0-C-11', '1-C-11', '0-J-16'], 1: ['1-J-16'], 3: ['0-J-15'] }, { 0: c => c.rank === 7 || c.rank >= 11 }, 7);
    const exchange = act(fresh(game)); const eligible = getEligibleExchangeCards(exchange);
    expect(getExchangeObservation(exchange, 0).returnRule).toBe('fallback');
    expect(eligible.every(c => c.rank === 11)).toBe(true); expect(eligible.length).toBeGreaterThan(1); conserved(finish(exchange));
  });
  it('rejects wrong phase, stale identity, foreign or duplicate pending cards without changing any hand', () => {
    const exchange = fresh(); const before = structuredClone(exchange); const valid = chooseExchangeAction(getExchangeObservation(exchange, exchange.currentPlayer!));
    for (const action of [{ ...valid, handId: 'old' }, { ...valid, sessionId: 'old' }, { ...valid, stateVersion: 999 }, { ...valid, type: 'return' as const }, { ...valid, player: 0 as Seat }, { ...valid, cardId: exchange.hands[0][0].id }]) expect(applyExchangeAction(exchange, action).ok).toBe(false);
    expect(exchange).toEqual(before);
    const after = act(exchange); expect(applyExchangeAction(after, valid).ok).toBe(false);
    const damaged = structuredClone(after); damaged.offers[0].card = damaged.hands[0][0];
    expect(applyExchangeAction(damaged, chooseExchangeAction(getExchangeObservation(after, 0))).ok).toBe(false);
    expect(() => finishExchangeGame(deal(), after)).toThrow();
  });
  it('rejects invalid or forged decks and a completed exchange attached to another original deal', () => {
    const game = deal(); game.hands[0][0] = game.hands[1][0]; expect(() => fresh(game)).toThrow();
    const original = deal({ 0: ['0-J-16'], 1: ['1-J-16'] }); const done = finish(fresh(original));
    const other = structuredClone(original); [other.hands[0][0], other.hands[1][0]] = [other.hands[1][0], other.hands[0][0]];
    expect(() => finishExchangeGame(other, done)).toThrow();
  });
});

describe('classic exchange observation isolation and legal-only policy', () => {
  it('hides the first double tribute and pending return from other observers', () => {
    let exchange = fresh(deal({ 0: ['0-J-16'], 2: ['1-J-16'], 1: ['0-J-15'], 3: ['1-J-15'] }), [0, 2]);
    exchange = act(exchange);
    expect(getExchangeObservation(exchange, 3).publicTransfers).toEqual([]);
    const changedPending = structuredClone(exchange); changedPending.offers[0].card.id = 'hidden-selection-only';
    expect(getExchangeObservation(changedPending, 3)).toEqual(getExchangeObservation(exchange, 3));
    exchange = act(exchange); const beforeReturn = getExchangeObservation(exchange, 2).publicTransfers;
    exchange = act(exchange); const original = getExchangeObservation(exchange, 2);
    expect(original.publicTransfers).toEqual(beforeReturn); expect(original.publicTransfers?.every(t => t.type === 'tribute')).toBe(true);
    const changedReturn = structuredClone(exchange); changedReturn.returnOffers[0].card.id = 'secret-return';
    expect(getExchangeObservation(changedReturn, 2)).toEqual(original);
    expect(chooseExchangeAction(getExchangeObservation(changedReturn, 2))).toEqual(chooseExchangeAction(original));
    expect(getExchangeObservation(finish(exchange), 2).publicTransfers).toHaveLength(4);
  });
  it('swapping hidden cards with unchanged public constraints does not change the own observation or decision', () => {
    const exchange = fresh(); const swapped = structuredClone(exchange);
    [swapped.hands[0], swapped.hands[1]] = [swapped.hands[1], swapped.hands[0]];
    const own = getExchangeObservation(exchange, 3); const changed = getExchangeObservation(swapped, 3);
    expect(changed).toEqual(own); expect(chooseExchangeAction(changed)).toEqual(chooseExchangeAction(own));
    expect(Object.keys(own)).not.toContain('hands'); expect(Object.keys(own)).not.toContain('seed'); expect(Object.keys(own)).not.toContain('offers');
    const before = structuredClone(exchange); own.hand[0].rank = 99; own.previous!.order[0] = 3; expect(exchange).toEqual(before);
  });
  it('preserves a natural straight flush among equal legal tribute entities, compared with frozen legacy policy', () => {
    const game = deal({ 0: ['0-J-16'], 2: ['1-J-16'], 3: ['0-J-15', '1-J-15'], 1: ['0-C-3', '0-C-4', '0-C-5', '0-C-6', '0-C-7', '0-S-7'] }, { 1: c => ['S', 'H', 'D'].includes(c.suit) && [2, 9, 11, 13].includes(c.rank) }, 7);
    const exchange = fresh(game, [0, 3, 2, 1]); const observation = getExchangeObservation(exchange, 1);
    expect(observation.eligibleCardIds.sort()).toEqual(['0-C-7', '0-S-7']);
    expect(legacyChoose(observation).cardId).toBe('0-C-7');
    expect(chooseExchangeAction(observation).cardId).toBe('0-S-7');
    expect(applyExchangeAction(exchange, chooseExchangeAction(observation)).ok).toBe(true);
  });
  it('retains legacy exchange shape and behavior rather than silently changing old logs', () => {
    const game = deal({ 0: ['0-J-16'], 2: ['1-J-16'], 1: ['0-J-15'], 3: ['1-J-15'] });
    const legacy = createExchange(game, result([0, 2])); expect(legacy).toEqual(legacyCreate(game, result([0, 2]))); expect(legacy.rulesVersion).toBeUndefined();
    const oldReturn = act(act(legacy)); expect(oldReturn.hands.map(h => h.length)).toEqual([28, 26, 28, 26]);
    expect(oldReturn.transfers.map(t => [t.from, t.to])).toEqual([[1, 0], [3, 2]]);
  });
});
