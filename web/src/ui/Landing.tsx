import { motion } from 'motion/react';
import { courses } from './course/courses';
import { chapterHref } from './course/route';

export function Landing() {
  return (
    <main className="landing">
      <motion.header
        className="landing-intro"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="kicker">Interactive, offline courses</div>
        <h1>Modernize legacy systems by understanding what they do.</h1>
        <p>Choose a course to explore the ideas or go deep on Java reflection.</p>
      </motion.header>
      <div className="course-grid">
        {courses.map((course, index) => {
          const firstChapter = course.chapters[0];
          if (!firstChapter) throw new Error(`Course ${course.id} has no chapters`);
          return (
            <motion.article
              key={course.id}
              className="course-card"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: index * 0.08 }}
            >
              <div className="course-audience">{course.audience}</div>
              <h2>{course.title}</h2>
              <p className="course-blurb">{course.blurb}</p>
              <div className="course-count">{course.chapters.length} chapters</div>
              <a className="course-link" href={chapterHref(course, firstChapter)}>
                Start course <span aria-hidden="true">→</span>
              </a>
            </motion.article>
          );
        })}
      </div>
    </main>
  );
}
