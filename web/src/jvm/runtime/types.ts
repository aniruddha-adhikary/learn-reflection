export interface JObject {
  readonly kind: 'object';
  readonly cls: string;
  readonly fields: Map<string, JvmValue>;
}

export interface JString {
  readonly kind: 'string';
  readonly cls: 'java/lang/String';
  readonly value: string;
  readonly fields: Map<string, JvmValue>;
}

export interface JArray {
  readonly kind: 'array';
  readonly descriptor: string;
  readonly values: JvmValue[];
}

export type JvmReference = JObject | JString | JArray;
export type JvmValue = number | bigint | JvmReference | null;

export interface StepEvent {
  readonly className: string;
  readonly methodName: string;
  readonly descriptor: string;
  readonly pc: number;
  readonly insnIndex: number;
  readonly locals: readonly (JvmValue | null)[];
  readonly stack: readonly JvmValue[];
  readonly depth: number;
}

export interface JvmOptions {
  readonly stepBudget?: number;
  readonly onStep?: (event: StepEvent) => void;
}

export type RunResult =
  | { readonly result: JvmValue }
  | { readonly threw: string; readonly message: string };
