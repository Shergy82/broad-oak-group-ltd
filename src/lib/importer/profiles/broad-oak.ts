'use client';
import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Known first-name aliases to help match operatives safely.
 */
const FIRST_NAME_ALIASES: Record<string, string[]> = {
  philip: ["phil", "phillip", "philip"],
  stephen: ["steve", "steven", "stephen"],
  michael: ["mike", "mick", "michael"],
  david: ["dave", "david"],
  robert: ["rob", "bob", "robert"],
  james: ["jim", "jamie", "james"],
  william: ["will", "bill", "billy", "william"],
  thomas: ["tom", "tommy", "thomas"],
};

/**
 * Broad Oak Gas & Build Planner Profile
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Gas/Build Planner';
  description = 'Hierarchical extraction with safe user matching and silent historic skipping.';

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

    const todayKey = this.getTodayDateKey();

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

      // Extraction of section context
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

      // Extraction of shifts within section
      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach(({ date, dateKey }, colNumber) => {
          // 🔒 SILENT HISTORIC SKIP
          if (dateKey < todayKey) return;

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

          const match = this.extractOperativeAndTaskSafely(rawText, userMap);
          
          if (match.error) {
              errors.push({
                  ...context,
                  message: match.error,
                  severity: match.isVague || match.isAmbiguous ? 'warning' : 'error',
                  code: 'MATCH_ERROR',
                  task: match.task || rawText,
                  operative: match.operative || "—",
                  address: blockAddress
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
              userId: match.user.uid,
              userName: match.user.originalName,
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
   * Safe matching logic implementation.
   */
  private extractOperativeAndTaskSafely(text: string, userMap: UserMapEntry[]) {
    // 1. Initial cleanup (collapse lines and spaces)
    const normalized = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lastHyphenIndex = normalized.lastIndexOf('-');
    
    if (lastHyphenIndex === -1) {
       return { error: "Missing operative / missing separator", task: normalized };
    }

    const taskPart = normalized.substring(0, lastHyphenIndex).trim();
    const namePart = normalized.substring(lastHyphenIndex + 1).trim();

    if (!taskPart) return { error: "Missing task/description", operative: namePart };
    if (!namePart) return { error: "Missing operative after separator", task: taskPart };

    // 2. Matching Logic
    const normPlanner = this.normaliseName(namePart);
    const plannerParts = normPlanner.split(" ");
    
    // Safety: reject first-name only entries
    if (plannerParts.length < 2) {
      return { error: `Operative name too vague: ${namePart}`, isVague: true, task: taskPart, operative: namePart };
    }

    const plannerFirst = plannerParts[0];
    const plannerLast = plannerParts.slice(1).join(" ");
    const plannerInitial = plannerFirst[0];

    const candidates: UserMapEntry[] = [];

    for (const user of userMap) {
      const normUser = this.normaliseName(user.originalName);
      const userParts = normUser.split(" ");
      if (userParts.length < 2) continue;
      
      const userFirst = userParts[0];
      const userLast = userParts.slice(1).join(" ");

      // A. Exact match
      if (normUser === normPlanner) {
        return { user, task: taskPart, type: this.detectType(taskPart) };
      }

      // B. Nickname match
      if (this.isSameNameGroup(plannerFirst, userFirst) && plannerLast === userLast) {
        candidates.push(user);
        continue;
      }

      // C. First Initial + Surname
      if (plannerFirst.length === 1 && plannerFirst === userFirst[0] && plannerLast === userLast) {
        candidates.push(user);
        continue;
      }

      // D. Fuzzy match
      const dist = this.getLevenshteinDistance(normUser, normPlanner);
      const surnameDist = this.getLevenshteinDistance(userLast, plannerLast);
      if (dist <= 2 && surnameDist <= 1) {
        candidates.push(user);
        continue;
      }
    }

    const uniqueCandidates = Array.from(new Map(candidates.map(u => [u.uid, u])).values());

    if (uniqueCandidates.length === 1) {
      return { user: uniqueCandidates[0], task: taskPart, type: this.detectType(taskPart) };
    }

    if (uniqueCandidates.length > 1) {
      return { error: `Multiple possible users matched: ${namePart}`, isAmbiguous: true, task: taskPart, operative: namePart };
    }

    return { error: `Operative not recognised: ${namePart}`, task: taskPart, operative: namePart };
  }

  private normaliseName(value: string): string {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ");
  }

  private isSameNameGroup(name1: string, name2: string): boolean {
    if (name1 === name2) return true;
    for (const aliases of Object.values(FIRST_NAME_ALIASES)) {
      if (aliases.includes(name1) && aliases.includes(name2)) return true;
    }
    return false;
  }

  private getLevenshteinDistance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () =>
      Array.from({ length: b.length + 1 }, () => 0)
    );
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
        else matrix[i][j] = Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
      }
    }
    return matrix[a.length][b.length];
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

  private getTodayDateKey(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
