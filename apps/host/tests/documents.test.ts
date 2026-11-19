import { unlinkSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import { createDocument } from '../src/server/documents.js';

describe('generated spreadsheets', () => {
  it('creates readable workbooks with useful column widths and filters', async () => {
    const created = await createDocument({
      kind: 'xlsx',
      title: 'Aegis spreadsheet test',
      sheets: [{ name: 'Data', rows: [['Name', 'Amount'], ['Alpha', 12], ['A much longer label', 37]] }],
    });
    try {
      const book = XLSX.readFile(created.path, { cellStyles: true });
      const sheet = book.Sheets.Data;
      expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
        ['Name', 'Amount'], ['Alpha', 12], ['A much longer label', 37],
      ]);
      expect(sheet['!autofilter']?.ref).toBe('A1:B3');
      expect(sheet['!cols']?.[0]?.wch).toBeGreaterThan(10);
      expect(created.bytes).toBeGreaterThan(0);
    } finally {
      unlinkSync(created.path);
    }
  });
});
