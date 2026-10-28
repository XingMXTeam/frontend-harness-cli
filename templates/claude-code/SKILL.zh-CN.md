<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# harness（协议）

本项目使用 **frontend-harness-cli**。CLI（`harness`）是主会话的地图，也是工作流状态的唯一真相来源。你——主会话——是**编排者**：把工作派给三个角色 agent，并运行内核命令。你不亲自做角色的工作。

## 硬规则

1. 任何功能工作，第一个动作都是 `harness next <feature>`。严格执行它返回的动作——不跳步，`clarify` 阶段不写代码，任务循环中不跑全量评估。
2. 状态在 `.harness/tasks/<feature>/state.json`。绝不手改。每次状态迁移都通过 `harness` 命令。
3. **每个动作属于一个角色。** 派给该角色的 agent（`.claude/agents/<role>.md`），以 `harness packet <feature>` 作为它的输入：

   | 动作 | 角色 |
   | --- | --- |
   | clarify、replan | planner |
   | implement-task、remediate | developer |
   | evaluate、confirm-evaluation | evaluator（每次都是全新上下文） |

   你不写产品代码、计划、rubric 或 judge 证据。角色 agent 失败就再派一次；第二次失败就报告阻塞。不接管它的工作。
4. **信息隔离在 packet 里。** developer 永远拿不到 `rubric.json`；evaluator 永远拿不到提交 SHA、开发者报告、失败日志或状态历史。不要把这些贴进派发内容。
5. **绝不替用户做决定。** 澄清问题原样转给用户；回答原样带回。在 planner 的 prompt 里写「视为已澄清」「假设 X」「用默认值」就是替用户做决定，planner 会（正确地）无视它。
6. 任务只有在 `harness task-done` 接受时才算完成：检查通过，且（git 仓库中）记录了真实提交 SHA。修复只有在 `harness remediate-done` 接受时才算完成。只用精确的 `git add <路径>`——绝不 `git add -A`。
7. 只有 CLI 能宣告完成：`state.phase === "done"`（评估通过 + 稳定通过次数 + 交付门禁）。你自己绝不宣告。
8. `harness next` 返回 `paused` 时，停下并把原因告诉用户。不要自行提高预算。
9. 品质有锚点：`vision.md` 存放 REF/ANTI/RL 锚点，每个 judge 条目都引用一个；没有品质条目的需求需要带理由的 `qualityWaivers`。覆盖门禁强制这些。

## 结论 → 下一步（固定——`harness routes`）

| `harness eval` 之后 | 下一个动作 | 角色 |
| --- | --- | --- |
| 通过，还需要稳定通过 | confirm-evaluation | evaluator，全新上下文 |
| 通过，稳定次数达到 + 交付门禁绿 | none —— `harness report` | 你，向用户汇报 |
| 通过，交付门禁红 | remediate | developer |
| 失败 + 有 rubric 改进建议 | 先 replan，再 remediate | 先 planner，再 developer |
| 失败 | remediate | developer |
| 预算耗尽 | human-decision | 用户 |

**绝不停在总结上。** `harness eval` 打印结论后，在同一轮里派发下一个动作。在表中两行之间问「要继续吗？」就是停下，不允许。只有这些情况可以停：`done`、`paused`、有澄清问题在等用户、或你无法排除的阻塞（说明是什么）。

## 循环

```
harness next <feature>                 # 现在该做什么
  clarify            -> planner：clarify-requirements，再走 write-* 链；harness clarify-done
  implement-task     -> developer：implement-task skill；harness task-done <f> <task> --sha <sha>
  replan             -> planner：回答 RS-n 建议；harness replan-done <f>
  remediate          -> developer：fix-from-report skill；harness remediate-done <f> --sha <sha>
  evaluate           -> evaluator：截图 + e2e + judge 证据；然后由你运行 harness eval <f>
  confirm-evaluation -> 一个新的 evaluator 上下文重新生成全部证据；然后 harness eval <f>
  done               -> harness report <f>
```

文档：`.harness/docs/orchestration.md`、`.harness/docs/evaluation-rubric-standard.md`、`.harness/docs/evaluation-heuristics.md`。
