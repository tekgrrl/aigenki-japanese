const JLPT_DIFFICULTY: Record<string, number> = { N5: 5, N4: 4, N3: 3, N2: 2, N1: 1 };

/** True when a KU's JLPT level is harder than the user's. Unknown levels count as not above. */
export function isAboveLevel(kuJlptLevel: string | undefined | null, userJlptLevel: string | undefined | null): boolean {
  if (!kuJlptLevel || !userJlptLevel) return false;
  const kuDiff = JLPT_DIFFICULTY[kuJlptLevel];
  const userDiff = JLPT_DIFFICULTY[userJlptLevel];
  if (kuDiff === undefined || userDiff === undefined) return false;
  return kuDiff < userDiff; // lower number = harder level
}
