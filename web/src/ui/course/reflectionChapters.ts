import { Placeholder } from '../chapters/Placeholder';
import type { Beat, Chapter } from './types';

const beats: readonly Beat[] = [{ caption: 'This chapter is being built.', ms: 0 }];

export const reflectionChapters: readonly Chapter[] = [
  { id: 'classes', title: 'Class objects', subtitle: 'What is this thing?', beats, Scene: Placeholder },
  { id: 'members', title: 'Fields and methods', subtitle: 'List everything it has', beats, Scene: Placeholder },
  { id: 'invoke', title: 'Invoke and set', subtitle: 'Call it without naming it in code', beats, Scene: Placeholder },
  { id: 'limits', title: 'Where reflection stops', subtitle: 'Names and signatures, not behaviour', beats, Scene: Placeholder },
  { id: 'proxies', title: 'Dynamic proxies', subtitle: 'Stand in for any interface', beats, Scene: Placeholder },
  { id: 'codegen', title: 'Facts to code', subtitle: "Generate, don't hand-write", beats, Scene: Placeholder },
  { id: 'tests', title: 'Facts to tests', subtitle: 'Inputs from the code itself', beats, Scene: Placeholder },
  { id: 'lab', title: 'Lab', subtitle: 'Write your own reflection tools', beats, Scene: Placeholder },
];
