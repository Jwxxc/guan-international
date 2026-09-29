import { getMusicTrack, type MusicTrackId } from './tracks';
import { createMusicGraph } from './synthesis';
import type { Instrument } from './score';
import { MUSIC_CROSSFADE_SECONDS } from './player';

/** Isolated held notes make the difference in articulation/timbre reviewable. */
export async function renderInstrumentPreview(instrument: Instrument): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, 44100 * 3, 44100);
  const graph = createMusicGraph(context, context.destination, 1);
  graph.note({ instrument, beat: 0, duration: 1.4, midi: 60, velocity: .65, pan: 0 }, .05);
  const buffer = await context.startRendering(); graph.dispose(); return buffer;
}

/** Dev-only offline rendering; imported by verification, never loaded by the game. */
export async function renderMusicPreview(seconds = 20, volume = .22, trackId?: MusicTrackId): Promise<AudioBuffer> {
  const track = getMusicTrack(trackId);
  const secondsPerBeat = 60 / track.bpm;
  const duration = Math.min(track.beats * secondsPerBeat + 1, Math.max(1, seconds));
  const context = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
  const volumeNode = context.createGain(); volumeNode.gain.value = volume * .9; volumeNode.connect(context.destination);
  const graph = createMusicGraph(context, volumeNode, secondsPerBeat);
  for (const note of track.score()) {
    const when = .045 + note.beat * secondsPerBeat;
    if (when < duration) graph.note(note, when);
  }
  const buffer = await context.startRendering(); graph.dispose(); volumeNode.disconnect(); return buffer;
}

/** Render the end/start overlap, or the unchanged single-track loop, for audible QA. */
export async function renderMusicTransitionPreview(fromId: MusicTrackId, toId: MusicTrackId, repeat = false): Promise<AudioBuffer> {
  const from = getMusicTrack(fromId), to = getMusicTrack(toId);
  const context = new OfflineAudioContext(2, 44100 * 9, 44100);
  const oldGain = context.createGain(), newGain = context.createGain();
  oldGain.connect(context.destination); newGain.connect(context.destination);
  const transition = 4, overlap = repeat ? 0 : MUSIC_CROSSFADE_SECONDS;
  oldGain.gain.setValueAtTime(.9, 0);
  newGain.gain.setValueAtTime(repeat ? .9 : 0, 0);
  if (!repeat) {
    oldGain.gain.setValueAtTime(.9, transition);
    oldGain.gain.linearRampToValueAtTime(0, transition + overlap);
    newGain.gain.setValueAtTime(0, transition);
    newGain.gain.linearRampToValueAtTime(.9, transition + overlap);
  }
  const oldGraph = createMusicGraph(context, oldGain, 60 / from.bpm);
  const newGraph = repeat ? oldGraph : createMusicGraph(context, newGain, 60 / to.bpm);
  const oldStart = transition + overlap - from.beats * 60 / from.bpm;
  for (const note of from.score()) {
    const when = oldStart + note.beat * 60 / from.bpm;
    if (when >= 0) oldGraph.note(note, when);
  }
  for (const note of to.score()) {
    const when = transition + note.beat * 60 / to.bpm;
    if (when < 9) newGraph.note(note, when);
  }
  const buffer = await context.startRendering();
  oldGraph.dispose(); if (!repeat) newGraph.dispose(); oldGain.disconnect(); newGain.disconnect();
  return buffer;
}

export function encodeWave(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const dataLength = buffer.length * channels * 2;
  const output = new Uint8Array(44 + dataLength); const view = new DataView(output.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, dataLength + 36, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataLength, true);
  const samples = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  for (let i = 0; i < buffer.length; i++) for (let channel = 0; channel < channels; channel++) {
    const value = Math.max(-1, Math.min(1, samples[channel]![i]!));
    view.setInt16(44 + (i * channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return output;
}
