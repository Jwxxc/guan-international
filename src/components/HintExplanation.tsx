import { tx } from '../i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HintExplanation as Explanation } from '../game/hintExplanation';
import '../styles/hint-explanation.css';

/** A read-only hover/focus disclosure. Its keyboard events never submit cards. */
export function HintExplanation({ summary, explanation }: { summary: string; explanation?: Explanation | null }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => { if (closeTimer.current !== null) clearTimeout(closeTimer.current); closeTimer.current = null; };
  const show = () => { clearTimer(); setOpen(true); };
  const hideSoon = () => { clearTimer(); closeTimer.current = setTimeout(() => { if (document.activeElement !== trigger.current) setOpen(false); }, 160); };
  useEffect(() => { setOpen(false); clearTimer(); return clearTimer; }, [summary, explanation]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
    const gap = 8, margin = 12;
    const above = anchor.top - box.height - gap;
    setPosition({
      left: Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(above >= margin ? above : anchor.bottom + gap, innerHeight - box.height - margin)),
    });
  }, [open, summary, explanation]);
  useEffect(() => {
    if (!open) return;
    const close = () => { clearTimer(); setOpen(false); };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', close);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) close(); };
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  if (!explanation?.lines.length) return <>{tx(summary)}</>;
  return <>
    <button type="button" ref={trigger} className="hint-explanation-trigger" data-testid="hint-explanation-trigger"
      aria-label={tx(`${summary} 查看详细分析`)} aria-expanded={open} aria-describedby={open ? id : undefined}
      onPointerEnter={show} onPointerLeave={hideSoon} onFocus={show} onBlur={hideSoon}
      onClick={show} onKeyDown={event => event.stopPropagation()}>
      {tx(summary)}<span className="hint-explanation-mark" aria-hidden="true">ⓘ</span>
    </button>
    {tx(open && createPortal(<div id={id} role="tooltip" ref={panel} className="hint-explanation-panel" data-testid="hint-explanation-panel"
      style={position} onPointerEnter={show} onPointerLeave={hideSoon} onKeyDown={event => event.stopPropagation()}>
      <strong>{tx("这手建议怎么看")}</strong>
      {tx(explanation.lines.map((line, index) => <p key={index}>{tx(line)}</p>))}
      <small>{tx("结合你的手牌和公开牌局解读")}</small>
    </div>, document.body))}
  </>;
}
