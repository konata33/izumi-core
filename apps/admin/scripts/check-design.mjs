import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path) => readFile(resolve(root, path), 'utf8')
const fail = (message) => {
  process.stderr.write(`design check failed: ${message}\n`)
  process.exitCode = 1
}

const [tokens, cheatsheet, language, posts, editor, profile] = await Promise.all([
  read('src/design/tokens.css'),
  read('src/design/CHEATSHEET.md'),
  read('docs/design-language.md'),
  read('src/views/posts-view.tsx'),
  read('src/views/editor-view.tsx'),
  read('src/views/profile-view.tsx'),
])

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
  '--mx-font-size-page',
  '--mx-sidebar-width',
  '--mx-content-toolbar-height',
  '--mx-settings-toolbar-height',
  '--mx-settings-content-width',
  '--mx-editor-drawer-width',
]

for (const token of requiredTokens) {
  if (!tokens.includes(token)) fail(`missing canonical token ${token}`)
}

for (const phrase of ['视觉母版只有 **mx-admin**', '先选模板', '不变量', 'pnpm check:design']) {
  if (!cheatsheet.includes(phrase)) fail(`CHEATSHEET is missing “${phrase}”`)
}

if (!language.includes('唯一视觉母版是 [mx-admin]')) fail('design language no longer declares mx-admin as the sole visual source')
if (!language.includes('src/design/tokens.css')) fail('design language does not point to the canonical tokens')
if (!posts.includes('PageFrame') || !editor.includes('PageFrame')) fail('content views must use PageFrame')
if (!posts.includes('MobilePostList') || !posts.includes('HeaderAction')) fail('posts must retain the responsive list and global toolbar actions')
if (!editor.includes('mx-write-editor') || !editor.includes('mx-editor-drawer') || !editor.includes('HeaderAction')) fail('editor must use the immersive canvas and settings drawer')
if (editor.includes('mx-side-panel')) fail('editor must not restore a permanent information sidebar')
if (!profile.includes('SettingsSection') || !profile.includes('SettingsRow')) fail('profile must use settings primitives')
if (!profile.includes('mx-social-link-add') || profile.includes('mx-social-link-empty')) fail('profile links must use a single add action instead of a passive unconfigured status')
if (!profile.includes('editingAvatar') || !profile.includes('mx-avatar-change')) fail('configured avatar URLs must use progressive disclosure')

async function collectCss(directory) {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const child = `${directory}/${entry.name}`
    return entry.isDirectory() ? collectCss(child) : entry.name.endsWith('.css') ? [child] : []
  }))
  return files.flat()
}

for (const file of await collectCss('src')) {
  if (file === 'src/design/tokens.css') continue
  const content = await read(file)
  if (/(#[0-9a-fA-F]{3,8}\b|rgba?\()/u.test(content)) fail(`${file} contains a raw colour; add or reuse a --mx-* token`)
  const fontValues = [...content.matchAll(/font-family\s*:\s*([^;]+)/gu)].map((match) => match[1].trim())
  if (fontValues.some((value) => !value.startsWith('var(--mx-font-'))) fail(`${file} declares a font family outside tokens.css`)
  const fontSizes = [...content.matchAll(/font-size\s*:\s*([^;]+)/gu)].map((match) => match[1].trim())
  if (fontSizes.some((value) => !value.startsWith('var(--mx-font-size-'))) fail(`${file} declares a font size outside tokens.css`)
}

if (process.exitCode) process.exit(process.exitCode)
process.stdout.write('Design contract passed: tokens, templates, and style-boundary checks are intact.\n')
