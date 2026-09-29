/** Presentation fixtures: deliberately constructed from 108 real physical IDs, not production dealing. */
import { createDeck } from '../src/engine/cards';
import { createPracticeGame } from '../src/engine/reducer';
import type { Card, GameState, Suit } from '../src/engine/types';
export function verticalFixture(name: string): GameState {
  const deck = createDeck(); const hand: Card[] = [];
  const take = (rank: number, suit?: Suit, count = 1) => {
    const chosen = deck.filter(c => c.rank === rank && (!suit || c.suit === suit) && !hand.includes(c)).slice(0, count);
    if (chosen.length !== count) throw Error('Invalid fixture'); hand.push(...chosen);
  };
  if (name === 'spacing') {
    take(12,undefined,4);take(16,'J',2);take(14,undefined,3);
    for(const [rank,suits] of [[11,['S','H']],[9,['S','D']],[7,['C','D']],[6,['H','D']],[5,['S','C']],[4,['H','C']],[3,['S','D']]] as Array<[number,Suit[]]>)for(const suit of suits)take(rank,suit);
    take(15,'J');take(10,'S');take(13,'S');take(8,'C');
  }
  else if (name === 'ambiguous-run') {
    take(3,'S');take(4,'D');take(5,'C');take(2,'H',2);take(16,'J');
  }
  else if (name === 'mixed-run') {
    take(16,'J');take(15,'J');take(14,'H');take(14,'S');take(13,'D');take(12,'C');take(10,'D');
  }
  else if (name === 'missing-run') {
    take(16,'J');take(12,'D');take(8,'H');take(7,'C');take(6,'D');take(5,'C');take(4,'D');take(3,'C');
  }
  else if (name === 'M') {
    take(5,'S',2);take(5,'C',2);take(5,'D');take(4,'H');take(4,'C');take(4,'D',2);
    take(10,'S');take(10,'C');take(13,'S');take(13,'H');take(13,'C');take(12,'S');take(12,'H');
    take(2,'S');take(2,'D',2);take(16,'J');take(10,'H');take(14,'S');take(11,'D');take(9,'S');take(8,'H');take(7,'C');take(6,'C');
  }
  else if (name === 'T') {
    take(14,'S',2);take(14,'C');take(14,'D');take(16,'J',2);
    for(const [rank,suits] of [[8,['S','D']],[13,['S','C']],[12,['S','H']],[11,['S','D']],[9,['S','D']],[7,['S','C']],[6,['S','C']],[5,['H','C']],[4,['H','D']],[2,['S','H']]] as Array<[number,Suit[]]>)for(const suit of suits)take(rank,suit);
    take(15,'J');
  }
  else if (name === 'R') {
    take(10,'S');take(10,'H',2);take(10,'D',2);take(8,'S');take(8,'H',2);take(8,'C');
    take(14,'S');take(14,'D');take(13,'H');take(13,'S');take(11,'H');take(11,'C');
    take(9,'S');take(9,'H');take(9,'C');take(4,'S',2);take(4,'H');
    take(16,'J');take(15,'J');take(3,'H');take(12,'H');take(6,'D');take(5,'D');
  }
  else if (name === 'P') { take(11,undefined,3); take(12,undefined,3); take(14,undefined,3); take(13,undefined,2); }
  else if (name === 'W3' || name === 'W4') { take(10,'H'); for (const r of [3,4,5,6,7].filter(r=>r!==(name==='W3'?5:4))) take(r,'D'); }
  else if (name === 'E') { take(10, 'H', 2); take(10, 'S', 2); for (const r of [3,4,5,6,7]) take(r,'D'); take(11,undefined,3); take(12,undefined,2); }
  else if (name === 'B') { take(8, undefined, 8); take(2, 'H', 2); }
  else if (name === 'F') { take(16, 'J', 2); take(15, 'J', 2); }
  else if (name === 'D' || name === 'H') { for (let r = 2; r <= 14; r++) { take(r, 'S'); take(r, 'C'); } }
  else if (name === 'C') { for (let r = 2; r <= 14; r++) take(r, r % 2 ? 'S' : 'D'); take(15, 'J'); take(16, 'J'); }
  else { take(8, undefined, 4); for (let r = 3; r <= 7; r++) take(r, 'D'); take(14, undefined, 2); take(13, undefined, 2); take(11, undefined, 3); take(10, undefined, 2); take(9, undefined, 2); take(6, 'C', 2); take(2, 'H', 2); take(16, 'J'); take(15, 'J'); take(7, 'C'); }
  for (const c of deck) { if (hand.length >= 27) break; if (!hand.includes(c)) hand.push(c); }
  const rest = deck.filter(c => !hand.includes(c));
  return { ...createPracticeGame({ firstPlayer: 0, levelRank: name === 'mixed-run' ? 14 : name === 'R' ? 3 : ['E','W3','W4','M'].includes(name) ? 10 : 2, sessionId: `vertical-${name}`, handId: `vertical-${name}` }, 1), hands: [hand, rest.slice(0,27), rest.slice(27,54), rest.slice(54)] };
}
