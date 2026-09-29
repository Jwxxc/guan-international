import type { Instrument, MusicNote } from './score';

type Phrase = Array<[beat: number, pitch: number, duration: number]>;
type Chord = [bass: number, ...notes: number[]];
const Eb: Chord = [39, 55, 58, 62], Cm: Chord = [36, 55, 58, 63];
const Fm: Chord = [41, 56, 60, 63], Bb: Chord = [46, 56, 60, 62];
const Ab: Chord = [44, 55, 60, 63], G: Chord = [43, 53, 59, 62];
const waltzHarmony = [Eb, Cm, Fm, Bb, Eb, Ab, Fm, Bb, Eb, Cm, Ab, Bb, Eb, G, Cm, Bb, Ab, Ab, Eb, Cm, Fm, Bb, Eb, G, Cm, Fm, Bb, Eb, Ab, Bb, Eb, Bb];
// A gentle 3/4 clarinet waltz. Phrases breathe between bass-led downbeats.
const waltzMelody: Phrase[] = [
  [[.2, 67, .65], [1.15, 70, 1.25]], [[.25, 72, 1], [1.75, 67, .8]],
  [[.25, 68, .65], [1.25, 65, 1.15]], [[.2, 62, 1.8]],
  [[.25, 63, .65], [1.2, 67, .65], [2.15, 70, .5]], [[.25, 72, 1], [1.7, 68, .8]],
  [[.2, 65, .65], [1.2, 68, 1.2]], [[.25, 65, .65], [1.35, 62, 1.15]],
  [[.2, 67, .65], [1.15, 70, .6], [2.1, 74, .5]], [[.25, 75, 1], [1.75, 72, .8]],
  [[.2, 72, .65], [1.25, 68, 1.2]], [[.25, 70, .65], [1.3, 65, 1.15]],
  [[.25, 67, .65], [1.2, 70, .65], [2.15, 75, .5]], [[.25, 74, .8], [1.5, 71, 1]],
  [[.25, 72, 1.9]], [[.5, 70, 1.5]],
  [[.2, 72, .6], [1.1, 75, .65], [2.1, 79, .55]], [[.25, 77, .7], [1.4, 75, 1]],
  [[.25, 74, .7], [1.4, 70, 1]], [[.25, 72, .7], [1.4, 67, 1]],
  [[.2, 68, .65], [1.2, 72, 1.2]], [[.25, 74, .65], [1.25, 70, .65], [2.2, 65, .5]],
  [[.25, 67, 1.9]], [[.5, 71, 1.5]],
  [[.2, 72, .7], [1.3, 67, 1.1]], [[.25, 68, .7], [1.35, 65, 1.1]],
  [[.25, 62, .65], [1.2, 65, .6], [2.1, 70, .55]], [[.25, 67, 1], [1.7, 63, .8]],
  [[.2, 60, .7], [1.3, 63, 1.1]], [[.25, 62, .7], [1.4, 65, 1]],
  [[.25, 63, 2.1]], [],
];

export function createWaltzScore(): MusicNote[] {
  const score: MusicNote[] = [];
  waltzHarmony.forEach(([bass, ...chord], bar) => {
    const add = (instrument: Instrument, beat: number, midi: number, duration: number, velocity: number, pan = 0) =>
      score.push({ instrument, beat: bar * 3 + beat, midi, duration, velocity, pan });
    add('bass', 0, bass, 1.6, .55, -.08);
    // Two soft offbeat guitar chords give the waltz its three-step sway.
    for (const beat of [1, 2]) chord.forEach((midi, i) => add('pluck', beat + i * .025, midi, .55, beat === 1 ? .23 : .18, -.3));
    add('brush', 1, 0, .14, .11, -.2); add('brush', 2, 0, .14, .15, -.2);
    add('shaker', 2.5, 0, .1, .09, .3);
    waltzMelody[bar]!.forEach(([beat, midi, duration], i) => add('clarinet', beat, midi, duration, i === 0 ? .65 : .58, .15));
  });
  return score.sort((a, b) => a.beat - b.beat);
}

