import ExcelJS from 'exceljs';
import { GasProfile } from './profiles/gas-profile';
import { BuildProfile } from './profiles/build-profile';
import { type PlannerProfile } from './types';

const PROFILES: PlannerProfile[] = [
  new GasProfile(),
  new BuildProfile()
];

export function detectProfile(workbook: ExcelJS.Workbook, department?: string): PlannerProfile {
  // 1. If department is provided (e.g. from UI context), prioritise that profile
  if (department === 'Gas') return PROFILES[0];
  if (department === 'Build') return PROFILES[1];

  // 2. Otherwise, attempt auto-detection based on content
  for (const profile of PROFILES) {
    if (profile.detect(workbook)) {
      return profile;
    }
  }

  // 3. Fallback to Gas for safety (most established)
  return PROFILES[0];
}

export function getAllProfiles(): PlannerProfile[] {
  return PROFILES;
}
