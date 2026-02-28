

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
   Types (match your system)
========================= */

export type ImportType = "BUILD" | "GAS";

// This is the raw data structure returned by the parser.
export type ParsedGasShift = {
  siteAddress: string;
  shiftDate: string; // ISO yyyy-mm-dd
  task: string;
  type: 'am' | 'pm' | 'all-day';
  user: UserMapEntry;
  source: { sheetName: string; cellRef: string };
};

export type ImportFailure = {
  reason: string;
  siteAddress?: string;
  shiftDate?: string;
  operativeNameRaw?: string;
  sheetName?: string;
  cellRef?: string;
};

// This type is passed in from the file-uploader component
type UserMapEntry = { uid: string; normalizedName: string; originalName: string, department?: string };


export type ParseResult = {
  parsed: ParsedGasShift[];
  failures: ImportFailure[];
};

/* =========================
   HELPERS
========================= */

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const normalizeText = (text: string) => (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

const findUsersInMap = (nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } => {
    const normalizedChunk = normalizeText(nameChunk);
    if (!normalizedChunk) return { users: [], reason: 'Empty name provided.' };

    // 1. Exact match (most reliable)
    let matches = userMap.filter(u => u.normalizedName === normalizedChunk);
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users exactly.` };

    // 2. The query is a substring of the full name (e.g., "Shergold" finds "Phil Shergold")
    matches = userMap.filter(u => u.normalizedName.includes(normalizedChunk));
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users.` };
    
    // 3. Fallback for Matrix-style parsing: Last name match
    const chunkParts = normalizedChunk.split(' ');
    const lastName = chunkParts[chunkParts.length - 1];
    if (lastName) {
        matches = userMap.filter(u => u.normalizedName.endsWith(' ' + lastName));
        if (matches.length === 1) return { users: matches };
        if (matches.length > 1) {
            // Disambiguate by first initial if possible
             if (chunkParts.length > 1) {
                const firstInitial = chunkParts[0].charAt(0);
                const initialMatches = matches.filter(u => u.normalizedName.startsWith(firstInitial));
                if (initialMatches.length === 1) return { users: initialMatches };
            }
            return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users by last name.` };
        }
    }
    
    return { users: [], reason: `No user found for name: "${nameChunk}".` };
};

/* =========================
   SMART GAS PARSER (NEW)
========================= */
export async function parseGasWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[]): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const sheet =
    workbook.getWorksheet("UNITAS") ??
    workbook.worksheets.find((ws) => ws.state !== "hidden") ??
    workbook.worksheets[0];

  if (!sheet) {
    return { parsed: [], failures: [{ reason: "No worksheet found" }] };
  }

  // --- ATTEMPT LIST VIEW PARSE FIRST ---
  // Find first row with content
  let headerRow: ExcelJS.Row | undefined;
  let headerRowNumber: number = -1;
  sheet.eachRow((row, rowNum) => {
      if(!headerRow && row.values.some(v => v)) {
          headerRow = row;
          headerRowNumber = rowNum;
      }
  });

  if (headerRow) {
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = String(cell.value || '').trim().toLowerCase();
      });

      const dateIndex = headers.indexOf('date');
      const userIndex = headers.indexOf('user') > -1 ? headers.indexOf('user') : headers.indexOf('operative');
      const taskIndex = headers.indexOf('task');
      const addressIndex = headers.indexOf('address');

      if (dateIndex > -1 && userIndex > -1 && taskIndex > -1 && addressIndex > -1) {
          // It's a list view, parse it and return.
          return parseListView(sheet, headerRowNumber, headers, userMap);
      }
  }

  // --- FALLBACK TO MATRIX VIEW PARSE ---
  return parseMatrixView(sheet, userMap);
}

/* =========================
   LIST VIEW PARSER (from BUILD)
========================= */
function parseListView(sheet: ExcelJS.Worksheet, headerRowNumber: number, headers: string[], userMap: UserMapEntry[]): ParseResult {
    const parsed: ParsedGasShift[] = [];
    const failures: ImportFailure[] = [];
    const sheetName = sheet.name;
    
    const dateIndex = headers.indexOf('date');
    const userIndex = headers.indexOf('user') > -1 ? headers.indexOf('user') : headers.indexOf('operative');
    const taskIndex = headers.indexOf('task');
    const addressIndex = headers.indexOf('address');

    // Use a standard for loop from after the header to the last row with content.
    for (let rowNum = headerRowNumber + 1; rowNum <= sheet.rowCount; rowNum++) {
        const row = sheet.getRow(rowNum);

        // If the entire row is empty, skip it.
        if (!row.hasValues) {
            continue;
        }

        const date = parseExcelCellAsDate(row.getCell(dateIndex + 1));
        const userNameRaw = getCellText(row.getCell(userIndex + 1));
        const task = getCellText(row.getCell(taskIndex + 1));
        const address = getCellText(row.getCell(addressIndex + 1));

        if (!date || !userNameRaw || !task || !address) {
            // Only add a failure if there's *some* data on the row. This avoids adding failures for blank formatting rows.
            if (userNameRaw || task || address) {
                failures.push({
                    reason: 'Missing required data (Date, User, Task, or Address).',
                    siteAddress: address,
                    sheetName,
                    cellRef: `A${rowNum}`
                });
            }
            continue;
        }

        const { users: matchedUsers, reason } = findUsersInMap(userNameRaw, userMap);

        if (matchedUsers.length !== 1) {
            failures.push({
                reason: reason || `Could not find a unique user for "${userNameRaw}"`,
                siteAddress: address,
                operativeNameRaw: userNameRaw,
                sheetName,
                cellRef: row.getCell(userIndex + 1).address
            });
            continue;
        }
        
        const user = matchedUsers[0];

        parsed.push({
          siteAddress: address,
          shiftDate: toISODate(date),
          task: task,
          type: 'all-day',
          user: user,
          source: { sheetName, cellRef: row.getCell(userIndex + 1).address },
        });
    }

    return { parsed, failures };
}


/* =========================
   MATRIX VIEW PARSER (old GAS)
========================= */

function extractGasTaskAndNames(text: string): { task: string; names: string[]; type: 'am' | 'pm' | 'all-day' } {
    let raw = normalizeWhitespace(text);
    let shiftType: 'am' | 'pm' | 'all-day' = 'all-day';

    if (/^AM\b/i.test(raw)) {
        shiftType = 'am';
        raw = raw.substring(2).trim();
    } else if (/^PM\b/i.test(raw)) {
        shiftType = 'pm';
        raw = raw.substring(2).trim();
    }

    const lastHyphenIndex = raw.lastIndexOf("-");
    let taskPart = "Task not specified";
    let namesPart = raw;

    if (lastHyphenIndex > -1) {
        const potentialTask = raw.substring(0, lastHyphenIndex).trim();
        const potentialNames = raw.substring(lastHyphenIndex + 1).trim();
        if (potentialTask && potentialNames) {
            taskPart = potentialTask;
            namesPart = potentialNames;
        }
    }

    const peopleChunks = namesPart.split(/,|&|\/|\band\b/gi);

    const names = peopleChunks.map(chunk =>
        chunk.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
    ).filter(Boolean);
    
    if (names.length === 0 && lastHyphenIndex === -1) {
        const potentialNamesOnly = namesPart.split(/,|&|\/|\band\b/gi).map(c => c.replace(/\r?\n/g, ' ').trim()).filter(Boolean);
        if (potentialNamesOnly.length > 0) {
            return { task: "Task not specified", names: potentialNamesOnly, type: shiftType };
        }
    }

    return { task: taskPart, names, type: shiftType };
}


async function parseMatrixView(sheet: ExcelJS.Worksheet, userMap: UserMapEntry[]): Promise<ParseResult> {
  const sheetName = sheet.name;
  const failures: ImportFailure[] = [];
  const parsed: ParsedGasShift[] = [];

  const used = getUsedBounds(sheet);
  if (!used) {
    return { parsed: [], failures: [{ reason: "Sheet appears empty", sheetName }] };
  }

  const dividerRows = findDividerRows(sheet, used);
  if (dividerRows.length < 2) {
    return {
      parsed: [],
      failures: [{ reason: "Could not detect matrix format: coloured divider rows not found.", sheetName, }],
    };
  }

  for (let i = 0; i < dividerRows.length - 1; i++) {
    const blockStart = dividerRows[i] + 1;
    const blockEnd = dividerRows[i + 1] - 1;
    if (blockEnd <= blockStart) continue;

    const siteAddress = extractSiteAddress(sheet, used, blockStart, blockEnd);
    if (!siteAddress) {
      failures.push({ reason: "Block skipped — site address not found.", sheetName, cellRef: `A${blockStart}:B${blockEnd}` });
      continue;
    }

    const dateRowIdx = findDateRow(sheet, used, blockStart, blockEnd);
    if (!dateRowIdx) {
      failures.push({ reason: "Block skipped — date header row not found.", sheetName, siteAddress, cellRef: `${colToA1(used.startCol)}${blockStart}:${colToA1(used.endCol)}${blockEnd}`});
      continue;
    }

    const dateCols = getDateColumns(sheet, used, dateRowIdx);
    if (dateCols.length === 0) {
      failures.push({ reason: "Block skipped — no valid date columns found on date row.", sheetName, siteAddress, cellRef: `${colToA1(used.startCol)}${dateRowIdx}:${colToA1(used.endCol)}${dateRowIdx}` });
      continue;
    }

    for (const { col, isoDate } of dateCols) {
      for (let r = dateRowIdx + 1; r <= blockEnd; r++) {
        if (dividerRows.includes(r)) break;
        const cell = sheet.getCell(r, col);
        const text = getCellText(cell);
        if (!text) {
          continue; // FIX: Simply continue to the next row if the cell is blank
        }
        if (isNonShiftText(text)) continue;

        const { task, names, type } = extractGasTaskAndNames(text);
        if (names.length === 0) {
            failures.push({ reason: "Could not extract operative names from cell.", siteAddress, operativeNameRaw: text, sheetName, cellRef: cell.address });
            continue;
        }

        for (const name of names) {
          const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
          if (matchedUsers.length !== 1) {
            failures.push({ reason: reason || `Could not match operative: "${name}"`, siteAddress, operativeNameRaw: name, sheetName, cellRef: cell.address });
          } else {
            parsed.push({
              siteAddress,
              shiftDate: isoDate,
              task,
              type,
              user: matchedUsers[0],
              source: { sheetName, cellRef: cell.address },
            });
          }
        }
      }
    }
  }
  return { parsed, failures };
}


/* =========================
   HELPERS — USED RANGE
========================= */

type UsedBounds = { startRow: number; endRow: number; startCol: number; endCol: number };

function getUsedBounds(ws: ExcelJS.Worksheet): UsedBounds | null {
  let minRow = Infinity, maxRow = 0, minCol = Infinity, maxCol = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    minRow = Math.min(minRow, rowNumber);
    maxRow = Math.max(maxRow, rowNumber);
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const hasValue = cell.value !== null && cell.value !== undefined && getCellText(cell) !== "";
      if (hasValue) {
        minCol = Math.min(minCol, colNumber);
        maxCol = Math.max(maxCol, colNumber);
      }
    });
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (hasFill(cell)) {
        minCol = Math.min(minCol, colNumber);
        maxCol = Math.max(maxCol, colNumber);
      }
    });
  });
  if (!isFinite(minRow) || !isFinite(minCol) || maxRow === 0 || maxCol === 0) return null;
  return { startRow: minRow, endRow: maxRow, startCol: minCol, endCol: maxCol };
}

/* =========================
   HELPERS — DIVIDER ROWS (COLOUR ONLY)
========================= */

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
  let sampleColor: string | null = null;
  let colorMatches = 0;
  const totalCols = used.endCol - used.startCol + 1;
  for (let c = used.startCol; c <= used.endCol; c++) {
    const cell = ws.getCell(r, c);
    const text = getCellText(cell);
    if (text) textCount++;
    const color = getFillColor(cell);
    if (color && !isWhiteLike(color)) {
      filledCount++;
      if (!sampleColor) sampleColor = color;
      if (sampleColor && color === sampleColor) colorMatches++;
    }
  }
  if (textCount > 0) return false;
  const fillRatio = filledCount / totalCols;
  if (fillRatio < 0.7) return false;
  if (filledCount > 0 && colorMatches / filledCount < 0.7) return false;
  return true;
}

/* =========================
   HELPERS — SITE ADDRESS
========================= */

function extractSiteAddress(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): string | null {
  const candidatesA = collectAddressCandidates(ws, startRow, endRow, [1]);
  const bestA = pickBestAddressCandidate(candidatesA);
  if (bestA) return bestA;
  const candidatesAB = collectAddressCandidates(ws, startRow, endRow, [1, 2]);
  const bestAB = pickBestAddressCandidate(candidatesAB);
  if (bestAB) return bestAB;
  return null;
}

type AddressCandidate = { text: string; score: number };

function collectAddressCandidates(ws: ExcelJS.Worksheet, startRow: number, endRow: number, cols: number[]): AddressCandidate[] {
  const out: AddressCandidate[] = [];
  for (let r = startRow; r <= endRow; r++) {
    for (const c of cols) {
      const cell = ws.getCell(r, c);
      const text = getCellText(cell);
      if (!text) continue;
      const fillBoost = hasFill(cell) && !isWhiteLike(getFillColor(cell) ?? "") ? 15 : 0;
      const hasNumber = /\d/.test(text) ? 10 : 0;
      const hasCommaOrNewline = /,|\n/.test(text) ? 10 : 0;
      const looksLikePostcode = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i.test(text) ? 15 : 0;
      const lenScore = Math.min(text.length, 120);
      const score = fillBoost + hasNumber + hasCommaOrNewline + looksLikePostcode + lenScore;
      out.push({ text: normalizeWhitespace(text), score });
    }
  }
  return out;
}

function pickBestAddressCandidate(cands: AddressCandidate[]): string | null {
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  return best && best.score >= 30 ? best.text : null;
}

/* =========================
   HELPERS — DATE ROW + DATE COLUMNS
========================= */

function findDateRow(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): number | null {
  for (let r = startRow; r <= endRow; r++) {
    let run = 0, bestRun = 0;
    for (let c = used.startCol; c <= used.endCol; c++) {
      const cell = ws.getCell(r, c);
      const dt = parseExcelCellAsDate(cell);
      if (dt) run++; else run = 0;
      bestRun = Math.max(bestRun, run);
    }
    if (bestRun >= 3) return r;
  }
  return null;
}

function getDateColumns(ws: ExcelJS.Worksheet, used: UsedBounds, dateRowIdx: number): Array<{ col: number; isoDate: string }> {
  const cols: Array<{ col: number; isoDate: string }> = [];
  for (let c = used.startCol; c <= used.endCol; c++) {
    const cell = ws.getCell(dateRowIdx, c);
    const dt = parseExcelCellAsDate(cell);
    if (!dt) continue;
    cols.push({ col: c, isoDate: toISODate(dt) });
  }
  return cols;
}

/* =========================
   HELPERS — SHIFT TEXT FILTERS
========================= */

function isNonShiftText(text: string): boolean {
  const t = text.trim().toLowerCase();
  const blocked = ["job manager", "measures", "scheme", "pulse", "2 fans", "iwi", "ignore", "date of shift", "shift information"];
  if (blocked.some((b) => t === b || t.includes(b))) return true;
  if (/^\+?\d[\d\s-]{7,}$/.test(t)) return true;
  return false;
}

/* =========================
   HELPERS — CELL TEXT + FILL
========================= */

function getCellText(cell: ExcelJS.Cell): string {
  // Use the .text property which returns the cell's formatted text,
  // handling rich text, formulas, etc. automatically.
  return cell.text?.trim() || "";
}

function hasFill(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as ExcelJS.Fill | undefined;
  if (!fill) return false;
  return (fill as any).type === "pattern" && !!(fill as any).fgColor;
}

function getFillColor(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill as any;
  if (!fill || fill.type !== "pattern") return null;
  const fg = fill.fgColor;
  if (!fg) return null;
  if (typeof fg.argb === "string") return fg.argb.toUpperCase();
  return null;
}

function isWhiteLike(argb: string): boolean {
  if (!argb) return true;
  const a = argb.toUpperCase();
  if (a === "FFFFFFFF" || a === "FFFFFFFE") return true;
  if (a.startsWith("00")) return true;
  return false;
}

/* =========================
   HELPERS — DATE PARSING
========================= */

function parseExcelCellAsDate(cell: ExcelJS.Cell): Date | null {
  const v = cell.value;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "number") {
    if (v < 20000 || v > 60000) return null;
    const date = excelSerialToDate(v);
    if (!isNaN(date.getTime())) return date;
  }
  const text = getCellText(cell).trim();
  if (!text) return null;
  const normalizedText = text.replace(/(\d+)(st|nd|rd|th)/g, '$1');
  const parts = normalizedText.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1;
    let year = parts[3] ? parseInt(parts[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      const d = new Date(Date.UTC(year, month, day));
      if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) return d;
    }
  }
  const parsedDate = new Date(normalizedText);
  if (!isNaN(parsedDate.getTime()) && parsedDate.getUTCFullYear() > 2000) {
    return new Date(Date.UTC(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()));
  }
  return null;
}

function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  return new Date(utcValue * 1000);
}

function toISODate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* =========================
   HELPERS — A1 formatting
========================= */

function colToA1(col: number): string {
  let n = col, s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
