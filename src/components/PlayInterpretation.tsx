import { tx } from '../i18n';
import type { ResolvedPlay } from '../engine/types';
import { rankName } from '../engine/rules';
import { suitSymbol, cardName } from './PlayingCard';
export function wildcardDescription(play: ResolvedPlay): string {
  return play.wildcards.map(mapping => { const original = play.cards.find(c => c.id === mapping.cardId); return `${original ? cardName(original) : '逢人配'} → ${suitSymbol(mapping.suit)}${rankName(mapping.rank)}`; }).join('；');
}
export function PlayInterpretation({ plays, selectedKey, onSelect }: { plays: ResolvedPlay[]; selectedKey: string; onSelect: (key: string) => void }) {
  if (!plays.length) return null;
  const chosen = plays.find(p => p.key === selectedKey) ?? plays[0]!;
  return <div className="interpretation" data-testid="interpretations">
    {tx(plays.length > 1 ? <label><span>{tx("牌型解释")}</span><select aria-label={tx("牌型解释")} value={chosen.key} onChange={e => onSelect(e.target.value)}>{tx(plays.map((p, i) => <option key={p.key} value={p.key}>{tx(i + 1)}. {tx(p.label)}{tx(p.wildcards.length ? ` · ${wildcardDescription(p)}` : '')}</option>))}</select></label> : <strong>{tx(chosen.label)}</strong>)}
    {tx(chosen.wildcards.length > 0 && <div className="wild-mapping" data-testid="wild-mapping">{tx(wildcardDescription(chosen))}</div>)}
  </div>;
}
