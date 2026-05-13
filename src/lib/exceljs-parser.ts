/**
 * GAS & BUILD IMPORT (ExcelJS based)
 * - Uses ExcelJS for robust style and formula handling.
 * 
 * !!! VERIFIED BUILD IMPORT - DO NOT ALTER THE parseBuildWorkbook FUNCTION !!!
 * !!! VERIFIED GAS IMPORT - DO NOT ALTER THE parseGasWorkbook FUNCTION !!!
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
  return String(s).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ").trim();
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return "";
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function getCellText(cell: ExcelJS.Cell | null | undefined): string {
  if (!cell) return "";
  const val = cell.value;
  if (val === null || val === undefined) return "";
  
  if (typeof val === 'object' && 'result' in val) {
    const res = val.result;
    if (res === null || res === undefined) return "";
    if (res instanceof Date) return res.toISOString();
    return String(res).trim();
  }

  if (typeof val === 'object' && 'richText' in val && Array.isArray(val.richText)) {
    return val.richText.map(v => v.text || '').join('').trim();
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
  if (v && typeof v === 'object' && 'result' in v) return v.result;
  return v;
}

/**
 * 🔒 VERIFIED MATCHING LOGIC (GAS & BUILD)
 * Requirement: Do not "assume" identities from single names.
 */
function findUsersInMap(nameChunk: string, userMap: UserMapEntry[]): { users: UserMapEntry[]; reason?: string } {
    const normalizedChunk = normalizeText(nameChunk);
    if (!normalizedChunk) return { users: [], reason: 'Empty name provided.' };

    // 1. Try Exact Match First (Works for single names if the database name is also single, or for companies)
    let matches = userMap.filter(u => u.normalizedName === normalizedChunk);
    if (matches.length === 1) return { users: matches };
    if (matches.length > 1) return { users: [], reason: `Ambiguous name "${nameChunk}" matches multiple users exactly.` };

    const chunkParts = normalizedChunk.split(' ');
    
    // 2. STRICT CHECK: If only one name is provided (e.g. "KYLE"), and exact match failed, DO NOT partial match.
    // This prevents "KYLE" matching "KYLE DANSON" by assumption.
    if (chunkParts.length < 2) {
        return { users: [], reason: `Single name "${nameChunk}" requires a full/exact match. No match found.` };
    }

    // 3. Multi-word partial matching (Only for "KYLE DANSON" or "COMPANY LTD" style inputs)
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

function parseExcelCellAsDate(cell: ExcelJS.Cell): Date | null {
  const v = getCellValue(cell);
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  }
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const d = new Date((v - 25569) * 86400 * 1000);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  const text = getCellText(cell);
  if (!text) return null;
  const d = new Date(text.replace(/(\d+)(st|nd|rd|th)/g, '$1'));
  return (!isNaN(d.getTime()) && d.getFullYear() > 2000) ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
}

function toISODate(dt: Date): string {
  return dt.toISOString().split('T')[0];
}

function isNonShiftText(text: string): boolean {
  const t = text.trim().toLowerCase();
  const noise = [
    "job manager", "measures", "scheme", "pulse", "ignore", "ordered", 
    "start date", "on live", "coole", "variation", "work type", 
    "operative", "site address", "task", "date", "name", "week comm", 
    "asbestos present", "bedroom", "bathroom", "waiting on", "scaffolding", 
    "cc", "council", "manager", "ordering", "loft", "300mm", "insulation",
    "pv wire", "invertor", "hatch", "board from"
  ];
  return noise.some(b => t.includes(b)) || /^\+?\d[\d\s-]{7,}$/.test(t);
}

