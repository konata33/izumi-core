import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

import {
  applyTextScopedProposal,
  buildDraftInput,
  canApplySaveResult,
  createTextScopedProposal,
  documentBeforeExtensionRemount,
  inspectTextScopedProposal,
  reconcileAutosaveResponse,
  shouldBlockEditorNavigation,
  shouldScheduleAutosave,
} from '../src/lib/editor-state.ts';
import { previewRequirementsForDocument } from '../src/components/rich-post-preview-groups.ts';
import { normalizeAiRunEvent, ServerSentEventParser } from '../src/lib/sse.ts';

assert.deepEqual(
  previewRequirementsForDocument({
    root: {
      children: [
        { postId: 'post-a', type: 'post-reference' },
        {
          content: {
            root: {
              children: [
                { postId: 'post-b', type: 'post-reference' },
                { postId: 'post-a', type: 'post-reference' },
              ],
              type: 'root',
            },
          },
          type: 'nested-doc',
        },
      ],
      type: 'root',
    },
  }).postReferenceIds,
  ['post-a', 'post-b'],
  'publish preview must resolve nested post references once per target',
);

const parser = new ServerSentEventParser();
const chunks = [
  'event: meta\ndata: {"run',
  'Id":"run-1"}\n\nevent: delta\ndata: {"text":"静',
  '默"}\n\nevent: delta\ndata: {"text":"编辑部"}\n\nevent: done\n',
  'data: {"runId":"run-1","messageId":"message-1"}\n\n',
];
const events = chunks
  .flatMap((chunk) => parser.push(chunk))
  .map(normalizeAiRunEvent)
  .filter(Boolean);
assert.deepEqual(events, [
  { type: 'meta', runId: 'run-1' },
  { type: 'delta', delta: '静默' },
  { type: 'delta', delta: '编辑部' },
  { type: 'done', runId: 'run-1', messageId: 'message-1' },
]);

const errorParser = new ServerSentEventParser();
const [errorFrame] = errorParser.push(
  'event: error\ndata: {"code":"AI_RUN_FAILED","message":"stream failed"}\n\n',
);
assert.deepEqual(normalizeAiRunEvent(errorFrame), {
  type: 'error',
  message: 'stream failed',
});

const submitted = JSON.stringify({ title: 'A', content: 'first' });
const latest = { title: 'A', content: 'typed while saving' };
const stale = reconcileAutosaveResponse({
  current: latest,
  currentSnapshot: JSON.stringify(latest),
  response: { title: 'A', content: 'first' },
  responseSnapshot: submitted,
  submittedSnapshot: submitted,
});
assert.equal(stale.stale, true);
assert.equal(stale.current, latest);
assert.equal(stale.savedSnapshot, submitted);

const normalizedResponse = { title: 'A', slug: 'a', content: 'first' };
const current = { title: 'A', content: 'first' };
const settled = reconcileAutosaveResponse({
  current,
  currentSnapshot: submitted,
  response: normalizedResponse,
  responseSnapshot: JSON.stringify(normalizedResponse),
  submittedSnapshot: submitted,
});
assert.equal(settled.stale, false);
assert.equal(settled.current, normalizedResponse);

const bodyFirstDocument = {
  root: {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', text: '先写正文', version: 1 }],
        version: 1,
      },
    ],
    version: 1,
  },
};
const bodyFirstDraft = buildDraftInput({
  title: ' \n ',
  slug: '',
  document: bodyFirstDocument,
  excerpt: '',
  section: '',
  tagsText: '写作, 写作, 草稿',
});
assert.equal(Object.hasOwn(bodyFirstDraft, 'title'), false);
assert.equal(JSON.stringify(bodyFirstDraft).includes('"title"'), false);
assert.equal(bodyFirstDraft.document, bodyFirstDocument);
assert.deepEqual(bodyFirstDraft.tags, ['写作', '草稿']);

