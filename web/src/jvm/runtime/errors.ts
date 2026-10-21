export class UnsupportedBytecode extends Error {
  public constructor(mnemonic: string, className: string, methodName: string) {
    super(`Unsupported bytecode ${mnemonic} in ${className}.${methodName}`);
    this.name = 'UnsupportedBytecode';
  }
}

export class UnsupportedNative extends Error {
  public constructor(owner: string, name: string, descriptor: string) {
    super(`Unregistered native method ${owner}.${name}${descriptor}`);
    this.name = 'UnsupportedNative';
  }
}

export class StepBudgetExceeded extends Error {
  public constructor(public readonly budget: number) {
    super(`JVM step budget of ${budget} instructions exceeded`);
    this.name = 'StepBudgetExceeded';
  }
}