/* =========================
   GAS PARSER (VERIFIED - DO NOT ALTER parseGasWorkbook)
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

  const today = toISODate(new Date());
  return { 
    parsed: allParsed.filter(s => s.shiftDate >= today), 
    failures: allFailures.filter(f => !f.shiftDate || f.shiftDate >= today) 
  };
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

        if (!date || !userNameRaw || !task || !address) continue;

        const { users: matchedUsers, reason } = findUsersInMap(userNameRaw, userMap);
        if (matchedUsers.length !== 1) {
            failures.push({
                reason: reason || `Could not find a unique user for "${userNameRaw}"`,
                siteAddress: address,
                shiftDate: toISODate(date),
                operativeNameRaw: userNameRaw,
                sheetName,
                cellRef: row.getCell(userIndex + 1).address,
                cellContent: userNameRaw
            });
            continue;
        }

        parsed.push({
          siteAddress: address,
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
  if (!used) return { parsed: [], failures: [] };

  // dividerRows already stops at 15 empty Column A cells
  let dividerRows = findDividerRows(sheet, used);
  
  if (!dividerRows.includes(used.startRow - 1)) dividerRows.unshift(used.startRow - 1);
  if (!dividerRows.includes(used.endRow + 1)) dividerRows.push(used.endRow + 1);

  for (let i = 0; i < dividerRows.length - 1; i++) {
    const blockStart = dividerRows[i] + 1;
    const blockEnd = dividerRows[i + 1] - 1;
    if (blockEnd < blockStart) continue;

    const dateRowIdx = findDateRow(sheet, used, blockStart, blockEnd);
    if (!dateRowIdx) continue;

    // 🔒 CRITICAL FIX (GAS): Site address is strictly sought ABOVE the date header row
    // This prevents picking up measures/notes like "LOFT" which are typically below headers.
    const siteAddressResult = extractSiteAddress(sheet, used, blockStart, dateRowIdx - 1);
    if (!siteAddressResult) continue;
    
    const { address: rawSiteAddress } = siteAddressResult;
    const eNumMatch = rawSiteAddress.match(/\b([BE]\d+\S*)\b/i);
    const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
    const siteAddress = eNumMatch ? rawSiteAddress.replace(eNumMatch[0], '').trim().replace(/,$/, '').trim() : rawSiteAddress;

    let manager = '';
    const otherContacts: string[] = [];
    for (let r = blockStart; r < dateRowIdx; r++) {
        const cellText = getCellText(sheet.getRow(r).getCell(1));
        if (cellText) {
            const upper = cellText.toUpperCase();
            if (upper.includes('SITE MANAGER')) manager = cellText.replace(/site manager\s*:?/i, '').trim().split('\n')[0];
            else if (upper.includes('PROJECT MANAGER') || upper.includes('TLO')) otherContacts.push(cellText);
        }
    }

    const dateCols = getDateColumns(sheet, used, dateRowIdx);
    const seenShiftsInBlock = new Set<string>();

    for (const { col, isoDate } of dateCols) {
      for (let r = dateRowIdx + 1; r <= blockEnd; r++) {
        const cell = sheet.getRow(r).getCell(col);
        const text = getCellText(cell);
        
        if (!text || !text.includes('-') || isNonShiftText(text)) continue;

        const { task, names, type } = extractGasTaskAndNames(text);
        
        for (const name of names) {
            const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
            if (matchedUsers.length !== 1) {
                failures.push({ 
                    reason: reason || `Could not match operative: "${name}"`, 
                    siteAddress, 
                    shiftDate: isoDate,
                    operativeNameRaw: name, 
                    sheetName, 
                    cellRef: cell.address,
                    cellContent: text
                });
                continue;
            }
            
            const user = matchedUsers[0];
            const uniqueKey = `${isoDate}-${user.uid}-${type}`;
            
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
                  contract: sheetName,
                });
            }
        }
      }
    }
  }
  return { parsed, failures };
}

/* =========================
   BUILD PARSER (VERIFIED - DO NOT ALTER parseBuildWorkbook)
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
    for (let r = 1; r <= 20; r++) {
        const row = sheet.getRow(r);
        const tempCols: { col: number, isoDate: string }[] = [];
        row.eachCell((cell, colNumber) => {
            if (colNumber < 7) return;

            const dt = parseExcelCellAsDate(cell);
            if (dt && dt.getFullYear() > 2020) tempCols.push({ col: colNumber, isoDate: toISODate(dt) });
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

        const siteAddressResult = extractSiteAddress(sheet, used, blockStart, blockEnd);
        if (!siteAddressResult) continue;

        const { address: rawSiteAddress } = siteAddressResult;
        const eNumMatch = rawSiteAddress.match(/\b([BE]\d+\S*)\b/i);
        const eNumber = eNumMatch ? eNumMatch[1].toUpperCase() : '';
        const siteAddress = eNumMatch ? rawSiteAddress.replace(eNumMatch[0], '').trim().replace(/,$/, '').trim() : rawSiteAddress;

        const seenShiftsInBlock = new Set<string>();

        for (let r = blockStart; r <= blockEnd; r++) {
            const row = sheet.getRow(r);
            for (const { col, isoDate } of dateCols) {
                if (isoDate < today) continue;

                const cell = row.getCell(col);
                const cellText = getCellText(cell);
                
                if (!cellText || !cellText.includes('-') || isNonShiftText(cellText)) continue;

                const { task, names, type } = extractGasTaskAndNames(cellText);
                
                for (const name of names) {
                    const { users: matchedUsers, reason } = findUsersInMap(name, userMap);
                    if (matchedUsers.length !== 1) {
                        allFailures.push({
                            reason: reason || `Could not match operative: "${name}"`,
                            siteAddress,
                            shiftDate: isoDate,
                            operativeNameRaw: name,
                            sheetName: sheet.name,
                            cellRef: cell.address,
                            cellContent: cellText
                        });
                        continue;
                    }

                    const user = matchedUsers[0];
                    const uniqueKey = `${isoDate}-${user.uid}-${type}`;
                    
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
                            department: 'Build'
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
  let emptyCount = 0;
  for (let r = used.startRow; r <= used.endRow; r++) {
    const row = ws.getRow(r);
    const colA = getCellText(row.getCell(1));
    
    // Stop processing if 15 consecutive rows have no address data in Col A
    if (!colA) emptyCount++;
    else emptyCount = 0;
    if (emptyCount >= 15) break;

    if (isDividerRow(ws, r) || !row.hasValues) rows.push(r);
  }
  return rows.filter((row, idx) => idx === 0 || row !== rows[idx - 1] + 1);
}

function isDividerRow(ws: ExcelJS.Worksheet, r: number): boolean {
  const row = ws.getRow(r);
  let hasPatternFill = false;
  let hasText = false;
  for (let c = 1; c <= 8; c++) {
    const cell = row.getCell(c);
    if (getCellText(cell)) { hasText = true; break; }
    const fill = cell.fill as any;
    if (fill?.type === "pattern" && fill.pattern !== "none") hasPatternFill = true;
  }
  return hasPatternFill && !hasText;
}

/**
 * 🔒 VERIFIED ADDRESS LOGIC (GAS)
 * Refined to ignore manager/materials/measure notes and focus on postal addresses.
 */
