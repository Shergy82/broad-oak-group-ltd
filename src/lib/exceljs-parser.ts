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
 * 🔒 TIMEZONE-STABLE DATE PARSING (REALITY FILTER)
 */
function parseExcelCellAsDate(cell: ExcelJS.Cell): { date: Date | null, diagnostic?: string } {
  try {
    const v = getCellValue(cell);
    let d: Date | null = null;

    if (v instanceof Date && !isNaN(v.getTime())) {
      d = new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    } else if (typeof v === "number" && v > 20000) {
      // 🔒 PHONE NUMBER SHIELD: Serial dates above 60,000 are past the year 2064
      if (v > 60000) {
        return { date: null, diagnostic: `Likely a contact number or ID.` };
      }
      const rawDate = new Date((v - 25569) * 86400 * 1000);
      d = new Date(Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()));
    }

    if (d && !isNaN(d.getTime())) {
      // Reality check: ignore dates before 2024 or after 2035
      if (d.getUTCFullYear() < 2024 || d.getUTCFullYear() > 2035) {
        return { date: null, diagnostic: `Date resolves to year ${d.getUTCFullYear()}.` };
      }
      // Force to Midday UTC for absolute identity stability
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
   GAS PARSER
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
    failures: allFailures.filter(f => !f.shiftDate || f.shiftDate >= today),
    diagnostics: allDiagnostics
  };
}

