import { useEffect, useRef } from 'react';

type PendingHint = { promise: Promise<unknown> };
/** One automatic request per decision. Manual edits consume this turn's prompt;
 * only an unfinished request cancelled by pause/navigation may resume. */
export function useContinuousHint({ enabled, ready, positionKey, request, cancel }: {
  enabled: boolean; ready: boolean; positionKey: string;
  request: () => PendingHint | undefined; cancel: () => void;
}): () => void {
  const attempted = useRef<string | null>(null), manualRevision = useRef(0);
  const latest = useRef({ request, cancel }); latest.current = { request, cancel };
  useEffect(() => {
    if (!enabled) { attempted.current = null; return; }
    if (!ready || attempted.current === positionKey) return;
    let launched = false, settled = false, launchRevision = 0;
    // Deferred dispatch avoids StrictMode's setup/cleanup probe and leaves React
    // time to clear presentation from the preceding turn before selecting cards.
    const timer = setTimeout(() => {
      if (attempted.current === positionKey) return;
      attempted.current = positionKey;
      const task = latest.current.request();
      if (!task) return;
      launched = true; launchRevision = manualRevision.current;
      void task.promise.then(() => { settled = true; }, () => { settled = true; });
    }, 120);
    return () => {
      clearTimeout(timer);
      if (launched && !settled) {
        latest.current.cancel();
        if (manualRevision.current === launchRevision) attempted.current = null;
      }
    };
  }, [enabled, ready, positionKey]);
  return () => { if (enabled) { attempted.current = positionKey; manualRevision.current++; } };
}
