import { describe, expect, it } from 'vitest';

import { buildBoundedHistory, buildPostContext } from '../../src/ai/post-context.js';

describe('AI article context', () => {
  it('contains only bounded editorial content and preserves structured content first', () => {
    const context = buildPostContext({
      title: '静默编辑部',
      document: { root: { type: 'root', children: [{ type: 'paragraph' }] } },
      content: '# 正文',
      ownerId: 'must-not-leak',
      encryptedApiKey: 'must-not-leak',
    } as never);

    expect(context).toContain('静默编辑部');
    expect(context).toContain('"type":"root"');
    expect(context).toContain('# 正文');
    expect(context).not.toContain('must-not-leak');
  });

  it('omits oversized structured JSON and truncates oversized Markdown', () => {
    const context = buildPostContext({
      title: 'Long',
      document: { text: 'x'.repeat(90_000) },
      content: 'y'.repeat(50_000),
    });

    expect(context).toContain('structured document omitted');
    expect(context).toContain('[truncated by Izumi Core]');
    expect(context.length).toBeLessThan(42_000);
  });

  it('sends only the most recent bounded conversation history', () => {
    const history = buildBoundedHistory(
      Array.from({ length: 50 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `${index}:${'x'.repeat(3_000)}`,
      })),
    );

    expect(history.length).toBeLessThanOrEqual(40);
    expect(
      history.reduce((total, message) => total + message.content.length, 0),
    ).toBeLessThanOrEqual(80_000);
    expect(history.at(-1)?.content).toContain('0:');
  });
});
