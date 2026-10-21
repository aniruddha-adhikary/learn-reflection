import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas and doubled quotes', () => {
    expect(parseCsv('a,"b, c","d ""q"""\r\n1,,3\r\n')).toEqual([
      ['a', 'b, c', 'd "q"'],
      ['1', '', '3'],
    ]);
  });
  it('fails loudly on an unterminated quote', () => {
    expect(() => parseCsv('a,"b')).toThrow('unterminated');
  });
});
