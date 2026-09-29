import { tx } from '../i18n';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import '../styles/danlm-hint-button.css';

const HOLD_MS = 2000;
export function DanlmHintButton({ continuous = false, onContinuousChange, onHint, canHint, busy = false, blocked = false, unavailableReason, interactionKey, shortcut = false }: {
  continuous?: boolean; onContinuousChange?: (enabled: boolean) => void; onHint: () => void;
  canHint: boolean; busy?: boolean; blocked?: boolean; unavailableReason?: string; interactionKey: string; shortcut?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const press = useRef<{ pointerId?: number; key?: string; started: number; completed: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null), suppressClick = useRef(false);
  const latest = useRef({ continuous, onContinuousChange, onHint, canHint, busy });
  latest.current = { continuous, onContinuousChange, onHint, canHint, busy };
  // Switching OFF must remain possible during inference or another player's turn.
  const disabled = !continuous && (blocked || busy || !!unavailableReason);
  const end = (cancelled: boolean) => {
    const active = press.current; press.current = null;
    if (timer.current !== null) clearInterval(timer.current); timer.current = null;
    setProgress(null);
    if (active && (cancelled || active.completed)) suppressClick.current = true;
    if (active?.pointerId !== undefined && button.current?.hasPointerCapture(active.pointerId)) button.current.releasePointerCapture(active.pointerId);
    return active;
  };
  const activate = () => {
    const state = latest.current;
    if (state.continuous) state.onContinuousChange?.(false);
    else if (state.canHint && !state.busy) state.onHint();
  };
  const start = (input: { pointerId?: number; key?: string }) => {
    if (disabled || press.current) return;
    suppressClick.current = false;
    press.current = { ...input, started: performance.now(), completed: false };
    if (continuous || !onContinuousChange) return;
    setProgress(0);
    timer.current = setInterval(() => {
      const active = press.current; if (!active) return;
      const fraction = Math.min(1, (performance.now() - active.started) / HOLD_MS);
      setProgress(fraction);
      if (fraction < 1) return;
      active.completed = true; suppressClick.current = true;
      if (timer.current !== null) clearInterval(timer.current); timer.current = null;
      latest.current.onContinuousChange?.(true);
    }, 40);
  };
  useEffect(() => { end(true); }, [disabled, continuous, interactionKey]);
  useEffect(() => {
    const cancel = () => end(true);
    const hidden = () => { if (document.hidden) cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && press.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', hidden); document.addEventListener('keydown', escape, true);
    return () => {
      if (timer.current !== null) clearInterval(timer.current); press.current = null;
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', hidden); document.removeEventListener('keydown', escape, true);
    };
  }, []);
  return <button ref={button} type="button" className={`secondary-button danlm-hint-button ${continuous ? 'is-continuous' : ''}`}
    disabled={disabled} aria-label={tx(continuous ? 'DanLM 连续提示，点击关闭' : 'DanLM 提示')} aria-pressed={continuous} aria-busy={busy}
    data-testid="danlm-hint-button" data-holding={progress !== null || undefined}
    title={tx(continuous ? '连续提示已开启：每次轮到你自动分析，点击关闭；仍由你确认提交' : unavailableReason || '点击提示一次；按住 2 秒开启连续提示，不会自动出牌')}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || disabled) return;
      start({ pointerId: event.pointerId }); event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (press.current?.pointerId !== event.pointerId) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) end(true);
    }}
    onPointerUp={event => { if (press.current?.pointerId === event.pointerId) end(false); }}
    onPointerCancel={() => end(true)} onLostPointerCapture={() => { if (press.current) end(true); }}
    onContextMenu={event => event.preventDefault()}
    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } activate(); }}
    onKeyDown={event => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) start({ key: event.key }); }
    }}
    onKeyUp={event => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault(); event.stopPropagation();
      if (press.current?.key !== event.key) return;
      const active = end(false); if (active && !active.completed) activate();
      suppressClick.current = false;
    }} onBlur={() => { if (press.current) end(true); }}>
    <span className="danlm-hint-label">{tx(continuous ? 'DanLM 连续' : 'DanLM 提示')}{tx(shortcut && !continuous && <kbd>H</kbd>)}</span>
    <small>{tx(progress !== null ? `再按住 ${Math.max(1, Math.ceil(HOLD_MS * (1 - progress) / 1000))} 秒` : continuous ? busy ? '正在分析 · 点击关闭' : '已开启 · 点击关闭' : busy ? '正在分析' : '长按 2 秒连续')}</small>
    {tx(progress !== null && <span className="danlm-hold-progress" aria-hidden="true" style={{ '--hold-progress': progress } as CSSProperties}/>)}
  </button>;
}
