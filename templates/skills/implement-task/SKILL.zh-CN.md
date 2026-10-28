<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# 实现一个任务（implement-task）

一个任务从头到尾：失败的测试、代码、通过的测试、提交、记录。内核只在检查通过且提交 SHA 真实存在时接受任务。

## 先读（不得跳过）

1. `harness packet <feature>`——任务 id、标题、需求。
2. `plan.md` / `tasks.json` 里的这个任务：文件、契约、检查。
3. `tech-design.md`——技术栈与边界。这里没写的东西（框架、store、运行时、包）一律不碰：停下报告 `blocked`，而不是加进来。
4. `.harness/standards.md`。
5. `vision.md`——本任务涉及页面的目标状态，以及每条红线（RL-n）。有意识地防御红线。

你不读 `rubric.json`：你按计划和愿景构建，而不是按考题构建。

## 流程

1. **先写失败的测试。** 写出任务契约所要求的测试，运行，看它因为正确的原因失败。产出：失败输出。
2. **最小实现。** 让这个测试通过，别的不做。
3. **变绿。** 运行该测试和任务的 `checks`。全部通过，手里有新鲜输出。
4. **重构**，不改变行为；重跑。
5. **状态。** 任务要渲染数据时：加载、空、错误、无权限状态都存在且有测试。
6. **精确提交。**
   ```bash
   git status --short
   git add <本任务的确切路径>
   git commit -m "feat(<TASK-ID>): <标题>"
   git rev-parse --short HEAD
   ```
   绝不 `git add -A` / `git add .`；绝不提交无关文件。
7. **报告。** 写 `.harness/tasks/<feature>/developer/<TASK-ID>-report.md`：改了什么（文件）、提交 SHA、测试命令与结果计数、契约范围内做的决定、没能完成的。（评估者永远看不到这个文件；它是给下一个开发者和修复用的。）
8. **记录。** `harness task-done <feature> <TASK-ID> --sha <sha>`。被拒（检查失败、SHA 校验不过）就修正原因，从失败的那一步重来——不伪造 SHA。

测试或检查失败且原因不明显时，切换到 `systematic-debugging`。说「完成」之前，走一遍 `verification-before-completion`。

## 反模式

- ❌ 先写代码，再写一个只是复述代码的测试。
- ❌ 「顺手」改别的任务的文件。
- ❌ 用最后一次修改之前的测试结果宣称完成。
- ❌ 因为方便加一个新依赖。

## 完成标准

- `harness task-done` 以真实 SHA 接受了任务。
- 报告存在，含 SHA 和新鲜的测试计数。
