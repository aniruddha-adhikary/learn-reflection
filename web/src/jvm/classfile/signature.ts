export type SignatureType =
  | { readonly kind: 'base'; readonly descriptor: string }
  | { readonly kind: 'typeVariable'; readonly name: string }
  | { readonly kind: 'array'; readonly component: SignatureType }
  | {
      readonly kind: 'class';
      readonly segments: readonly {
        readonly name: string;
        readonly arguments: readonly TypeArgument[];
      }[];
    };

export type TypeArgument =
  | { readonly kind: 'any' }
  | { readonly kind: 'exact'; readonly type: SignatureType }
  | { readonly kind: 'extends' | 'super'; readonly type: SignatureType };

export interface TypeParameter {
  readonly name: string;
  readonly classBound: SignatureType | null;
  readonly interfaceBounds: readonly SignatureType[];
}

export interface ClassSignature {
  readonly kind: 'class';
  readonly typeParameters: readonly TypeParameter[];
  readonly superclass: SignatureType;
  readonly interfaces: readonly SignatureType[];
}

export interface FieldSignature {
  readonly kind: 'field';
  readonly type: SignatureType;
}

export interface MethodSignature {
  readonly kind: 'method';
  readonly typeParameters: readonly TypeParameter[];
  readonly parameters: readonly SignatureType[];
  readonly returnType: SignatureType | { readonly kind: 'void' };
  readonly throws: readonly SignatureType[];
}

export function parseClassSignature(signature: string): ClassSignature {
  const cursor = new SignatureCursor(signature);
  const typeParameters = cursor.typeParameters();
  const superclass = cursor.classType();
  const interfaces: SignatureType[] = [];
  while (!cursor.done()) interfaces.push(cursor.classType());
  return { kind: 'class', typeParameters, superclass, interfaces };
}

export function parseFieldSignature(signature: string): FieldSignature {
  const cursor = new SignatureCursor(signature);
  const type = cursor.referenceType();
  cursor.expectEnd();
  return { kind: 'field', type };
}

export function parseMethodSignature(signature: string): MethodSignature {
  const cursor = new SignatureCursor(signature);
  const typeParameters = cursor.typeParameters();
  cursor.expect('(');
  const parameters: SignatureType[] = [];
  while (cursor.peek() !== ')') {
    if (cursor.done()) cursor.fail('Missing closing )');
    parameters.push(cursor.javaType());
  }
  cursor.expect(')');
  const returnType =
    cursor.peek() === 'V' ? (cursor.expect('V'), { kind: 'void' as const }) : cursor.javaType();
  const throws: SignatureType[] = [];
  while (cursor.peek() === '^') {
    cursor.expect('^');
    const token = cursor.peek();
    if (token === 'L') throws.push(cursor.classType());
    else if (token === 'T') throws.push(cursor.typeVariable());
    else cursor.fail('Throws signature must be a class or type variable');
  }
  cursor.expectEnd();
  return { kind: 'method', typeParameters, parameters, returnType, throws };
}

class SignatureCursor {
  private position = 0;

  public constructor(private readonly source: string) {}

  public peek(): string | undefined {
    return this.source[this.position];
  }

  public done(): boolean {
    return this.position === this.source.length;
  }

  public typeParameters(): TypeParameter[] {
    if (this.peek() !== '<') return [];
    this.expect('<');
    const parameters: TypeParameter[] = [];
    while (this.peek() !== '>') {
      if (this.done()) this.fail('Unterminated type parameters');
      const name = this.until(':');
      this.expect(':');
      const classBound = this.peek() === ':' ? null : this.referenceType();
      const interfaceBounds: SignatureType[] = [];
      while (this.peek() === ':') {
        this.expect(':');
        interfaceBounds.push(this.referenceType());
      }
      parameters.push({ name, classBound, interfaceBounds });
    }
    this.expect('>');
    return parameters;
  }

  public javaType(): SignatureType {
    const token = this.peek();
    if (token && 'BCDFIJSZ'.includes(token)) {
      this.expect(token);
      return { kind: 'base', descriptor: token };
    }
    return this.referenceType();
  }

  public referenceType(): SignatureType {
    switch (this.peek()) {
      case 'L':
        return this.classType();
      case 'T':
        return this.typeVariable();
      case '[':
        this.expect('[');
        return { kind: 'array', component: this.javaType() };
      default:
        this.fail(`Expected reference type, found ${JSON.stringify(this.peek())}`);
    }
  }

  public classType(): SignatureType {
    this.expect('L');
    const segments: { name: string; arguments: TypeArgument[] }[] = [];
    let name = this.until('<.;');
    if (!name) this.fail('Empty class type name');
    segments.push({ name, arguments: this.typeArguments() });
    while (this.peek() === '.') {
      this.expect('.');
      name = this.until('<.;');
      if (!name) this.fail('Empty inner class name');
      segments.push({ name, arguments: this.typeArguments() });
    }
    this.expect(';');
    return { kind: 'class', segments };
  }

  public typeVariable(): SignatureType {
    this.expect('T');
    const name = this.until(';');
    if (!name) this.fail('Empty type variable name');
    this.expect(';');
    return { kind: 'typeVariable', name };
  }

  public expect(token: string): void {
    if (this.peek() !== token) this.fail(`Expected ${JSON.stringify(token)}`);
    this.position += 1;
  }

  public expectEnd(): void {
    if (!this.done()) this.fail(`Unexpected token ${JSON.stringify(this.peek())}`);
  }

  public fail(message: string): never {
    throw new SignatureError(`${message} at signature offset ${this.position}: ${this.source}`);
  }

  private typeArguments(): TypeArgument[] {
    if (this.peek() !== '<') return [];
    this.expect('<');
    const arguments_: TypeArgument[] = [];
    while (this.peek() !== '>') {
      if (this.done()) this.fail('Unterminated type arguments');
      switch (this.peek()) {
        case '*':
          this.expect('*');
          arguments_.push({ kind: 'any' });
          break;
        case '+':
          this.expect('+');
          arguments_.push({ kind: 'extends', type: this.referenceType() });
          break;
        case '-':
          this.expect('-');
          arguments_.push({ kind: 'super', type: this.referenceType() });
          break;
        default:
          arguments_.push({ kind: 'exact', type: this.referenceType() });
      }
    }
    this.expect('>');
    return arguments_;
  }

  private until(delimiters: string): string {
    const start = this.position;
    while (!this.done()) {
      const token = this.peek();
      if (token === undefined || delimiters.includes(token)) break;
      this.position += 1;
    }
    return this.source.slice(start, this.position);
  }
}

export class SignatureError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SignatureError';
  }
}
