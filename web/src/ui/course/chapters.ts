import type { Chapter } from './types';
import { scaleChapter } from '../chapters/Ch1Scale';
import { worldsChapter } from '../chapters/Ch2Worlds';
import { namesChapter } from '../chapters/Ch3Names';
import { machineChapter } from '../chapters/Ch4Machine';
import { bindingChapter } from '../chapters/Ch5Binding';
import { shapeChapter } from '../chapters/Ch6Shape';
import { fuzzChapter } from '../chapters/Ch7Fuzz';
import { tryChapter } from '../chapters/Ch8Try';

export const chapters: readonly Chapter[] = [
  scaleChapter,
  worldsChapter,
  namesChapter,
  machineChapter,
  bindingChapter,
  shapeChapter,
  fuzzChapter,
  tryChapter,
];
