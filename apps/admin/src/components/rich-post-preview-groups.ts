export type PreviewExtensionGroup = 'ai' | 'canvas' | 'code' | 'diagram' | 'light';

const groupByNodeType = new Map<string, PreviewExtensionGroup>([
  ['chat', 'ai'],
  ['code-block', 'code'],
  ['code-snippet', 'code'],
  ['embed', 'light'],
  ['excalidraw', 'canvas'],
  ['gallery', 'light'],
  ['mermaid', 'diagram'],
  ['nested-doc', 'light'],
]);

const baseNodeTypes = new Set([
  'alert-quote',
  'autolink',
  'banner',
  'code',
  'code-highlight',
  'comment',
  'details',
  'footnote',
  'footnote-section',
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

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function previewRequirementsForDocument(document: unknown): {
  groups: PreviewExtensionGroup[];
  postReferenceIds: string[];
  unsupportedNodeTypes: string[];
} {
  const groups = new Set<PreviewExtensionGroup>();
  const postReferenceIds = new Set<string>();
  const unsupportedNodeTypes = new Set<string>();

  function visitNode(value: unknown) {
    if (!isRecord(value)) return;
    if (typeof value.type === 'string') {
      const group = groupByNodeType.get(value.type);
      if (group) groups.add(group);
      else if (!baseNodeTypes.has(value.type)) unsupportedNodeTypes.add(value.type);
      if (value.type === 'post-reference' && typeof value.postId === 'string') {
        const postId = value.postId.trim();
        if (postId) postReferenceIds.add(postId);
      }
    }
    if (Array.isArray(value.children)) value.children.forEach(visitNode);
    if (isRecord(value.root)) visitNode(value.root);
    if (isRecord(value.content) && isRecord(value.content.root)) {
      visitNode(value.content.root);
    }
    if (Array.isArray(value.cells)) {
      for (const cell of value.cells) {
        if (isRecord(cell) && isRecord(cell.root)) visitNode(cell.root);
      }
    }
  }

  visitNode(document);
  return {
    groups: [...groups].sort(),
    postReferenceIds: [...postReferenceIds],
    unsupportedNodeTypes: [...unsupportedNodeTypes].sort(),
  };
}
