import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

import { chatEditNodes } from '@haklex/rich-ext-chat/edit';
import { codeSnippetEditNodes } from '@haklex/rich-ext-code-snippet/edit';
import { embedEditNodes } from '@haklex/rich-ext-embed';
import { ExcalidrawEditNode } from '@haklex/rich-ext-excalidraw';
import { galleryEditNodes } from '@haklex/rich-ext-gallery/edit';
import { nestedDocEditNodes } from '@haklex/rich-ext-nested-doc';
import { composeRenderer } from '@haklex/rich-compose';
import { alertModule } from '@haklex/rich-compose/modules/alert';
import { bannerModule } from '@haklex/rich-compose/modules/banner';
import { chatModule } from '@haklex/rich-compose/modules/chat';
import { codeBlockModule } from '@haklex/rich-compose/modules/code-block';
import { codeSnippetModule } from '@haklex/rich-compose/modules/code-snippet';
import { embedModule } from '@haklex/rich-compose/modules/embed';
import { excalidrawModule } from '@haklex/rich-compose/modules/excalidraw';
import { galleryModule } from '@haklex/rich-compose/modules/gallery';
import { imageModule } from '@haklex/rich-compose/modules/image';
import { linkCardModule } from '@haklex/rich-compose/modules/link-card';
import { mentionModule } from '@haklex/rich-compose/modules/mention';
import { mermaidModule } from '@haklex/rich-compose/modules/mermaid';
import { nestedDocModule } from '@haklex/rich-compose/modules/nested-doc';
import { rubyModule } from '@haklex/rich-compose/modules/ruby';
import { videoModule } from '@haklex/rich-compose/modules/video';
import { allNodes } from '@haklex/rich-editor/nodes';
import { createEditor } from 'lexical';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { richNodeLifecycleFixtures } from '../../api/test/fixtures/rich-node-lifecycle.mjs';
import { PostReferenceNode } from '../src/components/post-reference-node.tsx';
import {
  PostReferenceProvider,
  PostReferenceStaticNode,
  ResolvedPostReferenceView,
} from '../src/components/post-reference-static-node.tsx';
import {
  richPostBuiltinNodeOverrides,
  richPostCompatibilityModule,
  richPostCompatibilityNodes,
} from '../src/components/rich-post-compatibility.ts';
import { previewRequirementsForDocument } from '../src/components/rich-post-preview-groups.ts';

const advancedNodes = [
  ...chatEditNodes,
  ...codeSnippetEditNodes,
  ...embedEditNodes,
  ExcalidrawEditNode,
  ...galleryEditNodes,
  ...nestedDocEditNodes,
  PostReferenceNode,
];
const nodeTypes = new Set(
  [...allNodes, ...richPostCompatibilityNodes, ...advancedNodes]
    .map((entry) => ('replace' in entry ? entry.replace : entry).getType?.())
    .filter(Boolean),
);

for (const type of [
  'alert-quote',
  'banner',
  'chat',
  'code-block',
  'code-highlight',
  'code-snippet',
  'embed',
  'excalidraw',
  'gallery',
  'image',
  'link-card',
  'mention',
  'mark',
  'mermaid',
  'nested-doc',
  'post-reference',
  'ruby',
  'video',
]) {
  assert(nodeTypes.has(type), `Haklex editor registry is missing ${type}`);
}

for (const type of ['agent-diff', 'dynamic', 'poll']) {
  assert(!nodeTypes.has(type), `prohibited editor node registered: ${type}`);
}

