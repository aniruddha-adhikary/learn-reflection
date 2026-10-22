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
    title: 'Reflection in Java: deep dive',
    audience: 'Engineers',
    blurb: 'Explore Java reflection step by step, from class metadata to dynamic proxies and practical tooling.',
    chapters: reflectionChapters,
  },
];
