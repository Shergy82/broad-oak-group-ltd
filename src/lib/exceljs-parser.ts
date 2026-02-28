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

export type RawParsedShift = {
  siteAddress: string;
  shiftDate: string; // ISO yyyy-mm-dd
  operativeNameRaw: string;
  task: string;
  type: 'am' | 'pm' | 'all-day';
  department: "GAS" | "BUILD";
  importType: ImportType;
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

export type ParseResult = {
  parsed: RawParsedShift[];
  failures: ImportFailure[];
};

/* =========================
   ROUTER (leave BUILD alone)
========================= */

export async function parseWorkbookByType(params: {
  fileBuffer: Buffer;
  importType: ImportType;
  // keep your existing BUILD parser signature here:
  // parseBuildWorkbook: (fileBuffer: Buffer) => Promise<ParseResult>;
}): Promise<ParseResult> {
  const { fileBuffer, importType } = params;

  if (importType === "BUILD") {
    // ✅ EXISTING BUILD LOGIC — DO NOT CHANGE
    // return parseBuildWorkbook(fileBuffer);
    // For now, we will assume build parser is handled elsewhere and just return empty
     return { parsed: [], failures: [{reason: "BUILD parser not implemented in this module."}] };
  }

  if (importType === "GAS") {
    return parseGasWorkbook(fileBuffer);
  }

  return {
    parsed: [],
    failures: [{ reason: "Invalid importType" }],
  };
}

/* =========================
   GAS PARSER (NEW)
========================= */

export async function parseGasWorkbook(fileBuffer: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const sheet =
    workbook.getWorksheet("UNITAS") ??
    workbook.worksheets.find((ws) => ws.state !== "hidden") ??
    workbook.worksheets[0];

  if (!sheet) {
    return { parsed: [], failures: [{ reason: "No worksheet found" }] };
  }

  const sheetName = sheet.name;
  const failures: ImportFailure[] = [];
  const parsed: RawParsedShift[] = [];

  const used = getUsedBounds(sheet);
  if (!used) {
    return { parsed: [], failures: [{ reason: "Sheet appears empty", sheetName }] };
  }

  // 1) Find divider rows by COLOUR (no text)
  const dividerRows = findDividerRows(sheet, used);

  if (dividerRows.length < 2) {
    return {
      parsed: [],
      failures: [
        {
          reason: "GAS format invalid — coloured divider rows not found (need at least 2)",
          sheetName,
        },
      ],
    };
  }

  // 2) Build site blocks between divider rows
  for (let i = 0; i < dividerRows.length - 1; i++) {
    const blockStart = dividerRows[i] + 1;
    const blockEnd = dividerRows[i + 1] - 1;

    if (blockEnd <= blockStart) continue;

    // 3) Extract site address for block
    const siteAddress = extractSiteAddress(sheet, used, blockStart, blockEnd);

    if (!siteAddress) {
      failures.push({
        reason: "Block skipped — site address not found (column A/B heuristic failed)",
        sheetName,
        cellRef: `A${blockStart}:B${blockEnd}`,
      });
      continue;
    }

    // 4) Find date row within block
    const dateRowIdx = findDateRow(sheet, used, blockStart, blockEnd);
    if (!dateRowIdx) {
      failures.push({
        reason: "Block skipped — date header row not found (no date-like run of cells)",
        sheetName,
        siteAddress,
        cellRef: `${colToA1(used.startCol)}${blockStart}:${colToA1(used.endCol)}${blockEnd}`,
      });
      continue;
    }

    // 5) Map date columns
    const dateCols = getDateColumns(sheet, used, dateRowIdx);

    if (dateCols.length === 0) {
      failures.push({
        reason: "Block skipped — no valid date columns found on detected date row",
        sheetName,
        siteAddress,
        cellRef: `${colToA1(used.startCol)}${dateRowIdx}:${colToA1(used.endCol)}${dateRowIdx}`,
      });
      continue;
    }

    // 6) For each date column, scan down for operative names until divider or blanks
    for (const { col, isoDate } of dateCols) {
      let blankRun = 0;

      for (let r = dateRowIdx + 1; r <= blockEnd; r++) {
        // Stop if we somehow hit a divider row (defensive)
        if (dividerRows.includes(r)) break;

        const cell = sheet.getCell(r, col);
        const text = getCellText(cell);

        if (!text) {
          blankRun++;
          if (blankRun >= 3) break;
          continue;
        }
        blankRun = 0;

        // Ignore obvious non-shift fields
        if (isNonShiftText(text)) continue;

        // Split multi-name cells into multiple shifts
        const names = splitNames(text);
        if (names.length === 0) continue;

        for (const name of names) {
          parsed.push({
            siteAddress,
            shiftDate: isoDate,
            operativeNameRaw: name,
            department: "GAS",
            importType: "GAS",
            task: 'Unknown - from GAS import', // Placeholder task
            type: 'all-day', // Default type
            source: { sheetName, cellRef: cell.address },
          });
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
  // ExcelJS has "actualRowCount" / "actualColumnCount" but they can be misleading with styles.
  // We compute bounds by scanning rows that exist.
  let minRow = Infinity,
    maxRow = 0,
    minCol = Infinity,
    maxCol = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    minRow = Math.min(minRow, rowNumber);
    maxRow = Math.max(maxRow, rowNumber);

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      // include cells with text/value
      const hasValue = cell.value !== null && cell.value !== undefined && getCellText(cell) !== "";
      if (hasValue) {
        minCol = Math.min(minCol, colNumber);
        maxCol = Math.max(maxCol, colNumber);
      }
    });

    // also extend bounds if row has fills (divider rows may be blank but filled)
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

  // optional: de-dupe consecutive divider rows (keep the first of a run)
  return rows.filter((row, idx) => idx === 0 || row !== rows[idx - 1] + 1);
}

function isDividerRow(ws: ExcelJS.Worksheet, used: UsedBounds, r: number): boolean {
  // Divider row rule:
  // - Across the used columns, the row is essentially empty (no text)
  // - AND it contains a strong, consistent fill colour across many cells
  // - We do NOT rely on exact RGB, but we do require "non-white" fill
  let filledCount = 0;
  let textCount = 0;
  let sampleColor: string | null = null;
  let colorMatches = 0;

  const totalCols = used.endCol - used.startCol + 1;

  for (let c = used.startCol; c <= used.endCol; c++) {
    const cell = ws.getCell(r, c);
    const text = getCellText(cell);
    if (text) textCount++;

    const color = getFillColor(cell); // ARGB or null
    if (color && !isWhiteLike(color)) {
      filledCount++;
      if (!sampleColor) sampleColor = color;
      if (sampleColor && color === sampleColor) colorMatches++;
    }
  }

  // must be blank (or nearly blank) row
  if (textCount > 0) return false;

  // require meaningful fill coverage across the row
  const fillRatio = filledCount / totalCols;
  if (fillRatio < 0.7) return false;

  // require most filled cells share same fill (divider is usually a solid bar)
  if (filledCount > 0 && colorMatches / filledCount < 0.7) return false;

  return true;
}

/* =========================
   HELPERS — SITE ADDRESS
========================= */

function extractSiteAddress(
  ws: ExcelJS.Worksheet,
  used: UsedBounds,
  startRow: number,
  endRow: number
): string | null {
  // Primary: Column A best candidate
  const candidatesA = collectAddressCandidates(ws, startRow, endRow, [1]);
  const bestA = pickBestAddressCandidate(candidatesA);
  if (bestA) return bestA;

  // Fallback: columns A-B
  const candidatesAB = collectAddressCandidates(ws, startRow, endRow, [1, 2]);
  const bestAB = pickBestAddressCandidate(candidatesAB);
  if (bestAB) return bestAB;

  return null;
}

type AddressCandidate = { text: string; score: number };

function collectAddressCandidates(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  cols: number[]
): AddressCandidate[] {
  const out: AddressCandidate[] = [];

  for (let r = startRow; r <= endRow; r++) {
    for (const c of cols) {
      const cell = ws.getCell(r, c);
      const text = getCellText(cell);
      if (!text) continue;

      // Prefer filled cells (often green for address region)
      const fillBoost = hasFill(cell) && !isWhiteLike(getFillColor(cell) ?? "") ? 15 : 0;

      // Address-likeness
      const hasNumber = /\d/.test(text) ? 10 : 0;
      const hasCommaOrNewline = /,|\n/.test(text) ? 10 : 0;
      const looksLikePostcode = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i.test(text) ? 15 : 0;

      // Length matters
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

function findDateRow(
  ws: ExcelJS.Worksheet,
  used: UsedBounds,
  startRow: number,
  endRow: number
): number | null {
  // Find a row that has a run of >=3 date-like cells (adjacent columns)
  for (let r = startRow; r <= endRow; r++) {
    let run = 0;
    let bestRun = 0;

    for (let c = used.startCol; c <= used.endCol; c++) {
      const cell = ws.getCell(r, c);
      const dt = parseExcelCellAsDate(cell);

      if (dt) run++;
      else run = 0;

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

  // Optional sanity: sort by column index (already) and keep as-is
  return cols;
}

/* =========================
   HELPERS — SHIFT TEXT FILTERS + NAME SPLIT
========================= */

function isNonShiftText(text: string): boolean {
  const t = text.trim().toLowerCase();

  // Exclude obvious headers/metadata
  const blocked = [
    "job manager",
    "measures",
    "scheme",
    "pulse",
    "2 fans",
    "iwi",
    "ignore",
    "date of shift",
    "shift information",
  ];

  if (blocked.some((b) => t === b || t.includes(b))) return true;

  // Pure phone number lines
  if (/^\+?\d[\d\s-]{7,}$/.test(t)) return true;

  return false;
}

function splitNames(text: string): string[] {
  const raw = text
    .replace(/\r/g, "")
    .trim();

  if (!raw) return [];

  // Common separators for multiple operatives
  const parts = raw
    .split(/\n|,|&|\/|\band\b/gi)
    .map((p) => normalizeWhitespace(p))
    .map((p) => p.trim())
    .filter(Boolean);

  // Remove non-name garbage fragments
  return parts.filter((p) => {
    const t = p.toLowerCase();
    if (t === "ignore") return false;
    if (/^\+?\d[\d\s-]{7,}$/.test(t)) return false; // phone
    if (t.includes("tel") || t.includes("mobile")) return false;
    return true;
  });
}

/* =========================
   HELPERS — CELL TEXT + FILL
========================= */

function getCellText(cell: ExcelJS.Cell): string {
  const v = cell.value;

  if (v === null || v === undefined) return "";

  // ExcelJS can store as rich text / formula / etc.
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    // RichText
    // @ts-ignore
    if (Array.isArray(v.richText)) {
      // @ts-ignore
      return v.richText.map((rt) => rt.text).join("").trim();
    }
    // Hyperlink
    // @ts-ignore
    if (typeof v.text === "string") return v.text.trim();
    // Formula result
    // @ts-ignore
    if (v.result !== undefined && v.result !== null) return String(v.result).trim();
  }

  return "";
}

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function hasFill(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as ExcelJS.Fill | undefined;
  if (!fill) return false;
  // We care mainly about "pattern" fills
  return (fill as any).type === "pattern" && !!(fill as any).fgColor;
}

function getFillColor(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill as any;
  if (!fill || fill.type !== "pattern") return null;

  const fg = fill.fgColor;
  if (!fg) return null;

  // ExcelJS provides ARGB like "FF1F4E79"
  if (typeof fg.argb === "string") return fg.argb.toUpperCase();

  return null;
}

function isWhiteLike(argb: string): boolean {
  // Treat missing/transparent/white as white-like
  if (!argb) return true;

  const a = argb.toUpperCase();

  // Common whites
  if (a === "FFFFFFFF") return true; // white
  if (a === "FFFFFFFE") return true;

  // Transparent in some files
  if (a.startsWith("00")) return true;

  return false;
}

/* =========================
   HELPERS — DATE PARSING
========================= */

function parseExcelCellAsDate(cell: ExcelJS.Cell): Date | null {
  const v = cell.value;

  if (v instanceof Date) {
    if (!isNaN(v.getTime())) return v;
  }

  // Excel serial numbers (often used for dates)
  if (typeof v === "number") {
    if (v < 20000 || v > 60000) return null; // Simple sanity check for excel dates
    const date = excelSerialToDate(v);
    if (!isNaN(date.getTime())) return date;
  }

  const text = getCellText(cell).trim();
  if (!text) return null;

  // Try parsing dd/mm/yy or dd/mm/yyyy etc.
  const parts = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (parts) {
    const day = parseInt(parts[1], 10);
    const month = parseInt(parts[2], 10) - 1;
    let year = parseInt(parts[3], 10);
    if (year < 100) {
      year += 2000;
    }
    const date = new Date(Date.UTC(year, month, day));
    // Verify that the created date is valid (e.g., handles 31/02)
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) {
      return date;
    }
  }

  // Fallback for other formats that Date.parse might understand
  const parsedDate = new Date(text);
  if (!isNaN(parsedDate.getTime()) && parsedDate.getUTCFullYear() > 2000) {
    return new Date(Date.UTC(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()));
  }

  return null;
}

function excelSerialToDate(serial: number): Date {
  // Excel 1900 date system; Excel incorrectly treats 1900 as leap year.
  // This conversion is standard: epoch 1899-12-30
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400; // seconds
  return new Date(utcValue * 1000);
}

function toISODate(dt: Date): string {
  // ISO date only
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* =========================
   HELPERS — A1 formatting
========================= */

function colToA1(col: number): string {
  let n = col;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
