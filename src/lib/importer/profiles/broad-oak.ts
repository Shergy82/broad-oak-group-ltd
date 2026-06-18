import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas (Battleship) Profile
 * Structure: Site Divider -> Column A Info (Address is last) -> Date Headers (F+) -> Shift Grid (F+)
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Hierarchical grid: Property Section → Date Column → Work Cell.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    // Check for the characteristic date grid starting around Column F
    let dateFound = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 10) return; // Only check top
      row.eachCell((cell, colNumber) => {
        if (colNumber >= 6 && (cell.value instanceof Date || (typeof cell.value === 'string' && cell.value.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/)))) {
          dateFound = true;
        }
      });
    });

    return dateFound;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return { shifts: [], errors: [] };

    let currentBlock: any[] = [];
    
    // 1. Identify Blocks using Divider Lines
    // We treat full-width merged cells or rows with specific divider text as boundaries
    sheet.eachRow((row, rowNumber) => {
      const isDivider = this.isDividerRow(row);
      
      if (isDivider) {
        if (currentBlock.length > 0) {
          this.processBlock(currentBlock, userMap, shifts, errors, sheet.name);
        }
        currentBlock = [];
      } else {
        currentBlock.push({
          number: rowNumber,
          values: this.getRowValues(row)
        });
      }
    });

    // Process the final block if it exists
    if (currentBlock.length > 0) {
      this.processBlock(currentBlock, userMap, shifts, errors, sheet.name);
    }

    return { shifts, errors };
  }

  private isDividerRow(row: ExcelJS.Row): boolean {
    const firstCell = row.getCell(1).value?.toString() || '';
    // Divider usually starts with "THIS IS A SITE DIVIDING LINE" or is a long string describing the site status
    return firstCell.toUpperCase().includes('SITE DIVIDING LINE') || 
           firstCell.toUpperCase().includes('SIGNIFYING THE END') ||
           (row.cellCount === 1 && firstCell.length > 50);
  }

  private getRowValues(row: ExcelJS.Row): any[] {
    const values: any[] = [];
    for (let i = 1; i <= row.actualCellCount + 10; i++) {
      values[i] = row.getCell(i).value;
    }
    return values;
  }

  private processBlock(block: any[], userMap: UserMapEntry[], shifts: StandardShift[], errors: ImportError[], sheetName: string) {
    if (block.length < 2) return;

    // A. Identify Date Header Row
    // The date header is the first row in the block that has dates in Column F+
    let dateRowIndex = -1;
    const dateMap = new Map<number, Date>();

    for (let i = 0; i < block.length; i++) {
      const row = block[i];
      let foundDateInRow = false;
      for (let col = 6; col < row.values.length; col++) {
        const val = row.values[col];
        const date = this.parseDate(val);
        if (date) {
          dateMap.set(col, date);
          foundDateInRow = true;
        }
      }
      if (foundDateInRow) {
        dateRowIndex = i;
        break;
      }
    }

    if (dateRowIndex === -1) {
      errors.push({
        message: `No date header found in block starting at row ${block[0].number}`,
        severity: 'debug',
        code: 'NO_DATE_HEADER'
      });
      return;
    }

    // B. Extract Site Information from Column A
    // Address is the last non-empty box in Column A
    let siteAddress = "";
    let siteRef = "";
    let infoPanelRows: string[] = [];

    for (let i = 0; i < block.length; i++) {
      const colA = block[i].values[1]?.toString().trim();
      if (colA) {
        infoPanelRows.push(colA);
        // Does it look like a site ref (E12345)?
        const refMatch = colA.match(/\b[E]\d{4,}\b/i);
        if (refMatch) siteRef = refMatch[0];
        siteAddress = colA; // Address is the last one found
      }
    }

    // C. Extract Scheme Information from Column C/D
    let schemeName = "";
    for (let i = 0; i < block.length; i++) {
      const colC = block[i].values[3]?.toString().trim() || '';
      if (colC.toUpperCase().includes('SCHEME')) {
        schemeName = block[i].values[4]?.toString().trim() || "";
      }
    }

    // D. Process Work Cells (Rows below date header)
    for (let i = dateRowIndex + 1; i < block.length; i++) {
      const row = block[i];
      
      dateMap.forEach((date, colIndex) => {
        const cellValue = row.values[colIndex]?.toString().trim();
        if (!cellValue) return;

        const parsed = this.parseWorkCell(cellValue, userMap);
        
        if (parsed) {
          shifts.push({
            date,
            address: siteAddress,
            eNumber: siteRef,
            contract: schemeName,
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
            message: `Could not match operative in text: "${cellValue}"`,
            severity: 'warning',
            code: 'OPERATIVE_NOT_FOUND',
            rawValues: { text: cellValue, address: siteAddress, date }
          });
        }
      });
    }
  }

  private parseWorkCell(text: string, userMap: UserMapEntry[]) {
    // Format expected: "[Optional Type] [Task Description] - [User Name]"
    // Or sometimes just "[User Name]" or "[Task] [User Name]"
    
    // 1. Identify Shift Type (AM/PM)
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    let cleanText = text.trim();
    
    if (cleanText.toUpperCase().startsWith('AM ')) {
      type = 'am';
      cleanText = cleanText.substring(3).trim();
    } else if (cleanText.toUpperCase().startsWith('PM ')) {
      type = 'pm';
      cleanText = cleanText.substring(3).trim();
    }

    // 2. Extract Operative (Usually after a hyphen)
    let task = cleanText;
    let operativeName = "";
    
    if (cleanText.includes('-')) {
      const parts = cleanText.split('-');
      operativeName = parts.pop()?.trim() || "";
      task = parts.join('-').trim();
    } else {
      // Fallback: Check if the end of the string matches a user name
      for (const user of userMap) {
        if (cleanText.toLowerCase().endsWith(user.originalName.toLowerCase())) {
          operativeName = user.originalName;
          task = cleanText.substring(0, cleanText.length - user.originalName.length).trim();
          break;
        }
      }
    }

    // 3. Match User
    const user = this.matchUser(operativeName || cleanText, userMap);
    
    if (user) {
      return {
        user,
        operativeName: user.originalName,
        task: task || 'General Works',
        type
      };
    }

    return null;
  }

  private matchUser(name: string, userMap: UserMapEntry[]): UserMapEntry | null {
    if (!name) return null;
    const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
    
    // Exact match on normalized
    let found = userMap.find(u => u.normalizedName === normalized);
    if (found) return found;

    // Fuzzy match: check if the string contains the normalized user name
    found = userMap.find(u => normalized.includes(u.normalizedName) || u.normalizedName.includes(normalized));
    
    return found || null;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') {
      // Excel serial date
      return new Date(Math.round((val - 25569) * 864e5));
    }
    if (typeof val === 'string') {
      const match = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (match) {
        const d = parseInt(match[1], 10);
        const m = parseInt(match[2], 10) - 1;
        let y = parseInt(match[3], 10);
        if (y < 100) y += 2000;
        return new Date(y, m, d);
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

