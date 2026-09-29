import type { MusicNote } from './score';
import { getMusicTrack, type MusicTrack } from './tracks';

/** Schedule against the audio clock, never against animation frames or timer cadence. */
export class MusicTransport {
  private readonly score: MusicNote[];
  private readonly secondsPerBeat: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private savedBeat = 0;
  private next = 0;
  private cycle = 0;
  private notifiedCycle = -1;
  private endsAt = Infinity;
  constructor(private readonly clock: { currentTime: number }, private readonly play: (note: MusicNote, time: number) => void, private readonly track: MusicTrack = getMusicTrack(undefined), private readonly tail?: { seconds: number; onTail: (time: number) => void }) {
    this.score = track.score();
    this.secondsPerBeat = 60 / track.bpm;
  }
  get running(): boolean { return this.timer !== null; }
  get position(): number {
    return this.running ? (this.savedBeat + Math.max(0, (this.clock.currentTime - this.startedAt) / this.secondsPerBeat)) % this.track.beats : this.savedBeat;
  }
  start(at = this.clock.currentTime + .045): void {
    if (this.running) return;
    this.startedAt = at;
    this.endsAt = Infinity;
    this.notifiedCycle = -1;
    this.seek(this.savedBeat);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }
  finishAt(time: number): void { this.endsAt = time; }
  pause(): void {
    if (!this.running) return;
    const position = this.position;
    clearInterval(this.timer!); this.timer = null; this.savedBeat = position;
  }
  private seek(beat: number): void {
    this.cycle = Math.floor(beat / this.track.beats);
    this.next = this.score.findIndex(note => note.beat >= beat % this.track.beats - .00001);
    if (this.next < 0) { this.next = 0; this.cycle++; }
  }
  private tick(): void {
    const now = this.clock.currentTime;
    if (now >= this.endsAt) { this.pause(); return; }
    const beatNow = this.savedBeat + (now - this.startedAt) / this.secondsPerBeat;
    if (this.tail && this.endsAt === Infinity) {
      const cycle = Math.max(0, Math.floor(beatNow / this.track.beats));
      const tailAt = this.startedAt + ((cycle + 1) * this.track.beats - this.savedBeat) * this.secondsPerBeat - this.tail.seconds;
      if (cycle > this.notifiedCycle && tailAt <= now + .14) {
        this.notifiedCycle = cycle;
        this.tail.onTail(Math.max(now, tailAt));
      }
    }
    const nextBeat = this.score[this.next]!.beat + this.cycle * this.track.beats;
    // A stalled main thread skips missed notes instead of releasing a burst.
    if (nextBeat < beatNow - .18) this.seek(beatNow);
    while (true) {
      const note = this.score[this.next]!;
      const time = this.startedAt + (note.beat + this.cycle * this.track.beats - this.savedBeat) * this.secondsPerBeat;
      if (time > now + .14 || time >= this.endsAt) break;
      if (time >= now - .02) this.play(note, Math.max(now, time));
      if (++this.next >= this.score.length) { this.next = 0; this.cycle++; }
    }
  }
}
