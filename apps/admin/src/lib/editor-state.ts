export type AutosaveReconciliation<T> =
  | {
      current: T;
      savedSnapshot: string;
      stale: false;
    }
  | {
      current: T;
      savedSnapshot: string;
      stale: true;
    };

export function reconcileAutosaveResponse<T>({
  current,
  currentSnapshot,
  response,
  responseSnapshot,
  submittedSnapshot,
}: {
  current: T;
  currentSnapshot: string;
  response: T;
  responseSnapshot: string;
  submittedSnapshot: string;
}): AutosaveReconciliation<T> {
  if (currentSnapshot === submittedSnapshot) {
    return {
      current: response,
      savedSnapshot: responseSnapshot,
      stale: false,
    };
  }
  return {
    current,
    savedSnapshot: submittedSnapshot,
    stale: true,
  };
}

export type DraftFormSource<TDocument> = {
  title: string;
  slug: string;
  document: TDocument;
  excerpt: string;
  section: string;
  tagsText: string;
};

export function buildDraftInput<TDocument>(source: DraftFormSource<TDocument>) {
  const title = source.title.replace(/\r\n?|\n/gu, ' ').trim();
  const tags = new Map<string, string>();
  for (const candidate of source.tagsText.split(',')) {
    const tag = candidate.trim();
    if (tag && !tags.has(tag.toLocaleLowerCase())) {
      tags.set(tag.toLocaleLowerCase(), tag);
    }
  }
  return {
    ...(title ? { title } : {}),
    ...(source.slug.trim() ? { slug: source.slug.trim() } : {}),
    document: source.document,
    excerpt: source.excerpt.trim(),
    section: source.section.trim(),
    tags: [...tags.values()],
  };
}

export type AutosaveState =
  'idle' | 'waiting' | 'saving' | 'saved' | 'failed' | 'conflict';

export function shouldScheduleAutosave({
  dirty,
  loading,
  meaningful,
  isNew,
  state,
}: {
  dirty: boolean;
  loading: boolean;
  meaningful: boolean;
  isNew: boolean;
  state: AutosaveState;
}) {
  return (
    dirty &&
    !loading &&
    state !== 'saving' &&
    state !== 'failed' &&
    state !== 'conflict' &&
    (!isNew || meaningful)
  );
}

export function shouldBlockEditorNavigation({
  currentSnapshot,
  savedSnapshot,
  nextPath,
  pendingCreatedId,
}: {
  currentSnapshot: string;
  savedSnapshot: string;
  nextPath: string;
  pendingCreatedId?: string;
}) {
  if (currentSnapshot === savedSnapshot) return false;
  return (
    !pendingCreatedId || nextPath !== `/posts/${encodeURIComponent(pendingCreatedId)}`
  );
}

export function canApplySaveResult({
  active,
  aborted,
  operation,
  latestOperation,
}: {
  active: boolean;
  aborted: boolean;
  operation: number;
  latestOperation: number;
}) {
  return active && !aborted && operation === latestOperation;
}

export function documentBeforeExtensionRemount<T>(
  latestDocument: T,
  liveDocument: T | null,
): T {
  return liveDocument ?? latestDocument;
}

type JsonRecord = Record<string, unknown>;
type TextPath = Array<string | number>;

export type TextProposalInspection =
  | {
      safe: true;
      beforeText: string;
      afterText: string;
      path: TextPath;
      addedNodes: 0;
      removedNodes: 0;
      preservedNodes: number;
    }
  | {
      safe: false;
      reason: string;
      addedNodes: number;
      removedNodes: number;
      preservedNodes: number;
    };

type TextProposalResult<TDocument> =
  | {
      ok: true;
      document: TDocument;
      beforeText: string;
      afterText: string;
    }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function countNodeTypes(
  value: unknown,
  counts = new Map<string, number>(),
): Map<string, number> {
  if (Array.isArray(value)) {
    for (const child of value) countNodeTypes(child, counts);
    return counts;
  }
  if (!isRecord(value)) return counts;
  if (typeof value.type === 'string' && typeof value.version === 'number') {
    counts.set(value.type, (counts.get(value.type) ?? 0) + 1);
  }
  for (const child of Object.values(value)) countNodeTypes(child, counts);
  return counts;
}

function nodeCount(counts: Map<string, number>) {
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

function nodeDelta(from: Map<string, number>, to: Map<string, number>) {
  return [...to].reduce(
    (total, [type, count]) => total + Math.max(0, count - (from.get(type) ?? 0)),
    0,
  );
}

function countTextOccurrences(value: unknown, target: string): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (total, child) => total + countTextOccurrences(child, target),
      0,
    );
  }
  if (!isRecord(value)) return 0;
  let count = 0;
  if (value.type === 'text' && typeof value.text === 'string') {
    let offset = 0;
    while ((offset = value.text.indexOf(target, offset)) !== -1) {
      count += 1;
      offset += 1;
    }
  }
  return (
    count +
    Object.values(value).reduce(
      (total: number, child) => total + countTextOccurrences(child, target),
      0,
    )
  );
}

