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
 * Entry point for Excel parsing - RESET
 */
export async function parseWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[]): Promise<UnifiedParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const profile = detectProfile(workbook);
  const { shifts, errors: parseErrors } = await profile.parse(workbook, userMap);
  
  const validationErrors = validateShifts(shifts, userMap);
  
  return {
    shifts,
    errors: [...parseErrors, ...validationErrors],
    profileName: profile.name,
    profileId: profile.id
  };
}
