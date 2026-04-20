import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from '../../src/lib/csv';

describe('csv.toCsv', () => {
  it('emits plain rows without quotes when no escaping is needed', () => {
    const out = toCsv(['Village', 'Children'], [['Anandpur', 7], ['Belur', 6]]);
    expect(out).toBe('Village,Children\r\nAnandpur,7\r\nBelur,6\r\n');
  });

  it('escapes double-quotes by doubling + wrapping', () => {
    const out = toCsv(['Note'], [['He said "hi"']]);
    expect(out).toBe('Note\r\n"He said ""hi"""\r\n');
  });

  it('wraps cells containing commas in double-quotes', () => {
    const out = toCsv(['Address'], [['Anandpur, KA']]);
    expect(out).toBe('Address\r\n"Anandpur, KA"\r\n');
  });

  it('wraps cells containing CR or LF', () => {
    const out = toCsv(['Note'], [['line1\nline2']]);
    expect(out).toBe('Note\r\n"line1\nline2"\r\n');
  });

  it('treats null and undefined as empty strings', () => {
    const out = toCsv(['a', 'b'], [[null, undefined]]);
    expect(out).toBe('a,b\r\n,\r\n');
  });

  // decisions.md D6: formula-injection guard. The single-quote prefix
  // neuters the leading sigil in Excel / Sheets / LibreOffice.
  it("prefixes cells starting with = with a single quote", () => {
    const out = toCsv(['x'], [['=HYPERLINK("http://evil","c")']]);
    expect(out).toBe('x\r\n"\'=HYPERLINK(""http://evil"",""c"")"\r\n');
  });

  it.each(['=SUM(A1:A5)', '+A1', '-2+3', '@cmd', '\tstart'])(
    'prefixes formula-injection sigil for cell %p',
    (cell) => {
      const out = toCsv(['x'], [[cell]]);
      // After guard, cell begins with a single quote. Whether it's
      // further wrapped depends on whether it also contains , / " /
      // \r / \n; we just assert the leading `'` is present.
      const row = out.split('\r\n')[1]!;
      const firstChar = row.startsWith('"') ? row[1] : row[0];
      expect(firstChar).toBe("'");
    },
  );

  it('does not prefix cells where the sigil is not leading', () => {
    const out = toCsv(['x'], [['a=b']]);
    expect(out).toBe('x\r\na=b\r\n');
  });
});

describe('csv.csvFilename', () => {
  it('keeps alphanumerics, dash, underscore, dot', () => {
    expect(csvFilename('children_cluster_Bidar-01')).toBe(
      'children_cluster_Bidar-01.csv',
    );
  });
  it('replaces unsafe characters with underscores', () => {
    expect(csvFilename('a b/c\\d')).toBe('a_b_c_d.csv');
  });
});
