/**
 * GAS & BUILD IMPORT (ExcelJS based)
 * - Uses ExcelJS for robust style and formula handling.
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
  department?: string;
  plannerName?: string;
};

export interface DiagnosticIssue {
  cellRef: string;
  sheetName: string;
  value: string;
  reason: string;
}

export type ImportFailure = {
  reason: string;
  siteAddress?: string;
  shiftDate?: string;
  operativeNameRaw?: string;
  sheetName?: string;
  cellRef?: string;
  cellContent?: string;
};

type UserMapEntry = { 
  uid: string; 
  normalizedName: string; 
  originalName: string; 
  department?: string;
  accountType?: 'individual' | 'company';
};

export type ParseResult = {
  parsed: ParsedGasShift[];
  failures: ImportFailure[];
  diagnostics?: DiagnosticIssue[];
};

/* =========================
   HELPERS (SHARED)
========================= */

function normalizeWhitespace(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  let t = String(text).toLowerCase();
  // Strip phone numbers / IDs
  t = t.replace(/\b(0\d{3,4}\s*\d{5,6}|07\d{3}\s*\d{6}|\+44\s*\d{4}\s*\d{6})\b/g, '');
  return t.replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function getCellText(cell: ExcelJS.Cell | null | undefined): string {
  if (!cell) return "";
  const master = cell.isMerged ? cell.master : cell;
  const val = master.value;
  if (val === null || val === undefined) return "";
  if (typeof val === 'object' && 'result' in val) {
    const res = (val as any).result;
    if (res === null || res === undefined) return "";
    return String(res).trim();
  }
  return String(master.text || val).trim();
}

function getCellValue(cell: ExcelJS.Cell | null | undefined): any {
  if (!cell) return null;
  const master = cell.isMerged ? cell.master : cell;
  const v = master.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as any).result;
  return v;
}

/**
 * 🔒 FUZZY WORD-WISE MATCHING
 */
