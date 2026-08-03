import { readFileSync } from 'node:fs';

import { allHeadlessNodes, $toMarkdown } from '@haklex/rich-headless';
import { createHeadlessEditor } from '@lexical/headless';
import { describe, expect, it } from 'vitest';

import { richNodeLifecycleFixtures } from '../fixtures/rich-node-lifecycle.mjs';
import {
  assertRichDocument,
  inspectPublishableDocument,
  richDocumentToMarkdown,
  type RichDocument,
} from '../../src/posts/rich-content.js';

type LifecycleFixture = {
  document: RichDocument;
  headless?: 'empty-markdown' | 'parse-error';
  markdown: 'compatibility-rewrite' | 'headless' | 'reference-rewrite';
  token: string;
  type: string;
};

const fixtures = richNodeLifecycleFixtures as LifecycleFixture[];

function createStrictHeadlessEditor() {
  return createHeadlessEditor({
    nodes: allHeadlessNodes,
    onError(error) {
      throw error;
    },
  });
}

function strictHeadlessLifecycle(document: RichDocument) {
  const firstEditor = createStrictHeadlessEditor();
  firstEditor.setEditorState(firstEditor.parseEditorState(JSON.stringify(document)));
  const serialized = firstEditor.getEditorState().toJSON();

  const reloadedEditor = createStrictHeadlessEditor();
  reloadedEditor.setEditorState(
    reloadedEditor.parseEditorState(JSON.stringify(serialized)),
  );
  const reloaded = reloadedEditor.getEditorState().toJSON();
  const markdown = reloadedEditor.read(() => $toMarkdown()).trimEnd();

  return { markdown, reloaded, serialized };
}

function collectNodeTypes(value: unknown, output = new Set<string>()) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const child of value) collectNodeTypes(child, output);
    return output;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string') output.add(record.type);
  if (Array.isArray(record.children)) collectNodeTypes(record.children, output);
  for (const key of ['content', 'contentState', 'editorState']) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      collectNodeTypes((nested as Record<string, unknown>).root, output);
    }
  }
  if (Array.isArray(record.cells)) {
    for (const cell of record.cells) collectNodeTypes(cell, output);
  }
  if (record.root && typeof record.root === 'object') {
    collectNodeTypes(record.root, output);
  }
  return output;
}

describe('publishable rich-node lifecycle matrix', () => {
  it('stays exhaustive when the publication allowlist changes', () => {
    const source = readFileSync(
      new URL('../../src/posts/rich-content.ts', import.meta.url),
      'utf8',
    );
    const allowlist = source.match(
      /const PUBLISHABLE_NODE_TYPES = new Set\(\[(.*?)\]\);/s,
    )?.[1];

    expect(allowlist).toBeDefined();
    expect([...allowlist!.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(
      fixtures.map((fixture) => fixture.type),
    );
    expect(new Set(fixtures.map((fixture) => fixture.type)).size).toBe(fixtures.length);
  });

  it.each(fixtures)(
    'validates and degrades the meaningful $type fixture',
    ({ document, token, type }) => {
      expect(collectNodeTypes(document).has(type)).toBe(true);
      expect(() => assertRichDocument(document)).not.toThrow();
      expect(inspectPublishableDocument(document)).toEqual([]);
      expect(richDocumentToMarkdown(document)).toContain(token);
    },
  );

  it.each(fixtures.filter((fixture) => fixture.markdown === 'headless'))(
    'round-trips $type through the real Haklex headless registry',
    ({ document, token, type }) => {
      const { markdown, reloaded, serialized } = strictHeadlessLifecycle(document);

      expect(collectNodeTypes(serialized).has(type)).toBe(true);
      expect(reloaded).toEqual(serialized);
      expect(markdown).toContain(token);
    },
  );

  it.each(fixtures.filter((fixture) => fixture.markdown === 'compatibility-rewrite'))(
    'documents the local $headless compatibility rewrite for $type',
    ({ document, headless, token, type }) => {
      if (headless === 'parse-error') {
        expect(() => strictHeadlessLifecycle(document)).toThrow();
      } else {
        const lifecycle = strictHeadlessLifecycle(document);
        expect(collectNodeTypes(lifecycle.reloaded).has(type)).toBe(true);
        expect(lifecycle.markdown).toBe('');
      }
      expect(richDocumentToMarkdown(document)).toContain(token);
    },
  );

  it.each(fixtures.filter((fixture) => fixture.markdown === 'reference-rewrite'))(
    'documents the explicit post-reference rewrite for $type',
    ({ document, token }) => {
      expect(() => strictHeadlessLifecycle(document)).toThrow();
      expect(richDocumentToMarkdown(document)).toContain(token);
    },
  );

  it('preserves compatible siblings around a headless-incompatible mark', () => {
    const byType = new Map(fixtures.map((fixture) => [fixture.type, fixture]));
    const document = {
      root: {
        ...structuredClone(byType.get('mark')!.document.root),
        children: [
          ...structuredClone(byType.get('mark')!.document.root.children),
          ...structuredClone(byType.get('image')!.document.root.children),
          ...structuredClone(byType.get('post-reference')!.document.root.children),
        ],
      },
    };

    const markdown = richDocumentToMarkdown(document);
    expect(markdown).toContain('Mark lifecycle copy');
    expect(markdown).toContain('https://media.example.test/owners/owner-1/image.webp');
    expect(markdown).toContain('izumi-post:post-lifecycle');
  });

  it('preserves a block equation beside normal copy', () => {
    const byType = new Map(fixtures.map((fixture) => [fixture.type, fixture]));
    const document = {
      root: {
        ...structuredClone(byType.get('katex-block')!.document.root),
        children: [
          ...structuredClone(byType.get('katex-block')!.document.root.children),
          ...structuredClone(byType.get('paragraph')!.document.root.children),
        ],
      },
    };

    const markdown = richDocumentToMarkdown(document);
    expect(markdown).toContain('E = mc^2');
    expect(markdown).toContain('Paragraph lifecycle copy');
  });

  it.each([
    ['unknown', { type: 'future-node', version: 1 }, 'unknown'],
    ['prohibited', { type: 'poll', version: 1 }, 'prohibited'],
    [
      'invalid reference',
      { postId: ' ', type: 'post-reference', version: 1 },
      'invalid',
    ],
    [
      'invalid URL',
      { type: 'link', url: 'javascript:alert(1)', version: 1 },
      'invalid',
    ],
    [
      'nested prohibited',
      {
        content: {
          root: {
            children: [{ type: 'dynamic', version: 1 }],
            type: 'root',
            version: 1,
          },
        },
        type: 'nested-doc',
        version: 1,
      },
      'prohibited',
    ],
  ] as const)('rejects the %s fixture', (_case, fixture, reason) => {
    const document = {
      root: {
        children: [fixture],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    } as RichDocument;

    expect(() => assertRichDocument(document)).not.toThrow();
    expect(inspectPublishableDocument(document)).toContainEqual(
      expect.objectContaining({ reason }),
    );
  });
});
