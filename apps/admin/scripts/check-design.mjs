/* global process */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFile(resolve(root, path), 'utf8');
const fail = (message) => {
  process.stderr.write(`design check failed: ${message}\n`);
  process.exitCode = 1;
};

const [
  tokens,
  cheatsheet,
  language,
  posts,
  editor,
  statusFilter,
  autosizeTitle,
  richEditor,
  richEditorSurface,
  richEditorAdvanced,
  richEditorAi,
  richEditorCanvas,
  richEditorCode,
  richEditorLight,
  richPostPreview,
  richPostPreviewAi,
  richPostPreviewCanvas,
  richPostPreviewCode,
  richPostPreviewDiagram,
  richPostPreviewLight,
  pageFrame,
  postReferenceStatic,
  app,
  aiSettings,
  profile,
  auth,
  errors,
  styles,
] = await Promise.all([
  read('src/design/tokens.css'),
  read('src/design/CHEATSHEET.md'),
  read('docs/design-language.md'),
  read('src/views/posts-view.tsx'),
  read('src/views/editor-view.tsx'),
  read('src/components/status-filter.tsx'),
  read('src/components/autosize-title-field.tsx'),
  read('src/components/rich-post-editor.tsx'),
  read('src/components/haklex-editor-surface.tsx'),
  read('src/components/rich-post-editor-advanced.tsx'),
  read('src/components/rich-post-extension-ai.ts'),
  read('src/components/rich-post-extension-canvas.tsx'),
  read('src/components/rich-post-extension-code.ts'),
  read('src/components/rich-post-extension-light.tsx'),
  read('src/components/rich-post-preview.tsx'),
  read('src/components/rich-post-preview-extension-ai.ts'),
  read('src/components/rich-post-preview-extension-canvas.ts'),
  read('src/components/rich-post-preview-extension-code.ts'),
  read('src/components/rich-post-preview-extension-diagram.ts'),
  read('src/components/rich-post-preview-extension-light.ts'),
  read('src/components/page-frame.tsx'),
  read('src/components/post-reference-static-node.tsx'),
  read('src/app.tsx'),
  read('src/views/ai-settings-view.tsx'),
  read('src/views/profile-view.tsx'),
  read('src/views/auth-view.tsx'),
  read('src/lib/errors.ts'),
  read('src/style.css'),
]);

const requiredTokens = [
  '--mx-canvas',
  '--mx-page',
  '--mx-input',
  '--mx-line',
  '--mx-text',
  '--mx-muted',
  '--mx-subtle',
  '--mx-font-size-body',
  '--mx-font-size-control',
  '--mx-font-size-toolbar-context',
  '--mx-font-size-toolbar-context-mobile',
  '--mx-font-size-page',
  '--mx-sidebar-width',
  '--mx-content-toolbar-height',
  '--mx-settings-toolbar-height',
  '--mx-settings-content-width',
  '--mx-editor-drawer-width',
  '--mx-auth-canvas',
  '--mx-auth-field-line',
  '--mx-auth-field-surface',
  '--mx-auth-field-surface-hover',
  '--mx-auth-placeholder',
  '--mx-auth-field-height',
  '--mx-auth-field-radius',
  '--mx-auth-branch-rgb',
  '--mx-auth-branch-stem-alpha',
  '--mx-auth-branch-stem-width',
  '--mx-auth-branch-sprig-alpha',
  '--mx-auth-branch-sprig-width',
  '--mx-auth-branch-tip-alpha',
  '--mx-auth-branch-tip-width',
  '--mx-font-auth',
];

for (const token of requiredTokens) {
  if (!tokens.includes(token)) fail(`missing canonical token ${token}`);
}

for (const phrase of [
  '视觉母版只有 **mx-admin**',
  '先选模板',
  '不变量',
  'pnpm check:design',
]) {
  if (!cheatsheet.includes(phrase)) fail(`CHEATSHEET is missing “${phrase}”`);
}

if (!language.includes('唯一视觉母版是 [mx-admin]'))
  fail('design language no longer declares mx-admin as the sole visual source');
if (!language.includes('src/design/tokens.css'))
  fail('design language does not point to the canonical tokens');
if (!posts.includes('PageFrame') || !editor.includes('PageFrame'))
  fail('content views must use PageFrame');
