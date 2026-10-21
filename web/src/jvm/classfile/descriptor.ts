export type JavaType =
  | {
      readonly kind: 'primitive';
      readonly name: 'byte' | 'char' | 'double' | 'float' | 'int' | 'long' | 'short' | 'boolean';
      readonly descriptor: string;
    }
  | { readonly kind: 'object'; readonly internalName: string }
  | { readonly kind: 'array'; readonly component: JavaType };

export interface MethodDescriptor {
  readonly parameters: readonly JavaType[];
  readonly returnType: JavaType | { readonly kind: 'void' };
}

type PrimitiveName = Extract<JavaType, { kind: 'primitive' }>['name'];

const primitiveNames: Readonly<Record<string, PrimitiveName>> = {
  B: 'byte',
  C: 'char',
  D: 'double',
  F: 'float',
  I: 'int',
  J: 'long',
  S: 'short',
  Z: 'boolean',
};

export function parseFieldDescriptor(descriptor: string): JavaType {
  const cursor = new DescriptorCursor(descriptor);
  const result = cursor.readType();
  cursor.expectEnd();
  return result;
}

export function parseMethodDescriptor(descriptor: string): MethodDescriptor {
  const cursor = new DescriptorCursor(descriptor);
  cursor.expect('(');
  const parameters: JavaType[] = [];
  while (cursor.peek() !== ')') {
    if (cursor.isAtEnd()) cursor.fail('Missing closing )');
    parameters.push(cursor.readType());
  }
  cursor.expect(')');
  const returnType =
    cursor.peek() === 'V' ? (cursor.readVoid(), { kind: 'void' as const }) : cursor.readType();
  cursor.expectEnd();
  return { parameters, returnType };
}

class DescriptorCursor {
  private position = 0;

  public constructor(private readonly source: string) {}

  public peek(): string | undefined {
    return this.source[this.position];
  }

  public isAtEnd(): boolean {
    return this.position === this.source.length;
  }

  public readType(): JavaType {
    const token = this.source[this.position];
    if (token === undefined) this.fail('Unexpected end of descriptor');
    this.position += 1;
    const primitive = primitiveNames[token];
    if (primitive !== undefined) {
      return { kind: 'primitive', name: primitive, descriptor: token };
    }
    if (token === '[') return { kind: 'array', component: this.readType() };
    if (token === 'L') {
      const end = this.source.indexOf(';', this.position);
      if (end < 0) this.fail('Unterminated object descriptor');
      const internalName = this.source.slice(this.position, end);
      if (!internalName || internalName.includes('.') || internalName.includes('[')) {
        this.fail('Invalid object type name');
      }
      this.position = end + 1;
      return { kind: 'object', internalName };
    }
    this.fail(`Invalid field type token ${JSON.stringify(token)}`);
  }

  public readVoid(): void {
    this.expect('V');
  }

  public expect(token: string): void {
    if (this.source[this.position] !== token) {
      this.fail(`Expected ${JSON.stringify(token)}`);
    }
    this.position += 1;
  }

  public expectEnd(): void {
    if (!this.isAtEnd()) this.fail(`Unexpected token ${JSON.stringify(this.peek())}`);
  }

  public fail(message: string): never {
    throw new DescriptorError(`${message} at descriptor offset ${this.position}: ${this.source}`);
  }
}

export class DescriptorError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DescriptorError';
  }
}
