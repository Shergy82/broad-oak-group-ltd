
/**
 * GAS IMPORT (colour-based divider rows) — DROP-IN CODE
 * - Uses ExcelJS because SheetJS/xlsx usually does NOT preserve cell styles reliably.
 * - BUILD import is untouched: you route to it exactly as you do today.
 *
 * Install:
 *   npm i exceljs
 *
 * Notes:
 * - Divider rows have NO text; they are detected only by a consistent non-white fill across the row.
 * - Site blocks are between divider rows.
 * - Site address is the biggest filled cell with text in column A (fallback A–B).
 * - Date header row is detected by finding a row with >=3 date-like cells across adjacent columns.
 */

import ExcelJS from "exceljs";

/* =========================
   Types
========================= */

export type ImportType = "BUILD" | "GAS";

export type ParsedGasShift = {
  siteAddress: string;
  shiftDate: string; // ISO yyyy-mm-dd
  task: string;
  type: 'am' | 'pm' | 'all-day';
  user: UserMapEntry;
  source: { sheetName: string; cellRef: string };
  manager?: string;
  notes?: string;
  eNumber?: string;
  contract?: string;
};

export type ImportFailure = {
  reason: string;
  siteAddress?: string;
  shiftDate?: string;
  operativeNameRaw?: string;
  sheetName?: string;
  cellRef?: string;
};

type UserMapEntry = { uid: string; normalizedName: string; originalName: string, department?: string };

export type ParseResult = {
  parsed: ParsedGasShift[];
  failures: ImportFailure[];
};

/* =========================
   HELPERS
========================= */

function normalizeWhitespace(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Robustly extracts the visible text from an ExcelJS cell.
 * Handles nulls, formulas, and rich text to prevent "toString" errors.
 */
function getCellText(cell: ExcelJS.Cell | null | undefined): string {
  if (!cell) return "";
  const val = cell.value;
  if (val === null || val === undefined) return "";
  
  if (typeof val === 'object') {
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map(v => v.text || '').join('').trim();
    }
    if ('formula' in val) {
      return String(val.result ?? '').trim();
    }
  }
  
  // cell.text is a getter that can sometimes fail in edge cases
  try {
    return (cell.text || String(val)).trim();
  } catch (e) {
    return String(val || "").trim();
  }
}