if (!posts.includes('MobilePostList') || !posts.includes('HeaderAction'))
  fail('posts must retain the responsive list and global toolbar actions');
if (
  posts.includes('<select') ||
  posts.includes('className="mx-control" name="post-search"') ||
  !posts.includes('StatusFilter') ||
  !posts.includes('mx-search-input')
)
  fail('posts must retain the direct status filter and composite search field');
if (
  !statusFilter.includes('role="radiogroup"') ||
  !statusFilter.includes('aria-checked={selected}') ||
  !statusFilter.includes("event.key === 'ArrowRight'") ||
  !statusFilter.includes("event.key === 'Home'") ||
  !statusFilter.includes("event.key === 'End'")
)
  fail(
    'status filter must retain its single-select semantics and roving keyboard flow',
  );
if (
  !editor.includes('mx-write-editor') ||
  !editor.includes('mx-editor-drawer') ||
  !editor.includes('HeaderAction')
)
  fail('editor must use the immersive canvas and settings drawer');
if (
  editor.includes('<input id="post-title"') ||
  !editor.includes('AutosizeTitleField') ||
  !editor.includes('mx-editor-breadcrumb') ||
  !editor.includes('preventScroll: true') ||
  !autosizeTitle.includes('<textarea') ||
  !autosizeTitle.includes('ResizeObserver') ||
  !autosizeTitle.includes('withoutLineBreaks') ||
  !autosizeTitle.includes('onMoveToContent')
)
  fail(
    'editor must retain its autosizing title, compact context, and scroll-safe drawer focus',
  );
if (editor.includes('mx-side-panel'))
  fail('editor must not restore a permanent information sidebar');
if (!profile.includes('SettingsSection') || !profile.includes('SettingsRow'))
  fail('profile must use settings primitives');
if (!profile.includes('mx-social-link-add') || profile.includes('mx-social-link-empty'))
  fail(
    'profile links must use a single add action instead of a passive unconfigured status',
  );
if (!profile.includes('editingAvatar') || !profile.includes('mx-avatar-change'))
  fail('configured avatar URLs must use progressive disclosure');
if (!auth.includes('name="username"') || auth.includes('name="email"'))
  fail('auth must use username and must not restore email');
if (
  !auth.includes('UserRoundIcon') ||
  !auth.includes('getPublicProfile') ||
  !auth.includes('getOwnerAuthStatus') ||
  !auth.includes('AnimatePresence')
)
  fail('auth must retain the status-driven identity flow and optional public avatar');
if (
  !auth.includes('readOnly={!isSetup}') ||
  auth.includes('mx-auth-switch') ||
  !auth.includes('SetupProgress') ||
  !auth.includes('欢迎使用 Izumi') ||
  !auth.includes('创建账户')
)
  fail('auth must retain the routed, status-driven setup and login flow');
if (!app.includes('path="/setup"') || !app.includes('mode="setup"'))
  fail('the uninitialized owner flow must retain its dedicated setup route');
if (
  !auth.includes('AuthBranchCanvas') ||
  !auth.includes('drawBranchCanvas') ||
  !auth.includes('ResizeObserver') ||
  !auth.includes('createCanvasSeed') ||
  !auth.includes('crypto.getRandomValues') ||
  !auth.includes('createSeededRandom') ||
  !auth.includes('createEdgeBranchRoots') ||
  !auth.includes('drawGeneratedBranchField') ||
  !auth.includes('createFormSafeZone') ||
  !auth.includes('frontierLimit') ||
  !auth.includes('transition={{ duration: 0.24') ||
  auth.includes('branchRevealDuration') ||
  auth.includes('requestAnimationFrame') ||
  auth.includes('cancelAnimationFrame') ||
  auth.includes('duration: 3.6') ||
  auth.includes('scale: 0.995') ||
  auth.includes('Math.random') ||
  auth.includes('bezierCurveTo') ||
  auth.includes('createDesktopTwigClusters') ||
  auth.includes('createMobileTwigClusters') ||
  auth.includes('drawTwigCluster') ||
  auth.includes('protectFormSafeZone') ||
  auth.includes('createLeafletDetails') ||
  auth.includes('http')
)
  fail('auth must retain its seeded, local-only recursive Canvas twig field');
