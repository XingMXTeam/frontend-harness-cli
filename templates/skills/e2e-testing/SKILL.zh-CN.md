<!-- 中文阅读版。生效文件是同目录的 SKILL.md（宿主只加载它）；本文件仅供阅读，内容与英文版一一对应。 -->

# E2E 测试（e2e-testing）

在真实浏览器里证明 `e2e-cases.json` 的旅程可用、页面和 `vision.md` 说的一样——再把看到的变成分数、发现和更好的 rubric 条目。

## 工具（只有一条路，不依赖 IDE）

- 浏览器相关的一切都用 **Playwright**：
  - 脚本化用例：`@playwright/test` spec（`npx playwright test …`）；
  - 截图：`harness capture <feature>`（Playwright 库）；
  - 探索式会话：直接用 Playwright，或宿主若有 Playwright MCP 服务器也可。
- 没装？`npm i -D @playwright/test playwright && npx playwright install chromium`。若当前环境确实装不了，评估即为 **blocked**——如实报告。绝不用 API 调用、单元测试或读源码代替浏览器旅程。
- 某种方式失败（选择器不稳、超时）就换方式，而不是反复跑同一条失败命令。

## 流程

1. **启动应用**，按 `tech-design.md`「运行说明」。起不来 → 这就是第一个发现。
2. **跑脚本化用例。** `e2e-cases.json` 中每个用例结果为 PASS / FAIL / SKIP；SKIP 必须有理由。失败的 blocking 用例是 blocking 发现。
3. **截图。** `harness capture <feature> --run-id c<cycle>-<n>`。状态必须为 `pass`。证据运行不得用 `--allow-fallback`。有基线时跑 `harness visual <feature>`；`no-baseline` 不是匹配——要如实说。
4. **逐张看截图。** 打开每张 PNG。每个页面写一段简短的结构化结论：层次、色彩与对比度、间距与对齐、溢出、状态，以及与每个 REF-n 的差距。heuristics 文档能量化的就量化（`page.evaluate`）。
5. **探索。** 至少做 `evaluation-heuristics.md` §4 中的三种探测（重复提交、超长输入、前进后退、编辑中刷新、异常操作顺序、双标签页、慢网络）。
6. **打分。** 为每个 judge 条目写证据 JSON：`score` 1 / 0.5 / 0、`note`（为什么是这个分）、`artifacts`（截图、spec 输出、API 日志）、`heuristics`（编号）。以截图检查的红线必须在 `artifacts` 里有真实 PNG。
7. **改进 rubric。** 条目难以打分（`refine`）、无法证明（`add-verification`）、缺陷没有对应条目（`add`）、级别不对（`regrade`）时，添加 `rubricRefinementSuggestions`。
8. **写 `evaluation/eval-<cycle>.md`**（见下）。不要运行 `harness eval`。

## 报告 `eval-<cycle>.md`

```markdown
# Evaluation — <feature>, cycle <n> (<evaluate|confirm>)
Tools: Playwright <版本>; capture run <id> (status pass, 6 pages)

## E2E cases
| case | category | blocking | result | evidence |

## Rubric (judge items)
| id | layer | level | score | reason | artifacts |

## Comparison with references
| dimension | REF-n | ours | gap | fix | rubric id |

## Exploratory findings
| id | probe | result | severity | add as E2E case? | evidence |

## Findings
| heuristic | artifact | severity | problem | recommendation | rubric id |

## Rubric refinement suggestions
| RS（由内核分配） | type | item | problem | suggestion |
```

critical 和 major 发现必须对应一个 rubric id（或一条 `add` 建议），下一轮才能修。

## 规则

- 绝不修改产品代码或 rubric。
- 绝不读 `developer/**`、`failure-log.md`、提交信息。
- 确认轮从零开始：新截图、新证据文件。

## 完成标准

- 每个用例有结果；每个 judge 条目有带 artifacts 的新鲜证据；截图都打开并描述过；至少三种探测；报告已写。
