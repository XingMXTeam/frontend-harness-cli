# frontend-harness-cli

一个不绑宿主的 **Harness 内核**，专为长程**前端** AI 编程而造。

为什么先做前端？因为证据都在前端。传感器的五维（structure / data /
logic / **ui** / e2e）、技能包里一半的 Skill（component-from-design、
i18n-extract）、技术栈包（**node / nextjs / vue**），加上作者十年一线
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

`harness` 是去掉这些失败模式的确定性内核。它**从不调用 LLM**：宿主 Agent
（Claude Code、Codex、Cursor…）负责规划、写码和评判，CLI 负责状态、
覆盖门禁、测评、交付闸门和预算。

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

## 快速开始

```bash
node bin/harness.js init --stack node --host claude-code  # 栈: node/nextjs/vue; 宿主: claude-code/codex/generic
node bin/harness.js new checkout --title "结算流程"
# 与用户澄清后，由 Planner 写 .harness/tasks/checkout/rubric.json 与 tasks.json
node bin/harness.js clarify-done checkout
node bin/harness.js next checkout
node bin/harness.js task-done checkout TASK-1 --sha <commit>
node bin/harness.js eval checkout
node bin/harness.js report checkout
npm run demo   # 自带端到端演示，含一次模拟中途中断后的续跑
npm test       # 22 个测试：v0.1 内核全套（覆盖门禁/否决/pitfall/judge 证据/续跑/SHA/预算停机/全流程）
               # + scan 与原 ai-code-gate CLI 分数等价 + scan 类 rubric 条目
               # + 技能包装语义（全装/已存在跳过/--only/未知名称报错）
```

## 一个产品，三层（v0.2 起统一）

这套东西最初是三个独立的仓——技能包、内核、代码门禁。v0.2 把它们合成
一个 CLI，因为它们本来就是同一件事的三层：

- **行为层——技能包。** 8 个实测过的 Skill（plan-before-code、
  deterministic-eval、context-map、component-from-design、i18n-extract、
  state-schema-first、bug-root-cause、ship-checklist），源自原
  `harness-skills` 仓，以纯数据形式放在 `templates/skills/`：
  `init --host claude-code` 会连同 `harness` skill 一起装好，也可用
  `harness skills list|install [--project|--dir <路径>] [--only a,b]`
  单独管理。Skill 只引导 Agent，不做任何判定。
- **内核层——本 CLI。** 状态、覆盖门禁、测评、预算、自动收官。
  全产品唯一产生 verdict（判定）的地方。
- **传感器层——门禁引擎。** 原 `ai-code-gate` 的五维确定性扫描
  （structure / data / logic / ui / e2e，AST 级检查），以 v0.5.0 原样
  收进 `src/gate/`。

两条规矩保证三层不打架：

1. **只有一个判定权威。** 在长程循环里，传感器的分数只是*输入*：
   rubric 里 `kind: "scan"` 的条目读取某一维分数，与条目自己的
   `minScore` 比较。传感器永远不判一个 feature 过不过——判定只归内核。
2. **`harness scan` 可独立使用。** 不需要 init、不需要项目状态、零配置
   （有 `gate.config.json` 就读、没有用默认），退出码与传感器结果一致，
   供 CI 使用——与原 `ai-gate` 的用法完全相同。等价性测试把收进来的引擎
   与原 CLI 在两套自带样例上的分数钉死（good：100/过；bad：64/不过），
   保证「统一」不会悄悄变成「换了把尺子」。

```bash
node bin/harness.js scan [--json] [路径]         # 独立传感器报告
node bin/harness.js skills list                  # 查看内置技能包
node bin/harness.js skills install --project     # 装到 ./.claude/skills
```

rubric 里由传感器供数的条目长这样：

```json
{ "id": "RB-7", "requirement": "REQ-1", "level": "essential",
  "kind": "scan", "dimension": "structure", "minScore": 85, "weight": 2 }
```

## 诚实边界（v0.2）

CLI 只做编排与测评，不自己派 Agent；宿主 Agent 执行 `harness next` 给的
任务包。judge 类条目的品味取决于真实评判者，内核管的是格式与否决权。
完整接线的是 Claude Code（skill + session-start hook），Codex/generic
为指令级接入。

MIT License.