// D pentatonic, open fifths and generous rests. No piano or jazz chord voicings.
const bambooHarmony: Chord[] = [
  [38, 57, 62, 66], [47, 54, 59, 62], [42, 57, 62, 66], [45, 57, 64, 69],
  [38, 57, 62, 66], [40, 54, 59, 64], [42, 57, 62, 66], [45, 57, 64, 69],
];
const bambooMelody: Phrase[] = [
  [[.25, 62, .7], [1.5, 66, .9], [3, 69, .65]], [[.5, 71, 1.2], [2.5, 69, 1]],
  [[.25, 66, .7], [1.5, 64, 1.6]], [[.5, 62, 2.3]],
  [[.4, 69, 1.15], [2.3, 74, 1.25]], [[.5, 76, .9], [2, 74, 1.4]],
  [[.4, 71, .85], [1.8, 69, 1.4]], [[.5, 66, 2.4]],
  [[.25, 62, .6], [1.25, 66, .6], [2.25, 69, 1.1]], [[.5, 71, 1], [2.2, 74, 1.3]],
  [[.25, 69, .7], [1.5, 66, 1.6]], [[.5, 64, 2.3]],
  [[.4, 66, 1], [2.1, 69, 1.4]], [[.5, 64, 1.15], [2.4, 62, 1.1]],
  [[.25, 66, .6], [1.3, 64, .6], [2.4, 62, 1.1]], [[1, 57, 1.8]],
  [[.4, 74, 1.1], [2.3, 76, 1.2]], [[.5, 78, .85], [2, 76, 1.4]],
  [[.4, 74, .85], [1.8, 71, 1.5]], [[.5, 69, 2.4]],
  [[.25, 66, .6], [1.25, 69, .6], [2.25, 74, 1.1]], [[.5, 71, 1.1], [2.3, 69, 1.2]],
  [[.25, 66, .7], [1.5, 64, 1.6]], [[.5, 62, 2.3]],
  [[.4, 69, 1.1], [2.3, 66, 1.2]], [[.5, 64, .9], [2, 62, 1.4]],
  [[.25, 66, .6], [1.25, 69, .6], [2.25, 71, 1.1]], [[.5, 69, 1.1], [2.3, 66, 1.2]],
  [[.25, 64, .7], [1.5, 62, 1.6]], [[.5, 57, 1.1], [2.3, 59, 1.2]],
  [[.5, 62, 2.7]], [],
];

export function createBambooScore(): MusicNote[] {
  const score: MusicNote[] = [];
  bambooMelody.forEach((phrase, bar) => {
    const [bass, ...chord] = bambooHarmony[bar % 8]!;
    const add = (instrument: Instrument, beat: number, midi: number, duration: number, velocity: number, pan = 0) =>
      score.push({ instrument, beat: bar * 4 + beat, midi, duration, velocity, pan });
    add('guzheng', 0, bass, 2.6, .35, -.25);
    [0, 2, 1].forEach((index, i) => add('guzheng', .12 + i * .8, chord[index]!, 1.1, .23 - i * .025, -.3));
    add('guzheng', 2.8, chord[0]!, .85, .17, -.25);
    const flute = [4, 5, 6, 7, 12, 13, 16, 17, 18, 19, 24, 25].includes(bar);
    phrase.forEach(([beat, midi, duration]) => add(flute ? 'dizi' : 'guzheng', beat, midi, duration, flute ? .62 : .6, .2));
    // Brief pentatonic flourishes only between sections, below the lead volume.
    if ([7, 15, 23].includes(bar)) [57, 59, 62, 64, 66, 69].forEach((midi, i) => add('guzheng', 3.1 + i * .12, midi, .18, .14 + i * .01, -.1 + i * .04));
    add('shaker', 2, 0, .1, .07, -.35);
  });
  return score.sort((a, b) => a.beat - b.beat);
}
