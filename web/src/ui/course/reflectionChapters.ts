import { classesChapter } from '../chapters/reflection/R1Classes';
import { membersChapter } from '../chapters/reflection/R2Members';
import { invokeChapter } from '../chapters/reflection/R3Invoke';
import { limitsChapter } from '../chapters/reflection/R4Limits';
import { proxiesChapter } from '../chapters/reflection/R5Proxies';
import { codegenChapter } from '../chapters/reflection/R6Codegen';
import { testsChapter } from '../chapters/reflection/R7Tests';
import { labChapter } from '../chapters/reflection/R8Lab';
import type { Chapter } from './types';

export const reflectionChapters: readonly Chapter[] = [
  classesChapter,
  membersChapter,
  invokeChapter,
  limitsChapter,
  proxiesChapter,
  codegenChapter,
  testsChapter,
  labChapter,
];
