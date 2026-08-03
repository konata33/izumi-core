const lexicalNode = (type, fields = {}) => ({ ...fields, type, version: 1 });

const text = (value, fields = {}) => ({
  ...lexicalNode('text', {
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
    text: value,
  }),
  ...fields,
});

const element = (type, children, fields = {}) =>
  lexicalNode(type, {
    children,
    direction: null,
    format: '',
    indent: 0,
    ...fields,
  });

const paragraph = (children) =>
  element('paragraph', Array.isArray(children) ? children : [text(children)], {
    textFormat: 0,
    textStyle: '',
  });

const state = (children) => ({
  root: element('root', Array.isArray(children) ? children : [children]),
});

const inlineDocument = (child) =>
  state(paragraph(Array.isArray(child) ? child : [child]));
const blockDocument = (child) => state([child]);

const canonicalImage = 'https://media.example.test/owners/owner-1/image.webp';
const canonicalVideo = 'https://media.example.test/owners/owner-1/video.webm';
const nestedCopy = (value) => state(paragraph(value));

/**
 * One legal, meaningful fixture for every publication node. `markdown` records
 * the production path deliberately: headless means Haklex parses directly;
 * compatibility rewrites are local pre-parse substitutions for known Haklex
 * gaps; the whole-document readable fallback remains only for genuine errors.
 */
