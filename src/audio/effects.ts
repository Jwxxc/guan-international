import type { PowerSound } from '../game/playImpact';
import type { SoundVoice } from './synthesis';

export type GameSound = 'select' | 'play' | PowerSound;
interface Tone { offset: number; duration: number; from: number; to: number; gain: number; wave: OscillatorType }

/** Quiet acoustic-like cues, synthesized locally on the already unlocked context. */
function tonesFor(kind: GameSound): Tone[] {
  const tone = (from: number, to: number, gain: number, duration: number, offset = 0, wave: OscillatorType = 'sine'): Tone => ({ offset, duration, from, to, gain, wave });
  if (kind === 'select') return [tone(570, 320, .025, .09)];
  if (kind === 'play') return [tone(220, 90, .025, .09)];
  if (kind === 'straightFlush') return [659.25, 783.99, 987.77, 1174.66].map((hz, index) => tone(hz, hz * .998, .019 - index * .002, .28, .13 + index * .075));
  if (kind === 'jokerBomb') return [tone(152, 52, .054, .33, .15), tone(228, 87, .016, .22, .15, 'triangle'), tone(880, 878, .018, .28, .3), tone(1174.66, 1173, .014, .35, .39)];
  if (kind === 'largeBomb') return [tone(148, 57, .044, .28, .15), tone(296, 100, .013, .2, .15, 'triangle'), tone(783.99, 779, .012, .2, .25)];
  return [tone(170, 70, .033, .21, .15), tone(340, 112, .009, .16, .15, 'triangle')];
}

/** Exported so browser QA renders the exact same cues through OfflineAudioContext. */
export function scheduleGameSound(context: BaseAudioContext, output: AudioNode, kind: GameSound, onEnded: (voice: SoundVoice) => void = () => undefined): SoundVoice[] {
  return tonesFor(kind).map(tone => {
    const oscillator = context.createOscillator(); const gain = context.createGain();
    const start = context.currentTime + tone.offset;
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(tone.to, start + tone.duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, start + tone.duration);
    oscillator.connect(gain); gain.connect(output);
    let ended = false;
    const voice: SoundVoice = { stop: (when = context.currentTime) => { if (!ended) { try { oscillator.stop(when); } catch { /* Already stopped. */ } } } };
    oscillator.onended = () => { ended = true; oscillator.disconnect(); gain.disconnect(); onEnded(voice); };
    oscillator.start(start); oscillator.stop(start + tone.duration + .015);
    return voice;
  });
}
