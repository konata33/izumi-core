import {
  allHeadlessNodes,
  allHeadlessTransformers,
  $toMarkdown,
} from '@haklex/rich-headless';
import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RichDocumentNode {
  type: string;
  version: number;
  children?: RichDocumentNode[];
  [key: string]: JsonValue | RichDocumentNode[] | undefined;
}

export interface RichDocument {
  root: RichDocumentNode & {
    type: 'root';
    children: RichDocumentNode[];
  };
}

export interface RichDocumentIssue {
  path: string;
  type: string;
  reason: 'invalid' | 'unknown' | 'prohibited';
}

export const MAX_RICH_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_ENVELOPE_BYTES = MAX_RICH_DOCUMENT_BYTES * 2 + 1024 * 1024;
const MAX_DOCUMENT_DEPTH = 64;
const MAX_DOCUMENT_NODES = 20_000;

const PROHIBITED_NODE_TYPES = new Set(['agent-diff', 'dynamic', 'poll']);

/**
 * This mirrors the deliberately composed Izumi/Haklex registry. Keep the API
 * allow-list explicit: adding an editor node is not enough to make it safe to
 * publish.
 */
const PUBLISHABLE_NODE_TYPES = new Set([
  'alert-quote',
  'autolink',
  'banner',
  'chat',
  'code',
  'code-block',
  'code-highlight',
  'code-snippet',
  'comment',
  'details',
  'embed',
  'excalidraw',
  'footnote',
  'footnote-section',
  'gallery',
  'grid-container',
  'heading',
  'horizontalrule',
  'image',
  'katex-block',
  'katex-inline',
  'linebreak',
  'link',
  'link-card',
  'list',
  'listitem',
  'mark',
  'mention',
  'mermaid',
  'nested-doc',
  'paragraph',
  'post-reference',
  'quote',
  'rich-quote',
  'root',
  'ruby',
  'spoiler',
  'tab',
  'table',
  'tablecell',
  'tablerow',
  'tag',
  'text',
  'video',
]);

const EMBED_SOURCES = new Set([
  'tweet',
  'youtube',
  'codesandbox',
  'bilibili',
  'github-file',
  'github-gist',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePublicUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function matchesEmbedSource(url: URL, source: unknown): boolean {
  if (typeof source !== 'string' || !EMBED_SOURCES.has(source)) return false;
  const pathParts = url.pathname.split('/');
  switch (source) {
    case 'tweet':
      return (
        (url.hostname === 'twitter.com' || url.hostname === 'x.com') &&
        url.pathname.startsWith('/')
      );
    case 'youtube':
      return url.hostname === 'www.youtube.com' && url.pathname.startsWith('/watch');
    case 'codesandbox':
      return url.hostname === 'codesandbox.io' && pathParts.length === 3;
    case 'bilibili':
      return (
        (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) &&
        url.pathname.startsWith('/video/BV')
      );
    case 'github-file':
      return url.hostname === 'github.com' && pathParts[3] === 'blob';
    case 'github-gist':
      return url.hostname === 'gist.github.com';
    default:
      return false;
  }
}

function hasValidPublishedUrls(node: Record<string, unknown>): boolean {
  const type = String(node.type);
  if (type === 'link' || type === 'autolink') return parsePublicUrl(node.url) !== null;
  if (type === 'embed') {
    const url = parsePublicUrl(node.url);
    return url !== null && matchesEmbedSource(url, node.source);
  }
  if (type !== 'link-card') return true;

  if (parsePublicUrl(node.url) === null) return false;
  return ['image', 'favicon'].every(
    (field) => node[field] === undefined || parsePublicUrl(node[field]) !== null,
  );
}

function textNode(text: string): RichDocumentNode {
  return {
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  };
}

export function createEmptyRichDocument(): RichDocument {
  return {
    root: {
      children: [
        {
          children: [],
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          type: 'paragraph',
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  };
}

function markdownFallbackDocument(markdown: string): RichDocument {
  const document = createEmptyRichDocument();
  document.root.children = [
    {
      children: markdown ? [textNode(markdown)] : [],
      direction: null,
      format: '',
      indent: 0,
      textFormat: 0,
      textStyle: '',
      type: 'paragraph',
      version: 1,
    },
  ];
  return document;
}

export function assertRichDocument(value: unknown): asserts value is RichDocument {
  if (!isObject(value) || !isObject(value.root)) {
    throw new TypeError('document must contain a Lexical root object');
  }
  if (value.root.type !== 'root' || !Array.isArray(value.root.children)) {
    throw new TypeError('document.root must be a Lexical root with children');
  }

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RICH_DOCUMENT_BYTES) {
    throw new TypeError(`document exceeds ${MAX_RICH_DOCUMENT_BYTES} bytes`);
  }

  const pending: Array<{ value: unknown; depth: number }> = [
    { value: value.root, depth: 0 },
  ];
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > MAX_DOCUMENT_DEPTH) {
      throw new TypeError(`document exceeds ${MAX_DOCUMENT_DEPTH} nested levels`);
    }
    if (!isObject(current.value)) {
      throw new TypeError('document contains a non-object node');
    }
    if (typeof current.value.type !== 'string' || !current.value.type) {
      throw new TypeError('every document node must have a non-empty type');
    }
    if (
      typeof current.value.version !== 'number' ||
      !Number.isInteger(current.value.version) ||
      current.value.version < 1
    ) {
      throw new TypeError('every document node must have a positive integer version');
    }

    nodeCount += 1;
    if (nodeCount > MAX_DOCUMENT_NODES) {
      throw new TypeError(`document exceeds ${MAX_DOCUMENT_NODES} nodes`);
    }

    if (current.value.children !== undefined) {
      if (!Array.isArray(current.value.children)) {
        throw new TypeError('document node children must be an array');
      }
      for (const child of current.value.children) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
}

function visitSerializedNodes(
  value: unknown,
  visitor: (node: Record<string, unknown>, path: string) => void,
  path = 'root',
): void {
  if (!isObject(value)) return;

  if (
    typeof value.type !== 'string' ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version)
  ) {
    return;
  }
  visitor(value, path);

  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) =>
      visitSerializedNodes(child, visitor, `${path}.children[${index}]`),
    );
  }

  // Haklex uses nested Lexical states for nested-doc, callouts and grid cells.
  // Traverse only explicit editor-state roots; walking arbitrary rich-node
  // metadata would mistake Excalidraw scene elements (`type` + `version`) for
  // Lexical nodes.
  for (const key of ['content', 'contentState', 'editorState']) {
    const nested = value[key];
    if (isObject(nested) && isObject(nested.root)) {
      visitSerializedNodes(nested.root, visitor, `${path}.${key}.root`);
    }
  }
  if (Array.isArray(value.cells)) {
    value.cells.forEach((cell, index) => {
      if (isObject(cell) && isObject(cell.root)) {
        visitSerializedNodes(cell.root, visitor, `${path}.cells[${index}].root`);
      }
    });
  }
}

