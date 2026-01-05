import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const getCorrectedLocalDate = (date: { toDate: () => Date }): Date => {
  const d = date.toDate();
  // Use UTC date parts to create a local date object to avoid timezone issues when comparing.
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * Checks if a date is within a given interval.
 *
 * @param date The date to check
 * @param interval The interval
 * @returns The date is within the interval
 */
export function isWithin(
  date: Date,
  interval: { start: Date; end: Date }
): boolean {
  return date.getTime() >= interval.start.getTime() && date.getTime() <= interval.end.getTime();
}
