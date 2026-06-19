import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Broad Oak Gas & Build Planner Profile
 * Identity Rule: Address is the LAST populated cell in Column A within a project section.
 * Cell Rule: Work is expected in "Task - Operative" format using the LAST hyphen.
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Gas/Build Planner';
  description = 'Hierarchical extraction: Identifies property address from the last cell in Column A within a project section.';

  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
        if (sheet.state === 'hidden') return false;
        let found = false;
        for (let i = 1; i <= 50; i++) {
            const rowText = sheet.getRow(i).values?.toString().toUpperCase() || '';
            if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
                found = true;
                break;
            }
        }
        return found;
    });
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];
    
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden' && this.detectSheet(s)) || workbook.worksheets.find(s => s.state !== 'hidden');

    if (!sheet) {
        errors.push({ message: "No valid worksheet found.", severity: 'error', code: 'NO_SHEET' });
        return { shifts, errors };
    }

    const dateColumnMap = new Map<number, { date: Date, dateKey: string }>();
    let dateRowIndex = -1;

    for (let r = 1; r <= 40; r++) {
        const row = sheet.getRow(r);
        let datesInRow = 0;
        const tempMap = new Map<number, { date: Date, dateKey: string }>();
        
        row.eachCell((cell, colNumber) => {
            if (colNumber >= 6) {
                const date = this.parseDate(cell.value);
                if (date) {
                    const dateKey = this.formatDateKey(date);
                    tempMap.set(colNumber, { date, dateKey });
                    datesInRow++;
                }
            }
        });

        if (datesInRow > (dateColumnMap.size || 0)) {
            dateRowIndex = r;
            dateColumnMap.clear();
            tempMap.forEach((v, k) => dateColumnMap.set(k, v));
        }
    }

    if (dateColumnMap.size === 0) {
        errors.push({ message: "No dates found in columns F onwards.", severity: 'error', code: 'NO_DATES' });
        return { shifts, errors };
    }

    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const rowText = row.values ? row.values.toString().toUpperCase() : '';
      if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) {
        dividerRows.push(dateRowIndex + 1);
    }

    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : sheet.rowCount;

      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);
        const colA = row.getCell(1).value?.toString().trim();
        const colC = row.getCell(3).value?.toString().trim();

        if (colA?.toUpperCase().includes('SITE MANAGER')) {
            blockManager = colA.split(':')[1]?.trim() || colA.split('MANAGER')[1]?.trim() || blockManager;
        }

        if (colC?.toUpperCase().includes('SCHEME') || colC?.toUpperCase().includes('CONTRACT')) {
            blockScheme = row.getCell(4).value?.toString().trim() || blockScheme;
        }

        if (colA && colA.length > 5 && !colA.toUpperCase().includes('MANAGER') && !colA.toUpperCase().includes('DIVIDING')) {
            blockAddress = colA;
            const eMatch = colA.match(this.eNumberRegex);
            if (eMatch) {
                blockENumber = eMatch[0];
                blockAddress = colA.replace(this.eNumberRegex, '').replace(/^\s*[-:–—]\s*/, '').trim();
            }
        }
      }

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach(({ date, dateKey }, colNumber) => {
          const cell = row.getCell(colNumber);
          if (!cell.value) return;

          const rawText = cell.value.toString().trim();
          if (rawText.length < 3) return;

          if (this.isHeaderJunk(cell.value, date)) return;

          const context = {
              row: r,
              cell: `${this.getColumnLetter(colNumber)}${r}`,
              sheet: sheet.name,
              date: this.formatDateUK(date),
              dateKey,
              address: blockAddress || "Unknown Address"
          };

          const match = this.extractOperativeAndTask(rawText, userMap);
          
          if (match.error) {
              errors.push({
                  ...context,
                  message: match.error,
                  severity: 'error',
                  code: 'PARSE_ERROR',
                  task: match.task || rawText,
                  operative: match.operative || "—"
              });
              return;
          }

          if (match.user) {
            shifts.push({
              date,
              dateKey,
              address: blockAddress || "Unknown Address",
              eNumber: blockENumber,
              contract: blockScheme || "Planner Works",
              manager: blockManager,
              operative: match.user.originalName,
              operativeUid: match.user.uid,
              task: match.task,
              descriptionOfWorks: rawText,
              type: match.type || 'all-day',
              sourceCell: context.cell,
              sourceSheet: sheet.name,
              sourcePlannerId: "",
              sourcePlannerName: "",
              plannerName: "",
              profileId: "",
              importKey: "",
            });
          }
        });
      }
    }

    return { shifts, errors };
  }

  private detectSheet(sheet: ExcelJS.Worksheet): boolean {
    for (let i = 1; i <= 30; i++) {
        const rowText = sheet.getRow(i).values?.toString().toUpperCase() || '';
        if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) return true;
    }
    return false;
  }

  /**
   * 🔒 ROBUST CELL SPLITTING
   * Rules: 
   * 1. Normalize text (remove multi-lines, extra spaces).
   * 2. Split using the LAST hyphen.
   * 3. Validate components.
   */
  private extractOperativeAndTask(text: string, userMap: UserMapEntry[]) {
    // Normalize: remove newlines and collapse multiple spaces
    const normalized = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lastHyphenIndex = normalized.lastIndexOf('-');
    
    if (lastHyphenIndex === -1) {
       return { error: "Missing operative / missing separator", rawText: normalized };
    }

    const taskPart = normalized.substring(0, lastHyphenIndex).trim();
    const namePart = normalized.substring(lastHyphenIndex + 1).trim();

    if (!taskPart) return { error: "Missing task/description", rawText: normalized };
    if (!namePart) return { error: "Missing operative after separator", rawText: normalized };

    // Find user match
    const searchName = namePart.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedUser = userMap.find(u => u.normalizedName === searchName);
    
    if (!matchedUser) {
      return { 
        error: `Operative not recognized: ${namePart}`, 
        task: taskPart, 
        operative: namePart, 
        rawText: normalized 
      };
    }

    return { 
      user: matchedUser, 
      task: taskPart, 
      type: this.detectType(taskPart) 
    };
  }

  private detectType(task: string): 'am' | 'pm' | 'all-day' {
    const t = task.toUpperCase();
    if (t.includes(' AM ') || t.startsWith('AM ') || t.endsWith(' AM')) return 'am';
    if (t.includes(' PM ') || t.startsWith('PM ') || t.endsWith(' PM')) return 'pm';
    return 'all-day';
  }

  private isHeaderJunk(val: any, columnDate: Date): boolean {
    if (val instanceof Date) return true;
    const str = val.toString().toUpperCase();
    const junk = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    if (junk.some(j => str.includes(j))) return true;
    if (str === columnDate.getDate().toString()) return true;
    return false;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(Math.round((val - 25569) * 864e5));
    if (typeof val === 'string') {
        const m = val.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (m) {
            let y = parseInt(m[3], 10);
            if (y < 100) y += 2000;
            return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
        }
    }
    return null;
  }

  private formatDateKey(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private formatDateUK(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  private getColumnLetter(col: number): string {
    let letter = '';
    while (col > 0) {
      let t = (col - 1) % 26;
      letter = String.fromCharCode(t + 65) + letter;
      col = (col - t - 1) / 26;
    }
    return letter;
  }
}
