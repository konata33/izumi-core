import { describe, expect, it } from 'vitest';

import {
  calculateReadingMinutes,
  markdownToVisiblePlainText,
} from '../../src/posts/content-metrics.js';

describe('content metrics', () => {
  it('uses the v1 CJK and Latin-or-number formula with a one-minute minimum', () => {
    expect(calculateReadingMinutes('')).toBe(1);
    expect(calculateReadingMinutes('字'.repeat(300))).toBe(1);
    expect(calculateReadingMinutes('字'.repeat(301))).toBe(2);

    const twoHundredWords = Array.from({ length: 200 }, () => 'word').join(' ');
    const twoHundredAndOneWords = `${twoHundredWords} word`;
    expect(calculateReadingMinutes(twoHundredWords)).toBe(1);
    expect(calculateReadingMinutes(twoHundredAndOneWords)).toBe(2);
    expect(calculateReadingMinutes(`${'字'.repeat(300)} ${twoHundredWords}`)).toBe(2);
  });

  it('counts visible Markdown text rather than link destinations or unsafe raw HTML', () => {
    const visible = markdownToVisiblePlainText(
      '# Heading\n\n[Read this text](https://example.test/hidden-url)\n\n![diagram](image.png)\n\n<script>ignored words</script>',
    );

    expect(visible).toContain('Heading');
    expect(visible).toContain('Read this text');
    expect(visible).toContain('diagram');
    expect(visible).not.toContain('hidden-url');
    expect(visible).not.toContain('ignored words');
  });
});
