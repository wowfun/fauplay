---
updated: 2026-03-01
---

# 002 UI/UX 评审检查清单

## 1. 命名一致性检查（Naming Consistency）

- [ ] 组件名是否为 `PascalCase` 且文件名一致。
- [ ] 是否使用语义化命名，避免 `Content/Item/Helper` 裸用。
- [ ] 类型命名是否遵循 `XxxProps/XxxState/XxxAction`。
- [ ] Hook 命名是否遵循 `useXxx`。

## 2. 层级边界检查（Layer Boundaries）

- [ ] `src/ui/*` 是否仅包含通用基础组件。
- [ ] `ui` 是否未依赖 `features`。
- [ ] 业务组件是否位于 `src/features/<domain>/*`。
- [ ] 页面骨架是否位于 `src/layouts/*`。

## 3. 状态完整性检查（State Matrix）

- [ ] 是否定义 `default/hover/focus/active/disabled/loading/error` 状态。
- [ ] `disabled` 状态是否同时禁用交互与视觉反馈。
- [ ] `loading` 状态是否有明确占位、骨架或加载指示。
- [ ] `error` 状态是否有统一位置与文案语气。

## 4. 可访问性检查（Accessibility）

- [ ] 键盘可达（Keyboard Accessible）是否完整。
- [ ] `focus-visible` 是否可见且不与 `hover` 混淆。
- [ ] 交互元素是否具备必要 `aria-label` / `title`。
- [ ] 图标按钮是否有文本替代（含 `sr-only`）。

## 5. 可扩展性检查（Extensibility）

- [ ] 新组件是否可兼容能力发现（Capability Discovery）与插件动作扩展。
- [ ] 组件 API 是否避免硬编码后端能力细节。
- [ ] 是否复用已有 `ui` 组件，而非重复实现样式逻辑。
- [ ] 是否遵循 `mapping.md` 的目标命名与迁移优先级。

## 6. PR 附加要求

- [ ] PR 描述中包含“命名与层级选择理由”。
- [ ] PR 描述中包含“本清单勾选结果”。
- [ ] 若偏离规范，是否明确写出例外原因与后续修复计划。
