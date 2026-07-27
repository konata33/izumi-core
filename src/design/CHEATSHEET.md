# Izumi Admin 设计速查

新增或改动后台 UI 前先读这页；完整原则见 [`docs/design-language.md`](../../docs/design-language.md)。视觉母版只有 **mx-admin**。Yohaku 只提供“令牌 + 速查 + 校验”的治理方法，不提供任何视觉取值。

## 先选模板

| 场景 | 必须使用 |
| --- | --- |
| 列表、查询、常规内容 | `PageFrame`（64px 工具栏） |
| 文章编辑 | `PageFrame` + 沉浸式 Markdown 画布 + 336px 设置抽屉 |
| 单项低频设置 | `SettingsSection` + `SettingsRow`（64px 工具栏、768px 内容列） |
| 登录、首次初始化 | 独立身份入口，不进入后台壳层 |

## 不变量

1. 先复用页面模板和原语；缺少原语时先更新设计语言，再新建组件。
2. 颜色、字体和阴影只能从 `tokens.css` 的 `--mx-*` 角色令牌获取；业务样式中不得写色值或字体栈。
3. 正文以 `--mx-font-size-body`（14px）为锚点；字段和表格使用 `--mx-font-size-control`（13px）；元信息使用 `--mx-font-size-label` 或 `--mx-font-size-meta`；页面标题使用 `--mx-font-size-page`。中文标题最高 `600`，不要使用伪粗体。
4. 画布 / 工作区 / 控件分别是 `--mx-canvas`、`--mx-page`、`--mx-input`。常规内容不堆卡片，也不使用渐变或强调色装饰。
5. 顶部工具栏使用 `HeaderAction` 的图标操作；浅色实底只给当前主操作。输入表单内才使用带文字的确认按钮；`--mx-danger-*` 只用于风险操作；`--mx-success-*` 只用于状态反馈。
6. 标题和字段标签只出现一次。不要常驻“未配置”“未保存”“仅支持 HTTPS”等不可操作或技术性说明；校验时才在字段旁展示。个人链接未配置时只保留一次“添加链接”操作。
   已配置的外部头像不常驻显示 URL；使用缩略图和“更换”操作，需要修改时才展开输入。
7. 所有纯图标操作必须有 `aria-label` 和 `title`；`prefers-reduced-motion` 下不应依赖动效传达状态。
8. 路由内容只做 180ms 的淡入 / 小位移；侧栏不随页面切换重建；设置抽屉只做 transform + opacity；不动画宽高、间距或表格结构。

## 评审前运行

```bash
pnpm check:design
pnpm build
node .context/admin-acceptance.cjs
```

`check:design` 检查令牌、速查规则、页面模板和禁止的绕过方式；它不能替代 1440px、390px 与键盘操作的浏览器验收。