const fixtures = [
  {
    type: 'alert-quote',
    document: blockDocument(
      lexicalNode('alert-quote', {
        alertType: 'warning',
        content: nestedCopy('Alert lifecycle copy'),
      }),
    ),
    markdown: 'headless',
    token: 'Alert lifecycle copy',
  },
  {
    type: 'autolink',
    document: inlineDocument(
      element('autolink', [text('https://example.test/autolink')], {
        isUnlinked: false,
        rel: null,
        target: null,
        title: null,
        url: 'https://example.test/autolink',
      }),
    ),
    markdown: 'headless',
    token: 'https://example.test/autolink',
  },
  {
    type: 'banner',
    document: blockDocument(
      lexicalNode('banner', {
        bannerType: 'important',
        content: nestedCopy('Banner lifecycle copy'),
      }),
    ),
    markdown: 'headless',
    token: 'Banner lifecycle copy',
  },
  {
    type: 'chat',
    document: blockDocument(
      lexicalNode('chat', {
        messages: [
          {
            content: 'Chat lifecycle copy',
            id: 'message-1',
            participantId: 'writer-1',
          },
        ],
        participants: [{ id: 'writer-1', kind: 'user', name: 'Izumi Writer' }],
        variant: 'user-agent',
      }),
    ),
    markdown: 'headless',
    static: 'client-decorator-shell',
    token: 'Chat lifecycle copy',
  },
  {
    type: 'code',
    document: blockDocument(
      element(
        'code',
        [
          text('const lifecycle = true;', {
            highlightType: 'keyword',
            type: 'code-highlight',
          }),
        ],
        { language: 'typescript' },
      ),
    ),
    markdown: 'headless',
    token: 'const lifecycle = true;',
  },
  {
    type: 'code-block',
    document: blockDocument(
      lexicalNode('code-block', {
        code: 'const blockLifecycle = 42;',
        language: 'typescript',
      }),
    ),
    markdown: 'headless',
    static: 'skeleton',
    staticToken: 'data-rich-skeleton="codeblock"',
    token: 'const blockLifecycle = 42;',
  },
  {
    type: 'code-highlight',
    document: blockDocument(
      element(
        'code',
        [
          text('highlightLifecycle', {
            highlightType: 'function',
            type: 'code-highlight',
          }),
        ],
        { language: 'typescript' },
      ),
    ),
    markdown: 'headless',
    token: 'highlightLifecycle',
  },
  {
    type: 'code-snippet',
    document: blockDocument(
      lexicalNode('code-snippet', {
        files: [
          {
            code: 'export const snippetLifecycle = true;',
            filename: 'lifecycle.ts',
            highlightLines: [1],
            language: 'typescript',
          },
        ],
      }),
    ),
    markdown: 'headless',
    static: 'client-decorator-shell',
    token: 'snippetLifecycle',
  },
  {
    type: 'comment',
    document: inlineDocument(text('Comment lifecycle copy', { type: 'comment' })),
    markdown: 'headless',
    static: 'client-decoration',
    staticToken: 'data-rich-comment-anchor',
    token: 'Comment lifecycle copy',
  },
  {
    type: 'details',
    document: blockDocument(
      element('details', [paragraph('Details lifecycle copy')], {
        open: true,
        summary: 'Lifecycle details',
      }),
    ),
    markdown: 'headless',
    token: 'Details lifecycle copy',
  },
  {
    type: 'embed',
    document: blockDocument(
      lexicalNode('embed', {
        source: 'youtube',
        url: 'https://www.youtube.com/watch?v=lifecycle',
      }),
    ),
    markdown: 'headless',
    staticToken: 'youtube.com/embed/lifecycle',
    token: 'youtube.com/watch?v=lifecycle',
  },
  {
    type: 'excalidraw',
    document: blockDocument(
      lexicalNode('excalidraw', {
        snapshot: JSON.stringify({
          data: {
            appState: { viewBackgroundColor: '#ffffff' },
            elements: [],
            files: {},
          },
          type: 'inline',
        }),
      }),
    ),
    markdown: 'headless',
    static: 'placeholder',
    staticToken: 'Excalidraw Whiteboard',
    token: 'viewBackgroundColor',
  },
  {
    type: 'footnote',
    document: inlineDocument(lexicalNode('footnote', { identifier: 'lifecycle-note' })),
    markdown: 'headless',
    token: 'lifecycle-note',
  },
  {
    type: 'footnote-section',
    document: blockDocument(
      lexicalNode('footnote-section', {
        definitions: { 'lifecycle-note': 'Footnote lifecycle copy' },
      }),
    ),
    markdown: 'headless',
    token: 'Footnote lifecycle copy',
  },
  {
    type: 'gallery',
    document: blockDocument(
      lexicalNode('gallery', {
        images: [
          {
            alt: 'Gallery lifecycle image',
            height: 800,
            src: canonicalImage,
            width: 1200,
          },
        ],
        layout: 'grid',
      }),
    ),
    markdown: 'headless',
    token: canonicalImage,
  },
  {
    type: 'grid-container',
    document: blockDocument(
      lexicalNode('grid-container', {
        cells: [nestedCopy('Grid lifecycle cell A'), nestedCopy('Grid cell B')],
        cols: 2,
        gap: '1rem',
      }),
    ),
    markdown: 'headless',
    token: 'Grid lifecycle cell A',
  },
  {
    type: 'heading',
    document: blockDocument(
      element('heading', [text('Heading lifecycle copy')], { tag: 'h2' }),
    ),
    markdown: 'headless',
    token: 'Heading lifecycle copy',
  },
  {
    type: 'horizontalrule',
    document: state([
      paragraph('Before lifecycle rule'),
      lexicalNode('horizontalrule'),
      paragraph('After lifecycle rule'),
    ]),
    markdown: 'headless',
    serializedToken: 'horizontalrule',
    staticToken: '<hr',
    token: '---',
  },
  {
    type: 'image',
    document: blockDocument(
      lexicalNode('image', {
        altText: 'Image lifecycle desk',
        caption: 'Image lifecycle caption',
        height: 800,
        src: canonicalImage,
        thumbhash: '3OcRJYB4d3h/iIeHeEh3eIhw+j2A',
        width: 1200,
      }),
    ),
    markdown: 'headless',
    token: canonicalImage,
  },
  {
    type: 'katex-block',
    document: blockDocument(lexicalNode('katex-block', { equation: 'E = mc^2' })),
    headless: 'empty-markdown',
    markdown: 'compatibility-rewrite',
    token: 'E = mc^2',
  },
  {
    type: 'katex-inline',
    document: inlineDocument(
      lexicalNode('katex-inline', { color: null, equation: 'x^2 + y^2' }),
    ),
    markdown: 'headless',
    token: 'x^2 + y^2',
  },
  {
    type: 'linebreak',
    document: inlineDocument([
      text('Line lifecycle before'),
      lexicalNode('linebreak'),
      text('Line lifecycle after'),
    ]),
    markdown: 'headless',
    token: 'Line lifecycle after',
  },
  {
    type: 'link',
    document: inlineDocument(
      element('link', [text('Link lifecycle copy')], {
        rel: 'noopener',
        target: '_blank',
        title: 'Lifecycle link',
        url: 'https://example.test/link-lifecycle',
      }),
    ),
    markdown: 'headless',
    token: 'example.test/link-lifecycle',
  },
  {
    type: 'link-card',
    document: blockDocument(
      lexicalNode('link-card', {
        description: 'Link card lifecycle description',
        favicon: 'https://example.test/favicon.ico',
        image: 'https://example.test/cover.webp',
        source: 'example.test',
        title: 'Link card lifecycle',
        url: 'https://example.test/card-lifecycle',
      }),
    ),
    markdown: 'headless',
    token: 'example.test/card-lifecycle',
  },
  {
    type: 'list',
    document: blockDocument(
      element(
        'list',
        [
          element('listitem', [text('List lifecycle item')], {
            value: 1,
          }),
        ],
        { listType: 'bullet', start: 1, tag: 'ul' },
      ),
    ),
    markdown: 'headless',
    token: 'List lifecycle item',
  },
  {
    type: 'listitem',
    document: blockDocument(
      element(
        'list',
        [
          element('listitem', [text('Listitem lifecycle copy')], {
            value: 1,
          }),
        ],
        { listType: 'bullet', start: 1, tag: 'ul' },
      ),
    ),
    markdown: 'headless',
    token: 'Listitem lifecycle copy',
  },
  {
    type: 'mark',
    document: inlineDocument(
      element('mark', [text('Mark lifecycle copy')], { ids: ['review-1'] }),
    ),
    headless: 'parse-error',
    markdown: 'compatibility-rewrite',
    token: 'Mark lifecycle copy',
  },
  {
    type: 'mention',
    document: inlineDocument(
      lexicalNode('mention', {
        displayName: 'Lifecycle Writer',
        handle: 'lifecycle-writer',
        platform: 'github',
      }),
    ),
    markdown: 'headless',
    staticToken: 'Lifecycle Writer',
    token: 'lifecycle-writer',
  },
  {
    type: 'mermaid',
    document: blockDocument(
      lexicalNode('mermaid', { diagram: 'graph TD; Lifecycle-->Published' }),
    ),
    markdown: 'headless',
    static: 'skeleton',
    staticToken: 'data-rich-skeleton="mermaid"',
    token: 'Lifecycle-->Published',
  },
  {
    type: 'nested-doc',
    document: blockDocument(
      lexicalNode('nested-doc', {
        content: nestedCopy('Nested lifecycle copy'),
      }),
    ),
    markdown: 'headless',
    token: 'Nested lifecycle copy',
  },
  {
    type: 'paragraph',
    document: blockDocument(paragraph('Paragraph lifecycle copy')),
    markdown: 'headless',
    token: 'Paragraph lifecycle copy',
  },
  {
    type: 'post-reference',
    document: blockDocument(
      lexicalNode('post-reference', { postId: 'post-lifecycle' }),
    ),
    markdown: 'reference-rewrite',
    serializedToken: 'post-lifecycle',
    static: 'client-decorator-shell',
    token: 'izumi-post:post-lifecycle',
  },
  {
    type: 'quote',
    document: blockDocument(element('quote', [text('Quote lifecycle copy')])),
    editor: 'normalize-rich-quote',
    markdown: 'headless',
    token: 'Quote lifecycle copy',
  },
  {
    type: 'rich-quote',
    document: blockDocument(
      element('rich-quote', [text('Rich quote lifecycle copy')], {
        attribution: 'Izumi Editor',
      }),
    ),
    markdown: 'headless',
    token: 'Rich quote lifecycle copy',
  },
  {
    type: 'root',
    document: state(paragraph('Root lifecycle copy')),
    markdown: 'headless',
    token: 'Root lifecycle copy',
  },
  {
    type: 'ruby',
    document: inlineDocument(element('ruby', [text('漢字')], { reading: 'かんじ' })),
    markdown: 'headless',
    token: '漢字',
  },
  {
    type: 'spoiler',
    document: inlineDocument(element('spoiler', [text('Spoiler lifecycle copy')])),
    markdown: 'headless',
    token: 'Spoiler lifecycle copy',
  },
  {
    type: 'tab',
    document: inlineDocument([
      text('Tab lifecycle before'),
      lexicalNode('tab', {
        detail: 2,
        format: 0,
        mode: 'normal',
        style: '',
        text: '\t',
      }),
      text('Tab lifecycle after'),
    ]),
    markdown: 'headless',
    token: 'Tab lifecycle after',
  },
  {
    type: 'table',
    document: blockDocument(
      element(
        'table',
        [
          element(
            'tablerow',
            [
              element('tablecell', [paragraph('Table lifecycle cell')], {
                colSpan: 1,
                headerState: 0,
                rowSpan: 1,
              }),
            ],
            {},
          ),
        ],
        { colWidths: [160] },
      ),
    ),
    markdown: 'headless',
    token: 'Table lifecycle cell',
  },
  {
    type: 'tablecell',
    document: blockDocument(
      element('table', [
        element(
          'tablerow',
          [
            element('tablecell', [paragraph('Tablecell lifecycle copy')], {
              backgroundColor: '#ffffff',
              colSpan: 1,
              headerState: 1,
              rowSpan: 1,
              width: 180,
            }),
          ],
          { height: 48 },
        ),
      ]),
    ),
    markdown: 'headless',
    token: 'Tablecell lifecycle copy',
  },
  {
    type: 'tablerow',
    document: blockDocument(
      element('table', [
        element(
          'tablerow',
          [
            element('tablecell', [paragraph('Tablerow lifecycle copy')], {
              colSpan: 1,
              headerState: 0,
              rowSpan: 1,
            }),
          ],
          { height: 52 },
        ),
      ]),
    ),
    markdown: 'headless',
    token: 'Tablerow lifecycle copy',
  },
  {
    type: 'tag',
    document: inlineDocument(text('#lifecycle-tag', { type: 'tag' })),
    markdown: 'headless',
    token: '#lifecycle-tag',
  },
  {
    type: 'text',
    document: inlineDocument(text('Text lifecycle copy')),
    markdown: 'headless',
    token: 'Text lifecycle copy',
  },
  {
    type: 'video',
    document: blockDocument(
      lexicalNode('video', {
        height: 720,
        poster: 'https://media.example.test/owners/owner-1/poster.webp',
        src: canonicalVideo,
        width: 1280,
      }),
    ),
    markdown: 'headless',
    token: canonicalVideo,
  },
];

export const richNodeLifecycleFixtures = fixtures.map((fixture) => ({
  static: fixture.static ?? 'content',
  ...fixture,
}));
