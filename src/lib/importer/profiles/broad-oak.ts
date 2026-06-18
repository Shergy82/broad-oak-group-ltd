import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile - Image Optimized
 * Layout: 
 * - Block starts with "SITE MANAGER" in Col A.
 * - Date Headers are on the SAME ROW as "SITE MANAGER" starting at Col F.
 * - Address is identified by a Postcode regex in the Col A panel.
 * - Shifts are in the grid (F+) containing a hyphen "-".
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical grid triggered by Site Manager labels.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let markerFound = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 20) return;
      const val = row.getCell(1).value?.toString().toUpperCase() || '';
      if (val.includes('SITE MANAGER') || val.includes('TECHNICAL MANAGER')) {
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

    let currentBlockRows: any[] = [];
    
    // 1. Chunk the sheet into blocks based on "SITE MANAGER" marker
    sheet.eachRow((row, rowNumber) => {
      const colA = row.getCell(1).value?.toString().toUpperCase() || '';
      const isNewBlock = colA.includes('SITE MANAGER');
      
      if (isNewBlock && currentBlockRows.length > 0) {
        this.processBlock(currentBlockRows, userMap, shifts, errors, sheet.name);
        currentBlockRows = [];
      }
      
      currentBlockRows.push({
        number: rowNumber,
        values: this.getRowValues(row)
      });
    });

    if (currentBlockRows.length > 0) {
      this.processBlock(currentBlockRows, userMap, shifts, errors, sheet.name);
    }

    return { shifts, errors };
  }

  private getRowValues(row: ExcelJS.Row): any[] {
    const values: any[] = [];
    // Scan up to a reasonable column limit
    for (let i = 1; i <= 30; i++) {
      values[i] = row.getCell(i).value;
    }
    return values;
  }

  private processBlock(block: any[], userMap: UserMapEntry[], shifts: StandardShift[], errors: ImportError[], sheetName: string) {
    // A. Find Date Headers (Look in the first row of the block, F+)
    const dateMap = new Map<number, Date>();
    const headerRow = block[0];
    
    for (let col = 6; col < headerRow.values.length; col++) {
      const date = this.parseDate(headerRow.values[col]);
      if (date) dateMap.set(col, date);
    }

    if (dateMap.size === 0) return;

    // B. Identify Address & Site Ref in Col A
    // We look for the cell containing a postcode as the definitive address anchor
    let siteAddress = "Unknown Address";
    let siteRef = "";
    const postcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i;

    for (const row of block) {
      const val = row.values[1]?.toString() || '';
      if (postcodeRegex.test(val)) {
        siteAddress = val.trim();
        const refMatch = val.match(/\b[E]\d{4,}\b/i);
        if (refMatch) siteRef = refMatch[0];
        break; 
      }
    }

    // C. Identify Scheme in Col C/D
    let schemeName = "";
    for (const row of block) {
      if (row.values[3]?.toString().toUpperCase().includes('SCHEME')) {
        schemeName = row.values[4]?.toString() || "";
        break;
      }
    }

    // D. Scan the Grid (F+) for shifts
    for (const row of block) {
      dateMap.forEach((date, colIndex) => {
        const cellValue = row.values[colIndex]?.toString().trim();
        if (!cellValue || !cellValue.includes('-')) return;

        const parsed = this.parseWorkCell(cellValue, userMap);
        if (parsed) {
          shifts.push({
            date,
            address: siteAddress,
            eNumber: siteRef,
            contract: schemeName || "General",
            operative: parsed.operativeName,
            operativeUid: parsed.user?.uid,
            task: parsed.task,
            descriptionOfWorks: cellValue,
            type: parsed.type,
            sourceCell: `${sheetName}!${this.getColumnLetter(colIndex)}${row.number}`,
            sourceSheet: sheetName
          });
        } else {
          errors.push({
            row: row.number,
            cell: `${this.getColumnLetter(colIndex)}${row.number}`,
            message: `Unrecognized operative: "${cellValue}"`,
            severity: 'warning',
            code: 'USER_NOT_FOUND',
            rawValues: { text: cellValue, address: siteAddress, date }
          });
        }
      });
    }
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
