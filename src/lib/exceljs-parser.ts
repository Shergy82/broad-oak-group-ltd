
/**
 * GAS & BUILD IMPORT (ExcelJS based)
 * - Uses ExcelJS for robust style and formula handling.
 * 
 * !!! LOCKED BUILD DEPARTMENT LOGIC - VERIFIED BY USER !!!
 * DO NOT MODIFY THE parseBuildWorkbook FUNCTION OR ITS HELPERS WITHOUT EXPLICIT INSTRUCTION.
 * 
 * !!! LOCKED GAS DEPARTMENT LOGIC - VERIFIED BY USER !!!
 * DO NOT MODIFY THE parseGasWorkbook FUNCTION OR ITS HELPERS WITHOUT EXPLICIT INSTRUCTION.
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
};

/* =========================
   HELPERS (SHARED)
========================= */

function normalizeWhitespace(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * 🔒 ROBUST NORMALIZATION (SHARED)
 */
function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  let t = String(text).toLowerCase();
  
  // 🔒 STRIP PHONE NUMBERS from addresses to ensure key stability
  t = t.replace(/\b(0\d{3,4}\s*\d{5,6}|07\d{3}\s*\d{6}|\+44\s*\d{4}\s*\d{6})\b/g, '');
  t = t.replace(/\s*\d{10,12}\b/g, ''); 
  
  return t
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 🔒 MERGED CELL AWARE TEXT EXTRACTION
 */
function getCellText(cell: ExcelJS.Cell | null | undefined): string {
  if (!cell) return "";
  
  const master = cell.isMerged ? cell.master : cell;
  const val = master.value;
  
  if (val === null || val === undefined) return "";
  
  if (typeof val === 'object' && 'result' in val) {
    const res = (val as any).result;
    if (res === null || res === undefined) return "";
    if (res instanceof Date) return res.toISOString();
    return String(res).trim();
  }

  if (typeof val === 'object' && 'richText' in val && Array.isArray((val as any).richText)) {
    return (val as any).richText.map((v: any) => v.text || '').join('').trim();
  }
  
  try {
    return (master.text || String(val)).trim();
  } catch (e) {
    return String(val || "").trim();
  }
}

/**
 * 🔒 MERGED CELL AWARE VALUE EXTRACTION
 */
function getCellValue(cell: ExcelJS.Cell | null | undefined): any {
  if (!cell) return null;
  const master = cell.isMerged ? cell.master : cell;
  const v = master.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as any).result;
  return v;
}

/**
 * 🔒 VERIFIED MATCHING LOGIC (SHARED)
 */
