import { createMusicScore, MUSIC_BEATS, MUSIC_BPM, MUSIC_TITLE, type MusicNote } from './score';
import { createBreezeScore, createEveningScore } from './compositions';
import { createTeaScore, createMoonlightScore } from './newCompositions';
import { createBambooScore, createWaltzScore } from './styleCompositions';

export type MusicTrackId = 'afternoon' | 'evening' | 'breeze' | 'tea' | 'moonlight' | 'waltz' | 'bamboo';
export type MusicPlaybackMode = 'sequence' | 'repeat-one';
export const getMusicPlaybackMode = (value: unknown): MusicPlaybackMode => value === 'repeat-one' ? 'repeat-one' : 'sequence';
export interface MusicTrack {
  id: MusicTrackId;
  title: string;
  description: string;
  bpm: number;
  beats: number;
  beatsPerBar?: 3 | 4;
  score: () => MusicNote[];
}
export const DEFAULT_MUSIC_TRACK: MusicTrackId = 'afternoon';
export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: 'afternoon', title: MUSIC_TITLE, description: '轻快键盘 · 萨克斯接句', bpm: MUSIC_BPM, beats: MUSIC_BEATS, score: createMusicScore },
  { id: 'evening', title: '晚灯慢叙', description: '暖钢琴 · 柔和萨克斯', bpm: 82, beats: 128, score: createEveningScore },
  { id: 'breeze', title: '微风小聚', description: '轻盈拨弦 · 长笛与萨克斯', bpm: 112, beats: 128, score: createBreezeScore },
  { id: 'tea', title: '茶香闲局', description: '摇摆钢琴 · 轻柔拨弦与萨克斯', bpm: 96, beats: 128, score: createTeaScore },
  { id: 'moonlight', title: '月下归舟', description: '慢拍琴音 · 长笛与低音萨克斯', bpm: 76, beats: 128, score: createMoonlightScore },
  { id: 'waltz', title: '灯影圆舞', description: '爵士华尔兹 · 单簧管与轻刷鼓', bpm: 90, beats: 96, beatsPerBar: 3, score: createWaltzScore },
  { id: 'bamboo', title: '竹庭清风', description: '清淡国风 · 古筝与笛子', bpm: 72, beats: 128, score: createBambooScore },
];
export function getMusicTrack(id: unknown): MusicTrack {
  return MUSIC_TRACKS.find(track => track.id === id) ?? MUSIC_TRACKS[0]!;
}
export function getNextMusicTrack(id: unknown): MusicTrack {
  return MUSIC_TRACKS[(MUSIC_TRACKS.indexOf(getMusicTrack(id)) + 1) % MUSIC_TRACKS.length]!;
}
