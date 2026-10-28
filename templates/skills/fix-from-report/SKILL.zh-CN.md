<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# 按报告修复（fix-from-report）

评估失败并列出了待修项。只修这些——并证明每个修复确实改变了行为。

## 输入

- `harness packet <feature>`——`items`（rubric id 或 `gate:<命令>`）和 `findings`（每项观察到的症状）。
- `plan.md` 里原来的任务、`tech-design.md`、`vision.md`、`.harness/standards.md`。
- 你在 `developer/` 下之前写的报告。

你仍然不读 `rubric.json`；finding 已经告诉你症状。

## 流程

1. **复现**每一项：一个失败的测试、一条命令或一段脚本能展示症状。复现不了？记录你试过的一切，把该项报告为 `blocked`——不盲修。
2. **根因**（`systematic-debugging`）：一次一个假设。
3. **最小修复**，消除原因。只有正确性需要时才扩大范围，并说明原因。
4. **证明：** 复现现在通过；任务检查和受影响的测试通过，手里有新鲜输出。
5. **精确提交：** `git add <本次修复的路径>`；`git commit -m "fix(<item ids>): <原因>"`。
6. **报告：** 追加到对应的 `developer/<TASK-ID>-report.md`——项、根因（一行）、修复、SHA、测试结果计数。
7. **记录：** `harness remediate-done <feature> --sha <sha>`。不要运行 `harness eval`；由一个全新的评估者来评判修复。

`gate:<命令>` 项表示交付门禁在该命令失败：运行它，读第一个失败，修那个。

## 规则

- 没有复现不修；没有新鲜通过输出不提交。
- 不提交无关文件；不 `git add -A`。
- 没提交的修复不算修复：`remediate-done` 需要 SHA。

## 完成标准

- 每个列出的项都已复现、找到根因、修复并重测——或带着尝试记录报告为 blocked。
- `harness remediate-done` 接受了 SHA。