function findUsersInMap(nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } {
    const normalizedChunk = normalizeText(nameChunk);
    if (!normalizedChunk) return { users: [], reason: 'Empty name provided.' };

    let matches = userMap.filter(u => u.normalizedName === normalizedChunk);
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users exactly.` };

    const chunkParts = normalizedChunk.split(' ');
    
    if (chunkParts.length < 2) {
        const companyMatches = userMap.filter(u => u.accountType === 'company' && u.normalizedName.includes(normalizedChunk));
        if (companyMatches.length === 1) return { users: companyMatches };
        return { users: [], reason: `Single name "${nameChunk}" requires a full/exact match for individuals. No match found.` };
    }

    matches = userMap.filter(u => u.normalizedName.includes(normalizedChunk));
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous input "${nameChunk}" matches multiple users.` };
    
    const lastName = chunkParts[chunkParts.length - 1];
    if (lastName) {
        matches = userMap.filter(u => u.normalizedName.endsWith(' ' + lastName));
        if (matches.length === 1) return { users: matches };
        if (matches.length > 1) {
            const firstInitial = chunkParts[0].charAt(0);
            const initialMatches = matches.filter(u => u.normalizedName.startsWith(firstInitial));
            if (initialMatches.length === 1) return { users: initialMatches };
            return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users by last name.` };
        }
    }
    
    return { users: [], reason: `No user found for name: "${nameChunk}".` };
}

/**
 * 🔒 TIMEZONE-STABLE DATE PARSING (UK ROBUST)
 */
function parseExcelCellAsDate(cell: ExcelJS.Cell): Date | null {
  try {
    const v = getCellValue(cell);
    let d: Date | null = null;

    if (v instanceof Date && !isNaN(v.getTime())) {
      d = new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    } else if (typeof v === "number" && v > 20000 && v < 60000) {
      const rawDate = new Date((v - 25569) * 86400 * 1000);
      d = new Date(Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()));
    } else {
      const text = getCellText(cell);
      if (text) {
        const ukMatch = text.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
        if (ukMatch) {
            const day = parseInt(ukMatch[1], 10);
            const month = parseInt(ukMatch[2], 10) - 1;
            let year = parseInt(ukMatch[3], 10);
            if (year < 100) year += 2000;
            d = new Date(Date.UTC(year, month, day));
        } else {
            const cleanedText = text.replace(/(\d+)(st|nd|rd|th)/g, '$1');
            const parsed = new Date(cleanedText);
            if (!isNaN(parsed.getTime())) {
              d = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
            }
        }
      }
    }

    if (d && !isNaN(d.getTime()) && d.getUTCFullYear() >= 2020 && d.getUTCFullYear() <= 2050) {
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
  } catch (e) {
    console.error("Error parsing excel cell as date:", e);
  }
  return null;
}

function toISODate(dt: Date | null): string {
  if (!dt || isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isNonShiftText(text: string): boolean {
  const t = text.trim().toLowerCase();
  
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(t)) return true;
  if (/^\d+$/.test(t)) return true;

  const noise = [
    "job manager:",
    "site address:",
    "week comm:",
    "asbestos present:",
    "variation:",
    "scheme:",
    "site manager:",
    "technical manager:",
    "responsible person:",
    "contract:",
    "waiting on",
    "totals",
    "weekly summary"
  ];

  const strictHeaders = [
    "date", "task", "name", "operative", "address", 
    "scheme", "measures", "pulse", "cc", "council", 
    "manager", "ignore", "ordered", "start date", 
    "on live", "coole", "variation", "work type", 
    "waiting on", "scaffolding", "ordering", "hc",
    "remedial", "responsible person", "planner",
    "technical manager", "job manager"
  ];
  
  if (strictHeaders.includes(t)) return true;
  if (t.includes('bedroom') || t.includes('bathroom')) return false;

  return noise.some(b => t.startsWith(b)) || /^\+?\d[\d\s-]{7,}$/.test(t);
}

/* =========================
   LOCKED GAS PARSER (VERIFIED)
========================= */

export async function parseGasWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[]): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const allParsed: ParsedGasShift[] = [];
  const allFailures: ImportFailure[] = [];

  const visibleWorksheets = workbook.worksheets.filter(ws => ws.state !== 'hidden');

  for (const sheet of visibleWorksheets) {
    const sheetResult = parseGasSheet(sheet, userMap);
    allParsed.push(...sheetResult.parsed);
    allFailures.push(...sheetResult.failures);
  }

  const now = new Date();
  const today = toISODate(now);
  
  return { 
    parsed: allParsed.filter(s => s.shiftDate && s.shiftDate >= today), 
    failures: allFailures.filter(f => !f.shiftDate || f.shiftDate >= today) 
  };
}

function parseGasSheet(sheet: ExcelJS.Worksheet, userMap: UserMapEntry[]): ParseResult {
  const sheetName = sheet.name;
  const failures: ImportFailure[] = [];
  const parsed: ParsedGasShift[] = [];

  const used = getUsedBounds(sheet);
  if (!used) return { parsed: [], failures: [] };

  const dateHeaderRows: Array<{ row: number; dateCols: Array<{ col: number; isoDate: string }> }> = [];
  for (let r = used.startRow; r <= used.endRow; r++) {
      const dateCols = getDateColumns(sheet, used, r, 3);
      if (dateCols.length >= 2) {
          dateHeaderRows.push({ row: r, dateCols });
      }
  }

  if (dateHeaderRows.length === 0) return { parsed: [], failures: [] };

  for (let i = 0; i < dateHeaderRows.length; i++) {
      const header = dateHeaderRows[i];
      const nextHeaderRow = dateHeaderRows[i+1]?.row || used.endRow + 1;
      
      let blockEnd = nextHeaderRow - 1;
      for (let r = header.row + 1; r < nextHeaderRow; r++) {
          if (isBlackDivider(sheet.getRow(r))) {
              blockEnd = r - 1;
              break;
          }
      }

      if (blockEnd <= header.row) continue;

      const addressResult = extractSiteAddress(sheet, used, header.row, blockEnd);
      if (!addressResult) continue;

      const { address: rawAddr } = addressResult;
      const eNumMatch = rawAddr.match(/\b([BE]\d+\S*)\b/i);
      const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
      const siteAddress = eNumMatch ? rawAddr.replace(eNumMatch[0], '').trim().replace(/^[:\-\s]+/, '').trim().replace(/,$/, '').trim() : rawAddr;

      let manager = '';
      let contract = sheetName;
      let notesSet = new Set<string>();

      const metadataStart = Math.max(used.startRow, header.row - 6);
      const metadataEnd = Math.min(blockEnd, header.row + 6);
      for (let r = metadataStart; r <= metadataEnd; r++) {
          const row = sheet.getRow(r);
          for (let c = 1; c <= 10; c++) {
              const cell = row.getCell(c);
              const text = getCellText(cell);
              if (!text) continue;
              const upper = text.toUpperCase();
              
              const isMetadata = 
                upper.includes('SITE MANAGER') || 
                upper.includes('RESPONSIBLE PERSON') || 
                upper.includes('TECHNICAL MANAGER') || 
                upper.includes('JOB MANAGER') ||
                upper.includes('TLO') || 
                upper.includes('PLANNER') || 
                upper.includes('CONTACT') ||
                upper.includes('ASBESTOS') ||
                upper.includes('VARIATION');

              if (isMetadata) {
                  notesSet.add(text);
                  if (upper.includes('SITE MANAGER') || upper.includes('RESPONSIBLE PERSON') || upper.includes('TECHNICAL MANAGER') || upper.includes('JOB MANAGER')) {
                      const cleaned = text.replace(/(site manager|responsible person|technical manager|job manager)\s*:?/i, '').trim();
                      if (!manager) manager = cleaned.split('\n')[0].trim();
                  }
              }

              if (upper.includes('SCHEME:')) {
                  notesSet.add(text);
                  const sameCellScheme = text.split(/scheme:/i)[1]?.trim();
                  if (sameCellScheme) {
                    contract = sameCellScheme;
                  } else {
                    const nextVal = getCellText(row.getCell(c + 1));
                    if (nextVal) contract = nextVal;
                  }
              }
          }
      }

      const finalNotes = Array.from(notesSet).join('\n').trim();

      for (let r = header.row + 1; r <= blockEnd; r++) {
          const row = sheet.getRow(r);
          const firstColText = getCellText(row.getCell(1));
          if (isNonShiftText(firstColText) && !firstColText.toLowerCase().includes('bedroom')) continue;

          for (const { col, isoDate } of header.dateCols) {
              const cell = row.getCell(col);
              const text = getCellText(cell);
              if (!text || isNonShiftText(text)) continue;

              const { task, names, type } = extractGasTaskAndNames(text);
              for (const name of names) {
                  const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
                  if (matchedUsers.length === 1) {
                      parsed.push({
                          siteAddress,
                          shiftDate: isoDate,
                          task,
                          type,
                          user: matchedUsers[0],
                          source: { sheetName, cellRef: cell.address },
                          manager,
                          eNumber,
                          contract,
                          notes: finalNotes,
                          department: 'Gas'
                      });
                  } else {
                      if (!/^\d/.test(name) && name.length > 2) {
                        failures.push({
                            reason: reason || `Operative mismatch: "${name}"`,
                            siteAddress,
                            shiftDate: isoDate,
                            operativeNameRaw: name,
                            sheetName,
                            cellRef: cell.address,
                            cellContent: text
                        });
                      }
                  }
              }
          }
      }
  }

  return { parsed, failures };
}

/* =========================
   LOCKED BUILD PARSER (LINEAR SCAN FIX)
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

    let dateRowIdx = -1;
    let dateCols: { col: number, isoDate: string }[] = [];
    
    for (let r = 1; r <= 50; r++) {
        const row = sheet.getRow(r);
        const tempCols: { col: number, isoDate: string }[] = [];
        row.eachCell((cell, colNumber) => {
            if (colNumber < 6) return; 
            const dt = parseExcelCellAsDate(cell);
            if (dt) tempCols.push({ col: colNumber, isoDate: toISODate(dt) });
        });
        if (tempCols.length >= 2) { 
            dateRowIdx = r; 
            dateCols = tempCols; 
            break; 
        }
    }

    if (dateRowIdx === -1) continue;

    // 🔒 LINEAR SCAN FIX: Replace block-logic with a precise row-by-row address tracker
    let currentAddress = "";
    let currentENumber = "";

    for (let r = dateRowIdx + 1; r <= used.endRow; r++) {
        const row = sheet.getRow(r);

        // Check for black divider - clear context
        if (isBlackDivider(row)) {
            currentAddress = "";
            currentENumber = "";
            continue;
        }

        // Try to extract a new address from THIS specific row
        const rowAddr = extractBuildAddressFromRow(row);
        if (rowAddr) {
            currentAddress = rowAddr.address;
            currentENumber = rowAddr.eNumber;
        }

        // If we don't have a valid address context for this row, skip it
        if (!currentAddress) continue;

        for (const { col, isoDate } of dateCols) {
            if (isoDate && isoDate < today) continue;

            const cell = row.getCell(col);
            const cellText = getCellText(cell);
            if (!cellText || isNonShiftText(cellText)) continue;

            const { task, names, type } = extractGasTaskAndNames(cellText);
            
            for (const name of names) {
                const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
                if (matchedUsers.length !== 1) {
                    if (!/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(name) && !/^\d+$/.test(name) && name.length > 2) {
                      allFailures.push({
                          reason: reason || `Operative match error: "${name}"`,
                          siteAddress: currentAddress,
                          shiftDate: isoDate,
                          operativeNameRaw: name,
                          sheetName: sheet.name,
                          cellRef: cell.address,
                          cellContent: cellText
                      });
                    }
                    continue;
                }

                allParsed.push({
                    siteAddress: currentAddress,
                    shiftDate: isoDate,
                    task,
                    type,
                    user: matchedUsers[0],
                    source: { sheetName: sheet.name, cellRef: cell.address },
                    eNumber: currentENumber,
                    contract: sheetName,
                    department: 'Build',
                    manager: sheetName
                });
            }
        }
    }
  }

  return { parsed: allParsed, failures: allFailures };
}

/* =========================
   GENERIC UTILS
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

function isBlackDivider(row: ExcelJS.Row): boolean {
    for (let c = 1; c <= 5; c++) {
        const cell = row.getCell(c);
        const fill = cell.fill as any;
        if (fill?.type === 'pattern') {
            const color = fill.fgColor?.argb || fill.fgColor?.theme;
            if (color === 'FF000000' || color === '000000' || fill.fgColor?.indexed === 64) return true;
        }
    }
    return false;
}

/**
 * 🔒 BUILD SPECIFIC ADDRESS EXTRACTOR
 */
function extractBuildAddressFromRow(row: ExcelJS.Row): { address: string; eNumber: string } | null {
  for (let c = 1; c <= 3; c++) {
    const text = getCellText(row.getCell(c));
    if (!text || text.length < 5) continue;

    const upper = text.toUpperCase();
    const noise = ['MATERIALS', 'MANAGER', 'TLO', 'MEASURES', 'SCHEME', 'PULSE', 'WEEK COMM', 'REMEDIAL', 'START DATE', 'SITE MANAGER', 'TECHNICAL MANAGER', 'JOB MANAGER', 'RESPONSIBLE PERSON', 'CONTRACT:', 'WAITING ON', 'TOTALS', 'SUMMARY'];
    if (noise.some(n => upper.includes(n))) continue;

    let score = Math.min(text.length, 50);
    if (/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) score += 2000;
    if (/\d+/.test(text)) score += 500;

    if (score >= 50) {
      const rawAddr = normalizeWhitespace(text);
      const eNumMatch = rawAddr.match(/\b([BE]\d+\S*)\b/i);
      const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
      const address = eNumMatch ? rawAddr.replace(eNumMatch[0], '').trim().replace(/^[:\-\s]+/, '').trim().replace(/,$/, '').trim() : rawAddr;
      return { address, eNumber };
    }
  }
  return null;
}

function extractSiteAddress(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): { address: string; row: number; } | null {
    const scoreAddress = (text: string) => {
        if (!text || text.length < 5) return 0;
        const upper = text.toUpperCase();
        const noise = ['MATERIALS', 'MANAGER', 'TLO', 'MEASURES', 'SCHEME', 'PULSE', 'WEEK COMM', 'REMEDIAL', 'START DATE', 'SITE MANAGER', 'TECHNICAL MANAGER', 'JOB MANAGER', 'RESPONSIBLE PERSON'];
        if (noise.some(n => upper.includes(n))) return -500;
        let score = Math.min(text.length, 50);
        if (/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) score += 2000;
        if (/\d+/.test(text)) score += 500;
        return score;
    };

    let best = { text: "", score: -Infinity, row: 0 };
    for (let r = startRow; r <= endRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= 3; c++) {
            const text = getCellText(row.getCell(c));
            const score = scoreAddress(text);
            if (score > best.score) best = { text, score, row: r };
        }
    }
    return best.score >= 50 ? { address: normalizeWhitespace(best.text), row: best.row } : null;
}

function getDateColumns(ws: ExcelJS.Worksheet, used: UsedBounds, dateRowIdx: number, matrixStartCol = 3): Array<{ col: number; isoDate: string }> {
  const cols = [];
  const startCol = Math.max(used.startCol, matrixStartCol);
  for (let c = startCol; c <= used.endCol; c++) {
    const dt = parseExcelCellAsDate(ws.getRow(dateRowIdx).getCell(c));
    if (dt) cols.push({ col: c, isoDate: toISODate(dt) });
  }
  return cols;
}

function extractGasTaskAndNames(text: string): { task: string; names: string[]; type: 'am' | 'pm' | 'all-day' } {
    let raw = normalizeWhitespace(text);
    let type: 'am' | 'pm' | 'all-day' = 'all-day';
    if (/^AM\b/i.test(raw)) { type = 'am'; raw = raw.substring(2).trim(); }
    else if (/^PM\b/i.test(raw)) { type = 'pm'; raw = raw.substring(2).trim(); }
    
    const separatorRegex = /[-\–\—]/g;
    let match;
    let lastIdx = -1;
    while ((match = separatorRegex.exec(raw)) !== null) {
        lastIdx = match.index;
    }

    if (lastIdx === -1) return { task: "", names: [], type };

    const task = raw.substring(0, lastIdx).trim() || "Work";
    const namesPart = raw.substring(lastIdx + 1).trim();
    
    const splitRegex = /[,&\/\+\\]| and /i;
    const names = namesPart.split(splitRegex).map(s => s.trim()).filter(Boolean).filter(n => {
        if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(n)) return false;
        if (/^\d+$/.test(n)) return false;
        return n.length > 1;
    });
    
    const uniqueNames = Array.from(new Set(names.map(n => n.toLowerCase()))).map(lowName => {
        return names.find(n => n.toLowerCase() === lowName)!;
    });

    return { task, names: uniqueNames, type };
}
