/**
 * Removes inline furigana from stored text: `漢字[かんじ]` → `漢字`. Use before sending a
 * sentence to the AI or comparing it with plain text (prompts can't be trusted to strip it).
 */
export const stripFurigana = (text: string): string => text.replace(/\[[^\]]*\]/g, '');
