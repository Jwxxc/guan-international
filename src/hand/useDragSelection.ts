import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { crossedCards, paintedSelection, visibleCardRegions, type CardRegion, type Point } from './dragSelection';

interface Gesture {
  pointerId: number; start: Point; last: Point; active: boolean; selecting: boolean; published: boolean;
  initial: string[]; touched: Set<string>; regions: CardRegion[];
}

export function useDragSelection({ host, selected, cardIds, layoutKey, onSelect, disabled }: {
  host: RefObject<HTMLDivElement | null>; selected: string[]; cardIds: string[];
  layoutKey: string; onSelect: (ids: string[]) => void; disabled: boolean;
}) {
  const latest = useRef({ onSelect, selected, cardIds, disabled });
  latest.current = { onSelect, selected, cardIds, disabled };
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const suppressDoubleUntil = useRef(0);
  const [dragMode, setDragMode] = useState<'select' | 'deselect' | null>(null);
  const cancelRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const element = host.current;
    const finish = (render = true) => {
      const current = gesture.current;
      gesture.current = null;
      if (current?.active) {
        suppressClick.current = true;
        suppressDoubleUntil.current = performance.now() + 500;
      }
      if (current && element?.hasPointerCapture(current.pointerId)) element.releasePointerCapture(current.pointerId);
      if (render) setDragMode(null);
    };
    cancelRef.current = finish;
    const paint = (current: Gesture, point: Point) => {
      const before = current.touched.size;
      for (const id of crossedCards(current.regions, current.last, point)) current.touched.add(id);
      current.last = point;
      if (current.touched.size === before && current.published) return;
      current.published = true;
      latest.current.onSelect(paintedSelection(current.initial, current.touched, current.selecting, new Set(latest.current.cardIds)));
    };
    const move = (event: globalThis.PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!(event.buttons & 1) || latest.current.disabled) { finish(); return; }
      const point = { x: event.clientX, y: event.clientY };
      if (!current.active) {
        if (Math.hypot(point.x-current.start.x, point.y-current.start.y) < 5) return;
        current.active = true;
        setDragMode(current.selecting ? 'select' : 'deselect');
        // Delay capture until a real drag, leaving ordinary click/double-click intact.
        try { element?.setPointerCapture(event.pointerId); } catch { /* Window listeners still finish the gesture. */ }
      }
      event.preventDefault();
      paint(current, point);
    };
    const up = (event: globalThis.PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.active && !latest.current.disabled) {
        event.preventDefault();
        paint(current, { x: event.clientX, y: event.clientY });
      }
      finish();
    };
    const cancelPointer = (event: globalThis.PointerEvent) => { if (gesture.current?.pointerId === event.pointerId) finish(); };
    const key = () => { if (gesture.current) finish(); };
    const hidden = () => { if (document.hidden) finish(); };
    const cancel = () => finish();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up, { passive: false });
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      finish(false); cancelRef.current = () => undefined;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [host]);

  useEffect(() => { cancelRef.current(); }, [layoutKey, disabled]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0 || gesture.current) return;
    // A fresh header/blank-area press also ends suppression left by an outside release.
    suppressClick.current = false; suppressDoubleUntil.current = 0;
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-card-id]') : null;
    if (!card || !host.current?.contains(card)) return;
    const id = card.dataset.cardId;
    if (!id || !cardIds.includes(id)) return;
    suppressClick.current = false; suppressDoubleUntil.current = 0;
    const bounds = host.current.getBoundingClientRect();
    const clipped = host.current.dataset.layout === 'vertical';
    const regions = Array.from(host.current.querySelectorAll<HTMLElement>('[data-card-id]')).map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.cardId!,
        left: clipped ? Math.max(rect.left, bounds.left, 0) : rect.left,
        right: clipped ? Math.min(rect.right, bounds.right, window.innerWidth) : rect.right,
        top: clipped ? Math.max(rect.top, bounds.top, 0) : rect.top,
        bottom: clipped ? Math.min(rect.bottom, bounds.bottom, window.innerHeight) : rect.bottom };
    }).filter(region => region.right > region.left && region.bottom > region.top);
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = { pointerId: event.pointerId, start: point, last: point, active: false, published: false, selecting: !selected.includes(id), initial: [...selected], touched: new Set([id]), regions: visibleCardRegions(regions) };
  };
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
  };
  const onDoubleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (performance.now() < suppressDoubleUntil.current) { event.preventDefault(); event.stopPropagation(); }
  };
  // Touch starts with implicit capture on the card. Transferring capture to
  // the hand emits a bubbled loss on that child, which must not cancel us.
  return { dragMode, cancelGesture: () => cancelRef.current(), onPointerDown, onClickCapture, onDoubleClickCapture, onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => { if (event.target === host.current && gesture.current?.active) cancelRef.current(); } };
}
