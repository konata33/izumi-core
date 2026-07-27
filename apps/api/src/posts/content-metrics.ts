const CJK_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LATIN_OR_NUMBER_WORD = /(?:\p{Script=Latin}|\p{N})+/gu;

/**
 * Produces the text a reader can encounter in the supported Markdown subset.
 * It deliberately retains code-block content, while omitting Markdown syntax,
 * link destinations, and raw HTML that the public renderer will remove.
 */
export function markdownToVisiblePlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<mailto:([^ >]+)>/gi, ' $1 ')
    .replace(/<((?:https?:\/\/)[^ >]+)>/gi, ' $1 ')
    .replace(/^\s{0,3}(?:`{3,}|~{3,})[^\n]*$/gm, ' ')
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, ' $1 ')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, ' ')
    .replace(/(?:\*\*|__|~~|`+|\*|_)/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * v1's fixed public reading-time formula. The minimum remains one minute so
 * even a very short published article has a useful, stable display value.
 */
export function calculateReadingMinutes(markdown: string): number {
  const visibleText = markdownToVisiblePlainText(markdown);
  const cjkCharacters = [...visibleText.matchAll(CJK_CHARACTER)].length;
  const nonCjkText = visibleText.replace(CJK_CHARACTER, ' ');
  const latinOrNumberWords = nonCjkText.match(LATIN_OR_NUMBER_WORD)?.length ?? 0;

  return Math.max(1, Math.ceil(cjkCharacters / 300 + latinOrNumberWords / 200));
}
