import { ClassFormatError } from './errors';

export class Reader {
  private position = 0;

  public constructor(
    private readonly bytes: Uint8Array,
    private readonly baseOffset = 0,
  ) {}

  public get offset(): number {
    return this.baseOffset + this.position;
  }

  public get remaining(): number {
    return this.bytes.length - this.position;
  }

  public u1(): number {
    this.ensure(1);
    const value = this.bytes[this.position];
    if (value === undefined) this.fail('Truncated input');
    this.position += 1;
    return value;
  }

  public u2(): number {
    return (this.u1() << 8) | this.u1();
  }

  public u4(): number {
    return (
      (this.u1() * 0x1000000 +
        (this.u1() << 16) +
        (this.u1() << 8) +
        this.u1()) >>>
      0
    );
  }

  public s4(): number {
    return this.u4() | 0;
  }

  public u8(): bigint {
    return (BigInt(this.u4()) << 32n) | BigInt(this.u4());
  }

  public take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ClassFormatError(`Invalid byte length ${length}`, this.offset);
    }
    this.ensure(length);
    const result = this.bytes.slice(this.position, this.position + length);
    this.position += length;
    return result;
  }

  public subReader(length: number): Reader {
    const start = this.offset;
    return new Reader(this.take(length), start);
  }

  public expectEnd(context: string): void {
    if (this.remaining !== 0) {
      throw new ClassFormatError(
        `${context} has ${this.remaining} trailing byte(s)`,
        this.offset,
      );
    }
  }

  public fail(message: string): never {
    throw new ClassFormatError(message, this.offset);
  }

  private ensure(length: number): void {
    if (length > this.remaining) {
      throw new ClassFormatError(
        `Truncated input: need ${length} byte(s), have ${this.remaining}`,
        this.offset,
      );
    }
  }
}
