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
  readonly locals: readonly (JvmValue | undefined)[];
  readonly stack: readonly JvmValue[];
  readonly depth: number;
}

export interface JvmOptions {
  readonly stepBudget?: number;
  readonly onStep?: (event: StepEvent) => void;
  readonly onInvoke?: (event: InvokeEvent) => void;
  readonly onReturn?: (event: ReturnEvent) => void;
}

export interface InvokeEvent {
  readonly owner: string;
  readonly name: string;
  readonly descriptor: string;
  readonly args: readonly JvmValue[];
  readonly depth: number;
}

export type ReturnEvent = InvokeEvent &
  (
    | { readonly result: JvmValue; readonly thrown?: never }
    | { readonly thrown: string; readonly result?: never }
  );

export type JvmNative = (receiver: JvmValue, args: readonly JvmValue[]) => JvmValue;

export type RunResult =
  | { readonly result: JvmValue }
  | { readonly threw: string; readonly message: string };
