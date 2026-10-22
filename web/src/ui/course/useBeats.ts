import { useCallback, useEffect, useState } from 'react';
import type { Beat } from './types';

export interface BeatController {
  readonly index: number;
  readonly playing: boolean;
  readonly maxSeen: number;
  readonly go: (index: number) => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly toggle: () => void;
}

export function useBeats(beats: readonly Beat[]): BeatController {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [maxSeen, setMaxSeen] = useState(0);
  const last = beats.length - 1;

  const go = useCallback(
    (target: number) => {
      const clamped = Math.max(0, Math.min(last, target));
      setIndex(clamped);
      setMaxSeen((m) => Math.max(m, clamped));
    },
    [last],
  );

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const beat = beats[index];
    if (beat === undefined) return;
    const timer = window.setTimeout(() => go(index + 1), beat.ms);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, beats, go]);

  const next = useCallback(() => go(index + 1), [go, index]);
  const prev = useCallback(() => go(index - 1), [go, index]);
  const toggle = useCallback(() => {
    if (!playing && index >= last) {
      go(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [playing, index, last, go]);

  return { index, playing, maxSeen, go, next, prev, toggle };
}
