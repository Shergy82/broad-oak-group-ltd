import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Robust Generic Parser
 * Scans for common headers and handles data carry-down for merged/blank cells.
 */
export class GenericProfile implements PlannerProfile {
  id = 'generic';
  name = 'Standard Tabular Planner';
  description = 'Supports standard layouts with columns for Date, Staff, Address, and Task.';

  private headerAliases: Record<string, string[]> = {
    operative: ['operative', 'employee', 'name', 'staff', 'worker', 'user'],
    date: ['date', 'appointment date', 'day'],
    startTime: ['start', 'start time', 'commence'],
    endTime: ['finish', 'end time', 'completion', 'finish time'],
    address: ['address', 'site address', 'job address', 'property', 'location'],
    contract: ['contract', 'project', 'client', 'scheme'],
    task: ['task', 'works', 'description', 'description of works', 'job type'],
    room: ['room', 'area'],
    notes: ['notes', 'comments', 'additional info']
  };

  detect(workbook: ExcelJS.Workbook): boolean {
    // This is the fallback, but we'll return true if we find at least 2 common headers
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;

    for (let r = 1; r <= 10; r++) {
      const row = sheet.getRow(r);
      let matchCount = 0;
      row.eachCell(cell => {
        const val = String(cell.value || '').toLowerCase();
        for (const aliases of Object.values(this.headerAliases)) {
          if (aliases.includes(val)) {
            matchCount++;
            break;
          }
        }
      });
      if (matchCount >= 2) return true;
    }
    return true; // Fallback
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    for (const sheet of workbook.worksheets.filter(ws => ws.state !== 'hidden')) {
      const mapping = this.findHeaders(sheet);
      
      errors.push({
        sheet: sheet.name,
        message: `Scanning sheet: ${sheet.name}. Headers detected: ${Object.keys(mapping).join(', ')}`,
        severity: 'info',
        code: 'DEBUG_LOG'
      });

      if (!mapping.date || !mapping.operative) {
        errors.push({
          sheet: sheet.name,
          message: `Skipping sheet: Could not find mandatory headers (Date and Operative).`,
          severity: 'warning',
          code: 'MISSING_HEADERS'
        });
        continue;
      }

      // Stateful tracking for merged/blank repeated cells
      let lastSeen: Partial<StandardShift> = {};
      let rowCount = 0;

      sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= (mapping.headerRow || 0)) return;
        rowCount++;

        const rawValues: any = {};
        row.eachCell((cell, colNumber) => { rawValues[colNumber] = cell.value; });

        const getVal = (col: number) => {
          const cell = row.getCell(col);
          const val = cell.isMerged ? cell.master.value : cell.value;
          return val === null || val === undefined ? '' : val;
        };

        const dateRaw = getVal(mapping.date!);
        const operativeRaw = getVal(mapping.operative!);
        const addressRaw = mapping.address ? getVal(mapping.address) : '';
        const taskRaw = mapping.task ? getVal(mapping.task) : '';
        const startTimeRaw = mapping.startTime ? getVal(mapping.startTime) : '';
        const endTimeRaw = mapping.endTime ? getVal(mapping.endTime) : '';
        const contractRaw = mapping.contract ? getVal(mapping.contract) : '';
        const roomRaw = mapping.room ? getVal(mapping.room) : '';
        const notesRaw = mapping.notes ? getVal(mapping.notes) : '';

        // Carry Down Logic
        const date = this.parseDate(dateRaw) || lastSeen.date;
        const operative = String(operativeRaw).trim() || lastSeen.operative;
        const address = String(addressRaw).trim() || lastSeen.address;
        const contract = String(contractRaw).trim() || lastSeen.contract || sheet.name;
        const room = String(roomRaw).trim() || lastSeen.room;
        
        // Update history
        if (date) lastSeen.date = date;
        if (operative) lastSeen.operative = operative;
        if (address) lastSeen.address = address;
        if (contract) lastSeen.contract = contract;
        if (room) lastSeen.room = room;

        // Validation of mandatory logic
        if (!date) {
          errors.push({ row: rowNumber, sheet: sheet.name, message: 'Row skipped: Invalid or missing date.', severity: 'debug', code: 'INVALID_DATE', rawValues });
          return;
        }
        if (!operative) {
          errors.push({ row: rowNumber, sheet: sheet.name, message: 'Row skipped: Missing operative name.', severity: 'debug', code: 'MISSING_OPERATIVE', rawValues });
          return;
        }
        if (!address && !taskRaw && !notesRaw) {
          errors.push({ row: rowNumber, sheet: sheet.name, message: 'Row skipped: No work details found (Address, Task, or Notes).', severity: 'debug', code: 'NO_WORK_DETAILS', rawValues });
          return;
        }

        shifts.push({
          date,
          operative,
          address,
          contract,
          task: String(taskRaw).trim() || 'Work',
          room,
          descriptionOfWorks: String(taskRaw || notesRaw).trim(),
          startTime: this.parseTime(startTimeRaw),
          endTime: this.parseTime(endTimeRaw),
          type: this.detectType(taskRaw, startTimeRaw),
          sourceCell: row.getCell(mapping.date!).address,
          sourceSheet: sheet.name
        });
      });

      errors.push({
        sheet: sheet.name,
        message: `Scanned ${rowCount} rows. Extracted ${shifts.length} shifts.`,
        severity: 'info',
        code: 'DEBUG_LOG'
      });
    }

    return { shifts, errors };
  }

  private findHeaders(sheet: ExcelJS.Worksheet): { [key: string]: number | undefined, headerRow?: number } {
    const mapping: { [key: string]: number | undefined, headerRow?: number } = {};
    for (let r = 1; r <= 10; r++) {
      const row = sheet.getRow(r);
      let found = false;
      row.eachCell((cell, colNumber) => {
        const val = String(cell.value || '').toLowerCase().trim();
        for (const [key, aliases] of Object.entries(this.headerAliases)) {
          if (aliases.includes(val)) {
            mapping[key] = colNumber;
            found = true;
          }
        }
      });
      if (found) {
        mapping.headerRow = r;
        return mapping;
      }
    }
    return mapping;
  }

  private parseDate(val: any): Date | null {
    if (val instanceof Date && !isNaN(val.getTime())) {
      return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate(), 12));
    }
    if (typeof val === 'number') {
      const d = new Date((val - 25569) * 86400 * 1000);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
    }
    if (typeof val === 'string') {
      const parts = val.split(/[/-]/);
      if (parts.length === 3) {
        let d, m, y;
        if (parts[0].length === 4) { [y, m, d] = parts.map(Number); }
        else { [d, m, y] = parts.map(Number); }
        if (y < 100) y += 2000;
        const date = new Date(Date.UTC(y, m - 1, d, 12));
        return isNaN(date.getTime()) ? null : date;
      }
    }
    return null;
  }

  private parseTime(val: any): string {
    if (!val) return '';
    if (typeof val === 'number') {
      const totalSeconds = Math.round(val * 86400);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const match = String(val).match(/(\d{1,2})[:.](\d{2})/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
    return '';
  }

  private detectType(task: any, time: any): 'am' | 'pm' | 'all-day' {
    const combined = String(task + ' ' + time).toLowerCase();
    if (combined.includes('am') || combined.includes('morning')) return 'am';
    if (combined.includes('pm') || combined.includes('afternoon')) return 'pm';
    return 'all-day';
  }
}
