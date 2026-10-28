<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# 编写开发计划（write-dev-plan）

把技术方案拆成开发者能逐个完成、测试、提交的小任务，按依赖排序。需要开发者「自己理解」的任务，就是评估者会判失败的任务。

## 门禁

- `prd.md`、`vision.md`、`tech-design.md` 已存在；摘要已确认。

## `tasks.json`（内核读取）

```json
[
  {
    "id": "TASK-1",
    "title": "Notice list model: sort newest first, unread count",
    "requirements": ["REQ-1"],
    "checks": ["node --test test/notice-model.test.js"]
  }
]
```

- `id` 唯一且稳定——之后的 replan 只追加，不重新编号。
- `requirements` 列出本任务推进的 `REQ-n`。
- `checks` 是 shell 命令，全部退出码为 0，`harness task-done` 才接受。用本任务自己的测试；除非是集成任务，否则不跑全量。

## `plan.md`（给人看，也给 `harness scope` 用）

每个任务：

```markdown
### TASK-1: Notice list model

**目标** —— 本任务交付什么，一句话。

**文件**
- Create: `src/notices/model.ts`
- Modify: `src/notices/index.ts`
- Tests: `src/notices/model.test.ts`

**契约**
- `sortNotices(list: Notice[]): Notice[]` —— 按 `createdAt` 最新在前；相同时保持稳定。
- `unreadCount(list: Notice[]): number`

**验证**
- 单元：`npx vitest run src/notices/model.test.ts` —— 预期 6 个通过
- API / 集成：N/A —— 纯模块
```

文件末尾写范围守卫读取的一节：

```markdown
## Editable scope
- `src/notices/**`
- `test/notices/**`
```

## 规则

- 每个任务小（一次提交，大致 ≤ 300 行改动）且可单独验证。
- 精确路径、精确签名、精确命令和预期结果。不写 TODO、TBD、「按需」「等等」。
- 按依赖排序：数据和契约在前，UI 在后，集成最后。任务绝不依赖后面的任务。
- 加载、空、错误、无权限状态是任务（或任务的一部分），不是事后补。
- 任务细节只写在计划里——绝不写进 `.harness/overview/`。

## 完成标准

- PRD 中每个 `REQ-n` 至少出现在一个任务里。
- 每个任务都有文件、契约、检查；`tasks.json` 与 `plan.md` 的 id 和标题一致。
- 下一个 skill：`write-acceptance-criteria`。
