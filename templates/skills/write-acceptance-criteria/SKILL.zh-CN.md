<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# 编写验收标准（write-acceptance-criteria）

把 PRD 和愿景变成评估所依据的两个文件：`rubric.json`（评什么、怎么评）和 `e2e-cases.json`（哪些用户旅程必须能走通）。标准见 `.harness/docs/evaluation-rubric-standard.md`；L3/L4 的检查清单见 `.harness/docs/evaluation-heuristics.md`。

## 门禁

- `prd.md`、`vision.md`、`tech-design.md`、`tasks.json` 已存在；摘要已确认。

## 按顺序构建 `rubric.json`

1. **需求：** 把 PRD 的 `REQ-n` id 和句子抄进 `requirements`。
2. **L1（正确性）：** 每条需求至少一个条目，其中至少一个 `essential`。优先用跑真实测试的 `command` 条目。
3. **L2（健壮性）：** 来自 PRD 的异常/边界路径和技术方案的异常处理。点名时序和权限类失败。
4. **L3（UI）：** 来自愿景的设计意图和关键页面。每个 REF-n 至少产生一个 important/essential 的 `judge` 条目，`"anchor": "REF-n"`。
5. **L4（交互）：** 来自愿景的交互范式，以 heuristics 第 2 节为清单。
6. **陷阱：** 每条 RL-n 至少变成一个 `pitfall` 条目（缺陷不存在时检查通过），或一个锚定它的 essential `judge` 条目。每个 ANTI-n 也值得一个 pitfall。
7. **交叉核对**下面三条覆盖线；用户要求生产级时，在 `policy` 里设配额。

覆盖线：每个 REQ → 一个 L1 essential；每个设计意图 → 一个 L3/L4 条目；每条 RL → 一个 pitfall 或锚定的 essential judge。

### 条目类型

| 类型 | 用途 | 必填字段 |
| --- | --- | --- |
| `command` | 测试、Playwright spec、脚本 | `command`（退出码 0 = 满足） |
| `file` | 交付物存在且不是空壳 | `path`、`minBytes` |
| `grep` | 某模式必须/不得出现 | `path`、`pattern`、`expect: present|absent` |
| `scan` | 传感器维度阈值 | `dimension`、`minScore`、可选 `path` |
| `judge` | 只有评估者看得到的 | `anchor`（REF/ANTI/RL-n）、`evidence` 路径 |

每个条目：`id`、`requirement`、`layer`（L1–L4）、`level`、`kind`，以及写明可观察行为和阈值的 `description`。证据路径放在 `.harness/tasks/<feature>/evaluation/judge-<id>.json`。

### 顶层字段

```json
{
  "version": 1,
  "feature": "<feature>",
  "layerWeights": true,
  "policy": { "minEssentialPerLayer": 1, "minPitfallsPerLayer": 1 },
  "requirements": [ … ],
  "items": [ … ],
  "qualityWaivers": [ { "requirement": "REQ-3", "reason": "<为什么没有品质面>" } ],
  "e2eCategories": { "core": 2, "negative": 2, "boundary": 1, "crossFeature": 1, "persistence": 1, "uiJourney": 1, "na": { } }
}
```

没有 judge 条目的需求需要带理由的 `qualityWaivers`。不适用的层需要带理由的 `policy.layerNA.<L>`。

## 构建 `e2e-cases.json`

用例数组：

```json
{ "id": "E2E-1", "category": "core", "mapsTo": "REQ-1", "blocking": true, "severity": "critical",
  "route": "/notices", "steps": ["open /notices", "…"], "expect": ["newest notice is first", "…"] }
```

| 类别 | 最少 | 证明什么 |
| --- | --- | --- |
| core | 2 | 主旅程端到端可用 |
| negative | 2 | 错误输入、空数据、无权限、网络失败 |
| boundary | 1 | 大数据量、极端输入、分页边界、并发 |
| crossFeature | 1 | 这里的操作在别处按预期可见 |
| persistence | 1 | 刷新/重开后数据仍在 |
| uiJourney | 1 | 加载、空态、反馈、响应式 |

- `core` 和 `negative` 各至少一条 `blocking: true`。
- 不适用的类别写进 `e2eCategories.na` 并给理由——绝不悄悄降低最低数。
- 每条 `uiJourney` 用例的 `route` 必须在 `pages.json` 里；缺了就补到 `pages.json`（那是 planner 的文件）。

## 然后

运行 `harness clarify-done <feature>`。按它列出的每个缺口补条目或把条目写得更锋利——绝不靠删需求、降级别来过门禁。

## replan 时

在这里落实每条被接受的改进建议（更锋利的描述或阈值、新的验证方式、新条目、新级别），为评估者的探索性发现补 E2E 用例，并把决定写进 `replan-decisions.json`。

## 完成标准

- `harness clarify-done` 通过。
- 每个 judge 条目的锚点存在；每条 RL 被覆盖；E2E 配额达到或带理由豁免。
