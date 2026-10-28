# frontend-harness-cli

一个不绑宿主的 **Harness 内核**，专为长程**前端** AI 编程而造。

为什么先做前端？因为证据都在前端。传感器的五维（structure / data /
logic / **ui** / e2e）、前端向的 Skill（component-from-design、
i18n-extract、e2e-testing）、技术栈包（**node / nextjs / vue / react**），加上作者十年一线
前端的实测经验，指向的都是同一个方向。内核本身保持与栈无关——规范与
默认都放在栈包里——但产品不宣称没有实测过的地盘。先做前端；通用性
靠一个个栈包挣出来，不靠嘴说。

别人卖的是流程，这个卖的是**证据**：一个需求只有在「按需求生成的 rubric
通过、无 essential 项失败、无 pitfall 触发、交付门禁绿、且达到配置的稳定
通过轮次」之后才算 done——每一步状态转移都落在可审计、可杀进程、可续跑
的文件里。

## 它解决什么

长程 Agent 的失败模式是固定的：过早宣布完成（一半功能是占位）、自己出题
自己答、平均分掩盖致命缺陷（一个核心功能死了、九十九个检查是绿的）、
状态只活在对话里（进程一杀全丢）、无预算地重试烧钱。

`harness` 是去掉这些失败模式的确定性内核。它**从不调用 LLM**：三个角色
Agent——**planner**、**developer**、**evaluator**——在任意宿主（Claude Code、
Codex…）里负责规划、写码和评判，CLI 负责状态、覆盖门禁、测评、交付闸门、
预算，以及每个角色能看到什么。

## 核心机制

- **按需求生成的 rubric + 一票否决**：essential 项得 0 或 pitfall 触发，
  总分再高也 FAIL。条目分 `command/file/grep`（确定性，脚本判）与
  `judge`（评判者把 `{score, note}` 写进证据文件，无证据记 0）。
- **覆盖门禁**：每个需求必须至少映射一条 essential 检查，否则不许开工——
  分母受控，没法靠少写检查刷分。
- **逐任务小循环**：实现 → 跑任务检查 → 精确提交 → SHA 经
  `git rev-parse --verify` 校验后才记 done，假 SHA 直接拒绝。
- **长程可恢复**：全部状态在 `.harness/tasks/<feature>/state.json`，
  `harness next` 只凭状态推出下一步；杀掉进程、新开会话，续跑点不变。
- **预算与自动收官**：宏循环与单任务重试都有上限，耗尽自动 `paused`
  等人决策；done 需要配置轮次的稳定通过，确认轮必须来自新的评判上下文。
- **传感器与技能包**：内置五维确定性扫描可独立运行
  （`harness scan`，零配置、退出码对齐 CI），rubric 条目可用
  `kind: "scan"` 读取某一维分数与自己的 `minScore` 比较——判定只归
  内核，传感器只供数。技能包用 `harness skills list|install` 管理，
  `init` 时一并装好。每个内置 skill（以及 `harness` 协议 skill）
  都附中文阅读版：与生效英文版同目录的 `SKILL.zh-CN.md`；宿主加载的
  始终是英文 `SKILL.md`，中文版只供阅读。

## 快速开始

```bash
node bin/harness.js init --stack react --host claude-code  # 栈: node/nextjs/vue/react; 宿主: claude-code/codex/generic
node bin/harness.js new checkout --title "结算流程"
# planner：与用户澄清，再按 write-* 链写 prd.md、vision.md、tech-design.md + pages.json、
# tasks.json、rubric.json + e2e-cases.json
node bin/harness.js clarify-done checkout
node bin/harness.js next checkout
node bin/harness.js packet checkout          # 交给负责该步骤的角色 Agent 的输入
node bin/harness.js task-done checkout TASK-1 --sha <commit>
node bin/harness.js capture checkout         # evaluator：按 pages.json 用 Playwright 截图
node bin/harness.js eval checkout
node bin/harness.js report checkout
npm run demo     # 端到端演示，含一次模拟中途中断后的续跑
npm run example  # examples/notice-list：真实功能走完 失败 → replan → 修复 → 通过 → done
npm test         # 82 个测试：v0.1 内核全套（覆盖门禁/否决/pitfall/judge 证据/续跑/SHA/预算停机/全流程）
               # + v0.2 统一（scan 分数等价/scan 条目/技能包装语义）
               # + v0.3（vision 锚点与豁免/e2e 六类配额/verify-zone/scope/scan 历史/skills 自评计分）
               # + v0.4 run 驱动（无人值守跑到 done/驱动重启续跑/澄清需人停机/Agent 失败与停滞检测）
               # + v0.5 Agent 层（角色 packet 与隔离绊线/角色守卫/证据新鲜度与引用/分层计分/
               #   改进建议 → replan/capture 与 visual/notice-list 示例重放）
               # + v0.6 数据契约对照（字段 diff 通过/扣分、spec 不可加载或无类型声明时中立）
               # + v0.7 真跑（自动探测 tsc 编译通过/失败/可关、testCommand 与 --run-tests 执行、仅退出码信号）
```