async function verifyTerminalFailure(failure, recovery) {
  let state = 'idle';
  let requests = 0;
  const timers = [];
  const schedule = () => {
    if (
      shouldScheduleAutosave({
        dirty: true,
        loading: false,
        meaningful: true,
        isNew: false,
        state,
      })
    ) {
      state = 'waiting';
      timers.push(async () => {
        state = 'saving';
        requests += 1;
        state = 'failed';
      });
    }
  };

  schedule();
  await timers.shift()();
  schedule();
  assert.equal(requests, 1, `${failure} failure must not loop`);
  assert.equal(timers.length, 0, `${failure} failure must stay terminal`);

  if (recovery === 'explicit retry') {
    state = 'saving';
    requests += 1;
    state = 'failed';
  } else {
    state = 'idle';
    schedule();
    await timers.shift()();
  }
  assert.equal(
    requests,
    2,
    `${failure} permits exactly one ${recovery} retry decision`,
  );
}

await verifyTerminalFailure('400', 'explicit retry');
await verifyTerminalFailure('500', 'owner edit');
await verifyTerminalFailure('offline', 'online');

assert.equal(
  shouldBlockEditorNavigation({
    currentSnapshot: 'typed during request',
    savedSnapshot: 'persisted before request',
    nextPath: '/posts',
  }),
  true,
);
assert.equal(
  shouldBlockEditorNavigation({
    currentSnapshot: 'typed during request',
    savedSnapshot: 'persisted before request',
    nextPath: '/posts/post-created',
    pendingCreatedId: 'post-created',
  }),
  false,
);
assert.equal(
  canApplySaveResult({
    active: true,
    aborted: false,
    operation: 3,
    latestOperation: 3,
  }),
  true,
);
for (const lateResult of [
  { active: false, aborted: false, operation: 3, latestOperation: 3 },
  { active: true, aborted: true, operation: 3, latestOperation: 3 },
  { active: true, aborted: false, operation: 2, latestOperation: 3 },
]) {
  assert.equal(canApplySaveResult(lateResult), false);
}
assert.equal(
  shouldScheduleAutosave({
    dirty: true,
    loading: false,
    meaningful: true,
    isNew: false,
    state: stale.stale ? 'waiting' : 'saved',
  }),
  true,
  'a stale response queues the follow-up save',
);

const richDocument = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            type: 'text',
            text: '安静的开头。',
            format: 1,
            style: '',
            version: 1,
          },
        ],
      },
      {
        type: 'image',
        version: 1,
        src: 'https://media.example.test/image.webp',
        altText: '写作桌',
      },
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', text: '保留的结尾。', version: 1 }],
      },
    ],
  },
};
const textProposal = createTextScopedProposal(
  richDocument,
  '```json\n{"before":"安静的开头","after":"更清楚的开头"}\n```',
);
assert.equal(textProposal.ok, true);
assert.equal(textProposal.document.root.children[1].type, 'image');
assert.equal(
  textProposal.document.root.children[0].children[0].format,
  richDocument.root.children[0].children[0].format,
);

const inspection = inspectTextScopedProposal(richDocument, textProposal.document);
assert.equal(inspection.safe, true);
assert.equal(inspection.addedNodes, 0);
assert.equal(inspection.removedNodes, 0);

const currentWithNewerEdit = JSON.parse(JSON.stringify(richDocument));
currentWithNewerEdit.root.children[2].children[0].text = '刚刚补写的结尾。';
const applied = applyTextScopedProposal(
  currentWithNewerEdit,
  richDocument,
  textProposal.document,
);
assert.equal(applied.ok, true);
assert.equal(
  applied.document.root.children[2].children[0].text,
  '刚刚补写的结尾。',
  'applying a proposal preserves newer edits outside its text range',
);
assert.equal(applied.document.root.children[1].type, 'image');
const currentWithEditedTarget = JSON.parse(JSON.stringify(richDocument));
currentWithEditedTarget.root.children[0].children[0].text = '作者刚改过的开头。';
assert.equal(
  applyTextScopedProposal(currentWithEditedTarget, richDocument, textProposal.document)
    .ok,
  false,
);