for (const phrase of [
  '至少 12 个字符',
  '正在检查配置',
  '无法读取管理员状态。检查 Core 是否正在运行。',
]) {
  if (!auth.includes(phrase)) fail(`auth is missing its direct feedback “${phrase}”`);
}
for (const phrase of ['用户名或密码不正确。', '管理员已设置，请登录。']) {
  if (!errors.includes(phrase)) fail(`auth error mapping is missing “${phrase}”`);
}
if (
  !tokens.includes('--mx-auth-canvas: oklch(9% 0.008 75);') ||
  !styles.includes('.mx-auth-backdrop') ||
  !styles.includes('.mx-auth-field-list') ||
  !styles.includes('.mx-auth-input-frame') ||
  !styles.includes('width: min(100%, 384px)') ||
  !styles.includes('@media (prefers-reduced-motion: reduce)') ||
  styles.includes('mask-image') ||
  tokens.includes('--mx-auth-backdrop-mask')
)
  fail(
    'auth must retain its warm-ink generated field, centered layout, and reduced-motion override',
  );
if (styles.includes('.mx-auth-fields'))
  fail('auth must not restore the card-like credential field group');
if (
  !styles.includes('.mx-search-input:focus-visible') ||
  !styles.includes('.mx-status-filter-option[aria-checked=') ||
  !styles.includes('.mx-editor-breadcrumb-current') ||
  !styles.includes('overflow: clip')
)
  fail(
    'article workbench must retain its canonical focus, filter, breadcrumb, and clipped surface rules',
  );
if (
  !editor.includes('RichPostEditor') ||
  !editor.includes('}, 800);') ||
  !editor.includes('savePostDraft') ||
  !editor.includes('error.status === 412') ||
  editor.includes('mx-write-markdown') ||
  editor.includes('<textarea id="post-content"')
)
  fail(
    'editor must retain structured content, 800ms autosave, and ETag conflict recovery',
  );
if (
  !richEditorSurface.includes('<RichEditor') ||
  !richEditorSurface.includes('OPEN_IMAGE_UPLOAD_DIALOG_COMMAND') ||
  !richEditorSurface.includes('extractTextContent') ||
  !richEditor.includes('const AdvancedHaklexEditor = lazy') ||
  !richEditor.includes("import('@/components/rich-post-editor-advanced')") ||
  !richEditor.includes("'post-reference'")
)
  fail('Haklex base adapter and lazy advanced editor boundary are incomplete');
if (
  !richEditorAdvanced.includes("import('@/components/rich-post-extension-ai')") ||
  !richEditorAdvanced.includes("import('@/components/rich-post-extension-canvas')") ||
  !richEditorAdvanced.includes("import('@/components/rich-post-extension-code')") ||
  !richEditorAdvanced.includes("import('@/components/rich-post-extension-light')") ||
  !richEditorAi.includes('chatEditNodes') ||
  !richEditorCanvas.includes('ExcalidrawEditNode') ||
  !richEditorCode.includes('codeSnippetEditNodes') ||
  !richEditorLight.includes('galleryEditNodes') ||
  !richEditorLight.includes('nestedDocEditNodes') ||
  /\b(?:AgentDiff|Poll|Dynamic)\b/u.test(
    [
      richEditorAdvanced,
      richEditorAi,
      richEditorCanvas,
      richEditorCode,
      richEditorLight,
    ].join('\n'),
  )
)
  fail(
    'advanced editor must split approved extension groups and reject AgentDiff/Poll/Dynamic',
  );
if (
  !richPostPreview.includes('composeRenderer') ||
  !richPostPreview.includes('previewRequirementsForDocument') ||
  !richPostPreview.includes('extensionLoaders') ||
  !richPostPreviewCanvas.includes('excalidrawModule') ||
  !richPostPreviewLight.includes('nestedDocModule') ||
  !richPostPreviewAi.includes('chatModule') ||
  !richPostPreviewCode.includes('codeSnippetModule') ||
  !richPostPreviewDiagram.includes('mermaidModule') ||
  !richPostPreview.includes('PostReferenceStaticNode') ||
  /\b(?:pollModule|dynamicModule|AgentDiff)\b/u.test(
    [
      richPostPreview,
      richPostPreviewAi,
      richPostPreviewCanvas,
      richPostPreviewCode,
      richPostPreviewDiagram,
      richPostPreviewLight,
    ].join('\n'),
  )
)
  fail('publish preview must compose only the approved static renderer modules');