function findUsersInMap(nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } {
    const normalizedInput = normalizeText(nameChunk);
    if (!normalizedInput || normalizedInput.length < 2) return { users: [], reason: 'Input too short.' };

    // 1. Exact Match
    let matches = userMap.filter(u => u.normalizedName === normalizedInput);
    if (matches.length === 1) return { users: matches };

    // 2. Fragment Match
    const inputWords = normalizedInput.split(' ').filter(w => w.length > 1);
    if (inputWords.length === 0) return { users: [], reason: 'No significant words.' };

    matches = userMap.filter(u => {
        const userWords = u.normalizedName.split(' ');
        return inputWords.every(iWord => 
            userWords.some(uWord => uWord.startsWith(iWord))
        );
    });

    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous: matches ${matches.map(m => m.originalName).join(', ')}` };
    
    return { users: [], reason: `No operative found for: "${nameChunk}"` };
}

/**
 * 🔒 TIMEZONE-STABLE DATE PARSING
 */
function parseExcelCellAsDate(cell: ExcelJS.Cell): { date: Date | null, diagnostic?: string } {
  try {
    const v = getCellValue(cell);
    let d: Date | null = null;

    if (v instanceof Date && !isNaN(v.getTime())) {
      d = new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    } else if (typeof v === "number" && v > 20000) {
      if (v > 60000) return { date: null, diagnostic: `Likely a contact number or ID.` };
      const rawDate = new Date((v - 25569) * 86400 * 1000);
      d = new Date(Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()));
    }

    if (d && !isNaN(d.getTime())) {
      if (d.getUTCFullYear() < 2024 || d.getUTCFullYear() > 2035) return { date: null, diagnostic: `Year ${d.getUTCFullYear()} is out of range.` };
      // Midday UTC for absolute stability
      return { date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0)) };
    }
  } catch (e) {}
  return { date: null };
}

function toISODate(dt: Date | null): string {
  if (!dt || isNaN(dt.getTime())) return "";
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function isNonShiftText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  const noise = ["date", "task", "name", "operative", "address", "scheme", "manager"];
  return noise.some(h => t.includes(h)) || /^\+?\d[\d\s-]{7,}$/.test(t);
}

/* =========================
   GAS PARSER (STATEFUL BATTLESHIP)
========================= */

export async function parseGasWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[]): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const allParsed: ParsedGasShift[] = [];
  const allFailures: ImportFailure[] = [];
  const allDiagnostics: DiagnosticIssue[] = [];

  for (const sheet of workbook.worksheets.filter(ws => ws.state !== 'hidden')) {
    const res = parseGasSheet(sheet, userMap);
    allParsed.push(...res.parsed);
    allFailures.push(...res.failures);
    if (res.diagnostics) allDiagnostics.push(...res.diagnostics);
  }

  const today = toISODate(new Date());
  return { 
    parsed: allParsed.filter(s => s.shiftDate >= today), 
    failures: allFailures, // Return failures for all to help debugging
    diagnostics: allDiagnostics
  };
}

function isBlackDivider(row: ExcelJS.Row): boolean {
    const cell = row.getCell(1);
    const fill = cell.fill as ExcelJS.FillPattern;
    if (fill?.type === 'pattern' && fill.fgColor) {
        const color = fill.fgColor.argb || (fill.fgColor as any).indexed;
        if (color === 'FF000000' || color === 64) return true;
        // Dark check for gray lines
        if (typeof color === 'string' && color.startsWith('FF')) {
            const r = parseInt(color.substring(2, 4), 16);
            const g = parseInt(color.substring(4, 6), 16);
            const b = parseInt(color.substring(6, 8), 16);
            if (r + g + b < 100) return true;
        }
    }
    return false;
}

function parseGasSheet(sheet: ExcelJS.Worksheet, userMap: UserMapEntry[]): ParseResult {
  const parsed: ParsedGasShift[] = [];
  const failures: ImportFailure[] = [];
  const diagnostics: DiagnosticIssue[] = [];

  const used = getUsedBounds(sheet);
  if (!used) return { parsed: [], failures: [], diagnostics: [] };

  // 1. Identify all divider rows (Start of Blocks)
  const dividers: number[] = [];
  for (let r = used.startRow; r <= used.endRow; r++) {
    if (isBlackDivider(sheet.getRow(r))) {
      dividers.push(r);
    }
  }

  // 2. Process Blocks
  for (let i = 0; i < dividers.length; i++) {
    const startRow = dividers[i];
    const endRow = dividers[i + 1] ? dividers[i + 1] - 1 : used.endRow;

    // a. Extract Address from block
    const blockAddress = extractAddressFromBlock(sheet, startRow, endRow);
    if (!blockAddress) continue;
    const eNumber = blockAddress.match(/\b([BE]\d+\S*)\b/i)?.[1].toUpperCase() || '';

    // b. Find Date Header Row (Blue row usually)
    let dateRowIdx = -1;
    let dateCols: { col: number, isoDate: string }[] = [];
    for (let r = startRow; r <= Math.min(startRow + 10, endRow); r++) {
        // Search Column F onwards
        const res = getDateColumns(sheet, used, r, 6);
        if (res.cols.length >= 2) {
            dateRowIdx = r;
            dateCols = res.cols;
            break;
        }
    }
    if (dateRowIdx === -1) continue;

    // c. Stateful Column Scan (The "Battleship" Fix)
    for (const { col, isoDate } of dateCols) {
        let currentUsers: UserMapEntry[] = [];
        let currentTaskLines: string[] = [];
        let currentType: 'am' | 'pm' | 'all-day' = 'all-day';
        let currentCellRef = '';

        const flush = () => {
            if (currentUsers.length > 0) {
                const combinedTask = currentTaskLines.join('\n').trim() || "Work";
                for (const user of currentUsers) {
                    parsed.push({
                        siteAddress: blockAddress, shiftDate: isoDate, task: combinedTask,
                        type: currentType, user, manager: "", eNumber, 
                        contract: sheet.name, department: 'Gas',
                        source: { sheetName: sheet.name, cellRef: currentCellRef }
                    });
                }
            }
        };

        for (let r = dateRowIdx + 1; r <= endRow; r++) {
            const cell = sheet.getRow(r).getCell(col);
            const text = getCellText(cell);
            if (!text) continue;

            const { names, task: lineTask, type } = extractGasTaskAndNames(text, userMap);

            if (names.length > 0) {
                // If we found a NEW name, it marks the start of a NEW context
                flush();
                
                const matchedUsers: UserMapEntry[] = [];
                for (const name of names) {
                    const { users, reason } = findUsersInMap(name, userMap);
                    if (users.length === 1) matchedUsers.push(users[0]);
                    else if (name.length > 2) {
                        failures.push({
                            reason: reason || 'Match failed', siteAddress: blockAddress,
                            shiftDate: isoDate, operativeNameRaw: name, sheetName: sheet.name,
                            cellRef: cell.address, cellContent: text
                        });
                    }
                }

                currentUsers = matchedUsers;
                currentTaskLines = lineTask ? [lineTask] : [];
                currentType = type;
                currentCellRef = cell.address;
            } else if (currentUsers.length > 0) {
                // Continuation of current user's task
                currentTaskLines.push(text);
                if (type !== 'all-day') currentType = type;
            }
        }
        flush(); // End of block flush
    }
  }

  return { parsed, failures, diagnostics };
}

function extractAddressFromBlock(sheet: ExcelJS.Worksheet, start: number, end: number): string | null {
    let best = { text: "", score: -1 };
    for (let r = start; r <= end; r++) {
        const text = getCellText(sheet.getRow(r).getCell(1));
        if (!text || text.length < 5) continue;
        const up = text.toUpperCase();
        if (['MANAGER', 'TECHNICAL', 'ORDERING', 'TLO', 'RESPONSIBLE'].some(w => up.includes(w))) continue;
        
        let score = text.length;
        if (/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) score += 1000;
        if (/\b[BE]\d+/.test(text)) score += 500;
        if (score > best.score) best = { text, score };
    }
    return best.score > 0 ? normalizeWhitespace(best.text) : null;
}

function extractGasTaskAndNames(text: string, userMap: UserMapEntry[]): { task: string; names: string[]; type: 'am' | 'pm' | 'all-day' } {
    let raw = normalizeWhitespace(text);
    let type: 'am' | 'pm' | 'all-day' = 'all-day';

    if (/\bAM\b/i.test(raw)) type = 'am';
    else if (/\bPM\b/i.test(raw)) type = 'pm';

    const cleanRaw = raw.replace(/\b(AM|PM)\b/gi, '').trim();
    const separators = /[-\–\—]/;
    
    if (!separators.test(cleanRaw)) {
        // No separator. Check if whole text is a name
        const { users } = findUsersInMap(cleanRaw, userMap);
        if (users.length > 0) return { task: "", names: [cleanRaw], type };
        return { task: cleanRaw, names: [], type };
    }

    const parts = cleanRaw.split(separators).map(s => s.trim()).filter(Boolean);
    const names: string[] = [];
    const taskParts: string[] = [];

    for (const part of parts) {
        const { users } = findUsersInMap(part, userMap);
        if (users.length > 0) names.push(part);
        else taskParts.push(part);
    }

    return { task: taskParts.join(' - '), names, type };
}

/* =========================
   BUILD PARSER
========================= */

export async function parseBuildWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[], selectedSheets: string[]): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const allParsed: ParsedGasShift[] = [];
  const allFailures: ImportFailure[] = [];
  const today = toISODate(new Date());

  for (const sheetName of selectedSheets) {
    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet || sheet.state === 'hidden') continue;
    const used = getUsedBounds(sheet);
    if (!used) continue;

    let dateRowIdx = -1, dateCols: { col: number, isoDate: string }[] = [];
    for (let r = 1; r <= 50; r++) {
        const res = getDateColumns(sheet, used, r, 6);
        if (res.cols.length >= 2) { dateRowIdx = r; dateCols = res.cols; break; }
    }
    if (dateRowIdx === -1) continue;

    let currentAddress = "", currentENumber = "";
    for (let r = dateRowIdx + 1; r <= used.endRow; r++) {
        const row = sheet.getRow(r);
        if (isDividerRow(row)) { currentAddress = ""; currentENumber = ""; continue; }
        const rowAddr = extractBuildAddressFromRow(row);
        if (rowAddr) { currentAddress = rowAddr.address; currentENumber = rowAddr.eNumber; }
        if (!currentAddress) continue;

        for (const { col, isoDate } of dateCols) {
            if (isoDate && isoDate < today) continue;
            const cell = row.getCell(col);
            const text = getCellText(cell);
            if (!text || isNonShiftText(text)) continue;
            const { names, task, type } = extractGasTaskAndNames(text, userMap);
            for (const name of names) {
                const { users: matched, reason } = findUsersInMap(name, userMap);
                if (matched.length === 1) {
                    allParsed.push({
                        siteAddress: currentAddress, shiftDate: isoDate, task, type,
                        user: matched[0], eNumber: currentENumber, contract: sheetName,
                        department: 'Build', manager: sheetName,
                        source: { sheetName: sheet.name, cellRef: cell.address }
                    });
                } else if (name.length > 2) {
                    allFailures.push({ reason: reason || 'Match error', siteAddress: currentAddress, shiftDate: isoDate, operativeNameRaw: name, sheetName: sheet.name, cellRef: cell.address, cellContent: text });
                }
            }
        }
    }
  }
  return { parsed: allParsed, failures: allFailures };
}

function extractBuildAddressFromRow(row: ExcelJS.Row): { address: string; eNumber: string } | null {
  const text = getCellText(row.getCell(1));
  if (!text || text.length < 3 || ['MATERIALS', 'MANAGER', 'TLO'].some(n => text.toUpperCase().includes(n))) return null;
  const rawAddr = normalizeWhitespace(text);
  const eMatch = rawAddr.match(/\b([BE]\d+\S*)\b/i);
  return { address: eMatch ? rawAddr.replace(eMatch[0], '').trim().replace(/^[:\-\s]+/, '') : rawAddr, eNumber: eMatch?.[1].toUpperCase() || '' };
}

/* =========================
   CORE UTILS
========================= */

function getUsedBounds(ws: ExcelJS.Worksheet): UsedBounds | null {
  let minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    minRow = Math.min(minRow, rowNumber); maxRow = Math.max(maxRow, rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.value !== null && cell.value !== undefined) {
        minCol = Math.min(minCol, colNumber); maxCol = Math.max(maxCol, colNumber);
      }
    });
  });
  return isFinite(minRow) ? { startRow: minRow, endRow: maxRow, startCol: minCol, endCol: maxCol } : null;
}

type UsedBounds = { startRow: number; endRow: number; startCol: number; endCol: number };

function findBlockEnd(ws: ExcelJS.Worksheet, start: number, max: number, nextStart?: number): number {
  let end = nextStart ? nextStart - 1 : max;
  for (let r = start + 1; r < (nextStart || max); r++) {
    if (isBlackDivider(ws.getRow(r))) { end = r - 1; break; }
  }
  return end;
}

function getDateColumns(ws: ExcelJS.Worksheet, used: UsedBounds, rowIdx: number, startCol: number): { cols: Array<{ col: number; isoDate: string }>, diagnostics: DiagnosticIssue[] } {
  const cols = [], diagnostics: DiagnosticIssue[] = [];
  for (let c = Math.max(used.startCol, startCol); c <= used.endCol; c++) {
    const cell = ws.getRow(rowIdx).getCell(c);
    const res = parseExcelCellAsDate(cell);
    if (res.date) cols.push({ col: c, isoDate: toISODate(res.date) });
    else if (res.diagnostic) diagnostics.push({ cellRef: cell.address, sheetName: ws.name, value: getCellText(cell), reason: res.diagnostic });
  }
  return { cols, diagnostics };
}
