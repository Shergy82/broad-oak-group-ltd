import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Robust Battleship Parser for Broad Oak Gas
 * 1. Identifies blocks between colored dividers.
 * 2. Selects correct address from Column A (ignoring managers/TLOs).
 * 3. Extracts name/task/type from single cell strings with fuzzy name matching.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Grid-based layout with colored site dividers and names inside task cells.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;
    
    let darkRows = 0;
    // Check first 30 rows for the colored divider pattern
    for (let r = 1; r <= 30; r++) {
      if (this.isDividerRow(sheet.getRow(r))) darkRows++;
    }
    return darkRows > 0;
  }

  private isDividerRow(row: ExcelJS.Row): boolean {
    const cell = row.getCell(1);
    const fill = cell.fill as ExcelJS.FillPattern;
    if (fill?.type === 'pattern' && fill.fgColor) {
      const color = String(fill.fgColor.argb || (fill.fgColor as any).indexed);
      // Matches standard black (FF000000) or dark indexed colors
      return color === 'FF000000' || color === '64' || color === 'FF333333';
    }
    return false;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    for (const sheet of workbook.worksheets.filter(ws => ws.state !== 'hidden')) {
      const bounds = this.getUsedBounds(sheet);
      if (!bounds) continue;

      // 1. Map out the dividers to define blocks
      const dividers: number[] = [];
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        if (this.isDividerRow(sheet.getRow(r))) dividers.push(r);
      }

      errors.push({ 
        sheet: sheet.name, 
        message: `Found ${dividers.length} site blocks.`, 
        severity: 'info', 
        code: 'BLOCK_COUNT' 
      });

      // 2. Process each block
      for (let i = 0; i < dividers.length; i++) {
        const startRow = dividers[i];
        const endRow = dividers[i + 1] ? dividers[i + 1] - 1 : bounds.endRow;

        // A. Extract Address (The row in Col A with postcode/house num)
        const address = this.findBestAddress(sheet, startRow, endRow);
        if (!address) {
          errors.push({ 
            row: startRow, 
            sheet: sheet.name, 
            message: `Block starting at Row ${startRow} skipped: No valid site address found in Column A.`, 
            severity: 'warning', 
            code: 'MISSING_ADDRESS' 
          });
          continue;
        }

        // B. Extract Date Header row (Usually row right after divider)
        const dateHeader = this.findDateRow(sheet, startRow, endRow);
        if (!dateHeader) continue;

        // C. Iterate through date columns (F onwards)
        for (const { col, date } of dateHeader.cols) {
          // Inside a block/column, scan for shifts
          for (let r = startRow + 1; r <= endRow; r++) {
            const cell = sheet.getRow(r).getCell(col);
            const rawText = this.getCellText(cell);
            if (!rawText || rawText.length < 3) continue;

            // D. Parse User and Task from the string
            const result = this.parseShiftString(rawText, userMap);
            
            if (result.userName) {
              shifts.push({
                date,
                operative: result.userName,
                address: address,
                contract: sheet.name,
                task: result.task || 'Standard Work',
                descriptionOfWorks: rawText,
                type: result.type,
                sourceCell: cell.address,
                sourceSheet: sheet.name
              });
            } else {
              // Row fails if we find text but can't identify a user
              errors.push({
                row: r,
                cell: cell.address,
                sheet: sheet.name,
                message: `Could not identify an operative in text: "${rawText.substring(0, 30)}..."`,
                severity: 'debug',
                code: 'UNKNOWN_USER',
                rawValues: { text: rawText }
              });
            }
          }
        }
      }
    }

    return { shifts, errors };
  }

  private findBestAddress(sheet: ExcelJS.Worksheet, start: number, end: number): string | null {
    let bestAddr = null;
    let maxScore = -1;

    for (let r = start; r <= end; r++) {
      const text = this.getCellText(sheet.getRow(r).getCell(1));
      if (!text) continue;

      let score = 0;
      // High score for house numbers
      if (/\b\d+\b/.test(text)) score += 10;
      // High score for UK postcodes
      if (/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.test(text)) score += 20;
      // Penalize manager/ordering headers
      if (/MANAGER|TLO|ORDERING|SCHEME|LIVE/i.test(text)) score -= 1000;
      
      if (score > maxScore && score > 0) {
        maxScore = score;
        bestAddr = text;
      }
    }
    return bestAddr;
  }

  private findDateRow(sheet: ExcelJS.Worksheet, start: number, end: number) {
    // Check first 5 rows of block for date headers
    for (let r = start; r <= Math.min(start + 5, end); r++) {
      const cols: { col: number, date: Date }[] = [];
      const row = sheet.getRow(r);
      
      // Dates start in col 6 (F)
      for (let c = 6; c <= 100; c++) {
        const val = row.getCell(c).value;
        const date = this.toValidDate(val);
        if (date) cols.push({ col: c, date });
      }

      if (cols.length >= 2) return { row: r, cols };
    }
    return null;
  }

  private toValidDate(val: any): Date | null {
    if (val instanceof Date && !isNaN(val.getTime())) {
      return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate(), 12));
    }
    if (typeof val === 'number' && val > 40000 && val < 60000) {
      const d = new Date((val - 25569) * 86400 * 1000);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
    }
    return null;
  }

  private parseShiftString(text: string, userMap: UserMapEntry[]): { userName: string | null, task: string, type: 'am' | 'pm' | 'all-day' } {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const lowerText = cleanText.toLowerCase();

    // 1. Detect Type
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    if (lowerText.startsWith('am ')) type = 'am';
    else if (lowerText.startsWith('pm ')) type = 'pm';

    // 2. Identify User using word-wise prefix matching (handles truncated/spaced names)
    let identifiedUser: string | null = null;
    let matchedInText = '';

    for (const user of userMap) {
      const name = user.originalName;
      const nameParts = name.toLowerCase().split(' '); // e.g. ["phil", "shergold"]
      
      // Try to find parts of the name in the string
      const allPartsFound = nameParts.every(part => {
        // Match part even if it's truncated (at least 3 chars)
        const regex = new RegExp(`\\b${part.substring(0, Math.min(part.length, 4))}`, 'i');
        return regex.test(lowerText);
      });

      if (allPartsFound) {
        identifiedUser = name;
        matchedInText = name; // We'll try to remove exactly what's in the text later
        break;
      }
    }

    // 3. Extract Task (strip type and name)
    let task = cleanText;
    if (type !== 'all-day') task = task.substring(3); // strip "am "/"pm "
    
    if (identifiedUser) {
        // Try fuzzy removal of the name
        const nameParts = identifiedUser.split(' ');
        nameParts.forEach(part => {
            const regex = new RegExp(`-?\\s*\\b${part.substring(0, 4)}[a-z]*\\s*`, 'gi');
            task = task.replace(regex, '');
        });
    }

    return { 
      userName: identifiedUser, 
      task: task.replace(/^[-–\s]+|[-–\s]+$/g, '').trim(), 
      type 
    };
  }

  private getCellText(cell: ExcelJS.Cell): string {
    const v = cell.isMerged ? cell.master.value : cell.value;
    return v ? String(v).trim() : '';
  }

  private getUsedBounds(ws: ExcelJS.Worksheet) {
    let minRow = Infinity, maxRow = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      minRow = Math.min(minRow, rowNumber);
      maxRow = Math.max(maxRow, rowNumber);
    });
    return isFinite(minRow) ? { startRow: minRow, endRow: maxRow } : null;
  }
}
