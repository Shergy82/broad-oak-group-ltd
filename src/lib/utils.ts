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
