
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

function getCellText(cell: ExcelJS.Cell | null | undefined): string {
  if (!cell) return "";
  const val = cell.value;
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
    return (cell.text || String(val)).trim();
  } catch (e) {
    return String(val || "").trim();
  }
}

function getCellValue(cell: ExcelJS.Cell | null | undefined): any {
  if (!cell) return null;
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) return (v as any).result;
  return v;
}

/**
 * 🔒 VERIFIED MATCHING LOGIC (SHARED)
 */
function findUsersInMap(nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } {
    const normalizedChunk = normalizeText(nameChunk);
    if (!normalizedChunk) return { users: [], reason: 'Empty name provided.' };

    // 1. Try Exact Match First
    let matches = userMap.filter(u => u.normalizedName === normalizedChunk);
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users exactly.` };

    const chunkParts = normalizedChunk.split(' ');
    
    // 2. STRICT CHECK: If only one name is provided, DO NOT partial match individuals.
    if (chunkParts.length < 2) {
        const companyMatches = userMap.filter(u => u.accountType === 'company' && u.normalizedName.includes(normalizedChunk));
        if (companyMatches.length === 1) return { users: companyMatches };
        return { users: [], reason: `Single name "${nameChunk}" requires a full/exact match for individuals. No match found.` };
    }

    //  multi-word partial matching
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
      d = new Date(v.getFullYear(), v.getMonth(), v.getDate());
    } else if (typeof v === "number" && v > 20000 && v < 60000) {
      const rawDate = new Date((v - 25569) * 86400 * 1000);
      d = new Date(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate());
    } else {
      const text = getCellText(cell);
      if (text) {
        // Try UK Format DD/MM/YYYY
        const ukMatch = text.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
        if (ukMatch) {
            const day = parseInt(ukMatch[1], 10);
            const month = parseInt(ukMatch[2], 10) - 1;
            let year = parseInt(ukMatch[3], 10);
            if (year < 100) year += 2000;
            d = new Date(year, month, day);
        } else {
            const cleanedText = text.replace(/(\d+)(st|nd|rd|th)/g, '$1');
            const parsed = new Date(cleanedText);
            if (!isNaN(parsed.getTime())) {
              d = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
            }
        }
      }
    }

    if (d && !isNaN(d.getTime()) && d.getFullYear() >= 2020 && d.getFullYear() <= 2050) {
      return d;
    }
  } catch (e) {
    console.error("Error parsing excel cell as date:", e);
  }
  return null;
}

/**
 * 🔒 STABLE ISO CONVERSION
 */
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
  ];

  const strictHeaders = [
    "date", "task", "name", "operative", "address", 
    "scheme", "measures", "pulse", "cc", "council", 
    "manager", "ignore", "ordered", "start date", 
    "on live", "coole", "variation", "work type", 
    "waiting on", "scaffolding", "ordering", "hc",
    "remedial"
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
    const sheetResult = parseMatrixView(sheet, userMap);
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

function parseMatrixView(sheet: ExcelJS.Worksheet, userMap: UserMapEntry[]): ParseResult {
  const sheetName = sheet.name;
  const failures: ImportFailure[] = [];
  const parsed: ParsedGasShift[] = [];

  const used = getUsedBounds(sheet);
  if (!used) return { parsed: [], failures: [] };

  let dividerRows = findDividerRows(sheet, used);
  if (!dividerRows.includes(used.startRow - 1)) dividerRows.unshift(used.startRow - 1);
  if (!dividerRows.includes(used.endRow + 1)) dividerRows.push(used.endRow + 1);

  for (let i = 0; i < dividerRows.length - 1; i++) {
    const blockStart = dividerRows[i] + 1;
    const blockEnd = dividerRows[i + 1] - 1;
    if (blockEnd < blockStart) continue;

    let dateRowIdx = -1;
    let dateCols: { col: number; isoDate: string }[] = [];
    for (let r = blockStart; r <= blockEnd; r++) {
        const tempCols = getDateColumns(sheet, used, r, 5); 
        if (tempCols.length >= 2) { 
            dateRowIdx = r;
            dateCols = tempCols;
            break;
        }
    }

    if (dateRowIdx === -1) continue;

    const siteAddressResult = extractSiteAddress(sheet, used, blockStart, blockEnd);
    if (!siteAddressResult) continue;
    
    const { address: rawSiteAddress, row: addressRowIdx } = siteAddressResult;
    const eNumMatch = rawSiteAddress.match(/\b([BE]\d+\S*)\b/i);
    const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
    const siteAddress = eNumMatch ? rawSiteAddress.replace(eNumMatch[0], '').trim().replace(/^[:\-\s]+/, '').trim().replace(/,$/, '').trim() : rawSiteAddress;

    let manager = '';
    const otherContacts: string[] = [];
    let scheme = sheetName; // Default to sheet name

    for (let r = blockStart; r <= blockEnd; r++) {
        const row = sheet.getRow(r);
        for (let c = 1; c <= 8; c++) {
            const cellText = getCellText(row.getCell(c));
            if (!cellText) continue;

            const upper = cellText.toUpperCase();
            
            if (r < addressRowIdx && (upper.includes('SITE MANAGER') || upper.includes('RESPONSIBLE PERSON'))) {
                const cleaned = cellText.replace(/(site manager|responsible person)\s*:?/i, '').trim();
                if (!manager) manager = cleaned.split('\n')[0].trim();
            } 
            
            if (upper.includes('SCHEME:')) {
                const schemeVal = getCellText(row.getCell(c + 1));
                if (schemeVal) {
                    scheme = schemeVal;
                }
            }

            if (r < addressRowIdx && (upper.includes('PROJECT MANAGER') || upper.includes('TLO') || upper.includes('TECHNICAL MANAGER') || upper.includes('CONTACT'))) {
                otherContacts.push(cellText);
            }
        }
    }

    const seenShiftsInBlock = new Set<string>();

    for (let r = blockStart; r <= blockEnd; r++) {
      if (r === dateRowIdx) continue; 
      
      const row = sheet.getRow(r);
      for (const { col, isoDate } of dateCols) {
        const cell = row.getCell(col);
        const text = getCellText(cell);
        if (!text || isNonShiftText(text)) continue;

        const { task, names, type } = extractGasTaskAndNames(text);
        
        for (const name of names) {
            const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
            if (matchedUsers.length !== 1) {
                if (!/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(name) && !/^\d+$/.test(name)) {
                  failures.push({ 
                      reason: reason || `Could not match operative: "${name}"`, 
                      siteAddress, 
                      shiftDate: isoDate,
                      operativeNameRaw: name, 
                      sheetName, 
                      cellRef: cell.address,
                      cellContent: text
                  });
                }
                continue;
            }
            
            const user = matchedUsers[0];
            const uniqueKey = `${isoDate}-${user.uid}-${normalizeText(siteAddress)}-${normalizeText(task)}-${type}`;
            
            if (!seenShiftsInBlock.has(uniqueKey)) {
                seenShiftsInBlock.add(uniqueKey);
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
                  contract: scheme,
                  department: 'Gas'
                });
            }
        }
      }
    }
  }
  return { parsed, failures };
}

/* =========================
   LOCKED BUILD PARSER (VERIFIED)
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
            if (colNumber < 5) return;
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

    let dividerRows = findDividerRows(sheet, used);
    if (!dividerRows.includes(dateRowIdx)) dividerRows.unshift(dateRowIdx);
    if (!dividerRows.includes(used.endRow + 1)) dividerRows.push(used.endRow + 1);

    for (let i = 0; i < dividerRows.length - 1; i++) {
        const blockStart = dividerRows[i] + 1;
        const blockEnd = dividerRows[i + 1] - 1;
        if (blockEnd < blockStart) continue;

        const siteAddressResult = extractSiteAddress(sheet, used, blockStart, blockEnd, true);
        if (!siteAddressResult) continue;

        const { address: rawSiteAddress } = siteAddressResult;
        const eNumMatch = rawSiteAddress.match(/\b([BE]\d+\S*)\b/i);
        const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
        const siteAddress = eNumMatch ? rawSiteAddress.replace(eNumMatch[0], '').trim().replace(/^[:\-\s]+/, '').trim().replace(/,$/, '').trim() : rawSiteAddress;

        const seenShiftsInBlock = new Set<string>();

        for (let r = blockStart; r <= blockEnd; r++) {
            const row = sheet.getRow(r);
            for (const { col, isoDate } of dateCols) {
                if (isoDate && isoDate < today) continue;

                const cell = row.getCell(col);
                const cellText = getCellText(cell);
                if (!cellText || isNonShiftText(cellText)) continue;

                const { task, names, type } = extractGasTaskAndNames(cellText);
                
                for (const name of names) {
                    const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
                    if (matchedUsers.length !== 1) {
                        if (!/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(name) && !/^\d+$/.test(name)) {
                          allFailures.push({
                              reason: reason || `Could not match operative: "${name}"`,
                              siteAddress,
                              shiftDate: isoDate,
                              operativeNameRaw: name,
                              sheetName: sheet.name,
                              cellRef: cell.address,
                              cellContent: cellText
                          });
                        }
                        continue;
                    }

                    const user = matchedUsers[0];
                    const uniqueKey = `${isoDate}-${user.uid}-${normalizeText(siteAddress)}-${normalizeText(task)}-${type}`;
                    
                    if (!seenShiftsInBlock.has(uniqueKey)) {
                        seenShiftsInBlock.add(uniqueKey);
                        allParsed.push({
                            siteAddress,
                            shiftDate: isoDate,
                            task,
                            type,
                            user,
                            source: { sheetName: sheet.name, cellRef: cell.address },
                            eNumber,
                            contract: sheetName,
                            department: 'Build',
                            manager: sheetName
                        });
                    }
                }
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

function findDividerRows(ws: ExcelJS.Worksheet, used: UsedBounds): number[] {
  const rows: number[] = [];
  for (let r = used.startRow; r <= used.endRow; r++) {
    if (isDividerRow(ws, r)) rows.push(r);
  }
  return rows.filter((row, idx) => idx === 0 || row !== rows[idx - 1] + 1);
}

function isDividerRow(ws: ExcelJS.Worksheet, r: number): boolean {
  const row = ws.getRow(r);
  let hasPatternFill = false;
  
  // 🔒 POSTCODE PROTECTION: Property headers contain postcodes. They are data, NOT dividers.
  // 🔒 HEADER PROTECTION: Rows containing metadata or dates are NOT dividers.
  for (let c = 1; c <= 12; c++) {
    const cell = row.getCell(c);
    const text = getCellText(cell);
    if (!text) {
        const fill = cell.fill as any;
        if (fill?.type === "pattern" && fill.pattern !== "none") hasPatternFill = true;
        continue;
    }

    const upper = text.toUpperCase();
    if (/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) return false;
    if (upper.includes('SITE MANAGER') || upper.includes('TECHNICAL MANAGER') || upper.includes('SCHEME:')) return false;
    if (parseExcelCellAsDate(cell)) return false;

    const fill = cell.fill as any;
    if (fill?.type === "pattern" && fill.pattern !== "none") hasPatternFill = true;
  }
  
  return hasPatternFill;
}

function extractSiteAddress(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number, isBuild = false): { address: string; row: number; } | null {
    if (isBuild) {
        const scoreAddress = (text: string) => {
            if (!text || text.length < 5) return 0;
            const upper = text.toUpperCase();
            const noise = ['MATERIALS', 'MANAGER', 'TLO', 'MEASURES', 'SCHEME', 'PULSE', 'WEEK COMM'];
            if (noise.some(n => upper.includes(n))) return -500;
            let score = Math.min(text.length, 50);
            if (/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) score += 2000;
            return score;
        };
        let best = { text: "", score: -Infinity, row: 0 };
        for (let r = startRow; r <= endRow; r++) {
            const text = getCellText(ws.getRow(r).getCell(1));
            const score = scoreAddress(text);
            if (score > best.score) best = { text, score, row: r };
        }
        return best.score >= 20 ? { address: normalizeWhitespace(best.text), row: best.row } : null;
    }

    const noiseKeywords = [
        'SITE MANAGER', 'TECHNICAL MANAGER', 'MATERIALS ORDERING', 'TLO', 
        'MEASURES', 'PROJECT MANAGER', 'MEASURE', 'CONTACT',
        'RESPONSIBLE PERSON', 'TO BE FILLED IN', 'SCHEME', 'REMEDIAL', 'START DATE',
        'WEEK COMM', 'CONTRACT'
    ];

    for (let r = endRow; r >= startRow - 1; r--) {
        if (r < 1) continue;
        const cell = ws.getRow(r).getCell(1);
        const text = getCellText(cell);
        if (!text || text.trim().length < 5) continue;
        
        const upper = text.toUpperCase();
        if (noiseKeywords.some(kw => upper.includes(kw))) continue;
        if (/\d+/.test(text) || /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(text)) {
            return { address: normalizeWhitespace(text), row: r };
        }
    }
    return null;
}

function getDateColumns(ws: ExcelJS.Worksheet, used: UsedBounds, dateRowIdx: number, matrixStartCol = 5): Array<{ col: number; isoDate: string }> {
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
    if (task.toLowerCase() === 'unspecified') return { task: "Work", names: [], type };

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
