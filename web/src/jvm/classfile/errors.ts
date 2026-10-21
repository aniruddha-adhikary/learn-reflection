export class ClassFormatError extends Error {
  public constructor(message: string, public readonly offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'ClassFormatError';
  }
}
