// Minimal RFC 4180 CSV serializer. Spec §3.6.3 / decisions.md D2:
// Excel-style .xlsx is deferred; L2 and L3 ship CSV only. Every
// spreadsheet tool opens this — no dependency needed.
//
// Escaping rules: if a cell contains `"`, `,`, `\n`, or `\r`, wrap
// in double quotes and double any embedded `"`. Empty / null cells
// are emitted as the empty string. Line endings are `\r\n` because
// Excel on Windows is strict about that; readers on other platforms
// accept it too.

export type CsvCell = string | number | null | undefined;

function esc(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  const s = String(cell);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(r.map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}

// Filename sanitizer for the Content-Disposition header — keep
// alphanumerics, dash, underscore, dot. Anything else becomes `_`.
// Prevents quoting / header-splitting bugs without pulling in a
// proper RFC 6266 encoder (overkill for lab usage).
export function csvFilename(base: string): string {
  return `${base.replace(/[^A-Za-z0-9_.-]/g, '_')}.csv`;
}