export function inspectPublishableDocument(
  document: RichDocument,
): RichDocumentIssue[] {
  const issues: RichDocumentIssue[] = [];
  visitSerializedNodes(document.root, (node, path) => {
    const type = String(node.type);
    if (PROHIBITED_NODE_TYPES.has(type)) {
      issues.push({ path, type, reason: 'prohibited' });
    } else if (!PUBLISHABLE_NODE_TYPES.has(type)) {
      issues.push({ path, type, reason: 'unknown' });
    } else if (!hasValidPublishedUrls(node)) {
      issues.push({ path, type, reason: 'invalid' });
    } else if (
      type === 'post-reference' &&
      (typeof node.postId !== 'string' || node.postId.trim() === '')
    ) {
      issues.push({ path, type, reason: 'invalid' });
    }
  });
  return issues;
}

export function extractPostReferenceIds(document: RichDocument): string[] {
  const ids = new Set<string>();
  visitSerializedNodes(document.root, (node) => {
    if (node.type === 'post-reference' && typeof node.postId === 'string') {
      const id = node.postId.trim();
      if (id) ids.add(id);
    }
  });
  return [...ids];
}

function serializedText(value: unknown): string {
  if (Array.isArray(value)) return value.map(serializedText).join('');
  if (!isObject(value)) return '';
  if (typeof value.text === 'string') return value.text;
  return Array.isArray(value.children) ? serializedText(value.children) : '';
}

function markdownParagraph(value: string): JsonValue {
  return {
    children: [textNode(value)],
    direction: null,
    format: '',
    indent: 0,
    textFormat: 0,
    textStyle: '',
    type: 'paragraph',
    version: 1,
  } as unknown as JsonValue;
}

function rewriteMarkdownCompatibilityNodes(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(rewriteMarkdownCompatibilityNodes);
  if (!isObject(value)) return value;

  if (value.type === 'post-reference') {
    const postId = typeof value.postId === 'string' ? value.postId : 'unknown';
    return markdownParagraph(`[Referenced post](izumi-post:${postId})`);
  }
  if (value.type === 'mark') {
    return textNode(serializedText(value.children)) as unknown as JsonValue;
  }
  if (value.type === 'katex-block') {
    const equation = typeof value.equation === 'string' ? value.equation : '';
    return markdownParagraph(`$$${equation}$$`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      rewriteMarkdownCompatibilityNodes(child as JsonValue),
    ]),
  );
}

function extractReadableText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const child of value) extractReadableText(child, output);
    return;
  }
  if (!isObject(value)) return;

  if (typeof value.text === 'string') output.push(value.text);
  else if (typeof value.equation === 'string') output.push(value.equation);
  else if (typeof value.code === 'string') output.push(value.code);
  else if (typeof value.url === 'string') output.push(value.url);
  else if (typeof value.src === 'string') output.push(value.src);

  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) extractReadableText(child, output);
  }
}

function readableMarkdownFallback(value: unknown): string {
  const text: string[] = [];
  extractReadableText(value, text);
  return text.join('\n\n').trim();
}

export function richDocumentToMarkdown(document: RichDocument): string {
  assertRichDocument(document);
  const serializable = rewriteMarkdownCompatibilityNodes(
    document as unknown as JsonValue,
  );

  try {
    const editor = createHeadlessEditor({
      nodes: allHeadlessNodes,
      onError(error) {
        throw error;
      },
    });
    editor.setEditorState(editor.parseEditorState(JSON.stringify(serializable)));
    const markdown = editor.read(() => $toMarkdown()).trimEnd();
    return markdown || readableMarkdownFallback(serializable);
  } catch {
    return readableMarkdownFallback(serializable);
  }
}

export function importMarkdownToRichDocument(markdown: string): RichDocument {
  const editor = createHeadlessEditor({ nodes: allHeadlessNodes });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, allHeadlessTransformers);
    },
    { discrete: true },
  );
  const document = editor.getEditorState().toJSON() as unknown;
  assertRichDocument(document);
  if (markdown.trim() && !richDocumentToMarkdown(document).trim()) {
    throw new Error('Markdown import produced an empty RichDocument');
  }
  return document;
}

export function markdownToRichDocument(markdown: string): RichDocument {
  try {
    return importMarkdownToRichDocument(markdown);
  } catch {
    return markdownFallbackDocument(markdown);
  }
}
