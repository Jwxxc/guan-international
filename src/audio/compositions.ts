import type { Instrument, MusicNote } from './score';

type Harmony = { bass: number; notes: number[] };
type Phrase = Array<[beat: number, midi: number, duration: number]>;
const F = { bass: 41, notes: [57, 60, 64, 67] };
const Dm = { bass: 38, notes: [53, 57, 60, 64] };
const Gm = { bass: 43, notes: [53, 57, 58, 62] };
const C = { bass: 36, notes: [52, 58, 62, 67] };
const Bb = { bass: 46, notes: [53, 57, 60, 62] };
const Am = { bass: 45, notes: [55, 59, 60, 64] };
const A = { bass: 45, notes: [55, 58, 61, 64] };
const G = { bass: 43, notes: [54, 57, 59, 62] };
const Em = { bass: 40, notes: [55, 59, 62, 66] };
const Cm = { bass: 36, notes: [55, 58, 62, 63] };
const D = { bass: 38, notes: [54, 60, 64, 69] };

// Original 32-bar A/A'/B/A' melodies; independent harmony, phrasing and grooves.
const eveningHarmony = [F, Dm, Gm, C, Am, Dm, Gm, C, F, Dm, Bb, C, Am, A, Gm, C, Bb, Bb, Am, Dm, Gm, C, F, F, Bb, C, Am, Dm, Gm, C, F, C];
const eveningMelody: Phrase[] = [
  [[.5, 69, 1.25], [2.25, 67, 1.1]], [[.25, 65, 1.4], [2.5, 64, .8]],
  [[.5, 62, .75], [1.75, 65, 1.4]], [[.75, 64, 1], [2.25, 62, .95]],
  [[.5, 64, .8], [1.75, 67, 1.35]], [[.5, 69, 1.4], [2.75, 65, .65]],
  [[.25, 67, .7], [1.5, 65, .9], [3, 62, .6]], [[.5, 64, 2.2]],
  [[.5, 69, .9], [1.75, 72, 1.5]], [[.5, 69, 1.25], [2.5, 65, .9]],
  [[.5, 65, 1], [2, 62, 1.5]], [[.75, 64, .8], [2, 67, 1.1]],
  [[.5, 71, 1], [2, 69, 1.2]], [[.5, 67, .85], [2, 61, 1.35]],
  [[.5, 62, .8], [1.75, 65, 1.3]], [[.5, 64, 2]],
  [[.5, 70, 1.2], [2.25, 69, 1]], [[.25, 65, .8], [1.5, 62, 1.6]],
  [[.5, 64, 1], [2, 67, 1.2]], [[.5, 69, .9], [2, 72, 1.2]],
  [[.5, 70, 1.2], [2.25, 69, .9]], [[.5, 67, 1], [2.25, 64, 1]],
  [[.5, 65, 2.25]], [[1, 60, 1.75]],
  [[.5, 62, .8], [1.75, 65, 1.3]], [[.5, 67, 1.2], [2.25, 64, 1]],
  [[.5, 64, .8], [1.75, 67, 1.3]], [[.5, 65, 1.1], [2.25, 62, 1]],
  [[.5, 62, .85], [1.75, 65, 1.25]], [[.5, 64, 1.2], [2.25, 62, .8]],
  [[.5, 65, 2.5]], [],
];
const breezeHarmony = [G, Em, Am, D, G, Em, Am, D, G, Em, C, D, G, Em, Am, D, C, Cm, G, Em, Am, D, G, D, C, D, G, Em, Am, D, G, D];
const breezeMelody: Phrase[] = [
  [[.25, 67, .4], [1, 71, .6], [2, 69, .4], [2.75, 67, .8]],
  [[.5, 66, .4], [1.25, 67, .55], [2.5, 71, .85]],
  [[.25, 72, .6], [1.5, 71, .4], [2.25, 69, .9]],
  [[.5, 66, .45], [1.25, 64, .45], [2.25, 62, 1]],
  [[.25, 67, .4], [1, 71, .6], [2, 74, .4], [2.75, 71, .8]],
  [[.5, 69, .4], [1.25, 67, .55], [2.5, 66, .85]],
  [[.25, 64, .6], [1.5, 67, .4], [2.25, 69, .9]],
  [[.5, 66, .5], [1.5, 62, 1.4]],
  [[.25, 71, .4], [1, 74, .6], [2, 76, .4], [2.75, 74, .8]],
  [[.5, 71, .4], [1.25, 69, .55], [2.5, 67, .85]],
  [[.25, 64, .6], [1.5, 67, .4], [2.25, 72, .9]],
  [[.5, 69, .45], [1.25, 66, .45], [2.25, 64, 1]],
  [[.25, 67, .6], [1.5, 69, .4], [2.25, 71, .9]],
  [[.5, 74, .4], [1.25, 71, .55], [2.5, 67, .85]],
  [[.25, 69, .6], [1.5, 67, .4], [2.25, 64, .9]],
  [[.5, 66, .5], [1.5, 69, 1.4]],
  [[.25, 72, .6], [1.5, 76, .4], [2.25, 74, .9]],
  [[.5, 75, .5], [1.5, 74, .5], [2.5, 72, .8]],
  [[.25, 71, .6], [1.5, 69, .4], [2.25, 67, .9]],
  [[.5, 66, .4], [1.25, 67, .55], [2.5, 71, .85]],
  [[.25, 72, .6], [1.5, 71, .4], [2.25, 69, .9]],
  [[.5, 66, .5], [1.5, 64, .5], [2.5, 62, .8]],
  [[.25, 67, .7], [1.75, 71, 1.2]], [[.5, 69, .65], [2, 66, 1]],
  [[.25, 64, .6], [1.5, 67, .4], [2.25, 72, .9]],
  [[.5, 69, .45], [1.25, 66, .45], [2.25, 64, 1]],
  [[.25, 67, .4], [1, 71, .6], [2, 74, .4], [2.75, 71, .8]],
  [[.5, 69, .4], [1.25, 67, .55], [2.5, 64, .85]],
  [[.25, 69, .6], [1.5, 67, .4], [2.25, 64, .9]],
  [[.5, 66, .5], [1.5, 64, .5], [2.5, 62, .8]],
  [[.25, 67, 2.7]], [],
];

