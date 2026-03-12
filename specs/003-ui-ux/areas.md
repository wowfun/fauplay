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
│   └─ B2. 预览面板区（File Preview Panel Zone，可折叠）       │
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

- 职责：文件列表虚拟渲染、选择态、双击打开、键盘导航承接、复选框多选与范围选择、工作区级插件入口与批处理触发。
- 当前组件：
  - `features/explorer/components/FileBrowserGrid`
  - `features/explorer/components/FileGridViewport`
  - `features/explorer/components/FileGridCard`
  - `features/explorer/components/WorkspacePluginHost`
  - `features/plugin-runtime/components/PluginActionRail`
  - `features/plugin-runtime/components/PluginToolWorkbench`
  - `features/plugin-runtime/components/PluginToolResultPanel`
- 边界：聚焦浏览与选择，不直接处理预览播放状态机；工作区插件仅面向当前工作目录或当前选中文件列表。
- 选择约束：B1 同时维护活跃项与勾选集合，二者语义不得混淆。
- 布局约束：B1 内部从左到右顺序固定为 `FileGridViewport | WorkspaceToolPanel | WorkspaceActionRail`，动作入口在最右侧，工作台与结果队列在其左侧。

### B2 预览面板区（File Preview Panel Zone）

- 职责：当前选中文件预览、遍历控制、自动播放控制、非媒体文件信息展示、预览插件动作入口、工具工作台展示（选项+操作）、按调用队列平铺的工具结果展示。
- 当前组件：
  - `features/preview/components/FilePreviewPanel`
  - `features/preview/components/PreviewHeaderBar`
  - `features/preview/components/PreviewControlGroup`
  - `features/plugin-runtime/components/PluginActionRail`
  - `features/plugin-runtime/components/PluginToolWorkbench`
  - `features/plugin-runtime/components/PluginToolResultPanel`
  - `features/preview/components/FilePreviewViewport`
  - `features/preview/components/PreviewFeedbackOverlay`
- 边界：由预览域状态驱动，不反向控制网格渲染策略；预览插件仅面向当前预览文件。
- 运行时细则：结果分层、折叠状态、侧栏/全屏一致性等约束见 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。

### C 底部状态区（Status Bar Zone）

- 职责：展示可见项统计与当前选中项元信息。
- 当前组件：`features/explorer/components/ExplorerStatusBar`
- 边界：只读展示，不触发目录变更与预览控制。

### D 全屏预览区（Lightbox Modal Zone）

- 职责：沉浸式文件查看，复用预览域逻辑。
- 当前组件：`features/preview/components/FileLightboxModal`
- 边界：作为覆盖层，不改变底层 A/B1/C 布局状态。

## 插件三段式子分区命名规范（Canonical Plugin Sub-zones）

| 规范中文名 | 规范英文名 | 当前实现载体 |
| --- | --- | --- |
| 动作入口侧栏 | `PluginActionRail` | 独立组件 |
| 工具工作台 | `PluginToolWorkbench` | 独立组件 |
| 工具结果面板 | `PluginToolResultPanel` | 独立组件 |

说明：
- `workspace` 与 `preview` 必须共享上述三段式交互语义；可使用作用域前缀形成实例化子区名（如 `WorkspaceActionRail`、`PreviewActionRail`）。
- `data-plugin-subzone` 作为推荐（SHOULD）标记方式，可用于测试与调试，但本轮不设为强制。

## 文件预览子分区与全屏对应关系 (Sub-zone Mapping)

| 面板态子分区 | 全屏态对应区 | 语义一致性要求 |
| --- | --- | --- |
| `PreviewHeaderBar` | 全屏头部栏 | MUST |
| `PreviewControlGroup` | 全屏控制组 | MUST |
| `PluginActionRail` | 全屏动作入口区 | MUST |
| `PluginToolWorkbench` | 全屏工具工作台区 | MUST |
| `PluginToolResultPanel` | 全屏结果面板区 | MUST |
| `FilePreviewViewport` | 全屏文件视口 | MUST |
| `PreviewFeedbackOverlay` | 全屏反馈层 | MUST |

## 插件作用域与入口映射 (Plugin Scope-to-Zone Mapping)

| 工具作用域 (`scopes`) | 入口分区 | 典型入口形态 | 主要作用对象 |
| --- | --- | --- | --- |
| `workspace` | B1 文件网格区 | `WorkspaceActionRail`（最右侧）+ `WorkspaceToolPanel`（其左侧） | 当前工作目录 / 当前选中文件列表 |
| `file` | B2 预览面板区 | `PreviewActionRail` + `PreviewToolPanel` | 当前预览文件 |

## B1 选择语义映射 (Grid Selection Mapping)

| 交互入口 | 作用对象 | 默认行为 |
| --- | --- | --- |
| 复选框点击 | 单项（文件或目录） | 切换勾选态，不触发目录进入/预览打开 |
| 普通单击卡片 | 单项（文件或目录） | 保持既有行为（目录进入、文件预览） |
| `Ctrl/Cmd + 单击` | 单项（文件或目录） | 仅切换勾选态 |
| `Shift + 单击` | 范围 | 覆盖当前勾选集合 |
| `Shift + 方向键` | 范围 | 扩展范围，预览在 `Shift` 松开后提交 |

## 插件运行时细则引用（Plugin Runtime Reference）

插件三段式实例的输入输出、状态边界、折叠持久化与跨表现态一致性细则统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)；本文件仅维护 UI 分区职责与落位映射。

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
3. 动作入口按 `scopes` 落位：`workspace` 在 B1，`file` 在 B2，避免下沉到基础 `ui` 组件。
4. 插件三段式必须复用同一运行内核：`PluginActionRail`、`PluginToolWorkbench`、`PluginToolResultPanel`。
5. `Esc` 交互优先级保持：先关闭预览态，再执行网格清空勾选。