function extractSiteAddress(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): { address: string; row: number; } | null {
    const scoreAddress = (text: string) => {
        if (!text || text.length < 5) return 0;
        
        const upper = text.toUpperCase();
        // 1. Explicit Exclusions for Noise Rows (Managers, Ordering, Measures, etc.)
        const noiseKeywords = [
            'MATERIALS ORDERING', 'TECHNICAL MANAGER', 'SITE MANAGER', 
            'PROJECT MANAGER', 'TLO', 'MEASURES', 'SCHEME', 'PULSE', 
            'PULCE', 'WEEK COMM', 'LOFT', '300MM', 'INSULATION', 'PV WIRE',
            'INVERTOR', 'HATCH', 'ATTIC', 'BOARD FROM'
        ];
        if (noiseKeywords.some(keyword => upper.includes(keyword))) return -500;

        let score = Math.min(text.length, 50);
        
        // 2. Look for UK Postcode (Strongest signal) - High boost
        if (/\b([Gg][Ii][Rr] 0[Aa]{2})|((([A-Za-z][0-9]{1,2})|(([A-Za-z][A-Ha-hJ-Yj-y][0-9]{1,2})|(([A-Za-z][0-9][A-Za-z])|([A-Za-z][A-Ha-hJ-Yj-y][0-9][A-Za-z]?))))\s?[0-9][A-Za-z]{2})\b/i.test(text)) {
            score += 2000;
        }
        
        // 3. Regular Address Indicators
        if (/\d/.test(text)) score += 20;
        if (/,/.test(text)) score += 30;
        
        // 4. Penalize rows that look like phone numbers only
        if (/^\+?[\d\s-]{10,}$/.test(text.replace(/[()]/g, '').trim())) score -= 200;

        // 5. Penalize rows that look like dates
        if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) score -= 200;

        return score;
    };

    let best = { text: "", score: -Infinity, row: 0 };
    for (let r = startRow; r <= endRow; r++) {
        for (let c = 1; c <= 2; c++) {
            const text = getCellText(ws.getRow(r).getCell(c));
            const score = scoreAddress(text);
            if (score > best.score) best = { text, score, row: r };
        }
    }
    return best.score >= 20 ? { address: normalizeWhitespace(best.text), row: best.row } : null;
}

function findDateRow(ws: ExcelJS.Worksheet, used: UsedBounds, startRow: number, endRow: number): number | null {
  for (let r = startRow; r <= endRow; r++) {
    let count = 0;
    for (let c = used.startCol; c <= used.endCol; c++) {
      if (parseExcelCellAsDate(ws.getRow(r).getCell(c))) count++;
    }
    if (count >= 3) return r;
  }
  return null;
}

function getDateColumns(ws: ExcelJS.Worksheet, used: UsedBounds, dateRowIdx: number): Array<{ col: number; isoDate: string }> {
  const cols = [];
  // Matrix format: Shifts/Dates strictly start from Column F (index 6) onwards.
  const startCol = Math.max(used.startCol, 6);
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
    const lastHyphen = raw.lastIndexOf("-");
    if (lastHyphen === -1) return { task: "Unspecified", names: raw.split(/[,&/]| and /i).map(s => s.trim()).filter(Boolean), type };
    return { 
        task: raw.substring(0, lastHyphen).trim() || "Unspecified", 
        names: raw.substring(lastHyphen + 1).split(/[,&/]| and /i).map(s => s.trim()).filter(Boolean), 
        type 
    };
}
