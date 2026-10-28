<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# harness

本项目使用 **frontend-harness-cli**。CLI（`harness`）是编排者，也是工作流状态的唯一事实源。你是一个宿主 Agent：它派发的规划 / 编码 / 评判工作由你来做，但状态永远不许你自己发明。

## 硬规则

1. 任何功能工作的第一个动作都是 `harness next <feature>`。它返回什么动作就只做那个动作——不许抢跑、不许在 `clarify` 阶段写代码、不许在任务循环里跑全量评测。
2. 状态存在 `.harness/tasks/<feature>/state.json`。永远不许手改。每次状态迁移都必须走 `harness` 命令。
3. 信息隔离：实现者依据计划和任务干活，**不看** `rubric.json`；评判者依据 `rubric.json` 和需求干活，**不看**实现者的推理。如果你被要求评判自己在同一个上下文里实现的工作，要说出来——那是一次调试运行，不算正式分数。
4. 一个任务只有被 `harness task-done` 接受才算完成：它的检查通过，且（在 git 仓库里）记录了一个 `git rev-parse --verify` 能解析的真实 commit SHA。只许精确 `git add <paths>`——永远不许 `git add -A`。
5. 永远不要自己宣布完成。只有 `state.phase === "done"` 算数，且只有 CLI 能设置它（评测通过 + 交付门禁通过 + 稳定通过要求满足）。
6. 如果 `harness next` 说 `paused`，停下来，把原因上报给用户。不要擅自提高预算。
7. 品质靠锚定，不靠感觉：`vision.md` 存放该功能的 REF/ANTI/RL 锚点，每条 judge 类 rubric 条目都必须引用一个。某个需求确实没有品质面的，要在 rubric.json 里写一条带理由的 `qualityWaivers` 豁免——永远不许静默跳过。覆盖门禁会在 clarify-done 时强制执行这一切。

## 主循环

```
harness next <feature>          # 现在该发生什么
  clarify   -> 问用户，然后写 vision.md + rubric.json + 任务，harness clarify-done
  implement -> 一次一个任务：实现、检查、提交、harness task-done
  remediate -> 只修列出的未关闭项，提交，harness eval
  evaluate  -> harness eval（确定性条目以命令运行；
               judge 条目需要评判者新写的证据 JSON）
  verify    -> 拿到一次全新的独立评测，再跑 harness eval
  done      -> 用 harness report <feature> 汇报
```