const previewSource = readFileSync(
  new URL('../src/components/rich-post-preview.tsx', import.meta.url),
  'utf8',
);
for (const moduleName of [
  'alertModule',
  'bannerModule',
  'imageModule',
  'linkCardModule',
  'mentionModule',
  'rubyModule',
  'videoModule',
  'PostReferenceStaticNode',
  'richPostCompatibilityModule',
  'richPostBuiltinNodeOverrides',
]) {
  assert.match(
    previewSource,
    new RegExp(`\\b${moduleName}\\b`),
    `static preview registry is missing ${moduleName}`,
  );
}
for (const forbiddenStaticModule of [
  'chatModule',
  'codeBlockModule',
  'codeSnippetModule',
  'embedModule',
  'excalidrawModule',
  'galleryModule',
  'mermaidModule',
  'nestedDocModule',
]) {
  assert.doesNotMatch(
    previewSource,
    new RegExp(`import[^;]+\\b${forbiddenStaticModule}\\b`),
    `base preview statically imports ${forbiddenStaticModule}`,
  );
}
for (const group of ['ai', 'canvas', 'code', 'diagram', 'light']) {
  assert.match(
    previewSource,
    new RegExp(`rich-post-preview-extension-${group}`),
    `preview is missing the ${group} dynamic renderer boundary`,
  );
}

const groupedPreviewDocument = {
  root: {
    children: [
      { type: 'chat', version: 1 },
      { type: 'code-snippet', version: 1 },
      { type: 'excalidraw', version: 1 },
      { type: 'mermaid', version: 1 },
      {
        content: {
          root: {
            children: [{ type: 'embed', version: 1 }],
            type: 'root',
            version: 1,
          },
        },
        type: 'nested-doc',
        version: 1,
      },
    ],
    type: 'root',
    version: 1,
  },
};
assert.deepEqual(previewRequirementsForDocument(groupedPreviewDocument), {
  groups: ['ai', 'canvas', 'code', 'diagram', 'light'],
  postReferenceIds: [],
  unsupportedNodeTypes: [],
});
assert.deepEqual(
  previewRequirementsForDocument({
    root: {
      children: [{ type: 'future-node', version: 1 }],
      type: 'root',
      version: 1,
    },
  }).unsupportedNodeTypes,
  ['future-node'],
  'unknown nodes must be rejected before the Lexical preview parses them',
);

const LifecycleRenderer = composeRenderer({
  builtinNodeOverrides: richPostBuiltinNodeOverrides,
  modules: [
    alertModule,
    bannerModule,
    chatModule,
    codeBlockModule,
    codeSnippetModule,
    embedModule,
    excalidrawModule,
    galleryModule,
    imageModule,
    linkCardModule,
    mentionModule,
    mermaidModule,
    nestedDocModule,
    rubyModule,
    videoModule,
    richPostCompatibilityModule,
    { name: 'izumi-post-reference', nodes: [PostReferenceStaticNode] },
  ],
});
const resolvedReferenceMarkup = renderToStaticMarkup(
  createElement(
    PostReferenceProvider,
    {
      references: new Map([
        [
          'post-live',
          {
            href: 'https://core.example.test/api/v1/public/posts/live-title',
            slug: 'live-title',
            title: '已发布标题',
          },
        ],
      ]),
    },
    createElement(ResolvedPostReferenceView, { postId: 'post-live' }),
  ),
);
assert.match(resolvedReferenceMarkup, />已发布标题</);
assert.match(resolvedReferenceMarkup, /\/live-title · 公开快照/);
assert.match(
  resolvedReferenceMarkup,
  /href="https:\/\/core\.example\.test\/api\/v1\/public\/posts\/live-title"/,
);
assert.doesNotMatch(resolvedReferenceMarkup, /post-live/);

const unavailableReferenceMarkup = renderToStaticMarkup(
  createElement(
    PostReferenceProvider,
    { references: new Map() },
    createElement(ResolvedPostReferenceView, { postId: 'private-post-id' }),
  ),
);
assert.match(unavailableReferenceMarkup, /引用不可用/);
assert.match(unavailableReferenceMarkup, /目标文章未发布或已下线/);
assert.doesNotMatch(unavailableReferenceMarkup, /private-post-id/);

