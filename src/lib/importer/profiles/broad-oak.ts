
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile - REBUILT
 * Hierarchical extraction: Property Section -> Date Column -> Work Cell
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical property sections with horizontal dates and embedded names.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    let dateCount = 0;
    // Look for a row containing horizontal dates (the hallmark of Battleship)
    sheet.eachRow((row, rowNumber) => {
      if (dateCount > 2 || rowNumber > 20) return;
      let rowDates = 0;
      row.eachCell(cell => {
        if (this.parseDate(cell.value)) rowDates++;
      });
      if (rowDates > dateCount) dateCount = rowDates;
    });

    return dateCount >= 3;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts: [], errors: [] };

    // 1. Identify the Date Header Row
    let dateRowNumber = -1;
    let maxDates = 0;
    const dateColumnMap = new Map<number, Date>();

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 30) return;
      let rowDates = 0;
      row.eachCell(cell => {
        if (this.parseDate(cell.value)) rowDates++;
      });
      if (rowDates > maxDates) {
        maxDates = rowDates;
        dateRowNumber = rowNumber;
      }
    });

    if (dateRowNumber === -1) {
      errors.push({ message: "Could not find a row containing date headers.", severity: 'error', code: 'NO_DATES' });
      return { shifts: [], errors };
    }

    // 2. Map Columns to Dates
    const headerRow = sheet.getRow(dateRowNumber);
    headerRow.eachCell((cell, colNumber) => {
      const date = this.parseDate(cell.value);
      if (date) dateColumnMap.set(colNumber, date);
    });

    // 3. Iterate Rows to extract Properties and Shifts
    let currentAddress = "";
    let currentENumber = "";
    let currentScheme = "";
    let currentManager = "";

    const postcodeRegex = /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i;
    const eNumberRegex = /\bE\d{5,}\b/i;

    sheet.eachRow((row, rowNumber) => {
      // Skip the header row and anything above it
      if (rowNumber <= dateRowNumber) return;

      const colA = row.getCell(1).value?.toString() || '';
      const colC = row.getCell(3).value?.toString() || '';
      const colD = row.getCell(4).value?.toString() || '';

      // Detection: Is this a property row?
      // We look for Site Refs (E...) or Postcodes in Column A
      const hasPostcode = postcodeRegex.test(colA);
      const hasENumber = eNumberRegex.test(colA);

      if (hasPostcode || hasENumber) {
        currentAddress = colA.trim();
        const eMatch = colA.match(eNumberRegex);
        currentENumber = eMatch ? eMatch[0] : "";
      }

      // Capture Scheme/Manager metadata if present
      if (colC.toUpperCase().includes('SCHEME')) {
          currentScheme = colD || "";
      }
      if (colA.toUpperCase().includes('SITE MANAGER')) {
          currentManager = colD || "";
      }

      // 4. Scan Work Cells for this row
      dateColumnMap.forEach((date, colNumber) => {
        const cell = row.getCell(colNumber);
        const cellValue = cell.value?.toString().trim();
        
        if (!cellValue) return;

        // Skip if the cell is just the header date repeated
        if (this.isHeaderRepeat(cellValue, date)) return;

        const cellCoord = `${this.getColumnLetter(colNumber)}${rowNumber}`;

        // Extraction: Find operative embedded in text
        const match = this.findOperative(cellValue, userMap);

        if (match) {
          shifts.push({
            date,
            address: currentAddress || "Unknown Address",
            eNumber: currentENumber,
            contract: currentScheme || "General",
            manager: currentManager,
            operative: match.user.originalName,
            operativeUid: match.user.uid,
            task: match.task,
            descriptionOfWorks: cellValue,
            type: match.type,
            sourceCell: `${sheet.name}!${cellCoord}`,
            sourceSheet: sheet.name
          });
        } else if (cellValue.length > 3) {
          // If the cell has content but we can't find a user, it's a "Not Imported" candidate
          errors.push({
            row: rowNumber,
            cell: cellCoord,
            message: `Operative not recognized in text: "${cellValue}"`,
            severity: 'warning',
            code: 'USER_NOT_FOUND',
            rawValues: { text: cellValue, address: currentAddress, date }
          });
        }
      });
    });

    return { shifts, errors };
  }

  private findOperative(text: string, userMap: UserMapEntry[]) {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const upperText = cleanText.toUpperCase();
    
    // Look for names in the text
    // Broad Oak planners often use "Task - Name" or "Task Name"
    for (const user of userMap) {
      const name = user.originalName.toUpperCase();
      if (upperText.includes(name)) {
        // Found a match!
        let type: 'am' | 'pm' | 'all-day' = 'all-day';
        if (upperText.startsWith('AM ')) type = 'am';
        else if (upperText.startsWith('PM ')) type = 'pm';

        // Extract task by stripping metadata
        let task = cleanText
          .replace(new RegExp(user.originalName, 'gi'), '')
          .replace(/^[Aa][Mm]\s+/, '')
          .replace(/^[Pp][Mm]\s+/, '')
          .replace(/^\s*-\s*/, '')
          .replace(/\s*-\s*$/, '')
          .trim();

        return { user, task: task || "General Works", type };
      }
    }
    return null;
  }

  private isHeaderRepeat(val: string, date: Date): boolean {
      const d = this.parseDate(val);
      return d ? d.getTime() === date.getTime() : false;
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
