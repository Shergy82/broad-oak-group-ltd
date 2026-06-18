
import ExcelJS from "exceljs";
import { detectProfile } from "./importer/planner-detector";
import { validateShifts } from "./importer/validation-engine";
import { type UserMapEntry, type StandardShift, type ImportError } from "./importer/types";

export interface UnifiedParseResult {
  shifts: StandardShift[];
  errors: ImportError[];
  profileName: string;
  profileId: string;
}

/**
 * Entry point for Excel parsing
 */
export async function parseWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[]): Promise<UnifiedParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const profile = detectProfile(workbook);
  
  // LOG: Starting parse for specific profile
  const { shifts, errors: parseErrors } = await profile.parse(workbook, userMap);
  
  const validationErrors = validateShifts(shifts, userMap);
  
  // Sort errors by row so they make sense in the UI
  const allErrors = [...parseErrors, ...validationErrors].sort((a, b) => (a.row || 0) - (b.row || 0));
  
  return {
    shifts,
    errors: allErrors,
    profileName: profile.name,
    profileId: profile.id
  };
}
