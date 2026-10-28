# harness-cli

一个通用的、不绑宿主的 **Harness 内核**，为长程 AI 编程而造。

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
node bin/harness.js init --stack node --host claude-code  # 栈: node/nextjs/python; 宿主: claude-code/codex/generic
node bin/harness.js new checkout --title "结算流程"
# 与用户澄清后，由 Planner 写 .harness/tasks/checkout/rubric.json 与 tasks.json
node bin/harness.js clarify-done checkout
node bin/harness.js next checkout
node bin/harness.js task-done checkout TASK-1 --sha <commit>
node bin/harness.js eval checkout
node bin/harness.js report checkout
npm run demo   # 自带端到端演示，含一次模拟中途中断后的续跑
npm test       # 11 个测试：覆盖门禁/否决/pitfall/judge 证据/续跑/SHA/预算停机/全流程
```

## 诚实边界（v0.1）

CLI 只做编排与测评，不自己派 Agent；宿主 Agent 执行 `harness next` 给的
任务包。judge 类条目的品味取决于真实评判者，内核管的是格式与否决权。
完整接线的是 Claude Code（skill + session-start hook），Codex/generic
为指令级接入。

MIT License.
