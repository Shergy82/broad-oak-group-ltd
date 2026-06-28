import { type UserMapEntry } from '../types';

/**
 * SHARED IMPORTER UTILITIES
 * 
 * Generic, safe utilities for date handling, name matching, and text normalization.
 * Used by both Gas and Build profiles.
 */

export const FIRST_NAME_ALIASES: Record<string, string[]> = {
  philip: ["phil", "phillip", "philip"],
  stephen: ["steve", "steven", "stephen"],
  michael: ["mike", "mick", "michael"],
  david: ["dave", "david"],
  robert: ["rob", "bob", "robert"],
  james: ["jim", "jamie", "james"],
  william: ["will", "bill", "billy", "william"],
  thomas: ["tom", "tommy", "thomas"],
};

export function normaliseText(val: any): string {
  if (val === undefined || val === null) return "";
  return String(val).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normaliseName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

export function formatDateKey(value: any): string {
  if (!value) return "";
  const d = value instanceof Date ? value : value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getTodayDateKey(): string {
  return formatDateKey(new Date());
}

export function isHistoricShift(shift: any): boolean {
  const key = shift?.dateKey || formatDateKey(shift?.date);
  if (!key) return false;
  return key < getTodayDateKey();
}

export function getLevenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) matrix[i][j] = matrix[i - 1][j - 1];
      else matrix[i][j] = Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
    }
  }
  return matrix[a.length][b.length];
}

export function isSameNameGroup(name1: string, name2: string): boolean {
  if (name1 === name2) return true;
  for (const aliases of Object.values(FIRST_NAME_ALIASES)) {
    if (aliases.includes(name1) && aliases.includes(name2)) return true;
  }
  return false;
}

export function findSafeUserMatch(name: string, userMap: UserMapEntry[]): UserMapEntry | null {
  const normPlanner = normaliseName(name);
  if (!normPlanner) return null;

  // 1. Exact full registered-name match first.
  // This allows single-word names (like "Vulcan") if they match a registered user/company exactly.
  const exactMatches = userMap.filter(u => {
    return normaliseName(u.originalName || "") === normPlanner;
  });

  if (exactMatches.length === 1) return exactMatches[0];
  
  // If multiple exact matches found, we return null so the caller can report ambiguity.
  if (exactMatches.length > 1) return null;

  // 2. Only after exact matching fails, enforce the "too vague" rule for fuzzy/alias matching.
  // We don't want to fuzzy-match or nickname-match single-word names (e.g. "Phil") to full names.
  const plannerParts = normPlanner.split(" ").filter(Boolean);
  if (plannerParts.length < 2) return null;

  const plannerFirst = plannerParts[0];
  const plannerLast = plannerParts.slice(1).join(" ");
  const candidates: UserMapEntry[] = [];

  for (const user of userMap) {
    const normUser = normaliseName(user.originalName);
    const userParts = normUser.split(" ");
    if (userParts.length < 2) continue;
    
    const userFirst = userParts[0];
    const userLast = userParts.slice(1).join(" ");

    // 1. Nickname + Exact Surname
    if (isSameNameGroup(plannerFirst, userFirst) && plannerLast === userLast) {
      candidates.push(user);
      continue;
    }

    // 2. First Initial + Exact Surname
    if (plannerFirst.length === 1 && plannerFirst === userFirst[0] && plannerLast === userLast) {
      candidates.push(user);
      continue;
    }

    // 3. Fuzzy match (Conservative)
    const dist = getLevenshteinDistance(normUser, normPlanner);
    const surnameDist = getLevenshteinDistance(userLast, plannerLast);
    if (dist <= 2 && surnameDist <= 1) {
      candidates.push(user);
      continue;
    }
  }

  const uniqueCandidates = Array.from(new Map(candidates.map(u => [u.uid, u])).values());
  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
}

export function buildImportKey(shift: any, sourcePlannerId: string): string {
  const parts = [
    sourcePlannerId,
    shift.operativeUid || shift.userId,
    shift.dateKey || formatDateKey(shift.date),
    shift.type || 'all-day',
    shift.startTime || "",
    shift.endTime || "",
    shift.eNumber || ""
  ];

  return parts.map(p => normaliseText(p)).join('|');
}

export function getColumnLetter(col: number): string {
  let letter = '';
  while (col > 0) {
    let t = (col - 1) % 26;
    letter = String.fromCharCode(t + 65) + letter;
    col = (col - t - 1) / 26;
  }
  return letter;
}
