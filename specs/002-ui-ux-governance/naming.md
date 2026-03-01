---
updated: 2026-03-01
---

# 002 组件命名与目录分层规则

## 1. 分层模型（Layering Model）

### 1.1 `src/ui/*`

- 仅放通用基础组件（Base UI Components），不包含业务语义。
- 示例：`Button`、`Input`、`Badge`、`Dialog`、`Select`。
- 依赖方向：`ui` 不依赖 `features`，可依赖 `lib` 与样式 token。

### 1.2 `src/features/<domain>/*`

- 放业务组件（Feature Components）与该域内 hooks/types。
- 示例域：`explorer`、`preview`、`filters`。
- 依赖方向：可依赖 `ui`，不可反向被 `ui` 依赖。

### 1.3 `src/layouts/*`

- 放页面骨架（Layout Shell）和区域编排组件。
- 示例：`AppShell`、`ExplorerLayout`、`PreviewLayout`。

## 2. 命名规则（Naming Rules）

### 2.1 组件与文件

- React 组件统一 `PascalCase`。
- 文件名与导出组件名一致：`ExplorerToolbar.tsx -> ExplorerToolbar`。
- 单文件仅导出一个主组件（必要时允许附属类型导出）。

### 2.2 Hooks

- 统一 `useXxx` 命名。
- 通用 hook 放 `src/hooks/`。
- 业务 hook 放 `src/features/<domain>/hooks/`。

### 2.3 类型

- Props：`XxxProps`
- 状态：`XxxState`
- 行为/事件：`XxxAction`
- 禁止模糊后缀：`Data`、`Info`、`Misc`

## 3. 禁用命名（Disallowed Names）

以下命名禁止直接使用，除非具备明确领域前缀：

- `Content`
- `Item`
- `Manager`
- `Helper`
- `Comp`
- `Ctl`
- `Util`

允许示例（带语义前缀）：
- `MediaPreviewCanvas`
- `ExplorerItemActions`
- `GatewayHelperBadge`（仅在 helper 为明确业务语义时）

## 4. 视觉与交互命名约定

- 视觉 token 名称统一使用 `token-*` 语义分组（在设计文档或后续 CSS token 迁移中执行）。
- 交互状态命名统一：`default` / `hover` / `focus` / `active` / `disabled` / `loading` / `error`。
- 可访问性状态命名统一：`aria-*` 与 `data-state=*` 对齐，不混用同义状态字段。

## 5. 目录模板（Template）

```txt
src/
  ui/
    Button/
      Button.tsx
      Button.types.ts
  features/
    explorer/
      components/
        ExplorerToolbar.tsx
      hooks/
        useExplorerFilters.ts
      types/
        explorer.types.ts
  layouts/
    ExplorerLayout.tsx
```

## 6. 新组件命名决策流程

1. 判断是否“跨业务复用”。
2. 若是，放 `ui`；若否，放对应 `features/<domain>`。
3. 若职责是区域编排，放 `layouts`。
4. 按语义词 + 业务词命名，避免通用词裸用。
