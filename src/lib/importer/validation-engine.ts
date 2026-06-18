import { type StandardShift, type ImportError, type UserMapEntry } from './types';

/**
 * Validation Engine - RESET
 * Logic to be implemented step-by-step.
 */
export function validateShifts(shifts: StandardShift[], userMap: UserMapEntry[]): ImportError[] {
  const errors: ImportError[] = [];
  
  // Minimal placeholder validation
  shifts.forEach((shift, index) => {
    if (!shift.date) {
      errors.push({
        row: index + 1,
        message: 'Missing date.',
        severity: 'error',
        code: 'MISSING_DATE'
      });
    }
  });

  return errors;
}
