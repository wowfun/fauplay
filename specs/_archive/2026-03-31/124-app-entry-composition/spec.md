# 124 App Entry Composition 入口装配重构规范

> Archived on 2026-03-31. Kept for historical reference.

## 1. 目的 (Purpose)

在不改变 Fauplay 启动、目录选择、工作区加载与快捷键行为的前提下，收敛 `src/App.tsx` 的入口装配职责，降低入口组件的理解成本，并为后续继续扩展开始页与工作区切换逻辑保留清晰边界。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 整理 `App.tsx` 内部的入口层装配逻辑与副作用组织方式。
2. 抽离“未打开工作区时的打开目录快捷键监听”这一入口副作用。
3. 显式化目录选择页与工作区壳层两条渲染分支的 props 装配。

范围外：

1. 修改目录选择页或工作区壳层的用户可见 UI。
2. 新增、删除或变更任何快捷键绑定。
3. 改动 `useFileSystem()`、`DirectorySelectionLayout`、`WorkspaceShell` 的外部契约。

## 3. 用户可见行为契约 (User-visible Contract)

1. 初始进入应用时，若尚未选择根目录，界面继续展示目录选择页。
2. 未打开工作区时，`Ctrl/Cmd + O` 继续触发目录选择器。
3. 已打开工作区时，应用继续以 `Suspense` 包裹懒加载的 `WorkspaceShell`，并展示现有加载中占位态。
4. 若 `useFileSystem()` 暂未提供 `rootId`，工作区仍必须使用稳定的会话级兜底 `rootId`，且同一目录句柄在当前会话内不得反复漂移。

## 4. 入口装配契约 (Composition Contract)

1. `FR-AEC-01` `App.tsx` 必须继续作为顶层装配器，只负责组合 hooks、渲染分支与边界 fallback，不承载额外业务逻辑。
2. `FR-AEC-02` “未打开工作区时监听打开目录快捷键”的逻辑必须封装为独立、可命名的入口副作用，而不是散落在 `App` 主体中。
3. `FR-AEC-03` 目录选择页与工作区页所需 props 必须在对应分支附近显式装配，避免在 JSX 中堆叠大量一次性内联包装。
4. `FR-AEC-04` 兜底 `rootId` 生成逻辑必须保持按目录句柄稳定，不得在重复渲染时生成新的值。

## 5. 验收标准 (AC)

1. `AC-AEC-01` 未选择目录时，点击按钮或按下 `Ctrl/Cmd + O` 均可继续打开目录选择器。
2. `AC-AEC-02` 已选择目录后，工作区仍正常渲染，且懒加载期间继续展示“正在加载工作区”占位。
3. `AC-AEC-03` `npm run typecheck` 通过。
4. `AC-AEC-04` `npm run lint` 通过。

## 6. 默认值与一致性约束 (Defaults & Consistency)

1. 本专题不引入新的快捷键，也不修改 [`src/config/shortcuts.ts`](../../../../src/config/shortcuts.ts) 与 [`docs/shortcuts.md`](../../../../docs/shortcuts.md)。
2. 本专题属于纯结构性重构，不允许顺带引入新的状态、存储键或用户可见功能。
3. 工作区兜底 `rootId` 仍沿用 `session:<handle.name>:<suffix>` 语义。

## 7. 关联主题 (Related Specs)

- 本地文件浏览：[`../../../111-local-file-browser/spec.md`](../../../111-local-file-browser/spec.md)
- 可配置快捷键：[`../../../116-configurable-shortcuts/spec.md`](../../../116-configurable-shortcuts/spec.md)
- 插件运行时交互：[`../../../105-plugin-runtime-interaction/spec.md`](../../../105-plugin-runtime-interaction/spec.md)
