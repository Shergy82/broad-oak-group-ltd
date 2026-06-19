import ExcelJS from "exceljs";
import { detectProfile } from "./importer/planner-detector";
import { type UserMapEntry, type StandardShift, type ImportError } from "./importer/types";

export interface UnifiedParseResult {
  shifts: StandardShift[];
  errors: ImportError[];
  profileName: string;
  profileId: string;
}

/**
 * Entry point for Excel parsing.
 * Uses isolated profiles to handle layout differences between departments.
 */
export async function parseWorkbook(fileBuffer: Buffer, userMap: UserMapEntry[], department?: string): Promise<UnifiedParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const profile = detectProfile(workbook, department);
  
  const { shifts, errors } = await profile.parse(workbook, userMap);
  
  return {
    shifts,
    errors: errors.sort((a, b) => (a.row || 0) - (b.row || 0)),
    profileName: profile.name,
    profileId: profile.id
  };
}
