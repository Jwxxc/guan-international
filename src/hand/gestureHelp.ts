/** Separate UI preference; original hand layouts and saved matches stay intact. */
export const GESTURE_HELP_KEY = 'guan.hand-gesture-help.v1';
let dismissedThisVisit = false;

export function needsGestureHelp(): boolean {
  if (dismissedThisVisit) return false;
  try { return localStorage.getItem(GESTURE_HELP_KEY) !== 'seen'; }
  catch { return true; }
}

export function rememberGestureHelp(): void {
  dismissedThisVisit = true;
  try { localStorage.setItem(GESTURE_HELP_KEY, 'seen'); }
  catch { /* Unavailable storage must never interrupt the hand. */ }
}
