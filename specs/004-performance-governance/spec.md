# 004 Performance Governance 性能治理规范

## 1. 目的 (Purpose)

定义 Fauplay 的跨专题性能治理契约（Performance Governance Contract），统一指标命名、测量口径、验收模板与回归门槛，作为后续性能专项（如 `108+`）的上游约束。

## 2. 关键术语 (Terminology)

- 开发冷启动（Dev Cold Start）
- 开始页可见时间（Start Page Visible Time）
- 交互延迟（Interaction Latency）
- 百分位（Percentile, P50/P95）
- 性能回归门槛（Regression Threshold）
- 降级策略（Degradation Strategy）

术语口径：

1. `Dev Cold Start`：从执行 `npm run dev` 到本地开发页面可首次成功访问的时间。
2. `Start Page Visible Time`：浏览器发起页面刷新到开始页（目录选择界面）出现可见主标题的时间。
3. `Interaction Latency`：用户触发交互动作到对应 UI 可见反馈出现的时间。
4. `P50/P95`：样本集合的 50/95 分位值，用于表达典型体验与尾部体验。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 性能指标与测量口径的统一定义。
2. 性能变更提交的最小信息集要求。
3. 性能类功能需求与验收模板编号规则。
4. 性能专题与基础主题的依赖关系约束。

范围外：

1. 单一性能问题的实现细节（由对应 `100+` 专题定义）。
2. 具体工具链实现方案（例如特定插件、脚本实现）。
3. 功能行为规范替代（本规范不替代 `003-ui-ux` 与功能专题规范）。

## 4. 指标与测量约束 (Metrics & Measurement)

1. 性能验收默认至少报告 `P50` 与 `P95`，不得仅报告单次结果。
2. 指标样本默认要求多次采样，且采样条件需在文档中可复现。
3. 指标报告必须包含环境上下文（运行模式、命令、入口路径、采样日期）。
4. 任何“优化完成”结论必须同时给出优化前基线与优化后结果。

## 5. 治理契约 (Governance Contract)

每项性能改动必须显式定义以下五项内容：

1. 基线（Baseline）：当前可量化性能现状。
2. 目标（Target）：本轮要达到的性能目标。
3. 测量方法（Measurement）：命令、观测信号与采样方式。
4. 回归门槛（Regression Threshold）：超过阈值即视为回归。
5. 降级策略（Degradation Strategy）：未达标时的保底行为与回退路径。

## 6. 文档级接口 (Public Interfaces)

1. 指标命名接口：性能专题应使用统一术语（`Dev Cold Start`、`Start Page Visible Time`、`Interaction Latency`、`P50/P95`）。
2. 编号接口：性能治理需求使用 `FR-PG-*`，验收使用 `AC-PG-*`。
3. 变更提交接口：性能专题必须包含“基线/目标/测量方法/回归门槛/降级策略”五项信息。

## 7. 功能需求 (FR)

1. `FR-PG-01` 所有性能专题必须采用统一术语与口径，禁止同义混用导致歧义。
2. `FR-PG-02` 所有性能专题必须包含“五项治理信息集”（基线、目标、测量方法、回归门槛、降级策略）。
3. `FR-PG-03` 所有性能验收必须至少给出 `P50/P95` 两类分位指标。
4. `FR-PG-04` 性能专题必须明确观测信号，保证每条验收项可被客观验证。
5. `FR-PG-05` 性能治理是跨专题约束，不替代功能专题的行为契约。

## 8. 验收模板 (AC Template)

1. `AC-PG-01` 文档中可检索到统一术语与定义，且跨专题引用一致。
2. `AC-PG-02` 任一性能专题均包含“五项治理信息集”且不缺项。
3. `AC-PG-03` 任一性能专题均提供可复现测量步骤与至少 `P50/P95` 结果。
4. `AC-PG-04` 任一性能专题的验收条款均可映射到具体观测信号。
5. `AC-PG-05` 性能专题与功能专题边界清晰，不出现职责覆盖冲突。

## 9. 与上游主题关系 (Relation to 000/001/003)

1. 与 `000-foundation`：本规范继承其“性能基线原则”，并将其细化为可执行治理要求。
2. 与 `001-architecture`：性能优化不得破坏架构依赖方向与模块边界约束。
3. 与 `003-ui-ux`：性能治理关注时延与可见反馈，不替代交互语义定义。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 性能治理专题编号固定为 `004-performance-governance`。
2. 性能专项建议按 `100+` 编号独立维护，并引用本规范。
3. 本规范优先定义“治理与验收框架”，不绑定具体实现技术。

## 11. 关联主题 (Related Specs)

- 基线规范：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 架构规范：[`../001-architecture/spec.md`](../001-architecture/spec.md)
- 交互规范：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
