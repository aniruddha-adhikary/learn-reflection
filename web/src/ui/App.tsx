import { useState } from 'react';
import { chapters } from './course/chapters';
import { useHash } from './course/hashRoute';
import { useBeats } from './course/useBeats';
import { BeatBar } from './components/BeatBar';
import type { Chapter } from './course/types';

function ChapterStage({ chapter, number, engineer }: { chapter: Chapter; number: number; engineer: boolean }) {
  const ctl = useBeats(chapter.beats);
  const { Scene } = chapter;
  return (
    <section className="stage" aria-label={chapter.title}>
      <header className="stage-head">
        <div className="kicker">Chapter {number}</div>
        <h1>{chapter.title}</h1>
      </header>
      <div className="scene">
        <Scene beat={ctl.index} engineer={engineer} />
      </div>
      <BeatBar beats={chapter.beats} ctl={ctl} engineer={engineer} />
    </section>
  );
}

export function App() {
  const route = useHash();
  const [engineer, setEngineer] = useState(false);
  const index = Math.max(0, chapters.findIndex((c) => c.id === route));
  const chapter = chapters[index] ?? chapters[0];
  if (chapter === undefined) throw new Error('No chapters registered');

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Modernize <span>by reflection</span>
        </div>
        <div className="spacer" />
        <div className="mode-toggle" role="group" aria-label="Detail level">
          <button aria-pressed={!engineer} onClick={() => setEngineer(false)}>
            Big picture
          </button>
          <button aria-pressed={engineer} onClick={() => setEngineer(true)}>
            Engineer view
          </button>
        </div>
      </div>
      <nav className="rail" aria-label="Chapters">
        {chapters.map((c, i) => (
          <a key={c.id} href={`#/${c.id}`} aria-current={c.id === chapter.id ? 'page' : undefined}>
            <span className="num">{i + 1}</span>
            <span>
              <div className="t">{c.title}</div>
              <div className="s">{c.subtitle}</div>
            </span>
          </a>
        ))}
      </nav>
      <ChapterStage key={chapter.id} chapter={chapter} number={index + 1} engineer={engineer} />
    </div>
  );
}
