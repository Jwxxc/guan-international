import {it,expect} from 'vitest';
import {PLAYER_TIERS,playerTier,savedTierLabel} from '../game/playerTiers';
import {roleAssignment,policyForSeat,policyForHint} from '../ai/roles';
import {strategyStamp} from '../ai/descriptors';
import type {SeatPolicies} from '../ai/strategyTypes';
import {createSavedGame,decodeSavedGame} from '../game/persistence';
import {decodeMatchSession,encodeMatchSession,nextMatchHand,restoreMatchJournal} from '../match/session';
import completed from './fixtures/classic-complete.json';
import {handDifficulty} from '../statistics/difficulty';
it('offers five policies in explicit display order without changing prior identities',()=>{
 expect(PLAYER_TIERS.map(t=>t.label)).toEqual(['休闲','均衡','均衡 Plus','均衡 Pro','DanLM']);
 expect(PLAYER_TIERS.map(t=>t.order)).toEqual([10,20,25,30,40]);
 expect(PLAYER_TIERS.map(t=>t.id)).toEqual(['coop-v2','balanced-attachment-v1','balanced-plus-v1','balanced-pro-v1','pro-danlm-classic-v1']);
 expect(playerTier(undefined)).toBe('coop-v2');expect(playerTier('coop-endgame-v1')).toBe('coop-v2');
 expect(playerTier('balanced-endgame-v1')).toBe('balanced-attachment-v1');
 expect(playerTier('jwxxc-pro')).toBe('coop-v2');expect(savedTierLabel('jwxxc-pro')).toBe('Jwxxc Beta');
 for(const id of ['jwxxc-model-v1','jwxxc-search-v1'] as const){expect(playerTier(id)).toBe('coop-v2');expect(savedTierLabel(id)).toBe('Jwxxc Beta（研究配置）');}
 for(const id of ['pro-neural-v1','pro-endgame-v1','pro-search-v1','pro-danlm-v1','pro-danlm-classic-v1'] as const)expect(playerTier(id)).toBe('pro-danlm-classic-v1');
 expect(savedTierLabel('pro-neural-v1')).not.toBe('DanLM');
});
it('does not rewrite the actual strategies or cards in an existing save',()=>{
 const assignment=roleAssignment('pro-endgame-v1');
 const saved=createSavedGame({firstPlayer:0},733711,undefined,assignment.policy,assignment.seatPolicies);
 const raw=JSON.stringify(saved);playerTier(saved.policy?.id);
 expect(JSON.stringify(decodeSavedGame(raw))).toBe(raw);
 expect(saved.policy?.id).toBe('pro-endgame-v1');
});
it.each(['balanced-v1','pro-danlm-classic-v1'] as const)('keeps an existing mixed %s hand intact and applies the uniform table only on the next hand',id=>{
 const oldAssignment={policy:strategyStamp(id),seatPolicies:[strategyStamp('coop-v2'),strategyStamp(id),strategyStamp('coop-v2'),strategyStamp(id)] as SeatPolicies};
 const saved=createSavedGame({firstPlayer:0},733711,undefined,oldAssignment.policy,oldAssignment.seatPolicies);
 const raw=JSON.stringify(saved),restored=decodeSavedGame(raw);
 expect(JSON.stringify(restored)).toBe(raw);expect(policyForSeat(restored,2).id).toBe('coop-v2');expect(policyForHint(restored).id).toBe(id);
 // Prehistory is a legal scripted fixture, not evidence of model strength.
 const first={...completed.records[0]!,...oldAssignment},between=restoreMatchJournal({...completed,records:[first]});
 const oldJournal=encodeMatchSession(between),assignment=roleAssignment(id),record=completed.records[1]!;
 const moved=nextMatchHand(between,record.seed,record.config.handId,assignment.policy,assignment.seatPolicies);
 if(!moved.ok)throw Error(moved.error);
 expect(encodeMatchSession(between)).toBe(oldJournal);
 expect(moved.match.journal.records[0]).toEqual(between.journal.records[0]);
 for(const seat of [0,1,2,3] as const)expect(policyForSeat(moved.match.saved,seat)).toEqual(strategyStamp(id));
 expect(policyForHint(moved.match.saved)).toEqual(strategyStamp(id));
 expect(decodeMatchSession(encodeMatchSession(moved.match))).toEqual(moved.match);
});
it('records DanLM statistics separately from retired neural experiments',()=>{
 expect(handDifficulty(roleAssignment('pro-danlm-classic-v1'))).toBe('danlm');
 expect(handDifficulty(roleAssignment('pro-danlm-v1'))).toBe('danlm');
 expect(handDifficulty(roleAssignment('pro-endgame-v1'))).toBe('pro');
});
