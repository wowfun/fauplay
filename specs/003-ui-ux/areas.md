# 003 UI 功能区细则 (Areas Reference)

## 目的

定义 UI 主要功能区与预览子分区细则，作为 `003-ui-ux/spec.md` 的引用文档。

## 总体分区模型

```txt
┌─────────────────────────────────────────────────────────────┐
│ A. 顶部工具区（Top Toolbar Zone）                            │
├─────────────────────────────────────────────────────────────┤
│ B. 主内容区（Main Content Zone）                            │
│   ├─ B1. 文件网格区（File Browser Grid Zone）               │
│   └─ B2. 预览面板区（Media Preview Panel Zone，可折叠）      │
├─────────────────────────────────────────────────────────────┤
│ C. 底部状态区（Status Bar Zone）                            │
└─────────────────────────────────────────────────────────────┘

覆盖层（Overlay Layer）：
- D. 全屏预览区（Lightbox Modal Zone）
```

## 各区职责与边界

### A 顶部工具区（Top Toolbar Zone）

- 职责：目录导航、搜索筛选、排序、视图模式切换。
- 当前组件：`features/explorer/components/ExplorerToolbar`
- 边界：不承载预览渲染与媒体播放状态机。

### B1 文件网格区（File Browser Grid Zone）

- 职责：文件列表虚拟渲染、选择态、双击打开、键盘导航承接。
- 当前组件：
  - `features/explorer/components/FileBrowserGrid`
  - `features/explorer/components/FileGridViewport`
  - `features/explorer/components/FileGridCard`
- 边界：聚焦浏览与选择，不直接处理预览播放状态机。

### B2 预览面板区（Media Preview Panel Zone）

- 职责：当前选中文件预览、遍历控制、自动播放控制、系统动作入口。
- 当前组件：
  - `features/preview/components/MediaPreviewPanel`
  - `features/preview/components/PreviewHeaderBar`
  - `features/preview/components/PreviewControlGroup`
  - `features/preview/components/PreviewActionRail`
  - `features/preview/components/PreviewMediaViewport`
  - `features/preview/components/PreviewFeedbackOverlay`
- 边界：由预览域状态驱动，不反向控制网格渲染策略。

### C 底部状态区（Status Bar Zone）

- 职责：展示可见项统计与当前选中项元信息。
- 当前组件：`features/explorer/components/ExplorerStatusBar`
- 边界：只读展示，不触发目录变更与预览控制。

### D 全屏预览区（Lightbox Modal Zone）

- 职责：沉浸式媒体查看，复用预览域逻辑。
- 当前组件：`features/preview/components/MediaLightboxModal`
- 边界：作为覆盖层，不改变底层 A/B1/C 布局状态。

## B2 子分区命名规范（Canonical Sub-zones）

| 规范中文名 | 规范英文名 | 当前实现载体 |
| --- | --- | --- |
| 预览头部栏 | `PreviewHeaderBar` | 独立组件 |
| 头部控制组 | `PreviewControlGroup` | 独立组件 |
| 预览动作侧栏 | `PreviewActionRail` | 独立组件 |
| 媒体展示视口 | `PreviewMediaViewport` | 独立组件 |
| 预览反馈层 | `PreviewFeedbackOverlay` | 独立组件 |

说明：
- `data-preview-subzone` 作为推荐（SHOULD）标记方式，可用于测试与调试，但本轮不设为强制。

## 预览子分区与全屏对应关系 (Sub-zone Mapping)

| 面板态子分区 | 全屏态对应区 | 语义一致性要求 |
| --- | --- | --- |
| `PreviewHeaderBar` | 全屏头部栏 | MUST |
| `PreviewControlGroup` | 全屏控制组 | MUST |
| `PreviewActionRail` | 全屏动作入口区 | MUST |
| `PreviewMediaViewport` | 全屏媒体视口 | MUST |
| `PreviewFeedbackOverlay` | 全屏反馈层 | MUST |

## 输入输出契约（Input/Output Contract）

输入：

1. 当前文件（Selected/Active File）
2. 预览遍历状态（Traversal State）
3. 自动播放状态（Auto-play State）
4. 工具元数据（Action Tool Metadata）

输出：

1. 预览控制事件（自动播放开关、遍历模式切换、间隔调整）
2. 展示切换事件（打开全屏、关闭预览）
3. 系统动作触发（按工具名发起 `tools/call`）

## 状态矩阵（State Matrix）

| 状态 | 含义 | 典型触发 |
| --- | --- | --- |
| `idle` | 无文件可预览 | 未选中文件 |
| `loading` | 预览资源加载中 | 选中文件变更 |
| `ready` | 可交互预览 | 资源加载成功 |
| `error` | 预览失败 | 文件读取/解码失败 |
| `navigating` | 预览切换过渡 | 上一项/下一项/自动播放 |

## 扩展落位规则

1. 新功能先判定所属分区，再决定 `ui / features / layouts` 落位。
2. 跨区协作通过显式契约连接，禁止直接读取对方内部状态。
3. 系统动作入口优先落在 B2 预览区，避免下沉到基础 `ui` 组件。
