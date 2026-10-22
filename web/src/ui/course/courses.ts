import { chapters } from './chapters';
import { reflectionChapters } from './reflectionChapters';
import type { Chapter } from './types';

export interface Course {
  readonly id: 'overview' | 'reflection';
  readonly title: string;
  readonly audience: string;
  readonly blurb: string;
  readonly chapters: readonly Chapter[];
}

export const courses: readonly Course[] = [
  {
    id: 'overview',
    title: 'Modernize by reflection: the big picture',
    audience: 'Everyone: engineers, PMs, stakeholders',
    blurb: 'See how reflection, bytecode analysis, and differential testing can help modernize a legacy system.',
    chapters,
  },
  {
    id: 'reflection',
    title: 'Reflection, ASM and ByteBuddy: deep dive',
    audience: 'Engineers',
    blurb: 'Reflection to see what a class has, ASM to read and rewrite what it does, ByteBuddy to watch it run. All live, on the same legacy classes.',
    chapters: reflectionChapters,
  },
];
