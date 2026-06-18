
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Block-based extraction: Detects "SITE MANAGER" blocks, finds the address,
 * then maps horizontal date columns to vertical work entries.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical property blocks with horizontal dates.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let markerFound = false;
    // Scan up to 100 rows to find the start of the grid
    sheet.eachRow((row, rowNumber) => {
      if (markerFound || rowNumber > 100) return;
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      if (colA.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        markerFound = true;
      }
    });
    return markerFound;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts: [], errors: [] };

    // Step 1: Group rows into visual "Site Blocks"
    const blocks: ExcelJS.Row[][] = [];
    let currentBlockRows: ExcelJS.Row[] = [];

    sheet.eachRow((row) => {
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      // New block starts at Site Manager marker
      if (colA.includes('SITE MANAGER') || colA.includes('TECHNICAL MANAGER')) {
        if (currentBlockRows.length > 0) blocks.push(currentBlockRows);
        currentBlockRows = [row];
      } else if (currentBlockRows.length > 0) {
        currentBlockRows.push(row);
      }
    });
    if (currentBlockRows.length > 0) blocks.push(currentBlockRows);

    // Step 2: Process each block independently
    for (const block of blocks) {
      const markerRow = block[0];
      const dateColumnMap = new Map<number, Date>();

      // Identify Date Columns from the marker row (Starts at Column F)
      for (let i = 6; i <= 50; i++) {
        const date = this.parseDate(markerRow.getCell(i).value);
        if (date) dateColumnMap.set(i, date);
      }

      if (dateColumnMap.size === 0) continue;

      // Identify Property Metadata for this specific block
      let blockAddress = "";
      let blockENumber = "";
      let blockScheme = "";
      let blockManager = "";

      const postcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i;
      const eNumberRegex = /\bE\d{5,}\b/i;

      // Scan Column A, C, D in this block for metadata
      for (const row of block) {
        const colA = row.getCell(1).value?.toString() || '';
        const colC = row.getCell(3).value?.toString() || '';
        const colD = row.getCell(4).value?.toString() || '';

        if (colA.toUpperCase().includes('SITE MANAGER')) {
            blockManager = colD || "";
        }

        if (colC.toUpperCase().includes('SCHEME')) {
          blockScheme = colD || "";
        }

        // The address is the row containing the postcode
        if (postcodeRegex.test(colA)) {
          blockAddress = colA.trim();
          const eMatch = colA.match(eNumberRegex);
          if (eMatch) blockENumber = eMatch[0];
        }
      }

      // Fallback: If no postcode row found, take the last non-empty row in Col A of the block
      if (!blockAddress) {
          for (let i = block.length - 1; i >= 0; i--) {
              const val = block[i].getCell(1).value?.toString().trim();
              if (val && val.length > 8 && !val.includes('MANAGER')) {
                  blockAddress = val;
                  const eMatch = val.match(eNumberRegex);
                  if (eMatch) blockENumber = eMatch[0];
                  break;
              }
          }
      }

      // Step 3: Extract shifts from the grid (Columns F+)
      for (const row of block) {
        dateColumnMap.forEach((date, colIndex) => {
          const cellValue = row.getCell(colIndex).value?.toString().trim();
          if (!cellValue) return;

          // Skip if the cell is just the header date itself
          if (this.isHeaderCell(cellValue, date)) return;

          // Per instructions: Non-empty cell under a date is a shift
          // Must contain a hyphen to separate Task - Operative
          if (!cellValue.includes('-')) {
             errors.push({
                 row: row.number,
                 cell: this.getColumnLetter(colIndex) + row.number,
                 message: "No operative separator (-) found",
                 severity: 'debug',
                 code: 'MISSING_HYPHEN',
                 rawValues: { text: cellValue, address: blockAddress, date }
             });
             return;
          }

          const parsed = this.parseWorkCell(cellValue, userMap);
          if (parsed) {
            shifts.push({
              date,
              address: blockAddress || "Unknown Address",
              eNumber: blockENumber,
              contract: blockScheme || "General",
              manager: blockManager,
              operative: parsed.operativeName,
              operativeUid: parsed.user?.uid,
              task: parsed.task,
              descriptionOfWorks: cellValue,
              type: parsed.type,
              sourceCell: `${sheet.name}!${this.getColumnLetter(colIndex)}${row.number}`,
              sourceSheet: sheet.name
            });
          } else {
            errors.push({
              row: row.number,
              cell: `${this.getColumnLetter(colIndex)}${row.number}`,
              message: `Operative not recognized: "${cellValue}"`,
              severity: 'warning',
              code: 'USER_NOT_FOUND',
              rawValues: { text: cellValue, address: blockAddress, date }
            });
          }
        });
      }
    }

    return { shifts, errors };
  }

  private isHeaderCell(val: string, date: Date): boolean {
      const d1 = this.parseDate(val);
      if (!d1) return false;
      return d1.getTime() === date.getTime();
  }

  private parseWorkCell(text: string, userMap: UserMapEntry[]) {
    let cleanText = text.trim();
    let type: 'am' | 'pm' | 'all-day' = 'all-day';

    if (cleanText.toUpperCase().startsWith('AM ')) {
      type = 'am';
      cleanText = cleanText.substring(3).trim();
    } else if (cleanText.toUpperCase().startsWith('PM ')) {
      type = 'pm';
      cleanText = cleanText.substring(3).trim();
    }

    // Split Task - Operative
    const parts = cleanText.split('-');
    const namePart = parts.pop()?.trim() || "";
    const taskPart = parts.join('-').trim() || "General Works";

    const user = this.matchUser(namePart, userMap);
    if (user) {
      return { user, operativeName: user.originalName, task: taskPart, type };
    }
    return null;
  }

  private matchUser(name: string, userMap: UserMapEntry[]): UserMapEntry | null {
    if (!name) return null;
    const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
    return userMap.find(u => u.normalizedName === normalized) || null;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(Math.round((val - 25569) * 864e5));
    if (typeof val === 'string') {
      const match = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (match) {
        const d = parseInt(match[1], 10);
        const m = parseInt(match[2], 10) - 1;
        let y = parseInt(match[3], 10);
        if (y < 100) y += 2000;
        const date = new Date(y, m, d);
        return isNaN(date.getTime()) ? null : date;
      }
    }
    return null;
  }

  private getColumnLetter(colIndex: number): string {
    let temp, letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      colIndex = (colIndex - temp - 1) / 26;
    }
    return letter;
  }
}
