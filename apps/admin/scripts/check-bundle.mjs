import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(resolve(root, 'dist/.vite/manifest.json'), 'utf8'),
);
const entries = Object.entries(manifest);
const mainEntry = entries.find(([, chunk]) => chunk.isEntry);
const main = mainEntry?.[1];
const editorViewEntry = entries.find(([, chunk]) => chunk.name === 'editor-view');
const editorView = editorViewEntry?.[1];
const richEditorEntry = entries.find(([, chunk]) => chunk.name === 'rich-post-editor');
const richEditor = richEditorEntry?.[1];
const advancedLoader = manifest['src/components/rich-post-editor-advanced.tsx'];
const previewEntry = entries.find(([, chunk]) => chunk.name === 'rich-post-preview');
const preview = previewEntry?.[1];
const groupNames = [
  'haklex-light',
  'haklex-code',
  'haklex-excalidraw',
  'haklex-ai-chat',
];
const groupEntries = new Map(
  groupNames.map((name) => [name, entries.find(([, chunk]) => chunk.name === name)]),
);
const previewGroupNames = [
  'haklex-preview-light',
  'haklex-preview-code',
  'haklex-preview-diagram',
  'haklex-preview-excalidraw',
  'haklex-preview-ai-chat',
];
const previewGroupEntries = new Map(
  previewGroupNames.map((name) => [
    name,
    entries.find(([, chunk]) => chunk.name === name),
  ]),
);

if (
  !main ||
  !editorView ||
  !editorViewEntry ||
  !richEditor ||
  !richEditorEntry ||
  !advancedLoader ||
  !preview ||
  !previewEntry ||
  [...groupEntries.values()].some((entry) => !entry) ||
  [...previewGroupEntries.values()].some((entry) => !entry)
) {
  throw new Error(
    'Vite manifest is missing the main, editor, loader, or extension-group boundary',
  );
}
if (!editorView.isDynamicEntry || !richEditor.isDynamicEntry) {
  throw new Error('Editor route and rich editor must remain dynamic entries');
}
if (!preview.isDynamicEntry) {
  throw new Error('Publication preview must remain a dynamic editor-only entry');
}
if (!advancedLoader.isDynamicEntry) {
  throw new Error('Advanced extension loader must remain a dynamic entry');
}

function collectStaticImports(startKey) {
  const files = new Set();
  const keys = new Set();
  const pending = [startKey];
  while (pending.length) {
    const key = pending.pop();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    const chunk = manifest[key];
    if (!chunk) continue;
    files.add(chunk.file);
    pending.push(...(chunk.imports ?? []));
  }
  return { files, keys };
}

const eager = collectStaticImports(mainEntry[0]);
const previewBase = collectStaticImports(previewEntry[0]);
const eagerSource = (
  await Promise.all(
    [...eager.files]
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFile(resolve(root, 'dist', file), 'utf8')),
  )
).join('\n');

for (const forbidden of [
  'Excalidraw',
  'createHighlighterCore',
  'rich-ext-excalidraw',
]) {
  if (eagerSource.includes(forbidden)) {
    throw new Error(`${forbidden} leaked into the non-editor eager bundle`);
  }
}

const editorOnlyFiles = new Set([
  editorView.file,
  richEditor.file,
  advancedLoader.file,
  preview.file,
  ...[...groupEntries.values()].map((entry) => entry[1].file),
  ...[...previewGroupEntries.values()].map((entry) => entry[1].file),
]);
for (const file of editorOnlyFiles) {
  if (eager.files.has(file)) {
    throw new Error(`${file} leaked into the non-editor eager graph`);
  }
}

const groupFiles = new Map(
  [...groupEntries].map(([name, entry]) => [name, entry[1].file]),
);
for (const [name, file] of groupFiles) {
  if (previewBase.files.has(file)) {
    throw new Error(`${name} leaked into the base publication preview graph`);
  }
}
for (const [name, entry] of groupEntries) {
  const graph = collectStaticImports(entry[0]);
  if (eager.files.has(entry[1].file)) {
    throw new Error(`${name} leaked into the eager application graph`);
  }
  for (const [otherName, otherFile] of groupFiles) {
    if (name !== otherName && graph.files.has(otherFile)) {
      throw new Error(`${name} statically imports the ${otherName} group`);
    }
  }
}

const previewGroupFiles = new Map(
  [...previewGroupEntries].map(([name, entry]) => [name, entry[1].file]),
);
const allowedEditorGroupByPreviewGroup = new Map([
  ['haklex-preview-ai-chat', 'haklex-ai-chat'],
  ['haklex-preview-code', 'haklex-code'],
  ['haklex-preview-excalidraw', 'haklex-excalidraw'],
  ['haklex-preview-light', 'haklex-light'],
]);
for (const [name, entry] of previewGroupEntries) {
  const graph = collectStaticImports(entry[0]);
  if (previewBase.files.has(entry[1].file)) {
    throw new Error(`${name} leaked into the base publication preview graph`);
  }
  for (const [otherName, otherFile] of previewGroupFiles) {
    if (name !== otherName && graph.files.has(otherFile)) {
      throw new Error(`${name} statically imports the ${otherName} preview group`);
    }
  }
  for (const [editorGroupName, editorGroupFile] of groupFiles) {
    if (
      editorGroupName !== allowedEditorGroupByPreviewGroup.get(name) &&
      graph.files.has(editorGroupFile)
    ) {
      throw new Error(`${name} statically imports the ${editorGroupName} group`);
    }
  }
}

const sizes = await Promise.all(
  [...groupFiles].map(async ([name, file]) => [
    name,
    Math.round((await stat(resolve(root, 'dist', file))).size / 1024),
  ]),
);
const previewSizes = await Promise.all(
  [...previewGroupFiles].map(async ([name, file]) => [
    name,
    Math.round((await stat(resolve(root, 'dist', file))).size / 1024),
  ]),
);

process.stdout.write(
  `Bundle contract passed: ${eager.files.size} eager files; independent groups ${sizes
    .map(([name, kib]) => `${name} ${kib} KiB`)
    .join(', ')}; preview groups ${previewSizes
    .map(([name, kib]) => `${name} ${kib} KiB`)
    .join(', ')}.\n`,
);
