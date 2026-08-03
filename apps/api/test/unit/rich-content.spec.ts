import { describe, expect, it } from 'vitest';

import {
  assertRichDocument,
  createEmptyRichDocument,
  extractPostReferenceIds,
  inspectPublishableDocument,
  MAX_REQUEST_ENVELOPE_BYTES,
  MAX_RICH_DOCUMENT_BYTES,
  markdownToRichDocument,
  richDocumentToMarkdown,
  type RichDocument,
} from '../../src/posts/rich-content.js';

function documentWithNode(node: Record<string, unknown>): RichDocument {
  return {
    root: {
      children: [node as RichDocument['root']['children'][number]],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  };
}

describe('rich content contract', () => {
  it('imports legacy Markdown into a valid Lexical document and derives Markdown', () => {
    const source = '# 标题\n\n一段 **重要** 的正文。';
    const document = markdownToRichDocument(source);

    expect(() => assertRichDocument(document)).not.toThrow();
    expect(document.root.type).toBe('root');
    expect(richDocumentToMarkdown(document)).toContain('标题');
    expect(richDocumentToMarkdown(document)).toContain('正文');
  });

  it('exports the canonical empty document as empty Markdown', () => {
    expect(richDocumentToMarkdown(createEmptyRichDocument())).toBe('');
  });

  it.each(['poll', 'dynamic', 'agent-diff'])(
    'rejects the prohibited %s node for publication',
    (type) => {
      const document = documentWithNode({ type, version: 1 });

      expect(inspectPublishableDocument(document)).toEqual([
        { path: 'root.children[0]', type, reason: 'prohibited' },
      ]);
    },
  );

  it('rejects unknown nodes and invalid post references only at publication', () => {
    const document = documentWithNode({
      children: [
        { type: 'future-node', version: 1 },
        { postId: '', type: 'post-reference', version: 1 },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    });

    expect(() => assertRichDocument(document)).not.toThrow();
    expect(inspectPublishableDocument(document)).toEqual([
      {
        path: 'root.children[0].children[0]',
        type: 'future-node',
        reason: 'unknown',
      },
      {
        path: 'root.children[0].children[1]',
        type: 'post-reference',
        reason: 'invalid',
      },
    ]);
  });

  it('deduplicates post reference ids while preserving document order', () => {
    const document = documentWithNode({
      children: [
        { postId: 'post-a', type: 'post-reference', version: 1 },
        { postId: 'post-b', type: 'post-reference', version: 1 },
        { postId: 'post-a', type: 'post-reference', version: 1 },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'paragraph',
      version: 1,
    });

    expect(extractPostReferenceIds(document)).toEqual(['post-a', 'post-b']);
  });

  it('checks nested editor states without treating Excalidraw scene data as nodes', () => {
    const excalidraw = documentWithNode({
      elements: [{ type: 'rectangle', version: 7 }],
      snapshot: 'https://assets.example.test/drawing.png',
      type: 'excalidraw',
      version: 1,
    });
    expect(inspectPublishableDocument(excalidraw)).toEqual([]);

    const nestedPoll = documentWithNode({
      content: {
        root: {
          children: [{ type: 'poll', version: 1 }],
          direction: null,
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      },
      type: 'nested-doc',
      version: 1,
    });
    expect(inspectPublishableDocument(nestedPoll)).toContainEqual({
      path: 'root.children[0].content.root.children[0]',
      type: 'poll',
      reason: 'prohibited',
    });
  });

  it.each([
    ['link', { url: 'javascript:alert(1)' }],
    ['autolink', { url: 'https://owner:secret@example.test/article' }],
    ['link-card', { url: 'data:text/html,unsafe' }],
    [
      'link-card',
      {
        favicon: 'file:///etc/passwd',
        url: 'https://example.test/article',
      },
    ],
    [
      'embed',
      {
        source: 'youtube',
        url: 'https://x.com/izumi/status/123',
      },
    ],
    [
      'embed',
      {
        source: 'unsupported-provider',
        url: 'https://example.test/embed',
      },
    ],
    [
      'embed',
      {
        source: 'bilibili',
        url: 'https://evilbilibili.com/video/BV123',
      },
    ],
  ])('rejects unsafe or mismatched %s URLs at publication', (type, fields) => {
    const document = documentWithNode({ ...fields, type, version: 1 });

    expect(inspectPublishableDocument(document)).toEqual([
      { path: 'root.children[0]', type, reason: 'invalid' },
    ]);
  });

  it.each([
    ['link', { url: 'https://example.test/article' }],
    ['autolink', { url: 'http://example.test/article' }],
    [
      'link-card',
      {
        favicon: 'https://example.test/favicon.ico',
        image: 'https://example.test/cover.webp',
        url: 'https://example.test/article',
      },
    ],
    [
      'embed',
      {
        source: 'youtube',
        url: 'https://www.youtube.com/watch?v=quiet',
      },
    ],
    [
      'embed',
      {
        source: 'github-file',
        url: 'https://github.com/mx-space/admin-react/blob/main/DESIGN.md',
      },
    ],
  ])('accepts safe %s URLs at publication', (type, fields) => {
    const document = documentWithNode({ ...fields, type, version: 1 });

    expect(inspectPublishableDocument(document)).toEqual([]);
  });

  it('exports an envelope that holds two maximum documents plus request metadata', () => {
    expect(MAX_RICH_DOCUMENT_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_REQUEST_ENVELOPE_BYTES).toBeGreaterThan(MAX_RICH_DOCUMENT_BYTES * 2);
  });

  it('rejects malformed roots before persistence', () => {
    expect(() =>
      assertRichDocument({ root: { children: [], type: 'paragraph', version: 1 } }),
    ).toThrow('document.root must be a Lexical root');
  });
});
