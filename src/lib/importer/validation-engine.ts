
import { type StandardShift, type ImportError, type UserMapEntry } from './types';

/**
 * Validates extracted shifts for data integrity.
 */
export function validateShifts(shifts: StandardShift[], userMap: UserMapEntry[]): ImportError[] {
  const errors: ImportError[] = [];
  
  shifts.forEach((shift, index) => {
    if (!shift.date || isNaN(shift.date.getTime())) {
      errors.push({
        row: index + 1,
        message: 'Invalid shift date.',
        severity: 'error',
        code: 'INVALID_DATE',
        rawValues: shift
      });
    }

    if (!shift.operativeUid) {
        errors.push({
            row: index + 1,
            message: `Operative "${shift.operative}" not found in database.`,
            severity: 'error',
            code: 'USER_NOT_FOUND',
            rawValues: shift
        });
    }

    if (!shift.address || shift.address === "Unknown Address") {
        errors.push({
            row: index + 1,
            message: 'No property address associated with this work cell.',
            severity: 'error',
            code: 'MISSING_ADDRESS',
            rawValues: shift
        });
    }
  });

  return errors;
}
