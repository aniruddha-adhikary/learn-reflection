const multiplier = 0x5deece66dn;
const addend = 0xbn;
const mask = (1n << 48n) - 1n;

export class JavaRandom {
  private seed: bigint;

  public constructor(seed: number | bigint) {
    this.seed = (BigInt(seed) ^ multiplier) & mask;
  }

  public nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x7fffffff) {
      throw new RangeError(`bound must be a positive 32-bit integer: ${bound}`);
    }
    if ((bound & (bound - 1)) === 0) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    for (;;) {
      const bits = this.next(31);
      const value = bits % bound;
      if (((bits - value + (bound - 1)) | 0) >= 0) return value;
    }
  }

  private next(bits: number): number {
    this.seed = (this.seed * multiplier + addend) & mask;
    return Number(this.seed >> BigInt(48 - bits));
  }
}

export function javaStringHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
  }
  return hash;
}
