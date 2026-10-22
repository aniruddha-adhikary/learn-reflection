export { facts, factsFromParsed, type FactsResult, type ClassFacts, type FactField, type FactProperty } from './facts';
export {
  dataflow,
  dataflowFromParsed,
  getterFlows,
  getterFlowsFromParsed,
  type DataflowResult,
  type DataflowTrace,
  type FlowInstruction,
  type GetterFlow,
} from './dataflow';
export { transform, transformFromParsed, type TransformResult, type RuleRecord } from './transform';
export { evidence, type EvidenceResult, type EvidenceRow, type EvidenceTrace } from './evidence';
export {
  fuzz,
  evaluateCondition,
  modernOutcome,
  type FuzzResult,
  type FuzzData,
  type FuzzCaseTrace,
  type Outcome,
} from './fuzz';
export { inert, type InertResult } from './inert';
export { ruleSteps, type RuleRun, type RuleStep } from './steps';
export {
  badTargetDescriptorMessage,
  defaultRewriteTarget,
  memberRefs,
  rewriteLab,
  visitEvents,
  type BridgeCall,
  type MemberInstructionRef,
  type MemberRef,
  type MethodMemberRefs,
  type RewriteApplicantResult,
  type RewriteLabResult,
  type RewrittenRule,
  type VisitEvent,
} from './asm-lab';
export {
  getterRecorder,
  recordReplay,
  type GetterRecord,
  type RecordedApplicant,
  type RecordReplayResult,
} from './instrument-lab';
export {
  APPLICANT_COLUMNS,
  buildFromRow,
  classView,
  courseClassNames,
  implementors,
  invokeLab,
  proxyLab,
  type ClassView,
  type LabCall,
  type LabValue,
  type MemberView,
  type MethodView,
  type PropertyView,
  type ProxyEvent,
  type ProxyRun,
  type RowBinding,
  type RowBuild,
} from './reflect-lab';
export { JavaRandom, javaStringHash } from './java-random';
export { csvRows } from './common';
export type { ClassBytes, ParsedClasses } from './common';
