# Izumi Admin

Izumi 的第一阶段文章管理端。它是 Core monorepo 中的 React 单页应用（Vite、TypeScript）：Core 是唯一的 API、鉴权和数据约束来源；管理端不保存内容副本，也不实现服务端规则。

界面以 [mx-admin](https://github.com/mx-space/mx-admin) 为唯一视觉参考：220px 深色侧栏、内嵌工作区、紧凑表格、克制的中性色和细粒度状态反馈。完整的页面模板、组件契约、文案和响应式规则见 [设计语言](docs/design-language.md)。所有页面均采用项目内原生 React/CSS 实现，不依赖第三方 UI 组件库或 CSS 工具链。

## 已实现

- 管理员首次初始化、正常登录和退出登录
- 首次初始化令牌仅从当次输入框读取，不写入环境变量、源码或浏览器存储
- 会话令牌与过期时间保存在浏览器本地，用于刷新后继续工作；401 会自动清除会话并回到登录页
- 文章分页、草稿／已发布状态筛选，以及标题、slug、栏目、状态与时间展示
- 新建文章、读取文章、保存草稿、发布和取消发布
- Markdown 源文件编辑，及标题、slug、摘要、栏目、标签编辑
- 单例个人资料：首次配置、读取和完整替换显示名称、标题、简介、头像地址与 GitHub／X 链接；Core 所需的头像替代文字由显示名称自动生成，不要求管理员填写
- 个人资料的本地必填与 URL 格式提示、Core 字段错误映射、保存状态和 60 秒公开缓存提示
- 清晰的保存中、成功与 Core 错误反馈
- 发布前的前端提示；最终发布条件始终由 Core 校验
- 桌面与窄屏布局，以及键盘焦点和减少动态效果支持
- React Query 负责请求缓存与列表刷新；Lucide 用于一致的功能图标

第一版刻意不包含富文本/协作编辑、媒体库、分类与标签管理、多用户、评论、统计、站点设置或后台 Markdown 预览。

## 运行

需要 Node.js 22.12+ 与 pnpm 10+。以下命令均从 monorepo 根目录执行。

```bash
pnpm install
cp apps/admin/.env.example apps/admin/.env.local
pnpm dev
pnpm dev:admin
```

`pnpm dev` 启动 Core；`pnpm dev:admin` 启动 Admin，并在
`http://localhost:5173/admin/` 提供页面。`VITE_CORE_API_URL` 是 Core 服务的源地址，
本地默认值为 `http://localhost:3001`；它只包含公开的服务地址，不能放置
`OWNER_SETUP_TOKEN` 或任何其他密钥。

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

- `POST /api/v1/auth/setup`：令牌只作为 `x-izumi-setup-token` 请求头传递
- `POST /api/v1/auth/login`
- `GET` / `POST /api/v1/posts`
- `GET` / `PATCH /api/v1/posts/:id`
- `GET /api/v1/owner/profile`
- `PUT /api/v1/owner/profile`：提交完整资料，包含 `displayName`、`headline`、`bio`、`avatar` 与唯一的 `github`／`x` 链接

请求成功读取 `{ data }`，失败读取 `{ error: { code, message, details, requestId } }`。SDK 负责请求路径、认证头、响应解包与契约类型；管理端不再维护一套平行的请求类型。

Core 当前没有“管理员是否已初始化”的查询端点，因此认证页明确提供“登录 / 首次初始化”两个入口；若初始化请求得到 `OWNER_ALREADY_CONFIGURED`（409），界面会提示并切换到登录入口。
