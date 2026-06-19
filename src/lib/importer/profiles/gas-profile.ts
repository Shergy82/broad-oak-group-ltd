/**
 * GAS PLANNER IMPORT PROFILE
 *
 * This profile is locked because the Gas planner reconciliation logic is currently working correctly.
 * Do not alter this file when changing Build planner behaviour.
 * Build planner changes must be made in the Build profile only.
 */

import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';
import { 
  normaliseText, 
  normaliseName,
  formatDateKey, 
  getTodayDateKey, 
  findSafeUserMatch, 
  getColumnLetter
} from '../core/utils';

export class GasProfile implements PlannerProfile {
  id = 'gas-planner';
  name = 'Gas Department Planner';
  description = 'Locked profile for the Gas department sheet layout.';

  private eNumberRegex = /\b[BE]\d{5,}\b/i;

  detect(workbook: ExcelJS.Workbook): boolean {
    return workbook.worksheets.some(sheet => {
        if (sheet.state === 'hidden') return false;
        let found = false;
        for (let r = 1; r <= 30; r++) {
            const rowText = sheet.getRow(r).values?.toString().toUpperCase() || '';
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
    const todayKey = getTodayDateKey();

    const sheet = workbook.worksheets.find(s => s.state !== 'hidden' && this.isPlannerSheet(s)) || workbook.worksheets.find(s => s.state !== 'hidden');

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
                const date = this.parseDateValue(cell.value);
                if (date) {
                    const dateKey = formatDateKey(date);
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
        errors.push({ message: "No dates found in header row (Col F+).", severity: 'error', code: 'NO_DATES' });
        return { shifts, errors };
    }

    const dividerRows: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      const rowText = row.values ? row.values.toString().toUpperCase() : '';
      if (rowText.includes('SITE MANAGER') || rowText.includes('DIVIDING LINE')) {
        dividerRows.push(rowNumber);
      }
    });

    if (dividerRows.length === 0) dividerRows.push(dateRowIndex + 1);

    for (let i = 0; i < dividerRows.length; i++) {
      const startRow = dividerRows[i];
      const nextDividerRow = dividerRows[i + 1];
      const endRow = nextDividerRow ? nextDividerRow - 1 : sheet.rowCount;

      let blockAddress = "";
      let blockENumber = "";
      let blockManager = "";
      let blockScheme = "";

      for (let r = startRow; r <= Math.min(startRow + 10, endRow); r++) {
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
            const eMatch = colA.match(this.eNumberRegex);
            if (eMatch) {
                blockENumber = eMatch[0];
                blockAddress = colA.replace(this.eNumberRegex, '').replace(/^\s*[-:–—]\s*/, '').trim();
            } else {
                blockAddress = colA;
            }
        }
      }

      for (let r = startRow; r <= endRow; r++) {
        const row = sheet.getRow(r);

        dateColumnMap.forEach(({ date, dateKey }, colNumber) => {
          const cell = row.getCell(colNumber);
          const rawText = cell.value?.toString() || "";
          const text = rawText.trim().replace(/\s+/g, ' ');

          if (!text) return;
          if (dateKey < todayKey) return;
          if (!text.includes("-")) return; 

          const lastHyphenIndex = text.lastIndexOf("-");
          const taskPart = text.substring(0, lastHyphenIndex).trim();
          const namePart = text.substring(lastHyphenIndex + 1).trim();

          const context = {
            row: r,
            cell: `${getColumnLetter(colNumber)}${r}`,
            sheet: sheet.name,
            date: format(date, 'dd/MM/yyyy'),
            dateKey,
            address: blockAddress || "Unknown Address",
            task: taskPart
          };

          if (!taskPart && namePart) {
            errors.push({ ...context, message: "Missing task/description", severity: 'error', code: 'VAL_ERROR', operative: namePart });
            return;
          }
          if (taskPart && !namePart) {
            errors.push({ ...context, message: "Missing operative after separator", severity: 'error', code: 'VAL_ERROR', operative: "—" });
            return;
          }

          const matchedUser = findSafeUserMatch(namePart, userMap);

          if (!matchedUser) {
            // Refined failure reason
            const norm = normaliseName(namePart);
            const parts = norm.split(" ").filter(Boolean);
            const exactMatches = userMap.filter(u => normaliseName(u.originalName) === norm);
            
            let reason = `Operative not recognised: ${namePart}`;
            if (exactMatches.length > 1) {
              reason = `Multiple registered users match: ${namePart}`;
            } else if (parts.length < 2) {
              reason = `Operative name too vague: ${namePart}`;
            }

            errors.push({ 
                ...context, 
                message: reason, 
                severity: 'error', 
                code: 'USER_NOT_FOUND', 
                operative: namePart 
            });
            return;
          }

          shifts.push({
            date,
            dateKey,
            address: blockAddress || "Unknown Address",
            eNumber: blockENumber,
            contract: blockScheme || "Planner Works",
            manager: blockManager,
            operative: matchedUser.originalName,
            operativeUid: matchedUser.uid,
            userId: matchedUser.uid,
            userName: matchedUser.originalName,
            task: taskPart,
            descriptionOfWorks: text,
            type: this.detectType(taskPart),
            sourceCell: context.cell,
            sourceSheet: sheet.name,
            sourcePlannerId: "",
            sourcePlannerName: "",
            plannerName: "",
            profileId: "",
            importKey: "",
            startTime: "",
            endTime: ""
          });
        });
      }
    }

    return { shifts, errors };
  }

  private isPlannerSheet(sheet: ExcelJS.Worksheet): boolean {
    for (let i = 1; i <= 20; i++) {
        const rowText = sheet.getRow(i).values?.toString().toUpperCase() || '';
        if (rowText.includes('SITE MANAGER')) return true;
    }
    return false;
  }

  private parseDateValue(val: any): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === 'number') return new Date(Math.round((val - 25569) * 864e5));
    return null;
  }

  private detectType(task: string): 'am' | 'pm' | 'all-day' {
    const t = task.toUpperCase();
    if (t.includes(' AM ') || t.startsWith('AM ') || t.endsWith(' AM')) return 'am';
    if (t.includes(' PM ') || t.startsWith('PM ') || t.endsWith(' PM')) return 'pm';
    return 'all-day';
  }
}