function arrange(harmonies: Harmony[], melody: Phrase[], evening: boolean): MusicNote[] {
  const score: MusicNote[] = [];
  harmonies.forEach((harmony, bar) => {
    const add = (instrument: Instrument, beat: number, midi: number, duration: number, velocity: number, pan = 0) => {
      score.push({ instrument, beat: bar * 4 + beat, midi, duration, velocity, pan });
    };
    if (evening) {
      // Piano opens each phrase; a lower sax voice answers, with space to breathe.
      for (const beat of [0, 2.5]) harmony.notes.forEach((midi, i) => add('keys', beat + i * .035, midi, 1.35, beat === 0 ? .46 : .32, -.3));
      add('bass', 0, harmony.bass, 2, .5, -.08);
      add('bass', 2.75, harmony.bass + 7, .85, .3, -.08);
      const saxLead = [2, 3, 10, 11, 16, 17, 18, 19, 26, 27].includes(bar);
      melody[bar]!.forEach(([beat, midi, duration]) => add(saxLead ? 'sax' : 'keys', beat, saxLead ? midi - 12 : midi, duration, saxLead ? .62 : .82, .22));
      add('brush', 1, 0, .14, .12, -.2); add('brush', 3, 0, .14, .15, -.2);
      for (const beat of [.5, 1.5, 2.5, 3.5]) add('shaker', beat, 0, .1, .12, .3);
    } else {
      // Alternating fingerpicked accompaniment, a lilting melody and light percussion.
      harmony.notes.forEach((midi, i) => add('keys', i * .018, midi, 1.1, .4, -.25));
      for (let eighth = 0; eighth < 8; eighth++) {
        const beat = eighth * .5 + (eighth % 2 ? .055 : 0);
        add('pluck', beat, harmony.notes[[0, 2, 1, 3][eighth % 4]!]!, .38, eighth % 2 ? .21 : .27, -.32);
        add('shaker', beat, 0, .1, eighth % 2 ? .21 : .13, .35);
      }
      add('bass', 0, harmony.bass, 1.4, .6, -.08);
      add('bass', 2, harmony.bass + 7, 1.1, .42, -.08);
      const lead: Instrument = [4, 5, 12, 13, 24, 25].includes(bar) ? 'flute'
        : [8, 9, 16, 17, 18, 19].includes(bar) ? 'sax' : 'pluck';
      melody[bar]!.forEach(([beat, midi, duration], i) => add(lead, beat + (i % 2 ? .018 : 0), lead === 'sax' ? midi - 12 : midi, duration, lead === 'sax' ? .57 : lead === 'flute' ? .68 : i === 0 ? .64 : .54, .24));
      add('brush', 1, 0, .14, .17, -.18); add('brush', 3, 0, .14, .19, -.18);
      add('kick', 0, 0, .18, .22); add('kick', 2, 0, .18, .17);
    }
  });
  return score.sort((a, b) => a.beat - b.beat);
}

export const createEveningScore = (): MusicNote[] => arrange(eveningHarmony, eveningMelody, true);
export const createBreezeScore = (): MusicNote[] => arrange(breezeHarmony, breezeMelody, false);