const flattenedDocument = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [{ type: 'text', text: '整篇纯文本', version: 1 }],
      },
    ],
  },
};
const destructiveInspection = inspectTextScopedProposal(
  richDocument,
  flattenedDocument,
);
assert.equal(destructiveInspection.safe, false);
assert.equal(destructiveInspection.removedNodes > 0, true);
assert.equal(
  applyTextScopedProposal(currentWithNewerEdit, richDocument, flattenedDocument).ok,
  false,
);
assert.equal(
  createTextScopedProposal(richDocument, '{"before":"不存在","after":"替换"}').ok,
  false,
);
assert.equal(
  createTextScopedProposal(
    {
      root: {
        type: 'root',
        children: [{ type: 'text', text: 'aaaa', version: 1 }],
        version: 1,
      },
    },
    '{"before":"aa","after":"b"}',
  ).ok,
  false,
);

const debouncedDocument = {
  root: { children: [], type: 'root', version: 1 },
};
const liveDocumentBeforeDebounce = {
  root: {
    children: [
      {
        children: [{ text: '刚刚输入', type: 'text', version: 1 }],
        type: 'paragraph',
        version: 1,
      },
    ],
    type: 'root',
    version: 1,
  },
};
assert.equal(
  documentBeforeExtensionRemount(debouncedDocument, liveDocumentBeforeDebounce),
  liveDocumentBeforeDebounce,
  'the first advanced-group remount must use the synchronous editor snapshot',
);

const coreSource = await readFile(
  new URL('../src/lib/core.ts', import.meta.url),
  'utf8',
);
for (const contractMarker of [
  'asset.publicUrl',
  'profile.apiKeyMasked',
  "profile.source === 'environment'",
  'ownerVoidRequest',
  'new ServerSentEventParser()',
  'new FormData()',
  "body.append('file', file)",
  "'/media/uploads'",
  "method: 'POST'",
  "'/posts/references/resolve'",
  '/api/v1/public/posts/',
]) {
  assert.ok(
    coreSource.includes(contractMarker),
    `missing client mapping: ${contractMarker}`,
  );
}

const previewSource = await readFile(
  new URL('../src/components/rich-post-preview.tsx', import.meta.url),
  'utf8',
);
const referenceSource = await readFile(
  new URL('../src/components/post-reference-static-node.tsx', import.meta.url),
  'utf8',
);
for (const marker of [
  'resolvePostReferences',
  'PostReferenceProvider',
  'referenceQuery.isError',
]) {
  assert.ok(
    previewSource.includes(marker),
    `missing preview reference state: ${marker}`,
  );
}
for (const marker of [
  '打开已发布文章',
  '目标文章未发布或已下线',
  'reference.title',
  'reference.slug',
]) {
  assert.ok(
    referenceSource.includes(marker),
    `missing resolved reference UI: ${marker}`,
  );
}
assert.equal(
  referenceSource.includes('发布时解析标题与链接'),
  false,
  'publish preview must not expose unresolved reference placeholders',
);
assert.equal(
  [
    'initiated.requiredHeaders',
    'initiated.uploadFields',
    'uploadUrl',
    '/finalize',
  ].some((marker) => coreSource.includes(marker)),
  false,
  'media upload must flow through Core without direct-upload or finalize contracts',
);

const editorSource = await readFile(
  new URL('../src/views/editor-view.tsx', import.meta.url),
  'utf8',
);
for (const safetyMarker of [
  'shouldBlockEditorNavigation',
  'controller.signal',
  "saveState !== 'failed'",
  'createTextScopedProposal',
  'disabled={deciding || !proposalInspection?.safe}',
]) {
  assert.ok(
    editorSource.includes(safetyMarker),
    `missing editor safety: ${safetyMarker}`,
  );
}

const richEditorSource = await readFile(
  new URL('../src/components/rich-post-editor.tsx', import.meta.url),
  'utf8',
);
const initialAdvancedEnable = richEditorSource.slice(
  richEditorSource.indexOf('onEnableAdvanced={() => {'),
);
assert.ok(
  initialAdvancedEnable.indexOf('editorRef.current?.getDocument()') !== -1 &&
    initialAdvancedEnable.indexOf('editorRef.current?.getDocument()') <
      initialAdvancedEnable.indexOf("setGroups(new Set(['light']))"),
  'the live document snapshot must be captured before enabling the first group',
);

process.stdout.write(
  'Core client contracts passed: SSE, DTO mappings, terminal autosave, navigation safety, live editor remounts, and text-scoped AI proposals.\n',
);