if (
  !editor.includes('headerInert={Boolean(auxiliary)}') ||
  !pageFrame.includes('inert={headerInert}')
)
  fail('modal editor drawers must inert the full page header and writing surface');
if (
  !postReferenceStatic.includes("return 'post-reference'") ||
  !postReferenceStatic.includes('postId: this.__postId') ||
  postReferenceStatic.includes('<input')
)
  fail('publish preview post references must serialize without editable controls');
if (
  !app.includes("import('@/views/editor-view')") ||
  !app.includes("import('@/views/ai-settings-view')") ||
  !aiSettings.includes('AI 模型') ||
  !aiSettings.includes('role="radiogroup"')
)
  fail(
    'editor and AI settings must remain route-split, with explicit provider selection',
  );
if (/linear-gradient|radial-gradient|backdrop-filter/gu.test(styles))
  fail('quiet editorial surfaces must not use gradients or glass effects');
for (const match of styles.matchAll(/transition\s*:\s*([^;]+)/gu)) {
  if (
    /(?:^|[,\s])(?:all|width|height|margin|padding|top|right|bottom|left|inset)(?:[,\s]|$)/u.test(
      match[1],
    )
  )
    fail(`layout property found in transition: ${match[1].trim()}`);
}
if (styles.includes('.mx-auth-field::before'))
  fail('auth must not restore baseline-only credential fields');
if (
  !auth.includes('placeholder="用户名"') ||
  !auth.includes('placeholder="密码（至少 12 个字符）"') ||
  !auth.includes('className="sr-only"') ||
  auth.includes('<label htmlFor=')
)
  fail('auth must retain visually-hidden labels and direct field placeholders');
if (
  auth.includes('auth-password-hint') ||
  auth.includes('auth-token-help') ||
  auth.includes('初始化令牌')
)
  fail('auth must not restore bootstrap-token fields or helper copy');
if (
  !styles.includes('border: 1px solid transparent') ||
  !styles.includes('.mx-auth-field:not(.is-readonly):hover .mx-auth-input-frame') ||
  styles.includes('border: 1px solid var(--mx-auth-field-line)')
)
  fail('auth fields must stay borderless at rest and surface-led on hover');
if (auth.includes('AuthFlowField') || styles.includes('mx-auth-backdrop-flow'))
  fail('auth must not restore the retired SVG flow field');
for (const retiredSelector of [
  'mx-auth-rail',
  'mx-auth-composition',
  'mx-auth-workspace',
  'mx-auth-layout',
  'mx-auth-intro',
  'mx-auth-divider',
  'mx-auth-form-region',
]) {
  if (auth.includes(retiredSelector))
    fail(`auth restored retired structure ${retiredSelector}`);
}
for (const retiredPhrase of [
  '196px 导航轨',
  '无品牌几何构图',
  '深色出版工作台',
  '双栏编辑部构图',
  '暖调光晕',
  'Yohaku',
]) {
  if (language.includes(retiredPhrase) || cheatsheet.includes(retiredPhrase))
    fail(`auth documentation restored “${retiredPhrase}”`);
}

async function collectCss(directory) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? collectCss(child)
        : entry.name.endsWith('.css')
          ? [child]
          : [];
    }),
  );
  return files.flat();
}

for (const file of await collectCss('src')) {
  if (file === 'src/design/tokens.css') continue;
  const content = await read(file);
  if (/(#[0-9a-fA-F]{3,8}\b|rgba?\()/u.test(content))
    fail(`${file} contains a raw colour; add or reuse a --mx-* token`);
  const fontValues = [...content.matchAll(/font-family\s*:\s*([^;]+)/gu)].map((match) =>
    match[1].trim(),
  );
  if (fontValues.some((value) => !value.startsWith('var(--mx-font-')))
    fail(`${file} declares a font family outside tokens.css`);
  const fontSizes = [...content.matchAll(/font-size\s*:\s*([^;]+)/gu)].map((match) =>
    match[1].trim(),
  );
  if (fontSizes.some((value) => !value.startsWith('var(--mx-font-size-')))
    fail(`${file} declares a font size outside tokens.css`);
}

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(
  'Design contract passed: tokens, templates, and style-boundary checks are intact.\n',
);