## v0.3 补齐：品质锚定、治理接线、分母与自评

- **品质愿景（quality-vision）。** 每个 feature 在澄清阶段写 `vision.md`：
  REF（正参照）/ ANTI（反参照）/ RL（红线，每条必须注明
  `check: screenshot|dom|command`）。覆盖门禁强制：vision 结构达标、
  judge 条目必须引用存在的锚点、每个 requirement 要么有品质条目、
  要么有带理由的 `qualityWaivers` 豁免——沉默不等于豁免。没锚点的品质
  判断在 rubric 加载时就被拒绝。
- **治理接线。** 门禁引擎里的人工保护区与可改范围守卫接成命令：
  `harness verify-zone`（受保护文件被改且无 `GATE_HUMAN_CONFIRM=yes`
  时拦截）、`harness scope <plan.md>`（改动超出计划「可改范围」节时
  拦截）、`harness scan --history <dir>`（只追加的历史报告 + 与上轮
  趋势对比）。
- **E2E 分母受控。** rubric 可声明 `e2eCategories` 六类最低配额
  （core / negative / boundary / crossFeature / persistence /
  uiJourney），覆盖门禁在 clarify-done 就核对 `e2e-cases.json`：
  N/A 必须写理由，core 与 negative 各至少一条 blocking；
  `policy.minPitfallsPerRequirement` 可强制每个 requirement 预先
  写明致命缺陷。
- **Skill 自评。** `harness skills eval` 发出黄金用例包（内置 36 条，
  应触发/不应触发 ≈ 80/20，每个内置 skill 都有用例），由全新宿主会话回填证据，内核按触发
  准确率计分判定。改 Skill 不过自评，等于给工作流的规则裸奔改版。
- **视觉回归**：v0.5 起内核自带 `harness capture` 与 `harness visual`
  （见下）；没有 baseline 仍然没有视觉判定，内核不假装能查自己查不了
  的东西。

## 真长程：`harness run`（v0.4）

内核不调 LLM——这条没变。v0.4 补的是**驱动层**：一个自身没有任何
智能的循环，它向内核问下一步，内核步骤（clarify-done、eval）自己
直接跑，Agent 步骤则以无头方式派给宿主 Agent 的命令行：

```bash
node bin/harness.js run checkout --agent claude-code   # 或 codex
node bin/harness.js run checkout --agent-cmd "my-agent --headless {prompt}"
npm run demo:run   # 用替身 Agent 演示无人值守全程，含一次驱动重启
```

停机条件全部显式、绝不静默：**done**（完成）、**paused**（内核预算
耗尽，等人决定）、**needs-human**（澄清环节——驱动不会替用户编答案）、
**max-steps / timeout**（重跑即续，驱动自身不存状态，靠内核文件
续跑）、**agent-failing**（宿主 CLI 连续报错）、**stalled**（Agent
跑了一步但状态签名毫无变化，计一次停滞，两次结束运行——这是
「禁止停滞」的机械化执行，不靠口头约束）。

## Agent 层（v0.5）

v0.4 能驱动循环；v0.5 讲清楚每一步谁来做、能看到什么、以及内核所执行的
契约由谁、怎样写出来。

- **三角色，隔离是机制不是口号。** `init --host claude-code` 安装
  `.claude/agents/planner.md`、`developer.md`、`evaluator.md`（硬边界、输入/
  输出契约、交接字段）；codex/generic 在 `.harness/agents/` 得到同样的指令级
  文本。clarify/replan → planner，implement-task/remediate → developer，
  evaluate/confirm-evaluation → evaluator。内核按白名单为每个角色构建 packet
  （`harness packet <feature>`）：developer 拿不到 `rubric.json`；evaluator
  拿不到提交 SHA、开发者报告、失败日志和状态历史——`harness run` 发现
  evaluator packet 会泄露这些时直接停机。`run` 下每一步带 `HARNESS_ROLE`，
  内核命令拒绝错误角色（只有 developer 能 `task-done` / `remediate-done`，
  只有 planner 能 `replan-done`，只有编排者能 `eval`）。judge 证据必须晚于
  它所评判的工作和上一次评估，确认轮因此真的是新鲜的。
- **让 `clarify-done` 诚实通过的成文链。** 新增 13 个 skill（各带中文阅读版）：
  `clarify-requirements` → `write-prd` → `write-quality-vision` →
  `write-tech-design`（+ `pages.json`）→ `write-dev-plan` →
  `write-acceptance-criteria`（分层 `rubric.json` + 六类 `e2e-cases.json`），
  developer 用的 `implement-task`、`fix-from-report`、`systematic-debugging`、
  `verification-before-completion`，evaluator 用的 `e2e-testing`、`api-testing`，
  以及长期记忆 `sync-overview`。`.harness/docs/` 安装三份文档：
  `orchestration.md`、`evaluation-rubric-standard.md`、`evaluation-heuristics.md`。
