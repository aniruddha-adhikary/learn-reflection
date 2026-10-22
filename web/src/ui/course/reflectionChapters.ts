import { classesChapter } from '../chapters/reflection/R1Classes';
import { membersChapter } from '../chapters/reflection/R2Members';
import { invokeChapter } from '../chapters/reflection/R3Invoke';
import { limitsChapter } from '../chapters/reflection/R4Limits';
import { asmReadChapter } from '../chapters/reflection/A1AsmRead';
import { asmWriteChapter } from '../chapters/reflection/A2AsmWrite';
import { proxiesChapter } from '../chapters/reflection/R5Proxies';
import { bbSubclassChapter } from '../chapters/reflection/B1Subclass';
import { bbAgentChapter } from '../chapters/reflection/B2Agent';
import { codegenChapter } from '../chapters/reflection/R6Codegen';
import { testsChapter } from '../chapters/reflection/R7Tests';
import { whichToolChapter } from '../chapters/reflection/T1Which';
import { labChapter } from '../chapters/reflection/R8Lab';
import type { Chapter } from './types';

export const reflectionChapters: readonly Chapter[] = [
  classesChapter,
  membersChapter,
  invokeChapter,
  limitsChapter,
  asmReadChapter,
  asmWriteChapter,
  proxiesChapter,
  bbSubclassChapter,
  bbAgentChapter,
  codegenChapter,
  testsChapter,
  whichToolChapter,
  labChapter,
];
