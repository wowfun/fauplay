---
updated: 2026-03-01
---

# 002 现有组件迁移映射

## 1. 说明

本表定义“现有组件 -> 目标命名”的首版固定映射。  
后续迁移必须按此表执行，避免同类组件出现多套命名语义。

优先级说明：
- `P0`：核心主链路，优先迁移。
- `P1`：高频组件，次优先迁移。
- `P2`：稳定组件，按需迁移。

触发条件说明：
- `增量迁移`：新功能开发触达该组件时顺带迁移。
- `专项重构`：仅在专门重构任务中迁移。

## 2. 映射表

| 现有组件 | 目标组件名 | 目标层级 | 优先级 | 触发条件 | 理由 |
| --- | --- | --- | --- | --- | --- |
| `Toolbar` | `ExplorerToolbar` | `features/explorer/components` | `P0` | 增量迁移 | 明确“浏览器工具栏”语义，避免通用名冲突 |
| `StatusBar` | `ExplorerStatusBar` | `features/explorer/components` | `P1` | 增量迁移 | 与工具栏形成同域命名一致性 |
| `FileGrid` | `FileBrowserGrid` | `features/explorer/components` | `P0` | 专项重构 | 当前命名过于通用，需体现浏览器上下文 |
| `VirtualGrid` | `FileGridViewport` | `features/explorer/components` | `P0` | 专项重构 | 明确其职责是虚拟视口实现层 |
| `FileItemCard` | `FileGridCard` | `features/explorer/components` | `P1` | 增量迁移 | 与 Grid 命名家族保持一致 |
| `PreviewPane` | `MediaPreviewPanel` | `features/preview/components` | `P0` | 增量迁移 | `Pane` 语义不稳定，`Panel` 更明确 |
| `PreviewModal` | `MediaLightboxModal` | `features/preview/components` | `P1` | 增量迁移 | 体现全屏预览（Lightbox）交互语义 |
| `PreviewContent` | `MediaPreviewCanvas` | `features/preview/components` | `P0` | 专项重构 | `Content` 为禁用通用词，需替换为语义名 |

## 3. 落地顺序建议

1. 先迁移 `P0` 且触发条件为“增量迁移”的组件。
2. 再处理 `P1` 组件，保持同域命名一致。
3. 最后在专项重构中处理 `VirtualGrid` 与 `PreviewContent` 这类实现层组件。

## 4. 迁移约束

- 迁移时必须同步更新引用与导入路径。
- 迁移 PR 必须附带 `checklist.md` 勾选结果。
- 同一个 PR 内禁止“部分改名后保留旧别名”。
