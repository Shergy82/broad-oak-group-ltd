import ExcelJS from 'exceljs';
import { type PlannerProfile, type StandardShift, type ImportError, type UserMapEntry } from '../types';

/**
 * Robust Battleship Parser for Broad Oak Gas
 * 
 * STRUCTURE:
 * - Property Section → Date Column → Work Cell
 * - Property info in Column A (Site Ref + Address).
 * - Dates run horizontally across columns.
 * - Work entries contain operative names (e.g., "Task - NAME").
 */
export class BroadOakProfile implements PlannerProfile {
  id = 'broad-oak';
  name = 'Broad Oak Gas (Battleship)';
  description = 'Horizontal dates, property sections, and embedded operative names.';

  detect(workbook: ExcelJS.Workbook): boolean {
    const sheet = workbook.worksheets.find(s => s.state !== 'hidden');
    if (!sheet) return false;
    
    // Look for horizontal dates which is a signature of Battleship
    for (let r = 1; r <= 10; r++) {
      const row = sheet.getRow(r);
      let dateCount = 0;
      for (let c = 1; c <= 30; c++) {
        if (this.toValidDate(row.getCell(c).value)) dateCount++;
      }
      if (dateCount >= 3) return true;
    }
    return false;
  }

  async parse(workbook: ExcelJS.Workbook, userMap: UserMapEntry[]): Promise<{ shifts: StandardShift[], errors: ImportError[] }> {
    const shifts: StandardShift[] = [];
    const errors: ImportError[] = [];

    for (const sheet of workbook.worksheets.filter(ws => ws.state !== 'hidden')) {
      errors.push({ 
        sheet: sheet.name, 
        message: `Scanning sheet: ${sheet.name}`, 
        severity: 'info', 
        code: 'SCAN_START' 
      });

      // 1. Identify Date Columns (Horizontal)
      const dateColumns: { col: number, date: Date }[] = [];
      let dateHeaderRow = -1;

      for (let r = 1; r <= 15; r++) {
        const row = sheet.getRow(r);
        const tempDates: { col: number, date: Date }[] = [];
        for (let c = 1; c <= 100; c++) {
          const date = this.toValidDate(row.getCell(c).value);
          if (date) tempDates.push({ col: c, date });
        }
        if (tempDates.length >= 3) {
          dateColumns.push(...tempDates);
          dateHeaderRow = r;
          break;
        }
      }

      if (dateColumns.length === 0) {
        errors.push({ 
          sheet: sheet.name, 
          message: 'No horizontal date header found in first 15 rows.', 
          severity: 'warning', 
          code: 'NO_DATES' 
        });
        continue;
      }

      errors.push({ 
        sheet: sheet.name, 
        message: `Found ${dateColumns.length} date columns.`, 
        severity: 'info', 
        code: 'DATES_FOUND' 
      });

      // 2. Iterate Rows to find Property Sections and Work Cells
      let currentAddress = '';
      let currentSiteRef = '';
      let propertyFoundInSheet = 0;

      sheet.eachRow((row, rowNumber) => {
        // Skip header rows
        if (rowNumber <= dateHeaderRow) return;

        // Check Column A for Property Info
        const cellA = row.getCell(1);
        const cellAText = this.getCellText(cellA);
        
        const siteRefMatch = cellAText.match(/\b(E\d{5,6})\b/i);
        const postcodeMatch = cellAText.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);

        if (siteRefMatch || postcodeMatch) {
          currentSiteRef = siteRefMatch ? siteRefMatch[1].toUpperCase() : currentSiteRef;
          currentAddress = cellAText.trim();
          propertyFoundInSheet++;
          
          errors.push({ 
            row: rowNumber, 
            sheet: sheet.name, 
            message: `Detected Property Section: ${currentAddress.substring(0, 30)}...`, 
            severity: 'info', 
            code: 'PROPERTY_FOUND' 
          });
          return;
        }

        // 3. Scan Date Columns for Work
        dateColumns.forEach(({ col, date }) => {
          const cell = row.getCell(col);
          const cellValue = this.getCellText(cell);
          
          if (!cellValue || cellValue.length < 3) return;

          const extraction = this.extractShiftData(cellValue, userMap);
          
          if (extraction) {
            if (!currentAddress) {
                errors.push({
                    row: rowNumber,
                    cell: cell.address,
                    sheet: sheet.name,
                    message: 'No address found for this work cell.',
                    severity: 'error',
                    code: 'PROPERTY_MISSING',
                    rawValues: { date, text: cellValue }
                });
                return;
            }

            shifts.push({
              date,
              operative: extraction.user.originalName,
              operativeUid: extraction.user.uid,
              address: currentAddress,
              contract: extraction.contract || currentSiteRef || sheet.name,
              task: extraction.task,
              descriptionOfWorks: cellValue,
              type: extraction.type,
              eNumber: currentSiteRef,
              sourceCell: cell.address,
              sourceSheet: sheet.name
            });
          } else {
            // This is a "Not Imported" item
            errors.push({
              row: rowNumber,
              cell: cell.address,
              sheet: sheet.name,
              message: `Operative not matched to a user.`,
              severity: 'error',
              code: 'OPERATIVE_MISSING',
              rawValues: { date, address: currentAddress, text: cellValue }
            });
          }
        });
      });

      if (propertyFoundInSheet === 0) {
        errors.push({ 
          sheet: sheet.name, 
          message: 'No property sections detected in Column A.', 
          severity: 'warning', 
          code: 'LAYOUT_MISMATCH' 
        });
      }
    }

    return { shifts, errors };
  }

  private extractShiftData(text: string, userMap: UserMapEntry[]) {
    const cleanText = text.toLowerCase();
    
    const matchedUser = userMap.find(u => {
      const name = u.originalName.toLowerCase();
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      return regex.test(cleanText);
    });

    if (!matchedUser) return null;

    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    if (cleanText.includes('am ') || cleanText.startsWith('am')) type = 'am';
    else if (cleanText.includes('pm ') || cleanText.startsWith('pm')) type = 'pm';

    let task = text;
    const nameRegex = new RegExp(`-?\\s*${matchedUser.originalName}\\s*`, 'gi');
    const typeRegex = /\b(am|pm)\b/gi;
    
    task = task.replace(nameRegex, '').replace(typeRegex, '').trim();
    if (task.startsWith('-')) task = task.substring(1).trim();
    if (task.endsWith('-')) task = task.substring(0, task.length - 1).trim();

    return {
      user: matchedUser,
      task: task || 'General Works',
      type,
      contract: ''
    };
  }

  private toValidDate(val: any): Date | null {
    if (!val) return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
      return new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate(), 12));
    }
    if (typeof val === 'number' && val > 40000 && val < 60000) {
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

  private getCellText(cell: ExcelJS.Cell): string {
    const v = cell.isMerged ? cell.master.value : cell.value;
    if (!v) return '';
    if (typeof v === 'object' && 'richText' in v) {
      return v.richText.map(t => t.text).join('').trim();
    }
    return String(v).trim();
  }
}