function replaceText(value: unknown, before: string, after: string): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => replaceText(child, before, after));
  }
  if (!isRecord(value)) return false;
  if (
    value.type === 'text' &&
    typeof value.text === 'string' &&
    value.text.includes(before)
  ) {
    const index = value.text.indexOf(before);
    value.text = `${value.text.slice(0, index)}${after}${value.text.slice(index + before.length)}`;
    return true;
  }
  return Object.values(value).some((child) => replaceText(child, before, after));
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
}

export function createTextScopedProposal<TDocument>(
  document: TDocument,
  rawResponse: string,
): TextProposalResult<TDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawResponse));
  } catch {
    return { ok: false, reason: 'AI 返回的内容不是可验证的文本修改。' };
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.before !== 'string' ||
    typeof parsed.after !== 'string'
  ) {
    return { ok: false, reason: 'AI 返回的修改缺少 before 或 after 文本。' };
  }
  if (!parsed.before.trim() || parsed.before === parsed.after) {
    return { ok: false, reason: 'AI 没有提供可应用的文本变化。' };
  }
  if (countTextOccurrences(document, parsed.before) !== 1) {
    return {
      ok: false,
      reason: 'AI 选择的原文无法唯一定位，请缩小修改范围后重试。',
    };
  }
  const next = jsonClone(document);
  replaceText(next, parsed.before, parsed.after);
  return {
    ok: true,
    document: next,
    beforeText: parsed.before,
    afterText: parsed.after,
  };
}

function compareTextOnly(
  before: unknown,
  after: unknown,
  path: TextPath,
  changes: Array<{ beforeText: string; afterText: string; path: TextPath }>,
): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (
      !Array.isArray(before) ||
      !Array.isArray(after) ||
      before.length !== after.length
    )
      return false;
    return before.every((value, index) =>
      compareTextOnly(value, after[index], [...path, index], changes),
    );
  }
  if (!isRecord(before) || !isRecord(after)) return false;
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  if (
    beforeKeys.length !== afterKeys.length ||
    beforeKeys.some((key) => !Object.hasOwn(after, key))
  ) {
    return false;
  }
  return beforeKeys.every((key) => {
    if (
      key === 'text' &&
      before.type === 'text' &&
      after.type === 'text' &&
      typeof before.text === 'string' &&
      typeof after.text === 'string'
    ) {
      changes.push({
        beforeText: before.text,
        afterText: after.text,
        path: [...path, key],
      });
      return true;
    }
    return compareTextOnly(before[key], after[key], [...path, key], changes);
  });
}

export function inspectTextScopedProposal(
  before: unknown,
  after: unknown,
): TextProposalInspection {
  const beforeNodeTypes = countNodeTypes(before);
  const afterNodeTypes = countNodeTypes(after);
  const beforeNodes = nodeCount(beforeNodeTypes);
  const changes: Array<{
    beforeText: string;
    afterText: string;
    path: TextPath;
  }> = [];
  const structureMatches = compareTextOnly(before, after, [], changes);
  const changedText = changes.filter(
    (change) => change.beforeText !== change.afterText,
  );
  const addedNodes = nodeDelta(beforeNodeTypes, afterNodeTypes);
  const removedNodes = nodeDelta(afterNodeTypes, beforeNodeTypes);
  if (!structureMatches || changedText.length !== 1) {
    return {
      safe: false,
      reason: '该提议会改变正文结构或多个文本范围，已阻止应用以保护图片、嵌入和格式。',
      addedNodes,
      removedNodes,
      preservedNodes: Math.max(0, beforeNodes - removedNodes),
    };
  }
  return {
    safe: true,
    ...changedText[0],
    addedNodes: 0,
    removedNodes: 0,
    preservedNodes: beforeNodes,
  };
}

function valueAtPath(value: unknown, path: TextPath): unknown {
  let current = value;
  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[part];
    } else {
      if (!isRecord(current)) return undefined;
      current = current[part];
    }
  }
  return current;
}

function setValueAtPath(value: unknown, path: TextPath, next: string): boolean {
  const parent = valueAtPath(value, path.slice(0, -1));
  const key = path.at(-1);
  if (!isRecord(parent) || typeof key !== 'string') return false;
  parent[key] = next;
  return true;
}

export function applyTextScopedProposal<TDocument>(
  current: TDocument,
  before: unknown,
  after: unknown,
): TextProposalResult<TDocument> {
  const inspection = inspectTextScopedProposal(before, after);
  if (!inspection.safe) return { ok: false, reason: inspection.reason };
  if (valueAtPath(current, inspection.path) !== inspection.beforeText) {
    return {
      ok: false,
      reason: '对应正文在审阅期间已经变化，请重新生成修改。',
    };
  }
  const next = jsonClone(current);
  if (!setValueAtPath(next, inspection.path, inspection.afterText)) {
    return { ok: false, reason: '无法定位 AI 建议对应的正文。' };
  }
  return {
    ok: true,
    document: next,
    beforeText: inspection.beforeText,
    afterText: inspection.afterText,
  };
}
