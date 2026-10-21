import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Beat } from '../course/types';
import type { BeatController } from '../course/useBeats';

interface Props {
  readonly beats: readonly Beat[];
  readonly ctl: BeatController;
  readonly engineer: boolean;
}

export function BeatBar({ beats, ctl, engineer }: Props) {
  const beat = beats[ctl.index];
  const { next, prev, toggle } = ctl;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, toggle]);

  return (
    <div className="beatbar">
      <div className="controls">
        <button className="iconbtn" onClick={prev} aria-label="Previous step">
          ◀
        </button>
        <button className="iconbtn primary" onClick={toggle} aria-label={ctl.playing ? 'Pause' : 'Play'}>
          {ctl.playing ? '❚❚' : '▶'}
        </button>
        <button className="iconbtn" onClick={next} aria-label="Next step">
          ▶▶
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={ctl.index}
          className="caption"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          {beat?.caption}
          {engineer && beat?.detail !== undefined && <span className="detail">{beat.detail}</span>}
        </motion.div>
      </AnimatePresence>
      <div className="dots" role="tablist" aria-label="Steps">
        {beats.map((b, i) => (
          <button
            key={b.caption}
            aria-label={`Step ${String(i + 1)}`}
            aria-current={i === ctl.index ? 'step' : undefined}
            className={i <= ctl.maxSeen ? 'seen' : undefined}
            onClick={() => ctl.go(i)}
          />
        ))}
      </div>
    </div>
  );
}
