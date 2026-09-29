import { tx } from '../i18n';
import { Music2, SkipForward, Volume2 } from 'lucide-react';
import type { AudioSettings, MusicStatus } from '../audio/player';
import { getMusicTrack, getMusicPlaybackMode, getNextMusicTrack, MUSIC_TRACKS } from '../audio/tracks';

export function MusicSettings({ settings, status, onChange }: {
  settings: AudioSettings;
  status: MusicStatus;
  onChange: (patch: Partial<AudioSettings>) => void;
}) {
  const track = getMusicTrack(settings.musicTrack);
  return <div className="music-settings">
    <label className="setting-row"><span><strong><Music2 size={16}/>{tx("背景音乐")}</strong><small>{tx(track.description)}</small></span><input type="checkbox" role="switch" aria-label={tx("背景音乐")} checked={settings.musicEnabled} onChange={event => onChange({ musicEnabled: event.target.checked })}/></label>
    <div className="music-track-controls"><label className="music-track-setting"><span>{tx("当前曲目")}</span><select aria-label={tx("背景音乐曲目")} value={track.id} onChange={event => onChange({ musicTrack: getMusicTrack(event.target.value).id })}>{tx(MUSIC_TRACKS.map(item => <option key={item.id} value={item.id}>{tx(item.title)}</option>))}</select></label><button type="button" className="music-next" onClick={() => onChange({ musicTrack: getNextMusicTrack(track.id).id })}><SkipForward size={14}/>{tx("下一曲")}</button></div>
    <label className="music-track-setting"><span>{tx("播放方式")}</span><select aria-label={tx("背景音乐播放方式")} value={getMusicPlaybackMode(settings.musicPlaybackMode)} onChange={event => onChange({ musicPlaybackMode: getMusicPlaybackMode(event.target.value) })}><option value="sequence">{tx("顺序播放")}</option><option value="repeat-one">{tx("单曲循环")}</option></select></label>
    <p className="music-playback-note">{tx(getMusicPlaybackMode(settings.musicPlaybackMode) === 'sequence' ? `${MUSIC_TRACKS.length} 首依次播放，末曲后回到第一首。` : '重复播放当前曲目。')}{' '}{tx("切歌时柔和渐变。")}</p>
    <label className="volume-setting"><Volume2 size={15}/><span>{tx("音乐音量")}</span><input type="range" aria-label={tx("音乐音量")} min="0" max="100" value={Math.round(settings.musicVolume * 100)} onChange={event => onChange({ musicVolume: Number(event.target.value) / 100 })}/><output>{tx(Math.round(settings.musicVolume * 100))}%</output></label>
    {tx(status === 'unavailable' && <p className="music-notice">{tx("浏览器暂时无法播放音频，牌局可正常继续。")}</p>)}
  </div>;
}
