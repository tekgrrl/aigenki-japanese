/**
 * How a sentence-assembly answer is compared: trailing punctuation and spaces don't count.
 * Shared by the review card and the admin Assembly Lab so they judge answers the same way.
 */
export const normalizeAssemblyAnswer = (s: string) =>
  s.replace(/[。、！？!?\.]+$/u, "").replace(/[\s　]+/g, "").trim();
