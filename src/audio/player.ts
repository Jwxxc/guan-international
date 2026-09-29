import { createMusicGraph, type MusicGraph, type SoundVoice } from './synthesis';
import { MusicTransport } from './transport';
import { scheduleGameSound, type GameSound } from './effects';
import { getMusicTrack, getMusicPlaybackMode, getNextMusicTrack, type MusicTrackId, type MusicPlaybackMode } from './tracks';

export type MusicStatus = 'ready' | 'playing' | 'paused' | 'muted' | 'unavailable';
export interface AudioSettings { musicEnabled: boolean; musicVolume: number; muted: boolean; musicTrack?: MusicTrackId; musicPlaybackMode?: MusicPlaybackMode }
export const MUSIC_CROSSFADE_SECONDS = 1.6;
interface MusicDeck {
  id: MusicTrackId;
  gain: GainNode;
  graph: MusicGraph;
  transport: MusicTransport;
  voices: Set<SoundVoice>;
  fade: { from: number; to: number; start: number; end: number };
}

/** One lazily unlocked audio context owns music and independent card effects. */
export class GuanAudioPlayer {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private deck: MusicDeck | null = null;
  private readonly effects = new Set<SoundVoice>();
  private readonly retiring = new Map<MusicDeck, ReturnType<typeof setTimeout>>();
  private disposed = false;
  private unlocked = false;
  private hidden: boolean;
  private unavailable = false;
  private lastStatus: MusicStatus | null = null;
  constructor(private settings: AudioSettings, hidden: boolean, private readonly onStatus: (status: MusicStatus) => void, private readonly onTrack: (track: MusicTrackId) => void = () => undefined) {
    this.hidden = hidden;
    this.report();
  }
  configure(settings: AudioSettings): void {
    if (this.disposed) return;
    const changedTrack = getMusicTrack(settings.musicTrack).id !== (this.deck?.id ?? getMusicTrack(this.settings.musicTrack).id);
    this.settings = settings;
    if (changedTrack && this.context) this.replaceMusic();
    if (settings.muted) this.stopEffects();
    if (!settings.musicEnabled || settings.musicVolume <= 0) this.stopMusic();
    else this.startMusic();
    this.report();
  }
  /** Only call from a trusted pointer or keyboard event. */
  unlock(): void {
    if (this.disposed || this.hidden) return;
    try {
      if (!this.context) {
        const Constructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) { this.unavailable = true; this.report(); return; }
        const context = new Constructor(); this.context = context;
        this.output = context.createGain(); this.output.gain.value = .9; this.output.connect(context.destination);
        this.musicGain = context.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.output);
        this.replaceMusic();
        context.onstatechange = () => {
          if (this.disposed) return;
          if (context.state !== 'running' || this.hidden) this.stopMusic(true);
          else this.startMusic();
          if (context.state === 'running' && this.hidden) void context.suspend().catch(() => undefined);
          // A fast hide/show can finish an earlier suspend after visibility returned.
          if (context.state === 'suspended' && !this.hidden && this.unlocked) void context.resume().catch(() => undefined);
          this.report();
        };
      }
      this.unlocked = true;
      const context = this.context;
      if (context.state === 'suspended') void context.resume().then(() => { if (!this.disposed) { this.startMusic(); this.report(); } }).catch(() => { this.report(); });
      else { this.startMusic(); this.report(); }
    } catch { this.unavailable = true; this.report(); }
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) {
      this.stopMusic(true);
      this.stopEffects();
      if (this.context?.state === 'running') void this.context.suspend().catch(() => undefined);
    } else if (this.unlocked && !this.disposed) this.unlock();
    this.report();
  }
  effect(kind: GameSound): void {
    const context = this.context;
    if (this.disposed || this.hidden || this.settings.muted || !this.unlocked || !context || context.state !== 'running' || !this.output) return;
    try {
      // At most a small cluster can overlap even if a scripted replay or rapid
      // selection arrives unexpectedly. Background music has its own voice set.
      if (this.effects.size >= 20) this.stopEffects();
      scheduleGameSound(context, this.output, kind, voice => this.effects.delete(voice)).forEach(voice => this.effects.add(voice));
    } catch { /* Optional sound must never interrupt a turn. */ }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.stopMusic(true); this.stopEffects();
    if (this.deck) this.disposeDeck(this.deck);
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => undefined);
    }
    this.musicGain?.disconnect(); this.output?.disconnect();
    this.deck = null; this.context = null;
  }
  private replaceMusic(at = this.context!.currentTime + .045): void {
    const context = this.context!;
    const previous = this.deck;
    const crossfade = !!previous?.transport.running && this.canPlay();
    if (previous) {
      if (crossfade) {
        this.fadeDeck(previous, 0, at, MUSIC_CROSSFADE_SECONDS);
        previous.transport.finishAt(at + MUSIC_CROSSFADE_SECONDS);
        const timer = setTimeout(() => this.disposeDeck(previous), (at + MUSIC_CROSSFADE_SECONDS - context.currentTime) * 1000 + 50);
        this.retiring.set(previous, timer);
      } else this.disposeDeck(previous);
    }
    const track = getMusicTrack(this.settings.musicTrack);
    const gain = context.createGain(); gain.gain.value = 0; gain.connect(this.musicGain!);
    const graph = createMusicGraph(context, gain, 60 / track.bpm);
    const voices = new Set<SoundVoice>();
    const transport = new MusicTransport(context, (note, time) => {
      let voice: SoundVoice;
      voice = graph.note(note, time, () => voices.delete(voice));
      voices.add(voice);
    }, track, { seconds: MUSIC_CROSSFADE_SECONDS, onTail: time => {
      if (this.deck?.transport !== transport || !this.canPlay() || getMusicPlaybackMode(this.settings.musicPlaybackMode) !== 'sequence') return;
      const next = getNextMusicTrack(track.id).id;
      this.settings = { ...this.settings, musicTrack: next };
      this.replaceMusic(time);
      this.onTrack(next);
    } });
    this.deck = { id: track.id, gain, graph, transport, voices, fade: { from: 0, to: 0, start: at, end: at } };
    if (crossfade) {
      this.fadeDeck(this.deck, 1, at, MUSIC_CROSSFADE_SECONDS);
      transport.start(at);
    }
  }
  private canPlay(): boolean {
    return !this.disposed && !this.hidden && this.unlocked && this.settings.musicEnabled && this.settings.musicVolume > 0 && this.context?.state === 'running';
  }
  private fadeDeck(deck: MusicDeck, target: number, at: number, seconds: number): void {
    const { from, to, start, end } = deck.fade;
    const now = this.context!.currentTime;
    const value = end <= start ? to : from + (to - from) * Math.max(0, Math.min(1, (now - start) / (end - start)));
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(value, now);
    deck.gain.gain.setValueAtTime(value, at);
    deck.gain.gain.linearRampToValueAtTime(target, at + seconds);
    deck.fade = { from: value, to: target, start: at, end: at + seconds };
  }
  private disposeDeck(deck: MusicDeck): void {
    const timer = this.retiring.get(deck);
    if (timer !== undefined) clearTimeout(timer);
    this.retiring.delete(deck);
    deck.transport.pause();
    deck.voices.forEach(voice => voice.stop(this.context?.currentTime ?? 0)); deck.voices.clear();
    deck.graph.dispose(); deck.gain.disconnect();
  }
  private startMusic(): void {
    if (!this.canPlay()) return;
    const context = this.context!;
    this.musicGain!.gain.cancelScheduledValues(context.currentTime);
    this.musicGain!.gain.setTargetAtTime(Math.max(0, Math.min(1, this.settings.musicVolume)), context.currentTime, .055);
    if (!this.deck!.transport.running) {
      this.fadeDeck(this.deck!, 1, context.currentTime, .25);
      this.deck!.transport.start();
    }
  }
  private stopMusic(immediate = false): void {
    this.deck?.transport.pause();
    const now = this.context?.currentTime ?? 0;
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(0, now, immediate ? .001 : .012);
    }
    this.deck?.voices.forEach(voice => voice.stop(immediate ? now : now + .05)); this.deck?.voices.clear();
    // All fading tracks share the music bus and must stop on mute/hide/dispose.
    this.retiring.forEach((_, deck) => this.disposeDeck(deck));
  }
  private stopEffects(): void {
    this.effects.forEach(voice => voice.stop(this.context?.currentTime ?? 0)); this.effects.clear();
  }
  private report(): void {
    if (this.disposed) return;
    const status: MusicStatus = this.unavailable ? 'unavailable'
      : !this.settings.musicEnabled || this.settings.musicVolume <= 0 ? 'muted'
      : this.hidden || this.unlocked && this.context?.state !== 'running' ? 'paused'
      : this.deck?.transport.running ? 'playing' : 'ready';
    if (status !== this.lastStatus) { this.lastStatus = status; this.onStatus(status); }
  }
}