function parseGasSheet(sheet: ExcelJS.Worksheet, userMap: UserMapEntry[]): ParseResult {
  const parsed: ParsedGasShift[] = [];
  const failures: ImportFailure[] = [];
  const diagnostics: DiagnosticIssue[] = [];

  const used = getUsedBounds(sheet);
  if (!used) return { parsed: [], failures: [], diagnostics: [] };

  const dateRows: Array<{ row: number; dateCols: Array<{ col: number; isoDate: string }> }> = [];
  for (let r = used.startRow; r <= Math.min(used.endRow, 100); r++) {
      // 🔒 COLUMN F BOUNDARY: Ignore columns A-E (1-5) for dates
      const res = getDateColumns(sheet, used, r, 6);
      if (res.cols.length >= 2) dateRows.push({ row: r, dateCols: res.cols });
      if (res.diagnostics) diagnostics.push(...res.diagnostics);
  }

  for (let i = 0; i < dateRows.length; i++) {
      const header = dateRows[i];
      const blockEnd = findBlockEnd(sheet, header.row, used.endRow, dateRows[i+1]?.row);
      const addressResult = extractSiteAddress(sheet, used, header.row, blockEnd);
      if (!addressResult) continue;

      const { address: siteAddress } = addressResult;
      const eNumber = siteAddress.match(/\b([BE]\d+\S*)\b/i)?.[1].toUpperCase() || '';
      let manager = '', contract = sheet.name;

      // Extract metadata (Manager/Scheme)
      for (let r = Math.max(1, header.row - 6); r <= header.row; r++) {
          const row = sheet.getRow(r);
          for (let c = 1; c <= 5; c++) {
              const text = getCellText(row.getCell(c));
              if (text.toUpperCase().includes('SCHEME:')) contract = text.split(/scheme:/i)[1]?.trim() || contract;
              if (text.toUpperCase().includes('MANAGER')) manager = text.replace(/(site manager|technical manager|job manager)\s*:?/i, '').trim().split('\n')[0];
          }
      }

      for (let r = header.row + 1; r <= blockEnd; r++) {
          const row = sheet.getRow(r);
          for (const { col, isoDate } of header.dateCols) {
              const cell = row.getCell(col);
              const text = getCellText(cell);
              if (!text || isNonShiftText(text)) continue;

              const { task, names, type } = extractGasTaskAndNames(text);
              if (names.length === 0) continue;

              for (const name of names) {
                  const { users: matched, reason } = findUsersInMap(name, userMap);
                  if (matched.length === 1) {
                      parsed.push({
                          siteAddress, shiftDate: isoDate, task, type,
                          user: matched[0], manager, eNumber, contract, department: 'Gas',
                          source: { sheetName: sheet.name, cellRef: cell.address }
                      });
                  } else {
                      failures.push({
                          reason: reason || 'Match error', siteAddress, shiftDate: isoDate,
                          operativeNameRaw: name, sheetName: sheet.name, cellRef: cell.address, cellContent: text
                      });
                  }
              }
          }
      }
  }

  return { parsed, failures, diagnostics };
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
        if (isBlackDivider(row)) { currentAddress = ""; currentENumber = ""; continue; }
        const rowAddr = extractBuildAddressFromRow(row);
        if (rowAddr) { currentAddress = rowAddr.address; currentENumber = rowAddr.eNumber; }
        if (!currentAddress) continue;

        for (const { col, isoDate } of dateCols) {
            if (isoDate && isoDate < today) continue;
            const cell = row.getCell(col);
            const text = getCellText(cell);
            if (!text || isNonShiftText(text)) continue;
            const { task, names, type } = extractBuildTaskAndNames(text);
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

function isBlackDivider(row: ExcelJS.Row): boolean {
    for (let c = 1; c <= 5; c++) {
        const fill = row.getCell(c).fill as any;
        if (fill?.type === 'pattern' && (fill.fgColor?.argb === 'FF000000' || fill.fgColor?.indexed === 64)) return true;
    }
    return false;
}

function findBlockEnd(ws: ExcelJS.Worksheet, start: number, max: number, nextStart?: number): number {
  let end = nextStart ? nextStart - 1 : max;
  for (let r = start + 1; r < (nextStart || max); r++) {
    if (isBlackDivider(ws.getRow(r))) { end = r - 1; break; }
  }
  return end;
}

function extractSiteAddress(ws: ExcelJS.Worksheet, used: UsedBounds, start: number, end: number): { address: string } | null {
    const score = (text: string) => {
        if (!text || text.length < 5) return 0;
        const up = text.toUpperCase();
        // 🔒 METADATA SHIELD: -20k points for labels
        if (['ORDERING', 'MANAGER', 'TLO', 'TECHNICAL', 'RESPONSIBLE', 'SITE:'].some(n => up.includes(n))) return -20000;
        let s = Math.min(text.length, 50);
        if (/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) s += 10000;
        if (/\d+/.test(text)) s += 500;
        return s;
    };
    let best = { text: "", score: -Infinity };
    for (let r = Math.max(1, start - 5); r <= end; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 3; c++) {
            const t = getCellText(row.getCell(c));
            const sc = score(t);
            if (sc > best.score) best = { text: t, score: sc };
        }
    }
    return best.score >= 50 ? { address: normalizeWhitespace(best.text) } : null;
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

function extractGasTaskAndNames(text: string): { task: string; names: string[]; type: 'am' | 'pm' | 'all-day' } {
    let raw = normalizeWhitespace(text), type: 'am' | 'pm' | 'all-day' = 'all-day';
    if (/^AM\b/i.test(raw)) { type = 'am'; raw = raw.substring(2).trim(); }
    else if (/^PM\b/i.test(raw)) { type = 'pm'; raw = raw.substring(2).trim(); }
    const sep = /[-\–\—]/g;
    let match, last = -1;
    while ((match = sep.exec(raw)) !== null) last = match.index;
    if (last === -1) return { task: "Work", names: [], type };
    const task = raw.substring(0, last).trim() || "Work";
    const names = raw.substring(last + 1).split(/[,&\/\+\\]| and /i).map(s => s.trim()).filter(n => n.length > 1 && !/\d/.test(n));
    return { task, names, type };
}

function extractBuildAddressFromRow(row: ExcelJS.Row): { address: string; eNumber: string } | null {
  const text = getCellText(row.getCell(1));
  if (!text || text.length < 3 || ['MATERIALS', 'MANAGER', 'TLO'].some(n => text.toUpperCase().includes(n))) return null;
  const rawAddr = normalizeWhitespace(text);
  const eMatch = rawAddr.match(/\b([BE]\d+\S*)\b/i);
  return { address: eMatch ? rawAddr.replace(eMatch[0], '').trim().replace(/^[:\-\s]+/, '') : rawAddr, eNumber: eMatch?.[1].toUpperCase() || '' };
}

function extractBuildTaskAndNames(text: string): { task: string; names: string[]; type: 'am' | 'pm' | 'all-day' } {
    let raw = normalizeWhitespace(text), type: 'am' | 'pm' | 'all-day' = 'all-day';
    if (/^AM\b/i.test(raw)) { type = 'am'; raw = raw.substring(2).trim(); }
    else if (/^PM\b/i.test(raw)) { type = 'pm'; raw = raw.substring(2).trim(); }
    const sep = /[-\–\—]/g;
    let match, last = -1;
    while ((match = sep.exec(raw)) !== null) last = match.index;
    if (last === -1) return { task: "Work", names: raw.length > 1 ? [raw] : [], type };
    return { task: raw.substring(0, last).trim() || "Work", names: raw.substring(last + 1).split(/[,&\/\+\\]| and /i).map(s => s.trim()).filter(Boolean), type };
}
