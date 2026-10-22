import { describe, expect, it } from 'vitest';
import { courses } from '../src/ui/course/courses';
import { chapterHref, parseRoute } from '../src/ui/course/route';

const overview = courses.find((course) => course.id === 'overview');
const reflection = courses.find((course) => course.id === 'reflection');

if (!overview || !reflection) throw new Error('Expected overview and reflection courses');
const firstOverviewChapter = overview.chapters[0];
const firstReflectionChapter = reflection.chapters[0];
if (!firstOverviewChapter || !firstReflectionChapter) throw new Error('Expected each course to have a first chapter');

describe('parseRoute', () => {
  it('routes an empty path to the landing page', () => {
    expect(parseRoute('')).toEqual({ kind: 'landing' });
  });

  it.each([
    ['names', 'names'],
    ['bytecode', 'bytecode'],
    ['binding', 'binding'],
    ['shape', 'shape'],
    ['fuzz', 'fuzz'],
    ['try', 'try'],
    ['scale', 'scale'],
    ['worlds', 'worlds'],
  ])('preserves the overview short link %s', (path, chapterId) => {
    const route = parseRoute(path);
    expect(route.kind).toBe('chapter');
    if (route.kind === 'chapter') {
      expect(route.course.id).toBe('overview');
      expect(route.course.chapters[route.index]?.id).toBe(chapterId);
    }
  });

  it.each(overview.chapters.map((chapter) => chapter.id))('routes overview/%s to that chapter', (chapterId) => {
    expect(parseRoute(`overview/${chapterId}`)).toMatchObject({
      kind: 'chapter',
      course: overview,
      index: overview.chapters.findIndex((chapter) => chapter.id === chapterId),
    });
  });

  it('routes reflection to its first chapter', () => {
    expect(parseRoute('reflection')).toEqual({ kind: 'chapter', course: reflection, index: 0 });
  });

  it.each(reflection.chapters.map((chapter) => chapter.id))('routes reflection/%s to that chapter', (chapterId) => {
    expect(parseRoute(`reflection/${chapterId}`)).toMatchObject({
      kind: 'chapter',
      course: reflection,
      index: reflection.chapters.findIndex((chapter) => chapter.id === chapterId),
    });
  });

  it.each(['overview/missing', 'reflection/missing', 'missing/path', 'names/extra'])(
    'returns notFound for %s without falling back',
    (path) => {
      expect(parseRoute(path)).toEqual({ kind: 'notFound', path });
    },
  );
});

describe('chapterHref', () => {
  it('keeps overview chapter links short', () => {
    expect(chapterHref(overview, firstOverviewChapter)).toBe('#/scale');
  });

  it('includes the reflection course in reflection links', () => {
    expect(chapterHref(reflection, firstReflectionChapter)).toBe('#/reflection/classes');
  });
});
