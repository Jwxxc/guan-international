import { tx } from '../i18n';
import { useEffect, useRef, type ReactNode } from 'react';
export function Modal({ title, onClose, children, wide = false, className = '' }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Room pushes and controlled settings can replace onClose while the dialog
  // stays open. Keep its focus lifecycle independent of callback identity.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const get = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0);
    get()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        // Explicit traversal also includes controls Safari may skip in its default tab order.
        event.preventDefault(); event.stopPropagation();
        const nodes = get();
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        const next = index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
        (nodes[next] ?? ref.current)?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus(); };
  }, [title]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} tabIndex={-1} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><h2 id="dialog-title">{tx(title)}</h2><button className="icon-button" aria-label={tx("关闭弹窗")} onClick={onClose}>×</button></div>{tx(children)}</div></div>;
}
