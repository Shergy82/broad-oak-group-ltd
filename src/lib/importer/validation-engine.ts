import { type StandardShift, type ImportError, type UserMapEntry } from './types';

export function validateShifts(shifts: StandardShift[], userMap: UserMapEntry[]): ImportError[] {
  const errors: ImportError[] = [];
  const seenKeys = new Set<string>();

  shifts.forEach((shift, index) => {
    // 1. Mandatory Field Checks
    if (!shift.address) {
      errors.push({ row: index + 1, cell: shift.sourceCell, message: 'Missing property address.', severity: 'error', code: 'MISSING_ADDRESS' });
    }
    if (!shift.operative) {
      errors.push({ row: index + 1, cell: shift.sourceCell, message: 'No operative assigned.', severity: 'error', code: 'MISSING_OPERATIVE' });
    }

    // 2. Operative Match Check
    const matchedUser = userMap.find(u => u.originalName.toLowerCase() === shift.operative.toLowerCase() || u.normalizedName === shift.operative.toLowerCase().replace(/[^a-z]/g, ''));
    if (!matchedUser) {
      errors.push({ row: index + 1, cell: shift.sourceCell, message: `Operative "${shift.operative}" not found in database.`, severity: 'error', code: 'USER_NOT_FOUND' });
    } else {
      shift.operativeUid = matchedUser.uid;
      shift.department = matchedUser.department;
    }

    // 3. Date Validation
    if (isNaN(shift.date.getTime())) {
      errors.push({ row: index + 1, cell: shift.sourceCell, message: 'Invalid or unreadable date format.', severity: 'error', code: 'INVALID_DATE' });
    } else if (shift.date.getFullYear() > new Date().getFullYear() + 2) {
      errors.push({ row: index + 1, cell: shift.sourceCell, message: `Suspicious future date: ${shift.date.getFullYear()}`, severity: 'warning', code: 'FUTURE_DATE' });
    }

    // 4. Duplicate Check
    const key = `${shift.date.toISOString()}-${shift.operativeUid}-${shift.address.toLowerCase()}-${shift.type}`;
    if (seenKeys.has(key)) {
      errors.push({ row: index + 1, cell: shift.sourceCell, message: 'Duplicate shift detected in spreadsheet.', severity: 'warning', code: 'DUPLICATE' });
    }
    seenKeys.add(key);
  });

  return errors;
}
