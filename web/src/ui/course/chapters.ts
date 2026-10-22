import type { Chapter } from './types';
import { scaleChapter } from '../chapters/Ch1Scale';
import { worldsChapter } from '../chapters/Ch2Worlds';
import { namesChapter } from '../chapters/Ch3Names';
import { Placeholder } from '../chapters/Placeholder';
import { tryChapter } from '../chapters/Ch8Try';

const soon = (id: string, title: string, subtitle: string): Chapter => ({
  id,
  title,
  subtitle,
  beats: [{ caption: 'Coming next.', ms: 4000 }],
  Scene: Placeholder,
});

export const chapters: readonly Chapter[] = [
  scaleChapter,
  worldsChapter,
  namesChapter,
  soon('bytecode', 'Read the machine', 'Follow values through bytecode'),
  soon('binding', 'Bind old to new', 'The one job we give to AI'),
  soon('shape', 'Change the shape, keep the logic', 'Same rule, new data flow'),
  soon('fuzz', 'Prove it', 'Differential fuzzing across two systems'),
  tryChapter,
];
