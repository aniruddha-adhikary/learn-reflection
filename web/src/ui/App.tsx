import { useState } from 'react';
import { useHash } from './course/hashRoute';
import { useBeats } from './course/useBeats';
import { BeatBar } from './components/BeatBar';
import type { Chapter } from './course/types';
import { Landing } from './Landing';
import { chapterHref, parseRoute } from './course/route';

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
  const route = parseRoute(useHash());
  const [engineer, setEngineer] = useState(false);
  if (route.kind === 'landing') return <Landing />;
  if (route.kind === 'notFound') {
    return (
      <main className="not-found">
        <div className="kicker">Not found</div>
        <h1>We couldn’t find that course page.</h1>
        <p className="mono">{route.path}</p>
        <a className="course-link" href="#/">Back to courses</a>
      </main>
    );
  }

  const { course, index } = route;
  const chapter = course.chapters[index];
  if (chapter === undefined) throw new Error(`No chapter ${index} registered for ${course.id}`);

  return (
    <div className="app">
      <div className="topbar">
        <a className="brand" href="#/">{course.title}</a>
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
        {course.chapters.map((c, i) => (
          <a key={c.id} href={chapterHref(course, c)} aria-current={i === index ? 'page' : undefined}>
            <span className="num">{i + 1}</span>
            <span>
              <div className="t">{c.title}</div>
              <div className="s">{c.subtitle}</div>
            </span>
          </a>
        ))}
      </nav>
      <ChapterStage key={`${course.id}:${chapter.id}`} chapter={chapter} number={index + 1} engineer={engineer} />
    </div>
  );
}
