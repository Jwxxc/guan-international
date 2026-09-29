import type { Instrument, MusicNote } from './score';

type Phrase = Array<[beat: number, midi: number, duration: number]>;
type Chord = [bass: number, ...notes: number[]];
const C: Chord = [36, 52, 55, 59, 62], Am: Chord = [45, 55, 59, 60, 64];
const Dm: Chord = [38, 53, 57, 60, 64], G: Chord = [43, 53, 57, 59, 62];
const F: Chord = [41, 52, 57, 60, 67], Em: Chord = [40, 55, 59, 62, 66];
const A: Chord = [45, 55, 61, 64, 67], Fm: Chord = [41, 53, 56, 60, 62];

// Two original A/A'/B/A compositions. Distinct phrases and accompaniment,
// with a restrained final bar that leaves room for the following track.
const teaHarmony = [C, Em, Am, Am, Dm, G, C, G, C, Em, F, Fm, C, A, Dm, G, F, F, Em, A, Dm, G, C, Am, F, G, Em, Am, Dm, G, C, G];
const teaMelody: Phrase[] = [
  [[.33, 67, .5], [1.33, 64, .5], [2.33, 62, .45], [3, 64, .65]],
  [[.33, 67, .55], [1.67, 71, .75], [3, 67, .65]],
  [[.33, 69, .65], [1.67, 72, .6], [2.67, 71, .45]], [[.33, 69, .6], [1.67, 64, 1.5]],
  [[.33, 65, .5], [1.33, 69, .5], [2.33, 64, .7]], [[.33, 62, .6], [1.67, 59, 1.5]],
  [[.33, 60, .6], [1.67, 64, .5], [2.67, 67, .8]], [[.33, 69, .6], [1.67, 67, 1.2]],
  [[.33, 67, .5], [1.33, 64, .5], [2.33, 71, .6]], [[.33, 74, .7], [1.67, 71, 1.3]],
  [[.33, 72, .7], [1.67, 69, .5], [2.67, 67, .9]], [[.33, 68, .7], [1.67, 65, 1.4]],
  [[.33, 64, .5], [1.33, 67, .5], [2.33, 72, .9]], [[.33, 73, .5], [1.33, 69, .5], [2.33, 67, 1]],
  [[.33, 65, .6], [1.67, 64, .5], [2.67, 62, .8]], [[.33, 59, 2]],
  [[.33, 69, .6], [1.67, 72, .55], [2.67, 76, .8]], [[.33, 74, .55], [1.33, 72, .55], [2.33, 69, 1]],
  [[.33, 71, .7], [1.67, 67, 1.5]], [[.33, 69, .6], [1.67, 73, 1.2]],
  [[.33, 72, .5], [1.33, 69, .5], [2.33, 65, 1]], [[.33, 67, .6], [1.67, 62, 1.5]],
  [[.33, 64, .8], [2, 67, 1.2]], [[.33, 69, .6], [1.67, 64, 1.5]],
  [[.33, 65, .55], [1.33, 69, .55], [2.33, 67, 1]], [[.33, 62, .6], [1.67, 67, 1.2]],
  [[.33, 71, .6], [1.67, 67, .55], [2.67, 64, .8]], [[.33, 69, .7], [1.67, 64, 1.4]],
  [[.33, 65, .6], [1.67, 62, 1.3]], [[.33, 59, .7], [1.67, 62, .8]], [[.33, 64, .8], [2, 60, 1.5]], [],
];
const moonHarmony = [Am, F, C, G, Dm, Am, F, G, Am, F, Em, Am, Dm, G, C, Em, F, G, Em, Am, F, Dm, G, G, Am, F, C, Em, Dm, G, C, G];
const moonMelody: Phrase[] = [
  [[.5, 64, 1.5], [2.5, 69, 1]], [[.5, 67, 1], [2, 65, 1.5]],
  [[.5, 64, 1], [2, 62, 1.5]], [[.5, 59, 2.5]],
  [[.5, 62, 1], [2, 65, 1.5]], [[.5, 64, 1.3], [2.5, 60, 1]],
  [[.5, 57, 1], [2, 60, 1.5]], [[.5, 62, 2.5]],
  [[.5, 64, 1.2], [2, 72, 1.5]], [[.5, 69, 1.2], [2.5, 67, 1]],
  [[.5, 66, 1], [2, 67, 1.5]], [[.5, 64, 2.5]],
  [[.5, 65, 1.2], [2.5, 69, 1]], [[.5, 67, 1], [2, 62, 1.5]],
  [[.5, 64, 2.5]], [[1, 59, 2]],
  [[.5, 72, 1.2], [2.5, 69, 1]], [[.5, 71, 1], [2, 67, 1.5]],
  [[.5, 74, 1.2], [2.5, 71, 1]], [[.5, 72, 1], [2, 69, 1.5]],
  [[.5, 67, 1.2], [2.5, 65, 1]], [[.5, 64, 1], [2, 62, 1.5]],
  [[.5, 59, 2.5]], [[1, 62, 2]],
  [[.5, 64, 1.5], [2.5, 69, 1]], [[.5, 67, 1], [2, 65, 1.5]],
  [[.5, 64, 1.2], [2.5, 67, 1]], [[.5, 71, 1], [2, 67, 1.5]],
  [[.5, 65, 1.2], [2.5, 62, 1]], [[.5, 59, 1], [2, 62, 1.5]], [[.5, 60, 2.7]], [],
];

function arrange(harmonies: Chord[], melody: Phrase[], calm: boolean): MusicNote[] {
  const score: MusicNote[] = [];
  harmonies.forEach(([bass, ...chord], bar) => {
    const add = (instrument: Instrument, beat: number, midi: number, duration: number, velocity: number, pan = 0) =>
      score.push({ instrument, beat: bar * 4 + beat, midi, duration, velocity, pan });
    if (calm) {
      chord.forEach((midi, i) => add('keys', i * .06, midi, 2.4, .38, -.25));
      [0, 2, 1, 3].forEach((index, i) => add('pluck', .5 + i * .75, chord[index]!, .65, .2, -.32));
      add('bass', 0, bass, 2.8, .48, -.08);
      add('brush', 3, 0, .14, .1, .15);
    } else {
      for (const beat of [0, 1.67, 3]) chord.forEach((midi, i) => add('keys', beat + i * .016, midi, .72, beat === 0 ? .47 : .32, -.24));
      add('bass', 0, bass, 1.4, .56, -.08); add('bass', 2, bass + 7, 1.2, .4, -.08);
      for (let i = 0; i < 8; i++) add('shaker', Math.floor(i / 2) + (i % 2 ? .67 : 0), 0, .1, i % 2 ? .17 : .1, .3);
      add('brush', 1, 0, .14, .14, -.2); add('brush', 3, 0, .14, .16, -.2);
      add('kick', 0, 0, .18, .18);
    }
    const sax = [6, 7, 14, 15, 18, 19, 26, 27].includes(bar);
    const flute = calm && [8, 9, 16, 17].includes(bar);
    const lead: Instrument = sax ? 'sax' : flute ? 'flute' : calm ? 'keys' : 'pluck';
    melody[bar]!.forEach(([beat, midi, duration]) => add(lead, beat, sax ? midi - 12 : midi, duration, sax ? .57 : flute ? .62 : calm ? .8 : .56, .22));
  });
  return score.sort((a, b) => a.beat - b.beat);
}
export const createTeaScore = () => arrange(teaHarmony, teaMelody, false);
export const createMoonlightScore = () => arrange(moonHarmony, moonMelody, true);