const lifecycleEditor = createEditor({
  namespace: 'izumi-rich-lifecycle',
  nodes: [...allNodes, ...richPostCompatibilityNodes, ...advancedNodes],
  onError(error) {
    throw error;
  },
});
const clientDecoratorModules = new Map([
  ['chat', chatModule],
  ['code-snippet', codeSnippetModule],
]);
const staticCapabilities = new Set();

function assertSerializedSubset(expected, actual, path = 'document') {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), `${path} stopped being an array`);
    assert.equal(actual.length, expected.length, `${path} changed length`);
    expected.forEach((value, index) =>
      assertSerializedSubset(value, actual[index], `${path}[${index}]`),
    );
    return;
  }
  if (expected && typeof expected === 'object') {
    assert(actual && typeof actual === 'object', `${path} stopped being an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertSerializedSubset(value, actual[key], `${path}.${key}`);
    }
    return;
  }
  if (path.endsWith('.type') && expected === 'quote') {
    assert.equal(
      actual,
      'rich-quote',
      `${path} did not use the registered quote upgrade`,
    );
    return;
  }
  assert.equal(actual, expected, `${path} changed during editor serialization`);
}

for (const fixture of richNodeLifecycleFixtures) {
  staticCapabilities.add(fixture.static);
  const serialized = lifecycleEditor
    .parseEditorState(JSON.stringify(fixture.document))
    .toJSON();
  const reloaded = lifecycleEditor
    .parseEditorState(JSON.stringify(serialized))
    .toJSON();
  const serializedJson = JSON.stringify(serialized);
  const serializedToken = fixture.serializedToken ?? fixture.token;
  const editorType =
    fixture.editor === 'normalize-rich-quote' ? 'rich-quote' : fixture.type;

  try {
    assertSerializedSubset(fixture.document, serialized);
  } catch (error) {
    throw new Error(`${fixture.type}: ${error.message}`, { cause: error });
  }
  assert.deepEqual(
    reloaded,
    serialized,
    `${fixture.type} changed after the second Lexical registry reload`,
  );
  assert(
    serializedJson.includes(`"type":"${editorType}"`),
    `${fixture.type} did not satisfy its edit-registry capability`,
  );
  assert(
    serializedJson.includes(serializedToken),
    `${fixture.type} lost its meaningful payload during editor serialization`,
  );

  const html = renderToStaticMarkup(
    createElement(LifecycleRenderer, {
      theme: 'dark',
      value: serialized,
      variant: 'article',
    }),
  );
  assert(html.trim(), `${fixture.type} produced empty static renderer markup`);
  if (fixture.static === 'client-decorator-shell') {
    const module = clientDecoratorModules.get(fixture.type);
    if (module) {
      assert(
        Object.keys(module.lazyRenderers ?? {}).length > 0,
        `${fixture.type} has no lazy client renderer behind its SSR shell`,
      );
    } else {
      assert.equal(
        fixture.type,
        'post-reference',
        `unclassified client decorator shell: ${fixture.type}`,
      );
    }
    assert.doesNotMatch(
      html,
      new RegExp(fixture.serializedToken ?? fixture.token),
      `${fixture.type} unexpectedly changed its documented SSR shell capability`,
    );
  } else {
    assert(
      html.includes(fixture.staticToken ?? fixture.token),
      `${fixture.type} did not satisfy its ${fixture.static} SSR capability`,
    );
  }
}
assert.deepEqual(
  staticCapabilities,
  new Set([
    'client-decoration',
    'client-decorator-shell',
    'content',
    'placeholder',
    'skeleton',
  ]),
);

const lightExtensionSource = readFileSync(
  new URL('../src/components/rich-post-extension-light.tsx', import.meta.url),
  'utf8',
);
assert.match(lightExtensionSource, /\bPostReferenceNode\b/);
assert.match(lightExtensionSource, /\bembedEditNodes\b/);
assert.match(lightExtensionSource, /\bgalleryEditNodes\b/);
assert.match(lightExtensionSource, /\bnestedDocEditNodes\b/);

const canonicalPublicUrl =
  'https://media.example.test/owners/owner-1/assets/asset-1/image.webp';
const document = {
  root: {
    children: [
      {
        altText: '安静的写作桌',
        height: 800,
        src: canonicalPublicUrl,
        thumbhash: '3OcRJYB4d3h/iIeHeEh3eIhw+j2A',
        type: 'image',
        version: 1,
        width: 1200,
      },
      {
        src: 'https://media.example.test/owners/owner-1/assets/video-1/film.webm',
        type: 'video',
        version: 1,
      },
      {
        source: 'youtube',
        type: 'embed',
        url: 'https://www.youtube.com/watch?v=quiet',
        version: 1,
      },
      {
        code: 'const answer = 42;',
        language: 'typescript',
        type: 'code-block',
        version: 1,
      },
      {
        diagram: 'graph TD; A-->B',
        type: 'mermaid',
        version: 1,
      },
      {
        images: [
          {
            alt: '安静的写作桌',
            src: canonicalPublicUrl,
          },
        ],
        layout: 'grid',
        type: 'gallery',
        version: 1,
      },
      {
        content: {
          root: {
            children: [
              {
                children: [
                  {
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: '嵌套正文',
                    type: 'text',
                    version: 1,
                  },
                ],
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
        },
        type: 'nested-doc',
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

const editor = createEditor({
  namespace: 'izumi-rich-contract',
  nodes: [...allNodes, ...richPostCompatibilityNodes, ...advancedNodes],
  onError(error) {
    throw error;
  },
});
const reloaded = editor.parseEditorState(JSON.stringify(document)).toJSON();
const image = reloaded.root.children[0];

assert.equal(image.type, 'image');
assert.equal(image.src, canonicalPublicUrl);
assert.equal(image.altText, '安静的写作桌');
assert.equal(image.width, 1200);
assert.equal(image.height, 800);
assert.equal(image.thumbhash, '3OcRJYB4d3h/iIeHeEh3eIhw+j2A');
const video = reloaded.root.children[1];
assert.equal(video.type, 'video');
assert.equal(
  video.src,
  'https://media.example.test/owners/owner-1/assets/video-1/film.webm',
);
assert.equal(
  JSON.parse(JSON.stringify(reloaded)).root.children[0].src,
  canonicalPublicUrl,
);
assert.equal(reloaded.root.children[2].type, 'embed');
assert.equal(reloaded.root.children[2].source, 'youtube');
assert.equal(reloaded.root.children[3].code, 'const answer = 42;');
assert.equal(reloaded.root.children[4].diagram, 'graph TD; A-->B');
assert.equal(reloaded.root.children[5].images[0].src, canonicalPublicUrl);
assert.equal(
  reloaded.root.children[6].content.root.children[0].children[0].text,
  '嵌套正文',
);

const compatibilityDocument = {
  root: {
    children: [
      {
        children: [
          {
            detail: 0,
            format: 0,
            highlightType: 'keyword',
            mode: 'normal',
            style: '',
            text: 'const',
            type: 'code-highlight',
            version: 1,
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        language: 'typescript',
        type: 'code',
        version: 1,
      },
      {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: '审阅标记',
                type: 'text',
                version: 1,
              },
            ],
            direction: null,
            format: '',
            ids: ['review-1'],
            indent: 0,
            type: 'mark',
            version: 1,
          },
        ],
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
const CompatibilityRenderer = composeRenderer({
  builtinNodeOverrides: richPostBuiltinNodeOverrides,
  modules: [richPostCompatibilityModule],
});
const compatibilityHtml = renderToStaticMarkup(
  createElement(CompatibilityRenderer, {
    theme: 'dark',
    value: compatibilityDocument,
  }),
);
assert.match(compatibilityHtml, />const</);
assert.match(compatibilityHtml, /<mark[^>]*>审阅标记<\/mark>/);

process.stdout.write(
  `Rich-content matrix passed: ${richNodeLifecycleFixtures.length} publication nodes preserve their payloads across editor, Markdown, and static-render capabilities.\n`,
);
