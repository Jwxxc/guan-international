/** Original GUAN composition: 「午后好牌」, a 32-bar, 104 BPM lounge/bossa loop. */
export const MUSIC_TITLE = '午后好牌';
export const MUSIC_BPM = 104;
export const SECONDS_PER_BEAT = 60 / MUSIC_BPM;
export const MUSIC_BARS = 32;
export const MUSIC_BEATS = MUSIC_BARS * 4;
export type Instrument = 'keys' | 'pluck' | 'bass' | 'shaker' | 'brush' | 'kick' | 'sax' | 'flute' | 'clarinet' | 'guzheng' | 'dizi';
export interface MusicNote { beat: number; duration: number; midi: number; velocity: number; instrument: Instrument; pan: number }
type Harmony = { bass: number; notes: number[] };
const C: Harmony = { bass: 36, notes: [52, 59, 62, 67] };
const Am: Harmony = { bass: 45, notes: [55, 59, 60, 64] };
const Dm: Harmony = { bass: 38, notes: [53, 60, 64, 69] };
const G: Harmony = { bass: 43, notes: [53, 59, 64, 69] };
const Em: Harmony = { bass: 40, notes: [55, 59, 62, 66] };
const A: Harmony = { bass: 45, notes: [55, 61, 64, 69] };
const F: Harmony = { bass: 41, notes: [52, 57, 60, 67] };
const Fm: Harmony = { bass: 41, notes: [53, 56, 60, 62] };
const harmonies = [C, Am, Dm, G, Em, A, Dm, G, C, Am, F, G, Em, Am, Dm, G, F, Fm, Em, A, Dm, G, C, C, F, G, Em, Am, Dm, G, C, G];
// Beat, pitch and held duration. Deliberate rests leave room for the cards.
const melodies: Array<Array<[number, number, number]>> = [
  [[0.5, 64, .7], [1.5, 67, .45], [2.25, 71, .65], [3.25, 69, .45]],
  [[0.25, 67, .7], [1.25, 64, 1.1], [3, 62, .65]],
  [[0.5, 65, .6], [1.5, 69, .6], [2.75, 72, .8]],
  [[.25, 71, .7], [1.25, 69, .5], [2.25, 67, 1.1]],
  [[.5, 67, .55], [1.25, 71, .55], [2.25, 74, .8]],
  [[.25, 73, .55], [1.25, 69, .75], [2.75, 67, .65]],
  [[.5, 65, .55], [1.25, 64, .55], [2.25, 62, .75], [3.25, 64, .4]],
  [[.5, 62, .6], [1.5, 59, 1.2]],
  [[.5, 64, .6], [1.5, 67, .45], [2.25, 71, .65], [3.25, 74, .45]],
  [[.25, 72, .7], [1.25, 71, .6], [2.75, 69, .75]],
  [[.5, 67, .7], [1.75, 64, .55], [2.75, 60, .7]],
  [[.25, 62, .65], [1.25, 64, .55], [2.25, 67, 1]],
  [[.5, 66, .6], [1.5, 67, .6], [2.75, 71, .7]],
  [[.25, 69, .65], [1.25, 67, .65], [2.5, 64, 1]],
  [[.5, 65, .5], [1.25, 64, .5], [2.25, 62, 1]],
  [[.5, 59, .6], [1.5, 62, .7]],
  [[.5, 69, .65], [1.5, 72, .5], [2.5, 76, .75]],
  [[.25, 74, .6], [1.25, 72, .7], [2.75, 68, .75]],
  [[.5, 67, .6], [1.5, 71, .55], [2.75, 74, .75]],
  [[.25, 73, .6], [1.25, 69, .6], [2.5, 67, .9]],
  [[.5, 65, .6], [1.5, 69, .6], [2.75, 72, .75]],
  [[.25, 71, .6], [1.25, 69, .55], [2.25, 67, .65], [3.25, 62, .45]],
  [[.5, 64, .7], [1.75, 67, .7], [3, 72, .6]],
  [[.5, 71, .65], [1.75, 67, 1.2]],
  [[.5, 69, .65], [1.5, 67, .6], [2.75, 64, .7]],
  [[.25, 62, .6], [1.25, 64, .55], [2.5, 67, .8]],
  [[.5, 71, .55], [1.25, 74, .55], [2.25, 71, .6]],
  [[.25, 69, .65], [1.25, 67, .65], [2.75, 64, .7]],
  [[.5, 65, .5], [1.25, 64, .5], [2.25, 62, .9]],
  [[.5, 59, .55], [1.5, 62, .6], [2.75, 67, .65]],
  [[.5, 64, 1.2], [2.25, 60, 1.1]],
  [],
];

export function createMusicScore(): MusicNote[] {
  const score: MusicNote[] = [];
  for (let bar = 0; bar < MUSIC_BARS; bar++) {
    const harmony = harmonies[bar]!;
    const add = (instrument: Instrument, beat: number, midi: number, duration: number, velocity: number, pan = 0) => {
      score.push({ instrument, beat: bar * 4 + beat, midi, duration, velocity, pan });
    };
    // Gently staggered chord attacks have the touch of a brushed piano comp.
    for (const [beat, strength] of [[0, .61], [1.5, .44], [2.75, .5]]) {
      harmony.notes.forEach((midi, index) => add('keys', beat! + index * .013, midi, .82, strength!, -.3 + index * .08));
    }
    add('bass', 0, harmony.bass, 1.25, .68, -.08);
    add('bass', 1.75, harmony.bass + 7, .55, .43, -.08);
    add('bass', 2.5, harmony.bass + 12, .9, .5, -.08);
    if (bar % 4 === 3) add('bass', 3.5, harmonies[(bar + 1) % MUSIC_BARS]!.bass + 7, .35, .38, -.08);
    // Short sax replies between the familiar plucked phrases, then a middle-section solo.
    const saxLead = [2, 3, 10, 11, 18, 19, 20, 21].includes(bar);
    melodies[bar]!.forEach(([beat, midi, duration], i) => add(saxLead ? 'sax' : 'pluck', beat + (i % 2 ? .018 : 0), midi, duration, saxLead ? .58 : i === 0 ? .67 : .56, .2));
    for (let eighth = 0; eighth < 8; eighth++) add('shaker', eighth * .5 + (eighth % 2 ? .025 : 0), 0, .1, eighth % 2 ? .28 : .17, eighth % 2 ? .4 : -.4);
    add('brush', 1, 0, .14, .2, -.18); add('brush', 3, 0, .14, .23, -.18);
    add('kick', 0, 0, .18, .3); add('kick', 2, 0, .18, .23);
  }
  return score.sort((a, b) => a.beat - b.beat);
}

export const midiFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
