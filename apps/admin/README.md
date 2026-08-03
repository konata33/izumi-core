# Izumi Admin

Izumi 的结构化文章工作台。它是 Core monorepo 中的 React 单页应用（Vite、TypeScript）：Core 是唯一的 API、鉴权和数据约束来源；管理端负责编辑体验，不复制服务端发布规则。

界面采用“静默编辑部”视觉语言：暖墨色工作面、克制的文字导航、内容优先的文章列表，以及独立的居中写作列。完整的页面模板、组件契约、文案和响应式规则见 [设计语言](docs/design-language.md)。

## 已实现

- 通过独立的欢迎、Owner 账户和完成三步向导完成首次初始化；邮箱不参与认证
- 初始化状态只由 Core 中是否存在唯一 Owner 决定，不要求使用者生成或复制部署令牌
- 会话令牌与过期时间保存在浏览器本地，用于刷新后继续工作；401 会自动清除会话并回到登录页
- 文章分页、草稿／已发布状态筛选，以及标题、slug、栏目、状态与时间展示
- 新建文章、读取文章、800ms 自动保存、发布更新、取消发布、版本恢复与冲突副本
- Haklex/Lexical 结构化编辑，标题自动增高，Markdown 作为兼容输出
- 图片与视频经 Core 上传、站内文章引用、代码、图表、Excalidraw 等按需加载的高级内容节点
- 设置、发布预览与 AI 助手面板；AI 提案在使用者确认前不会写入文章
- 多个加密 BYOK AI 档案、环境默认档案与持久会话
- 默认本地媒体存储，以及可在后台配置、测试的 S3／Cloudflare R2 存储
- 单例个人资料：首次配置、读取和完整替换显示名称、标题、简介、头像地址与 GitHub／X 链接；Core 所需的头像替代文字由显示名称自动生成，不要求管理员填写
- 个人资料的本地必填与 URL 格式提示、Core 字段错误映射、保存状态和 60 秒公开缓存提示
- 清晰的保存中、成功与 Core 错误反馈
- 发布前的前端提示；最终发布条件始终由 Core 校验
- 桌面与窄屏布局，以及键盘焦点和减少动态效果支持
- React Query 负责请求缓存与列表刷新；Lucide 用于一致的功能图标

当前不包含多人实时协作、分类与标签管理、多用户、评论、统计或站点设置。Poll 和可执行远程 JavaScript 的 Dynamic 节点被明确禁用。

## 运行

需要 Node.js 22.12+ 与 pnpm 10+。以下命令均从 monorepo 根目录执行。

```bash
pnpm install
cp apps/admin/.env.example apps/admin/.env.local
pnpm dev
pnpm dev:admin
```

`pnpm dev` 启动 Core；`pnpm dev:admin` 启动 Admin，并在
`http://localhost:<ADMIN_PORT>/admin/` 提供页面（默认 `5173`）。Core 使用根目录
`.env` 的 `PORT`（默认 `3001`），Vite 会把 Admin 的 API 请求自动代理到对应的
本地 Core 地址。`VITE_CORE_API_URL` 是可选的 Core 服务地址覆盖项；它只包含公开的服务地址，不能放置任何密钥。

在 Conductor 中，本工作区脚本先移除平台注入的 `CONDUCTOR_PORT`，再使用默认的四位数端口：
Core 为 `3001`，Admin 为 `5173`。固定端口工作区不可与另一套同端口服务并行启动。

本地开发或独立部署 Admin 时，Core 的 `CORS_ORIGIN` 必须包含管理端的实际来源；
由 Core 托管的 `/admin/` 与 API 同源，不需要 CORS 配置。

```bash
pnpm build
pnpm typecheck
```

生产构建时，`pnpm build` 会先构建 SDK 和 Admin。随后启动 Core 时，API 会将
`apps/admin/dist` 作为同源 SPA 托管在 `/admin/`；部署可以用
`ADMIN_STATIC_DIR` 覆盖该构建目录。

## 与 Core 的契约

前端客户端位于 [`src/lib/core.ts`](src/lib/core.ts)，直接使用本地打包的 `@izumi/sdk`，对应现有 Core OpenAPI 契约：

- `POST /api/v1/auth/setup`：仅在唯一 Owner 尚不存在时创建账户
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/status`：返回是否已初始化；完成后附带唯一管理员用户名
- `GET` / `POST /api/v1/posts`
- `GET` / `PATCH /api/v1/posts/:id`：更新使用 `If-Match` ETag 乐观锁
- `POST /api/v1/posts/:id/publish`、`unpublish`、`restore` 与 `fork`
- `POST /api/v1/media/uploads`：图片与视频统一通过 Core multipart 上传
- `/api/v1/storage/settings`：读取、保存并测试本地或 S3／R2 存储
- `/api/v1/ai/providers`、`sessions` 与 SSE run：AI 档案、会话和流式生成
- `GET /api/v1/owner/profile`
- `PUT /api/v1/owner/profile`：提交完整资料，包含 `displayName`、`headline`、`bio`、`avatar` 与唯一的 `github`／`x` 链接

请求成功读取 `{ data }`，失败读取 `{ error: { code, message, details, requestId } }`。SDK 负责请求路径、认证头、响应解包与契约类型；管理端不再维护一套平行的请求类型。

认证入口以 `GET /api/v1/auth/status` 决定路由：未初始化进入 `/setup` 三步向导，已初始化进入 `/auth` 登录。初始化完成后，Core 返回存储的唯一 `username`，管理端将它预填到登录框，使用者只需填写密码。两个认证请求体仍只包含 `username` 与 `password`；公开资料的头像仅可作为登录页的无文字提示，`displayName` 不承担认证职责，也不会重复显示。公开资料不存在、请求失败或头像损坏时，登录页静默使用中性的用户轮廓。
