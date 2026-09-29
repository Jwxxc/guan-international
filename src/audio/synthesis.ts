import { midiFrequency, SECONDS_PER_BEAT, type MusicNote } from './score';

export interface SoundVoice { stop: (at?: number) => void }
export interface MusicGraph {
  input: GainNode;
  dispose: () => void;
  note: (note: MusicNote, when: number, onEnd?: () => void) => SoundVoice;
}

/** Shared by the live player and the OfflineAudioContext preview renderer. */
export function createMusicGraph(context: BaseAudioContext, destination: AudioNode, secondsPerBeat = SECONDS_PER_BEAT): MusicGraph {
  const input = context.createGain();
  const tone = context.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 6200; tone.Q.value = .4;
  const dry = context.createGain(); dry.gain.value = .85;
  const wet = context.createGain(); wet.gain.value = .14;
  const reverb = context.createConvolver();
  const impulse = context.createBuffer(2, Math.floor(context.sampleRate * .52), context.sampleRate);
  let randomState = 0x4755414e;
  const noise = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0xffffffff * 2 - 1; };
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = noise() * (1 - i / data.length) ** 3 * .36;
  }
  reverb.buffer = impulse;
  input.connect(tone); tone.connect(dry); dry.connect(destination); tone.connect(reverb); reverb.connect(wet); wet.connect(destination);
  const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * .35), context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = noise();
  // Sustained reed harmonics vs a round, mostly fundamental flute. Cache each
  // waveform per graph, so scheduled notes do not repeatedly allocate tables.
  const windWave = (partials: number[]) => context.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials));
  const winds = {
    sax: { wave: windWave([0, 1, .72, .58, .42, .29, .2, .14, .09, .05, .03]), peak: .115, attack: .065, release: .12, filter: [1500, 2900, 2300], scoop: -24, vibrato: 5.1, depth: 11, airCutoff: 1200, air: .035 },
    flute: { wave: windWave([0, 1, .06, .13, .018, .025]), peak: .12, attack: .045, release: .15, filter: [4200, 5300, 4400], scoop: -5, vibrato: 5.6, depth: 7, airCutoff: 2300, air: .09 },
    // Strong odd harmonics and very restrained vibrato give a woody clarinet tone.
    clarinet: { wave: windWave([0, 1, .035, .48, .025, .22, .015, .085, .012, .025]), peak: .13, attack: .05, release: .13, filter: [1800, 3400, 2700], scoop: -5, vibrato: 5.2, depth: 4, airCutoff: 1400, air: .018 },
    // Brighter upper harmonics evoke the bamboo flute's membrane resonance.
    dizi: { wave: windWave([0, 1, .32, .2, .22, .05, .09, .025]), peak: .12, attack: .045, release: .16, filter: [4400, 5900, 4900], scoop: -12, vibrato: 5.8, depth: 9, airCutoff: 2100, air: .055 },
  };
  return {
    input,
    dispose: () => { input.disconnect(); tone.disconnect(); dry.disconnect(); wet.disconnect(); reverb.disconnect(); },
    note(note, when, onEnd) {
      const nodes: AudioNode[] = [];
      const sources: AudioScheduledSourceNode[] = [];
      const gain = context.createGain(); nodes.push(gain);
      const pan = context.createStereoPanner(); pan.pan.value = note.pan; nodes.push(pan);
      gain.connect(pan); pan.connect(input);
      let pending = 0;
      let finished = false;
      const cleanup = () => {
        if (finished || --pending > 0) return;
        finished = true; nodes.forEach(node => node.disconnect()); onEnd?.();
      };
      const source = <T extends AudioScheduledSourceNode>(node: T, end: number) => {
        nodes.push(node); sources.push(node); pending++; node.onended = cleanup; node.start(when); node.stop(end); return node;
      };
      const envelope = (peak: number, attack: number, decay: number, end: number) => {
        gain.gain.setValueAtTime(.00001, when);
        gain.gain.linearRampToValueAtTime(peak * note.velocity, when + attack);
        gain.gain.exponentialRampToValueAtTime(Math.max(.00001, peak * note.velocity * decay), end - .045);
        gain.gain.exponentialRampToValueAtTime(.00001, end);
      };
      if (note.instrument === 'shaker' || note.instrument === 'brush') {
        const end = when + (note.instrument === 'shaker' ? .065 : .14);
        const filter = context.createBiquadFilter(); nodes.push(filter);
        filter.type = 'bandpass'; filter.frequency.value = note.instrument === 'shaker' ? 5300 : 2200; filter.Q.value = note.instrument === 'shaker' ? .7 : .45;
        const buffer = context.createBufferSource(); buffer.buffer = noiseBuffer; buffer.connect(filter); filter.connect(gain);
        envelope(note.instrument === 'shaker' ? .085 : .06, .009, .07, end);
        source(buffer, end);
      } else if (note.instrument === 'kick') {
        const end = when + .17;
        const oscillator = context.createOscillator(); oscillator.frequency.setValueAtTime(85, when); oscillator.frequency.exponentialRampToValueAtTime(43, end);
        oscillator.connect(gain); envelope(.17, .007, .035, end); source(oscillator, end);
      } else if (note.instrument === 'sax' || note.instrument === 'flute' || note.instrument === 'clarinet' || note.instrument === 'dizi') {
        const wind = winds[note.instrument];
        const length = Math.max(.12, note.duration * secondsPerBeat);
        const releaseAt = when + length;
        const end = releaseAt + wind.release;
        const attack = Math.min(length * .3, wind.attack);
        const peak = wind.peak * note.velocity;
        // Breath-supported sustain and a soft release, unlike struck piano strings.
        gain.gain.setValueAtTime(.00001, when);
        gain.gain.linearRampToValueAtTime(peak, when + attack);
        gain.gain.linearRampToValueAtTime(peak * .82, when + Math.min(length * .65, .22));
        gain.gain.linearRampToValueAtTime(peak * .74, releaseAt);
        gain.gain.exponentialRampToValueAtTime(.00001, end);

        const filter = context.createBiquadFilter(); nodes.push(filter);
        filter.type = 'lowpass'; filter.Q.value = .5;
        filter.frequency.setValueAtTime(wind.filter[0]!, when);
        filter.frequency.linearRampToValueAtTime(wind.filter[1]!, when + attack);
        filter.frequency.linearRampToValueAtTime(wind.filter[2]!, releaseAt);
        filter.connect(gain);
        const oscillator = context.createOscillator();
        oscillator.setPeriodicWave(wind.wave);
        oscillator.frequency.value = midiFrequency(note.midi);
        oscillator.detune.setValueAtTime(wind.scoop, when);
        oscillator.detune.linearRampToValueAtTime(0, when + Math.min(length * .4, .095));
        oscillator.connect(filter); source(oscillator, end);

        const vibrato = context.createOscillator(); vibrato.frequency.value = wind.vibrato;
        const vibratoDepth = context.createGain(); nodes.push(vibratoDepth);
        vibratoDepth.gain.setValueAtTime(0, when);
        vibratoDepth.gain.setValueAtTime(0, when + Math.min(.16, length * .45));
        vibratoDepth.gain.linearRampToValueAtTime(wind.depth, when + Math.min(.4, length * .85));
        vibrato.connect(vibratoDepth); vibratoDepth.connect(oscillator.detune); source(vibrato, end);

        const breath = context.createBufferSource(); breath.buffer = noiseBuffer; breath.loop = true;
        const airFilter = context.createBiquadFilter(); nodes.push(airFilter);
        airFilter.type = 'highpass'; airFilter.frequency.value = wind.airCutoff;
        const airGain = context.createGain(); nodes.push(airGain); airGain.gain.value = wind.air;
        breath.connect(airFilter); airFilter.connect(airGain); airGain.connect(filter); source(breath, end);
      } else if (note.instrument === 'guzheng') {
        const length = note.duration * secondsPerBeat;
        const end = when + length + .55;
        const fundamental = midiFrequency(note.midi);
        envelope(.125, .003, .035, end);
        [1, .48, .32, .2, .11, .065].forEach((strength, index) => {
          const oscillator = context.createOscillator();
          const partialGain = context.createGain(); nodes.push(partialGain);
          // Slightly stretched overtones and a gentle after-pluck bend suggest a
          // resonating zither string; upper harmonics fade faster than the body.
          oscillator.frequency.value = fundamental * (index + 1) * Math.sqrt(1 + .00018 * index * index);
          oscillator.detune.setValueAtTime(0, when);
          oscillator.detune.linearRampToValueAtTime(index ? 0 : 8, when + Math.min(.35, length * .7));
          partialGain.gain.setValueAtTime(strength, when);
          if (index) partialGain.gain.exponentialRampToValueAtTime(.0001, when + Math.min(length + .5, .5 + .65 / index));
          oscillator.connect(partialGain); partialGain.connect(gain); source(oscillator, end);
        });
      } else {
        const length = note.duration * secondsPerBeat;
        const end = when + length + (note.instrument === 'bass' ? .07 : .28);
        const fundamental = midiFrequency(note.midi);
        const partials = note.instrument === 'keys' ? [1, .3, .065] : note.instrument === 'pluck' ? [1, .2, .065, .022] : [1, .2];
        envelope(note.instrument === 'keys' ? .095 : note.instrument === 'pluck' ? .17 : .22, note.instrument === 'bass' ? .022 : .009, note.instrument === 'bass' ? .12 : .035, end);
        partials.forEach((strength, index) => {
          const oscillator = context.createOscillator(); const partialGain = context.createGain(); nodes.push(partialGain);
          oscillator.type = 'sine'; oscillator.frequency.value = fundamental * (index + 1);
          if (note.instrument === 'keys' && index) oscillator.detune.value = index % 2 ? 2 : -2;
          partialGain.gain.setValueAtTime(strength, when);
          if (index) partialGain.gain.exponentialRampToValueAtTime(.0001, end - .01);
          oscillator.connect(partialGain); partialGain.connect(gain); source(oscillator, end);
        });
      }
      return { stop: (at = context.currentTime) => { if (!finished) sources.forEach(node => { try { node.stop(at); } catch { /* Already ended. */ } }); } };
    },
  };
}
