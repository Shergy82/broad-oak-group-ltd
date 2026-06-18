import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Robust Battleship Parser for Broad Oak Gas
 * 1. Identifies blocks defined by colored/dark dividers in Column A.
 * 2. Extracts site address from Column A using address scoring.
 * 3. Scans columns F+ for date headers.
 * 4. Uses stateful vertical scanning to associate names with tasks in cells below.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Grid-based layout with site blocks in Col A and dates across the top (Col F+).';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;
    
    // Look for a row that contains multiple date objects in F+
    for (let r = 1; r <= 20; r++) {
      const row = sheet.getRow(r);
      let dateCount = 0;
      for (let c = 6; c <= 50; c++) {
        if (this.toValidDate(row.getCell(c).value)) dateCount++;
      }
      if (dateCount >= 3) return true;
    }

    // Fallback: check for dividers
    for (let r = 1; r <= 30; r++) {
      if (this.isDividerRow(sheet.getRow(r))) return true;
    }

    return false;
  }

  private isDividerRow(row: ExcelJS.Row): boolean {
    const cell = row.getCell(1);
    // Any cell in Column A with a non-white fill is likely a divider
    const fill = cell.fill as ExcelJS.FillPattern;
    if (fill?.type === 'pattern' && fill.fgColor) {
      const argb = String(fill.fgColor.argb || '');
      // Ignore white/transparent
      return argb !== 'FFFFFFFF' && argb !== '' && argb !== '00000000';
    }
    return false;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    for (const sheet of workbook.worksheets.filter(ws => ws.state !== 'hidden')) {
      const bounds = this.getUsedBounds(sheet);
      if (!bounds) continue;

      // 1. Identify dividers to define blocks
      const dividers: number[] = [];
      for (let r = bounds.startRow; r <= bounds.endRow; r++) {
        if (this.isDividerRow(sheet.getRow(r))) dividers.push(r);
      }

      // 2. Process each block
      for (let i = 0; i < dividers.length; i++) {
        const startRow = dividers[i];
        const endRow = dividers[i + 1] ? dividers[i + 1] - 1 : bounds.endRow;

        // A. Extract Site Address from Column A
        const address = this.findBestAddress(sheet, startRow, endRow);
        if (!address) continue;

        // B. Dynamically find the Date Header row in this block
        const dateHeader = this.findDateRow(sheet, startRow, endRow);
        if (!dateHeader) continue;

        // C. Process each date column
        for (const { col, date } of dateHeader.cols) {
          let currentOperative: string | null = null;
          let currentTasks: string[] = [];
          let currentType: 'am' | 'pm' | 'all-day' = 'all-day';
          let sourceCell = '';

          // Stateful Vertical Scan within the column
          for (let r = dateHeader.row + 1; r <= endRow; r++) {
            const cell = sheet.getRow(r).getCell(col);
            const rawText = this.getCellText(cell);
            if (!rawText) continue;

            const userMatch = this.findUserInString(rawText, userMap);

            if (userMatch) {
              // If we already have a user, push the previous shift before starting new one
              if (currentOperative) {
                shifts.push(this.createShift(date, currentOperative, address, sheet.name, currentTasks, currentType, sourceCell));
              }

              currentOperative = userMatch.name;
              currentType = userMatch.type;
              sourceCell = cell.address;
              currentTasks = [];
              if (userMatch.task) currentTasks.push(userMatch.task);
            } else if (currentOperative) {
              // Accumulate task description found in cells below name
              currentTasks.push(rawText);
            }
          }

          // Push the final shift for this column
          if (currentOperative) {
            shifts.push(this.createShift(date, currentOperative, address, sheet.name, currentTasks, currentType, sourceCell));
          }
        }
      }
    }

    return { shifts, errors };
  }

  private createShift(date: Date, op: string, addr: string, contract: string, tasks: string[], type: 'am' | 'pm' | 'all-day', cell: string): StandardShift {
    return {
      date,
      operative: op,
      address: addr,
      contract: contract,
      task: tasks.join(' / ').trim() || 'General Works',
      descriptionOfWorks: tasks.join('\n'),
      type,
      sourceCell: cell,
      sourceSheet: contract
    };
  }

  private findUserInString(text: string, userMap: UserMapEntry[]) {
    const clean = text.toLowerCase().replace(/\s+/g, ' ').trim();
    
    // Detect Type
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    let task = text;
    if (clean.startsWith('am ')) { type = 'am'; task = text.substring(3); }
    else if (clean.startsWith('pm ')) { type = 'pm'; task = text.substring(3); }

    for (const user of userMap) {
      const parts = user.originalName.toLowerCase().split(' ');
      const allPartsMatched = parts.every(p => {
        const regex = new RegExp(`\\b${p.substring(0, 4)}`, 'i');
        return regex.test(clean);
      });

      if (allPartsMatched) {
        // Clean the name out of the task
        parts.forEach(p => {
            const r = new RegExp(`-?\\s*\\b${p.substring(0, 4)}[a-z]*\\s*`, 'gi');
            task = task.replace(r, '');
        });
        return { name: user.originalName, type, task: task.replace(/^[-–\s]+|[-–\s]+$/g, '').trim() };
      }
    }
    return null;
  }

  private findBestAddress(sheet: ExcelJS.Worksheet, start: number, end: number): string | null {
    let best = null;
    let max = -1;
    for (let r = start; r <= end; r++) {
      const text = this.getCellText(sheet.getRow(r).getCell(1));
      if (!text || text.length < 5) continue;
      let score = 0;
      if (/\b\d+\b/.test(text)) score += 10;
      if (/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.test(text)) score += 20;
      if (/MANAGER|TLO|ORDERING|SCHEME|LIVE/i.test(text)) score -= 20000;
      if (score > max && score > 0) { max = score; best = text; }
    }
    return best;
  }

  private findDateRow(sheet: ExcelJS.Worksheet, start: number, end: number) {
    for (let r = start; r <= Math.min(start + 8, end); r++) {
      const cols: { col: number, date: Date }[] = [];
      const row = sheet.getRow(r);
      for (let c = 6; c <= 100; c++) {
        const date = this.toValidDate(row.getCell(c).value);
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
    if (typeof val === 'number' && val > 44000 && val < 60000) {
      const d = new Date((val - 25569) * 86400 * 1000);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
    }
    return null;
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
