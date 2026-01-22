import { useCallback, useRef } from 'react';

export function useSoundNotification() {
  const audioContextRef = useRef<AudioContext | null>(null);

  const playSound = useCallback((type: 'error' | 'burst') => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      )();
    }
    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (type === 'error') {
      oscillator.frequency.value = 220;
      oscillator.type = 'sine';
    } else {
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
    }

    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  }, []);

  return playSound;
}
