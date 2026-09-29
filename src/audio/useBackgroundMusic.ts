import { useCallback, useEffect, useRef, useState } from 'react';
import { GuanAudioPlayer, type AudioSettings, type MusicStatus } from './player';
import type { GameSound } from './effects';
import type { MusicTrackId } from './tracks';

export function useBackgroundMusic(settings: AudioSettings, onTrackChange: (musicTrack: MusicTrackId) => void) {
  const player = useRef<GuanAudioPlayer | null>(null);
  const currentSettings = useRef(settings); currentSettings.current = settings;
  const trackChange = useRef(onTrackChange); trackChange.current = onTrackChange;
  const [status, setStatus] = useState<MusicStatus>(settings.musicEnabled ? 'ready' : 'muted');
  useEffect(() => {
    const audio = new GuanAudioPlayer(currentSettings.current, document.hidden, setStatus, track => trackChange.current(track));
    player.current = audio;
    const gesture = (event: Event) => { if (event.isTrusted) audio.unlock(); };
    const visibility = () => audio.setHidden(document.hidden);
    document.addEventListener('pointerdown', gesture, { capture: true, passive: true });
    document.addEventListener('keydown', gesture, { capture: true });
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerdown', gesture, true);
      document.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
      audio.dispose(); if (player.current === audio) player.current = null;
    };
  }, []);
  useEffect(() => { player.current?.configure(settings); }, [settings.musicEnabled, settings.musicVolume, settings.musicTrack, settings.musicPlaybackMode, settings.muted]);
  const sound = useCallback((kind: GameSound) => player.current?.effect(kind), []);
  return { musicStatus: status, sound };
}
