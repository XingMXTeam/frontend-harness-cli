<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# 编写技术方案（write-tech-design）

决定功能在本仓库里怎么搭，以及评估者要截哪些页面。沿用代码库现有模式；新模式需要一个用户认可过的理由。

## 门禁

- `prd.md` 和 `vision.md` 已存在；澄清摘要已确认。
- 读 `.harness/overview/technical.md`、`.harness/standards.md` 和功能涉及的代码。

## `tech-design.md` 章节

1. **技术栈与关键依赖**——用什么，须在澄清中确认过（「沿用仓库」或明确的新选择）。开发者不得引入这里没写的东西。
2. **架构概览**——功能放在哪；文字图即可。
3. **模块与边界**——新增/修改的模块、各自职责、谁可以 import 谁。
4. **数据流与状态**——数据来源、store、状态结构（见 `state-schema-first`），加载/空/错误/无权限状态。
5. **API / 接口契约**——端点或函数签名，含请求、响应、错误结构。
6. **异常处理**——每种失败：用户看到什么、什么会重试、什么会记日志。
7. **测试策略**——单元、组件、API、E2E（Playwright）：什么在哪一层测。
8. **运行说明**——评估时启动应用的命令、URL、前端工作目录。
9. **风险与权衡**——考虑过的方案和选它的理由。
10. **概览增量**——留给 `sync-overview`（或「无」）。

## `pages.json`

有 UI 的功能现在就写 `.harness/tasks/<feature>/pages.json`，依据是 PRD 的关键页面和应用的路由——不依赖测试用例（那时还不存在）。

```json
{
  "baseUrl": "http://localhost:5173",
  "viewport": { "width": 1280, "height": 800 },
  "fullPage": false,
  "pages": [
    { "name": "notices", "route": "/notices", "waitFor": "[data-testid=notice-list]" },
    { "name": "notices-empty", "route": "/notices?fixture=empty" }
  ]
}
```

- `name` 用 kebab-case 且唯一；`route` 以 `/` 开头且唯一；`waitFor` 是只有页面渲染完成才会出现的选择器。
- 覆盖 `vision.md` 的每个关键页面，以及有独立 URL 或 fixture 开关的状态（空、错误）。
- 有多个应用或多套路由可能适用且无法判断时，问用户一次。
- 没有 UI：不写该文件，在第 7 节写 `ui-evidence: N/A — <理由>`。

## 规则

- 选能单独测试的最简单边界。
- 写出将要改动的确切文件；开发计划的任务复用它们。
- 不写 TODO / TBD。真不确定的选择回去问用户。
- 不写 `.harness/overview/`；增量列在第 10 节。

## 完成标准

- 各章节齐全；技术栈一节与澄清一致。
- `pages.json` 能通过校验（`harness capture` 会检查）并覆盖每个关键页面，或写明 N/A。
- 下一个 skill：`write-dev-plan`。
