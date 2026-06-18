import ExcelJS from 'exceljs';
import { BroadOakProfile } from './profiles/broad-oak';
import { GenericProfile } from './profiles/generic';
import { ConnexusProfile } from './profiles/connexus';
import { type PlannerProfile } from './types';

const PROFILES: PlannerProfile[] = [
  new BroadOakProfile(),
  new ConnexusProfile(),
  new GenericProfile(),
];

export function detectProfile(workbook: ExcelJS.Workbook): PlannerProfile {
  for (const profile of PROFILES) {
    if (profile.detect(workbook)) {
      return profile;
    }
  }
  return new GenericProfile(); // Fallback
}

export function getProfileById(id: string): PlannerProfile | undefined {
  return PROFILES.find(p => p.id === id);
}

export function getAllProfiles(): PlannerProfile[] {
  return PROFILES;
}