- **结论 → 下一步固定映射，禁止停在总结。** `harness routes` 打印映射表；
  `harness eval` 每次都打印下一步；协议 skill 与 session-start hook 要求编排者
  同一轮派发，且绝不替用户回答澄清问题。
- **分层 rubric。** `"layerWeights": true` 按 L1 正确性 / L2 健壮性 / L3 UI /
  L4 交互 = 0.40 / 0.25 / 0.20 / 0.15 计分，级别权重 1 / 0.7 / 0.3；否决仍高于
  任何分数。可选每层配额（`policy.minEssentialPerLayer`、`minPitfallsPerLayer`）。
- **rubric 进化。** evaluator 在 judge 证据里附 `rubricRefinementSuggestions`；
  内核记录为 `RS-n`，失败的评估先路由到 `replan`，`replan-done` 要求逐条回答、
  被接受的建议必须真的改了文件、任何放宽已锁定 rubric 的改动需要人
  （`GATE_HUMAN_CONFIRM=yes`）。
- **取证截图与像素比对。** `harness capture <feature>` 按 `pages.json` 用
  Playwright 截图；非 PNG 或小于 `--min-bytes`（2KB）即失败，占位图只在
  `--allow-fallback` 下出现（状态 `fallback`，永不算证据）。`harness visual`
  用 pixelmatch 与 `.harness/baselines/` 比对；没有基线报 `no-baseline`
  （退出码 2），不算通过。锚定在截图类红线上的 judge 条目必须引用真实 PNG。
  Playwright、pixelmatch、pngjs 是**可选 peer 依赖**——没装时命令会准确告诉你装什么。

## 数据契约对照：数据维有了参照物（v0.6）

只读代码的扫描器只能查卫生习惯——硬编码密钥、明文 http、storage key
没命名空间——查不了真正会在线上炸的东西：代码眼里的数据跟契约对不
对得上。把 `gate.config.json` 的 `inputs.dataSpec` 指向一份契约文件：

```json
{ "interfaces": [{ "name": "Campaign",
  "fields": { "id": "string", "startsAt": "date", "tags": "array" } }] }
```

`harness scan` 就会把代码里同名的 TypeScript `interface`/`type` 声明
跟它逐字段对照：契约有、代码没建模的字段扣 8，类型对不上（如 string
vs date）扣 6，代码声明了契约里没有的字段扣 6。不给 spec 输入则行为
与从前完全一致，零配置扫描不受影响。spec 加载失败、或代码里根本没
有类型声明时，报中立（neutral）：未验证绝不冒充已验证。

## 真跑：编译和测试都实际执行（v0.7）

此前有两维是在批改「纸面材料」：结构维只量体型和 import，因为没人真
去编译；e2e 只认别人交来的结果文件。现在两维都在本地真跑：

- **编译。** 显式 `compileCommand` 优先；否则只要项目有 `tsconfig.json`
  且本地装了 TypeScript（`node_modules/.bin/tsc`），scan 就自己跑
  `tsc --noEmit`——失败扣 40 并引用第一行错误。只执行本地二进制，绝不
  下载任何东西。120 秒内跑不完报中立（neutral）而不是失败；
  `"autoCompile": false` 可完全关闭自动探测。
- **测试。** 在配置里设 `inputs.testCommand`（如 `"npm test"`），或给
  `harness scan` 加 `--run-tests`（自动探测 `package.json` 的 test
  脚本），scan 会在评分前先把测试套件真跑一遍。命令产出了配置的
  `testResults` 文件就照旧解析计数；没产出则降级为「仅退出码信号」
  并在报告里明说。命令根本跑不完（超时/启动失败）时，运行信号报
  未验证，不编造结果。

注意：真跑意味着会执行被扫项目自己的二进制与脚本——只扫你本来就敢
自己运行的项目。

## 诚实边界（v0.5）

内核只做编排与测评，永不调用 LLM；`harness run` 驱动层把任务包派给
宿主 Agent 的命令行（Claude Code、Codex，或 --agent-cmd 指定的任意
命令）——智能是宿主的，纪律是内核的。不用 run 时，宿主会话也可以
照 `harness next` 交互式地走同一套循环。judge 类条目的品味取决于
真实评判者，内核管的是格式与否决权。完整接线的是 Claude Code
（协议 skill + 三角色 agent + session-start hook），Codex/generic 为指令级接入。
隔离约束的是内核发出和接收的东西；有 shell 权限的 Agent 仍然能打开没给它的
文件——packet、角色守卫和新鲜度规则让这成为一次有意的违规，而不是意外。
澄清门禁（用户确认、未决问题为 0）是记录在 `clarification/summary.md` 的
skill 级规则；内核强制的是由它推出的 rubric 覆盖，而不是对话本身。自带示例
录制时没有浏览器，judge 证据引用的是渲染出的 HTML；`harness capture` 已用
Playwright 替身和真实 Playwright 安装（缺浏览器 → 清晰报错）测过，尚未在 CI
里对接真实浏览器。

MIT License.
