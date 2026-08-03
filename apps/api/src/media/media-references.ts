export type RichMediaReference = Readonly<{
  publicUrl: string;
  nodeType: 'image' | 'gallery' | 'video' | 'video-poster';
  alt?: string;
}>;

const MAX_VISITED_VALUES = 50_000;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractMediaReferences(document: unknown): RichMediaReference[] {
  const references: RichMediaReference[] = [];
  const pending: unknown[] = [document];
  let visited = 0;

  while (pending.length > 0) {
    visited += 1;
    if (visited > MAX_VISITED_VALUES) {
      throw new Error('Rich document exceeds the media reference traversal limit');
    }
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...[...value].reverse());
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const node = value as Record<string, unknown>;
    if (node.type === 'image') {
      const publicUrl = stringValue(node.src);
      if (publicUrl) {
        references.push({
          publicUrl,
          nodeType: 'image',
          alt: stringValue(node.altText),
        });
      }
    } else if (node.type === 'gallery' && Array.isArray(node.images)) {
      for (const image of node.images) {
        if (typeof image !== 'object' || image === null) continue;
        const record = image as Record<string, unknown>;
        const publicUrl = stringValue(record.src);
        if (publicUrl) {
          references.push({
            publicUrl,
            nodeType: 'gallery',
            alt: stringValue(record.alt),
          });
        }
      }
    } else if (node.type === 'video') {
      const publicUrl = stringValue(node.src);
      if (publicUrl) references.push({ publicUrl, nodeType: 'video' });
      const poster = stringValue(node.poster);
      if (poster) {
        references.push({ publicUrl: poster, nodeType: 'video-poster' });
      }
    }
    pending.push(...Object.values(node));
  }
  return references;
}
