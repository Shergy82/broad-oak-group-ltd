import { type StandardShift, type ImportError, type UserMapEntry } from './types';
import { format } from 'date-fns';

/**
 * Validates extracted shifts for data integrity.
 */
export function validateShifts(shifts: StandardShift[], userMap: UserMapEntry[]): ImportError[] {
  const errors: ImportError[] = [];
  
  shifts.forEach((shift, index) => {
    const context = {
        row: parseInt(shift.sourceCell.replace(/[^0-9]/g, '')) || undefined,
        cell: shift.sourceCell,
        sheet: shift.sourceSheet,
        operative: shift.operative,
        date: shift.date ? format(shift.date, 'dd/MM/yy') : 'Unknown',
        address: shift.address,
        task: shift.task,
        rawValues: shift
    };

    if (!shift.date || isNaN(shift.date.getTime())) {
      errors.push({
        ...context,
        message: 'Invalid or missing shift date.',
        severity: 'error',
        code: 'INVALID_DATE',
      });
    }

    if (!shift.operativeUid) {
        errors.push({
            ...context,
            message: `Operative "${shift.operative}" not found in database.`,
            severity: 'error',
            code: 'USER_NOT_FOUND',
        });
    }

    if (!shift.address || shift.address === "Unknown Address") {
        errors.push({
            ...context,
            message: 'No property address associated with this work cell.',
            severity: 'error',
            code: 'MISSING_ADDRESS',
        });
    }

    if (!shift.task) {
        errors.push({
            ...context,
            message: 'No task description found for this work cell.',
            severity: 'warning',
            code: 'MISSING_TASK',
        });
    }
  });

  return errors;
}
