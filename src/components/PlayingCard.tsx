import { tx } from '../i18n';
import type { CSSProperties, KeyboardEventHandler } from 'react';
import type { Card, RuleConfig } from '../engine/types';
import { isWild } from '../engine/cards';
import { rankName } from '../engine/rules';
import type { CardDetail } from '../game/cardAppearance';
import { jokerArtwork, type JokerExposure } from '../game/jokerArtwork';
import '../styles/card-details.css';
import '../styles/joker-art.css';

export const suitSymbol = (suit: string) => ({ S: '♠', H: '♥', C: '♣', D: '♦', J: '✦' }[suit] ?? '');
export const cardName = (card: Card) => `${({ S: '黑桃', H: '红心', C: '梅花', D: '方块', J: '' }[card.suit])}${rankName(card.rank)}`;
const pipPositions: Record<number, Array<[number, number]>> = {
  2:[[50,20],[50,80]], 3:[[50,20],[50,50],[50,80]],
  4:[[27,22],[73,22],[27,78],[73,78]], 5:[[27,22],[73,22],[50,50],[27,78],[73,78]],
  6:[[27,20],[73,20],[27,50],[73,50],[27,80],[73,80]],
  7:[[27,20],[73,20],[50,35],[27,50],[73,50],[27,80],[73,80]],
  8:[[27,20],[73,20],[50,35],[27,50],[73,50],[50,65],[27,80],[73,80]],
  9:[[27,16],[73,16],[27,38],[73,38],[50,50],[27,62],[73,62],[27,84],[73,84]],
  10:[[27,16],[73,16],[50,28],[27,38],[73,38],[27,62],[73,62],[50,72],[27,84],[73,84]],
};
export function PlayingCard({ card, rules, selected = false, interactive = false, onClick, onDoubleClick, style, tabIndex, onFocus, onKeyDown, title, detail = 'medium', jokerExposure = 'full', jokerStrip }: {
  card: Card; rules: RuleConfig; detail?: CardDetail; jokerExposure?: JokerExposure; jokerStrip?: number; selected?: boolean; interactive?: boolean;
  onClick?: () => void; onDoubleClick?: () => void; style?: CSSProperties; title?: string; tabIndex?: number; onFocus?: () => void; onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}) {
  const wild = isWild(card, rules);
  const red = card.suit === 'H' || card.suit === 'D' || card.rank === 16;
  const joker = card.rank > 14;
  const artwork = joker ? jokerArtwork(card.rank, detail, jokerExposure) : null;
  const cardStyle = joker && jokerStrip !== undefined ? { ...style, '--joker-strip': `${jokerStrip}px` } as CSSProperties : style;
  const classes = `playing-card ${red ? 'card-red' : 'card-black'} ${wild ? 'card-wild' : ''} ${selected ? 'is-selected' : ''} ${joker ? `is-joker ${card.rank === 16 ? 'joker-big' : 'joker-small'}` : ''}`;
  const pips = pipPositions[card.rank];
  const simplified = detail === 'small' || detail === 'tiny';
  const contents = <>
    <span className={`card-corner ${joker ? 'joker-corner' : ''}`}><b>{tx(rankName(card.rank))}</b><span>{tx(suitSymbol(card.suit))}</span>{tx(wild && <i className="wild-corner-mark" aria-hidden="true">{tx("配")}</i>)}</span>
    {tx(artwork ? <span className="joker-art" aria-hidden="true"><img className="joker-portrait" src={artwork.src} alt="" aria-hidden="true" draggable={false} decoding="async" data-testid="joker-art" data-joker-rank={card.rank} data-joker-motif={artwork.motif}/></span> : simplified ? <span className="card-simple-suit" aria-hidden="true">{tx(suitSymbol(card.suit))}</span> : pips ? <span className={`card-pips ${card.rank >= 7 ? 'card-pips-dense' : ''}`} aria-hidden="true">{tx(pips.map(([x,y],i) => <span key={i} style={{left:`${x}%`,top:`${y}%`,transform:`translate(-50%,-50%) ${y>50?'rotate(180deg)':''}`}}>{tx(suitSymbol(card.suit))}</span>))}</span> : <span className="card-center court-emblem" aria-hidden="true"><small>{tx(card.rank===14?'ACE':'GUAN')}</small><span>{tx(suitSymbol(card.suit))}</span><small>{tx(card.rank===14?'ONE':rankName(card.rank))}</small></span>)}
    <span className="card-corner card-corner-end" aria-hidden="true"><b>{tx(joker ? 'J' : rankName(card.rank))}</b><span>{tx(suitSymbol(card.suit))}</span></span>
    {tx(selected && <span className="selected-tick" aria-hidden="true">✓</span>)}
  </>;
  return interactive ? <button type="button" className={classes} data-detail={detail} data-joker-exposure={joker ? jokerExposure : undefined} style={cardStyle} title={tx(title)} tabIndex={tabIndex} onFocus={onFocus} onKeyDown={onKeyDown} onClick={onClick} onDoubleClick={onDoubleClick} data-testid="hand-card" data-card-id={card.id} aria-label={tx(`${cardName(card)}${wild ? '，逢人配' : ''}`)} aria-pressed={selected}>{tx(contents)}</button> : <div className={classes} data-detail={detail} data-joker-exposure={joker ? jokerExposure : undefined} style={cardStyle} aria-label={tx(`${cardName(card)}${wild ? '，逢人配' : ''}`)}>{tx(contents)}</div>;
}
