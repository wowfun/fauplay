---
updated: 2026-03-01
---

# 002 UI/UX 与组件命名治理规范

## 1. 目的

本文定义 Fauplay 的 UI/UX 与组件命名治理规则，用于支持后续功能扩展与协作开发一致性。  
本规范采用文档先行（Documentation First）策略：先统一标准，再按迭代增量迁移。

## 2. 治理目标

- 建立可扩展的视觉一致性规范（Visual Consistency）。
- 建立分层组件模型（Layering Model）：`ui` / `features` / `layouts`。
- 建立统一命名契约（Naming Contract），降低重构与评审成本。
- 建立迁移映射基线（Migration Baseline），避免多版本命名并存。

## 3. 范围与边界

范围内：
- 视觉与交互规则（Visual & Interaction Rules）
- 组件命名与目录分层规则（Naming & Layering Rules）
- 现有组件迁移映射（Migration Mapping）
- 评审检查清单（Review Checklist）

范围外：
- 业务代码重构
- 样式视觉改版
- 运行时行为变更

## 4. 规范原则

1. 一致优先（Consistency First）：相同问题采用相同模式。
2. 语义优先（Semantic Naming）：名称表达职责与业务语义。
3. 可迁移（Migration Friendly）：新旧并存阶段可追踪、可落地。
4. 可评审（Reviewable）：每项规范都可被检查清单验证。

## 5. 文档结构

- `specs/002-ui-ux-governance/spec.md`：总规范与边界。
- `specs/002-ui-ux-governance/naming.md`：命名与分层规则。
- `specs/002-ui-ux-governance/mapping.md`：组件迁移映射表。
- `specs/002-ui-ux-governance/checklist.md`：设计与代码评审清单。
- `specs/002-ui-ux-governance/areas.md`：UI 主要功能区划分与边界。

## 6. 重要约束

- 本轮仅定义“规范接口”，不改运行时代码接口。
- 新增概念契约：
  - 组件层级契约（Layer Contract）
  - 命名契约（Naming Contract）
  - 评审契约（Review Contract）

## 7. 落地策略

- 新功能开发优先遵循新命名与新分层。
- 存量组件按 `mapping.md` 的优先级与触发条件迁移。
- 评审流程使用 `checklist.md` 作为 PR 审查模板。
- 当首轮迁移完成后，`mapping.md` 与 `checklist.md` 继续作为长期治理基线保留。

## 8. 验收标准

1. 文档齐全：`spec/naming/mapping/checklist/areas` 五份文档存在。
2. 可执行：新成员可仅依赖文档完成组件命名和目录落位决策。
3. 可追踪：现有核心组件均有目标命名与迁移优先级。
