import { courses, type Course } from './courses';
import type { Chapter } from './types';

export type Route =
  | { readonly kind: 'landing' }
  | { readonly kind: 'chapter'; readonly course: Course; readonly index: number }
  | { readonly kind: 'notFound'; readonly path: string };

export function parseRoute(path: string): Route {
  if (path === '') return { kind: 'landing' };

  const overview = courseById('overview');
  const reflection = courseById('reflection');

  if (path === 'reflection') return { kind: 'chapter', course: reflection, index: 0 };

  const segments = path.split('/');
  if (segments.length === 1) {
    const index = overview.chapters.findIndex((chapter) => chapter.id === path);
    return index < 0 ? { kind: 'notFound', path } : { kind: 'chapter', course: overview, index };
  }

  if (segments.length === 2) {
    const [courseId, chapterId] = segments;
    if (courseId === 'overview' && chapterId !== undefined) {
      const index = overview.chapters.findIndex((chapter) => chapter.id === chapterId);
      return index < 0 ? { kind: 'notFound', path } : { kind: 'chapter', course: overview, index };
    }
    if (courseId === 'reflection' && chapterId !== undefined) {
      const index = reflection.chapters.findIndex((chapter) => chapter.id === chapterId);
      return index < 0 ? { kind: 'notFound', path } : { kind: 'chapter', course: reflection, index };
    }
  }

  return { kind: 'notFound', path };
}

export function chapterHref(course: Course, chapter: Chapter): string {
  return course.id === 'overview' ? `#/${chapter.id}` : `#/reflection/${chapter.id}`;
}

function courseById(id: Course['id']): Course {
  const course = courses.find((candidate) => candidate.id === id);
  if (!course) throw new Error(`Missing course ${id}`);
  return course;
}