function findUsersInMap(nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } {
    const normalizedChunk = normalizeText(nameChunk);
    if (!normalizedChunk) return { users: [], reason: 'Empty name provided.' };

    let matches = userMap.filter(u => u.normalizedName === normalizedChunk);
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users exactly.` };

    matches = userMap.filter(u => u.normalizedName.includes(normalizedChunk));
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users.` };
    
    const chunkParts = normalizedChunk.split(' ');
    const lastName = chunkParts[chunkParts.length - 1];
    if (lastName) {
        matches = userMap.filter(u => u.normalizedName.endsWith(' ' + lastName));
        if (matches.length === 1) return { users: matches };
        if (matches.length > 1) {
             if (chunkParts.length > 1) {
                const firstInitial = chunkParts[0].charAt(0);
                const initialMatches = matches.filter(u => u.normalizedName.startsWith(firstInitial));
                if (initialMatches.length === 1) return { users: initialMatches };
            }
            return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users by last name.` };
        }
    }
    
    return { users: [], reason: `No user found for name: "${nameChunk}".` };
}

/* =========================
   GAS PARSER
========================= */

export async function parseGasWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[]): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const allParsed: ParsedGasShift[] = [];
  const allFailures: ImportFailure[] = [];

  const visibleWorksheets = workbook.worksheets.filter(ws => ws.state !== 'hidden');

  for (const sheet of visibleWorksheets) {
    let headerRowNumber = -1;
    let headerRow: ExcelJS.Row | undefined;
    
    sheet.eachRow((row, rowNum) => {
        if(!headerRow && row.hasValues) {
            headerRow = row;
            headerRowNumber = rowNum;
        }
    });

    let sheetResult: ParseResult;

    if (headerRow) {
        const headers: string[] = [];
        headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          headers[colNumber - 1] = normalizeText(getCellText(cell));
        });
  
        const dateIndex = headers.indexOf('date');
        const userIndex = headers.indexOf('user') > -1 ? headers.indexOf('user') : headers.indexOf('operative');
        const taskIndex = headers.indexOf('task');
        const addressIndex = headers.indexOf('address');
  
        if (dateIndex > -1 && userIndex > -1 && taskIndex > -1 && addressIndex > -1) {
            sheetResult = parseListView(sheet, headerRowNumber, headers, userMap);
        } else {
            sheetResult = parseMatrixView(sheet, userMap);
        }
    } else {
      sheetResult = parseMatrixView(sheet, userMap);
    }

    allParsed.push(...sheetResult.parsed);
    allFailures.push(...sheetResult.failures);
  }

  return { parsed: allParsed, failures: allFailures };
}

function parseListView(sheet: ExcelJS.Worksheet, headerRowNumber: number, headers: string[], userMap: UserMapEntry[]): ParseResult {
    const parsed: ParsedGasShift[] = [];
    const failures: ImportFailure[] = [];
    const sheetName = sheet.name;
    
    const dateIndex = headers.indexOf('date');
    const userIndex = headers.indexOf('user') > -1 ? headers.indexOf('user') : headers.indexOf('operative');
    const taskIndex = headers.indexOf('task');
    const addressIndex = headers.indexOf('address');

    for (let rowNum = headerRowNumber + 1; rowNum <= sheet.rowCount; rowNum++) {
        const row = sheet.getRow(rowNum);
        if (!row || !row.hasValues) continue;

        const date = parseExcelCellAsDate(row.getCell(dateIndex + 1));
        const userNameRaw = getCellText(row.getCell(userIndex + 1));
        const task = getCellText(row.getCell(taskIndex + 1));
        const address = getCellText(row.getCell(addressIndex + 1));

        if (!date || !userNameRaw || !task || !address) {
            if (userNameRaw || task || address) {
                failures.push({
                    reason: 'Missing required data (Date, User, Task, or Address).',
                    siteAddress: address,
                    sheetName,
                    cellRef: `Row ${rowNum}`
                });
            }
            continue;
        }

        const eNumMatchStart = address.match(/^\s*([BE]\d+\S*)\s+/i);
        let finalAddress = address;
        let eNumber = '';
        if (eNumMatchStart) {
          eNumber = eNumMatchStart[1].trim().toUpperCase();
          finalAddress = address.replace(eNumMatchStart[0], '').trim();
        }

        const { users: matchedUsers, reason } = findUsersInMap(userNameRaw, userMap);
        if (matchedUsers.length !== 1) {
            failures.push({
                reason: reason || `Could not find a unique user for "${userNameRaw}"`,
                siteAddress: finalAddress,
                operativeNameRaw: userNameRaw,
                sheetName,
                cellRef: row.getCell(userIndex + 1).address
            });
            continue;
        }

        parsed.push({
          siteAddress: finalAddress,
          eNumber: eNumber,
          shiftDate: toISODate(date),
          task: task,
          type: 'all-day',
          user: matchedUsers[0],
          source: { sheetName, cellRef: row.getCell(userIndex + 1).address },
          notes: '',
        });
    }

    return { parsed, failures };
}

function parseMatrixView(sheet: ExcelJS.Worksheet, userMap: UserMapEntry[]): ParseResult {
  const sheetName = sheet.name;
  const failures: ImportFailure[] = [];
  const parsed: ParsedGasShift[] = [];

  const used = getUsedBounds(sheet);
  if (!used) return { parsed: [], failures: [{ reason: "Sheet appears empty", sheetName }] };

  const dividerRows = findDividerRows(sheet, used);
  if (dividerRows.length < 2) {
    return { parsed: [], failures: [{ reason: "Matrix format (coloured dividers) not detected.", sheetName }] };
  }

  for (let i = 0; i < dividerRows.length - 1; i++) {
    const blockStart = dividerRows[i] + 1;
    const blockEnd = dividerRows[i + 1] - 1;
    if (blockEnd <= blockStart) continue;

    const siteAddressResult = extractSiteAddress(sheet, used, blockStart, blockEnd);
    if (!siteAddressResult) {
      failures.push({ reason: "Site address not found in block.", sheetName, cellRef: `A${blockStart}:B${blockEnd}` });
      continue;
    }
    
    const { address: rawSiteAddress, row: addressRow } = siteAddressResult;
    const eNumMatch = rawSiteAddress.match(/\b([BE]\d+\S*)\b/i);
    const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
    const siteAddress = eNumMatch ? rawSiteAddress.replace(eNumMatch[0], '').trim().replace(/,$/, '').trim() : rawSiteAddress;

    const dateRowIdx = findDateRow(sheet, used, blockStart, blockEnd);
    if (!dateRowIdx) {
      failures.push({ reason: "Date header row not found.", sheetName, siteAddress, cellRef: `A${blockStart}:Z${blockEnd}`});
      continue;
    }

    let manager = '';
    const otherContacts: string[] = [];
    for (let r = blockStart; r < addressRow; r++) {
        const cellText = getCellText(sheet.getCell(r, 1));
        if (cellText) {
            const upper = cellText.toUpperCase();
            if (upper.includes('SITE MANAGER')) manager = cellText.replace(/site manager\s*:?/i, '').trim().split('\n')[0];
            else if (upper.includes('PROJECT MANAGER') || upper.includes('TLO')) otherContacts.push(cellText);
        }
    }

    const dateCols = getDateColumns(sheet, used, dateRowIdx);
    for (const { col, isoDate } of dateCols) {
      for (let r = dateRowIdx + 1; r <= blockEnd; r++) {
        if (dividerRows.includes(r)) break;
        const cell = sheet.getCell(r, col);
        const text = getCellText(cell);
        if (!text || isNonShiftText(text)) continue;

        const { task, names, type } = extractGasTaskAndNames(text);
        const uniqueUsers = new Map<string, UserMapEntry>();
        let cellFailed = false;

        for (const name of names) {
            const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
            if (matchedUsers.length !== 1) {
                failures.push({ reason: reason || `Could not match: "${name}"`, siteAddress, operativeNameRaw: name, sheetName, cellRef: cell.address });
                cellFailed = true;
                break; 
            }
            uniqueUsers.set(matchedUsers[0].uid, matchedUsers[0]);
        }

        if (cellFailed) continue;
        
        for (const user of uniqueUsers.values()) {
            parsed.push({
              siteAddress,
              shiftDate: isoDate,
              task,
              type,
              user,
              source: { sheetName, cellRef: cell.address },
              manager,
              notes: otherContacts.join('\n'),
              eNumber,
              contract: sheetName,
            });
        }
      }
    }
  }
  return { parsed, failures };
}

/* =========================
   GAS HELPERS (ExcelJS specific)
========================= */

function getUsedBounds(ws: ExcelJS.Worksheet): UsedBounds | null {
  let minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    minRow = Math.min(minRow, rowNumber);
    maxRow = Math.max(maxRow, rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.value !== null && cell.value !== undefined) {
        minCol = Math.min(minCol, colNumber);
        maxCol = Math.max(maxCol, colNumber);
      }
    });
  });
  if (!isFinite(minRow)) return null;
  return { startRow: minRow, endRow: maxRow, startCol: minCol, endCol: maxCol };
}

type UsedBounds = { startRow: number; endRow: number; startCol: number; endCol: number };

function findDividerRows(ws: ExcelJS.Worksheet, used: UsedBounds): number[] {
  const rows: number[] = [];
  for (let r = used.startRow; r <= used.endRow; r++) {
    if (isDividerRow(ws, used, r)) rows.push(r);
  }
  return rows.filter((row, idx) => idx === 0 || row !== rows[idx - 1] + 1);
}

function isDividerRow(ws: ExcelJS.Worksheet, used: UsedBounds, r: number): boolean {
  let filledCount = 0;
  let textCount = 0;
  const totalCols = used.endCol - used.startCol + 1;
  for (let c = used.startCol; c <= used.endCol; c++) {
    const cell = ws.getCell(r, c);
    if (getCellText(cell)) textCount++;
    const fill = cell.fill as any;
    if (fill?.type === "pattern" && fill.fgColor?.argb) {
        const argb = String(fill.fgColor.argb).toUpperCase();
        if (argb !== "FFFFFFFF" && argb !== "00000000" && !argb.startsWith("00")) filledCount++;
    }
  }
  return textCount === 0 && (filledCount / totalCols) > 0.7;
}

function extractSiteAddress(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): { address: string; row: number; } | null {
    const scoreAddress = (cell: ExcelJS.Cell) => {
        const text = getCellText(cell);
        if (!text) return 0;
        let score = Math.min(text.length, 50);
        if (/\d/.test(text)) score += 10;
        if (/,|\n/.test(text)) score += 10;
        if (/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i.test(text)) score += 20;
        return score;
    };

    let best = { text: "", score: 0, row: 0 };
    for (let r = startRow; r <= endRow; r++) {
        for (let c = 1; c <= 2; c++) {
            const cell = ws.getCell(r, c);
            const score = scoreAddress(cell);
            if (score > best.score) best = { text: getCellText(cell), score, row: r };
        }
    }
    return best.score >= 20 ? { address: normalizeWhitespace(best.text), row: best.row } : null;
}

function findDateRow(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): number | null {
  for (let r = startRow; r <= endRow; r++) {
    let count = 0;
    for (let c = used.startCol; c <= used.endCol; c++) {
      if (parseExcelCellAsDate(ws.getCell(r, c))) count++;
    }
    if (count >= 3) return r;
  }
  return null;
}

function getDateColumns(ws: ExcelJS.Worksheet, used: UsedBounds, dateRowIdx: number): Array<{ col: number; isoDate: string }> {
  const cols = [];
  for (let c = used.startCol; c <= used.endCol; c++) {
    const dt = parseExcelCellAsDate(ws.getCell(dateRowIdx, c));
    if (dt) cols.push({ col: c, isoDate: toISODate(dt) });
  }
  return cols;
}

function parseExcelCellAsDate(cell: ExcelJS.Cell): Date | null {
  const v = cell.value;
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = new Date((v - 25569) * 86400 * 1000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const text = getCellText(cell);
  if (!text) return null;
  const d = new Date(text.replace(/(\d+)(st|nd|rd|th)/g, '$1'));
  return (!isNaN(d.getTime()) && d.getUTCFullYear() > 2000) ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null;
}

function toISODate(dt: Date): string {
  return dt.toISOString().split('T')[0];
}

function extractGasTaskAndNames(text: string): { task: string; names: string[]; type: 'am' | 'pm' | 'all-day' } {
    let raw = normalizeWhitespace(text);
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    if (/^AM\b/i.test(raw)) { type = 'am'; raw = raw.substring(2).trim(); }
    else if (/^PM\b/i.test(raw)) { type = 'pm'; raw = raw.substring(2).trim(); }

    const lastHyphen = raw.lastIndexOf("-");
    if (lastHyphen === -1) return { task: "Task not specified", names: raw.split(/[,&/]| and /i).map(s => s.trim()).filter(Boolean), type };
    return { 
        task: raw.substring(0, lastHyphen).trim() || "Task not specified", 
        names: raw.substring(lastHyphen + 1).split(/[,&/]| and /i).map(s => s.trim()).filter(Boolean), 
        type 
    };
}

function isNonShiftText(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ["job manager", "measures", "scheme", "pulse", "ignore"].some(b => t.includes(b)) || /^\+?\d[\d\s-]{7,}$/.test(t);
}

function colToA1(col: number): string {
  let n = col, s = "";
  while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ====================================================================================================
   BUILD DEPARTMENT IMPORT (SHEETJS) - DO NOT MODIFY BELOW THIS LINE AS PER USER REQUEST
   ==================================================================================================== */

// Full sheet parser for BUILD format
export const parseBuildSheet = (
  worksheet: any, // Using 'any' for SheetJS worksheet type
  userMap: UserMapEntry[],
  sheetName: string,
  department: string
): { shifts: any[], failed: ImportFailure[] } => {
  const data: any[][] = worksheet; // SheetJS returns array of arrays
  const allShifts: any[] = [];
  const allFailed: any[] = [];

  const headers = data[0].map((h: any) => String(h || '').trim().toLowerCase());
  const dateIndex = headers.indexOf('date');
  const userIndex = headers.indexOf('user');
  const taskIndex = headers.indexOf('task');
  const addressIndex = headers.indexOf('address');

  if ([dateIndex, userIndex, taskIndex, addressIndex].includes(-1)) {
    // --- MATRIX VIEW PARSER ---
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dateRowRaw = data[0];
    const dateRow: (Date | null)[] = dateRowRaw.map((cell: any) => parseDate(cell));
    
    let currentAddress = '';
    let currentENumber = '';
    let currentContract = '';
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.every(cell => !cell)) {
          continue;
      }

      const newAddressAndENumber = String(row[0] || '').trim();
      if (newAddressAndENumber) {
        const eNumMatch = newAddressAndENumber.match(/\b([BE]\d+\S*)$/i);
        if (eNumMatch) {
          currentENumber = eNumMatch[0].toUpperCase();
          currentAddress = newAddressAndENumber.replace(eNumMatch[0], '').trim().replace(/,$/, '').trim();
        } else {
          currentAddress = newAddressAndENumber;
          currentENumber = '';
        }
        currentContract = String(row[2] || '').trim() || currentContract;
      }

      if (!currentAddress) continue;
      
      const shiftDateCells = dateRow.slice(5);

      for (let c = 0; c < shiftDateCells.length; c++) {
          const date = shiftDateCells[c];
          const cellText = String(row[c + 5] || '').trim();
          if (!date || !cellText || !/[a-zA-Z]/.test(cellText)) continue;

          if (date < today) continue;
          
          const extraction = extractUsersAndTask(cellText, userMap);
          if (!extraction || extraction.users.length === 0) {
              allFailed.push({
                  reason: extraction?.reason || 'No valid user found in cell.',
                  siteAddress: currentAddress,
                  sheetName,
                  cellRef: `Col ${c + 6}, Row ${i + 1}`,
              });
              continue;
          }

          extraction.users.forEach(user => {
              allShifts.push({
                  date,
                  address: currentAddress,
                  eNumber: currentENumber,
                  task: extraction.task,
                  userId: user.uid,
                  userName: user.originalName,
                  type: extraction.type,
                  manager: sheetName,
                  contract: currentContract,
                  department,
                  notes: '',
              });
          });
      }
    }
  } else {
    // --- LIST VIEW PARSER ---
    const operativeIndex = userIndex !== -1 ? userIndex : headers.indexOf('operative');
    const eNumberIndex = headers.findIndex(h => h.includes('number'));
    const contractIndex = headers.indexOf('contract');
    const managerIndex = headers.indexOf('manager');

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.every((cell: any) => !cell)) continue;

        const date = parseDate(row[dateIndex]);
        const userNameRaw = String(row[operativeIndex] || '').trim();
        const task = String(row[taskIndex] || '').trim();
        const address = String(row[addressIndex] || '').trim();

        if (!date || !userNameRaw || !task || !address) continue;

        const { users: matchedUsers, reason } = findUsersInMap(userNameRaw, userMap);
        if (matchedUsers.length !== 1) {
            allFailed.push({ reason: reason || 'No unique user found', siteAddress: address, operativeNameRaw: userNameRaw, sheetName, cellRef: `Row ${i + 1}` });
            continue;
        }

        allShifts.push({
            date,
            address,
            eNumber: eNumberIndex !== -1 ? String(row[eNumberIndex] || '') : '',
            task,
            userId: matchedUsers[0].uid,
            userName: matchedUsers[0].originalName,
            type: 'all-day',
            manager: managerIndex !== -1 ? String(row[managerIndex] || sheetName) : sheetName,
            contract: contractIndex !== -1 ? String(row[contractIndex] || '') : '',
            department,
            notes: '',
        });
    }
  }

  return { shifts: allShifts, failed: allFailed };
};

const extractUsersAndTask = (
  text: string,
  userMap: UserMapEntry[]
): { users: UserMapEntry[]; task: string; type: 'am' | 'pm' | 'all-day', reason?: string } | null => {
  if (!text || typeof text !== 'string') return null;

  let raw = text.trim();
  if (!raw) return null;

  let shiftType: 'am' | 'pm' | 'all-day' = 'all-day';

  if (/^AM\b/i.test(raw)) {
    shiftType = 'am';
    raw = raw.substring(2).trim();
  } else if (/^PM\b/i.test(raw)) {
    shiftType = 'pm';
    raw = raw.substring(2).trim();
  }

  const lastHyphenIndex = raw.lastIndexOf('-');
  if (lastHyphenIndex === -1) {
    return {
      users: [],
      task: raw,
      type: shiftType,
      reason: 'No " - " separator found to distinguish task from names.',
    };
  }

  const taskPart = raw.substring(0, lastHyphenIndex).trim();
  const namesPart = raw.substring(lastHyphenIndex + 1).trim();

  if (!namesPart) {
    return {
      users: [],
      task: taskPart,
      type: shiftType,
      reason: 'No names found after the " - " separator.',
    };
  }

  const nameChunks = namesPart.split(/,|&|\/|\b\s*and\s*\b/i).map(s => s.trim()).filter(Boolean);

  if (nameChunks.length === 0) {
      return {
          users: [],
          task: taskPart,
          type: shiftType,
          reason: `No valid names found in cell part: "${namesPart}"`
      };
  }

  const allMatchedUsers: UserMapEntry[] = [];
  let failureReason: string | null = null;
  
  for (const chunk of nameChunks) {
      const result = findUsersInMap(chunk, userMap);
      if (result.users.length === 1) {
          if (!allMatchedUsers.some(u => u.uid === result.users[0].uid)) {
              allMatchedUsers.push(result.users[0]);
          }
      } else {
          failureReason = result.reason || `Failed to match user for "${chunk}".`;
          break;
      }
  }

  if (failureReason) {
    return {
      users: [],
      task: taskPart,
      type: shiftType,
      reason: failureReason,
    };
  }
  
  if (allMatchedUsers.length === 0) {
      return {
          users: [],
          task: taskPart,
          type: shiftType,
          reason: `Could not identify any valid users from "${namesPart}".`
      }
  }
  
  return {
    users: allMatchedUsers,
    task: taskPart,
    type: shiftType,
  };
};

const parseDate = (dateValue: any): Date | null => {
  if (!dateValue) return null;
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    return dateValue;
  }
  if (typeof dateValue === 'number' && dateValue > 1) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
    if (!isNaN(d.getTime())) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  }
  if (typeof dateValue === 'string') {
    let s = dateValue.trim();
    if (!s) return null;

    s = s.replace(/(\d+)(st|nd|rd|th)/g, '$1');

    const parts = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
    if (parts) {
      const day = parseInt(parts[1], 10);
      const month = parseInt(parts[2], 10) - 1;
      let year = parts[3] ? parseInt(parts[3], 10) : new Date().getFullYear();
      if (year < 100) year += 2000;
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const d = new Date(Date.UTC(year, month, day));
        if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) {
          return d;
        }
      }
    }
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    }
  }
  return null;
};
