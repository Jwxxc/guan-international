// Development-only fixtures are legal, replayable histories, never edited hands.
// The UI calls this module only behind import.meta.env.DEV and ?fixture=.
import { chooseAiAction } from '../ai/policy';
import { createRng, isWild } from '../engine/cards';
import { getLegalMoves } from '../engine/legalMoves';
import { getObservation } from '../engine/observations';
import type { GameAction } from '../engine/types';
import { advanceSavedGame, createSavedGame, type SavedGame } from '../game/persistence';
import powerAiHistory from './fixtures/power-ai.json';
import powerAiEndingHistory from './fixtures/power-ai-ending.json';
import firstHuman from './fixtures/finish-first-human.json';
import firstPartner from './fixtures/finish-first-partner.json';
import firstOpponent from './fixtures/finish-first-opponent.json';
import firstOpponentLeft from './fixtures/finish-first-opponent-left.json';

const cache = new Map<string, SavedGame>();
function advance(saved: SavedGame, action: GameAction): SavedGame {
  const result = advanceSavedGame(saved, action);
  if (!result.ok) throw new Error(result.error);
  return result.saved;
}
export function getFixture(name: string): SavedGame | null {
  if (!import.meta.env.DEV) return null;
  if (cache.has(name)) return structuredClone(cache.get(name)!);
  let saved: SavedGame | null = null;
  const config = { levelRank: 2, sessionId: `fixture-${name}`, handId: `fixture-${name}`, firstPlayer: 0 as const };
  if (name === 'opening') saved = createSavedGame(config, 2026);
  const firstHistories:Record<string,typeof firstHuman|typeof firstPartner|typeof firstOpponent|typeof firstOpponentLeft>={
    'finish-first-human':firstHuman,'finish-first-partner':firstPartner,
    'finish-first-opponent':firstOpponent,'finish-first-opponent-left':firstOpponentLeft,
  };
  if(firstHistories[name]){
    const history=firstHistories[name];saved=createSavedGame(config,history.seed);
    for(const intent of history.actions)saved=advance(saved,{...intent,sessionId:saved.state.sessionId,handId:saved.state.handId,stateVersion:saved.state.stateVersion} as GameAction);
  }
  // Fixed, naturally dealt seeds. Power moves are selected and committed by
  // the browser exactly like ordinary play; no hand contents are rewritten.
  const powerSeeds: Record<string, number> = { 'power-bomb': 1, 'power-straight-flush': 1, 'power-large-bomb': 2, 'power-joker': 77 };
  if (powerSeeds[name]) saved = createSavedGame(config, powerSeeds[name]);
  const responseSeeds: Record<string, number> = {
    'ai-reply-single': 1, 'ai-reply-pair': 1, 'ai-reply-straight': 2,
    'ai-reply-pairs': 7, 'ai-reply-plate': 29,
  };
  if (responseSeeds[name]) saved = createSavedGame(config, responseSeeds[name]);
  if (name === 'power-ai' || name === 'power-ai-ending') {
    // These are fixed legal histories from naturally shuffled deals, replayed
    // through the normal validator. AI tuning must not change the starting
    // position of presentation tests or introduce an old policy into the app.
    const history = name === 'power-ai-ending' ? powerAiEndingHistory : powerAiHistory;
    saved = createSavedGame(config, history.seed);
    for (const intent of history.actions) {
      saved = advance(saved, {
        ...intent, sessionId: saved.state.sessionId, handId: saved.state.handId,
        stateVersion: saved.state.stateVersion,
      } as GameAction);
    }
  }
  if (name === 'four-plays') {
    for (let seed = 1; seed <= 100; seed++) {
      let candidate = createSavedGame(config, seed);
      let complete = true;
      for (const player of [0, 1, 2, 3] as const) {
        const observation = getObservation(candidate.state, player);
        const move = getLegalMoves(observation).filter(play => play.kind === 'single' && play.value < 15).sort((a,b) => a.value-b.value)[0];
        if (!move) { complete = false; break; }
        candidate = advance(candidate, { type: 'play', sessionId: candidate.state.sessionId, handId: candidate.state.handId, stateVersion: candidate.state.stateVersion, player, cardIds: move.cards.map(c => c.id), playKey: move.key });
      }
      if (complete) { saved = candidate; break; }
    }
  }
  if (name === 'ambiguous') {
    for (let seed = 1; seed < 1000; seed++) {
      const candidate = createSavedGame(config, seed);
      const hand = candidate.state.hands[0];
      if (hand.some(c => isWild(c, candidate.state.rules)) && [4, 5, 6, 7].every(rank => hand.some(c => c.rank === rank))) { saved = candidate; break; }
    }
  }
  if (name === 'reply') {
    saved = createSavedGame({ ...config, firstPlayer: 1 }, 2026);
    const obs = getObservation(saved.state, 1);
    const move = getLegalMoves(obs).filter(p => p.kind === 'single').sort((a, b) => a.value - b.value)[0];
    saved = advance(saved, { type: 'play', sessionId: saved.state.sessionId, handId: saved.state.handId, stateVersion: saved.state.stateVersion, player: 1, cardIds: move.cards.map(c => c.id), playKey: move.key });
    for (const player of [2, 3] as const) saved = advance(saved, { type: 'pass', sessionId: saved.state.sessionId, handId: saved.state.handId, stateVersion: saved.state.stateVersion, player });
  }
  if (name === 'endgame' || name === 'completed') {
    search: for (let seed = 1; seed <= 80; seed++) {
      let candidate = createSavedGame(config, seed);
      const rng = createRng(seed + 7000);
      for (let step = 0; step < 500 && !candidate.state.result; step++) {
        const obs = getObservation(candidate.state, candidate.state.currentPlayer);
        const next = advance(candidate, chooseAiAction(obs, getLegalMoves(obs), rng));
        if (next.state.result && candidate.state.currentPlayer === 0) { saved = name === 'completed' ? next : candidate; break search; }
        candidate = next;
      }
    }
  }
  if (saved) cache.set(name, saved);
  return saved;
}
