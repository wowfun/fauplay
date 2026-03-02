---
updated: 2026-03-01
---

# 002 UI 主要功能区划分

## 1. 目的

本文定义 Fauplay 的界面功能分区（Functional Zones），用于统一页面结构、组件归属和交互边界。  
目标是让新功能在扩展时能快速确定“放在哪个区、由谁负责、与谁协作”。

## 2. 总体分区模型

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

## 3. 各区职责与边界

### 3.1 A 顶部工具区（Top Toolbar Zone）

- 主要职责：目录导航、搜索筛选、排序、视图模式切换。
- 组件归属：`features/explorer/components/ExplorerToolbar`。
- 边界约束：只发起筛选/导航意图，不承载文件预览渲染逻辑。

### 3.2 B1 文件网格区（File Browser Grid Zone）

- 主要职责：文件列表虚拟渲染、选择态、双击打开、键盘导航承接。
- 组件归属：
  - `features/explorer/components/FileBrowserGrid`
  - `features/explorer/components/FileGridViewport`
  - `features/explorer/components/FileGridCard`
- 边界约束：聚焦“浏览与选择”，不直接处理媒体播放状态机。

### 3.3 B2 预览面板区（Media Preview Panel Zone）

- 主要职责：当前选中文件预览、上一个/下一个切换、自动播放控制、系统动作入口。
- 组件归属：
  - `features/preview/components/MediaPreviewPanel`
  - `features/preview/components/PreviewHeaderBar`
  - `features/preview/components/PreviewTitleRow`
  - `features/preview/components/PreviewControlGroup`
  - `features/preview/components/MediaPlaybackControls`
  - `features/preview/components/MediaPreviewCanvas`
  - `features/preview/components/PreviewActionRail`
  - `features/preview/components/PreviewMediaViewport`
  - `features/preview/components/PreviewFeedbackOverlay`
- 边界约束：面板行为由预览域状态驱动，不反向控制网格渲染策略。

#### 3.3.1 子分区命名规范（Canonical Sub-Zone Names）

| 规范中文名 | 规范英文名 | 当前实现载体 | 代码位置 | DOM 子分区标记 |
| --- | --- | --- | --- | --- |
| 预览头部栏 | `PreviewHeaderBar` | 独立组件 | `features/preview/components/PreviewHeaderBar.tsx` | `data-preview-subzone="PreviewHeaderBar"` |
| 文件标题行 | `PreviewTitleRow` | 独立组件 | `features/preview/components/PreviewTitleRow.tsx` | `data-preview-subzone="PreviewTitleRow"` |
| 头部控制组 | `PreviewControlGroup` | 独立组件 | `features/preview/components/PreviewControlGroup.tsx` | `data-preview-subzone="PreviewControlGroup"` |
| 预览动作侧栏 | `PreviewActionRail` | 独立组件 | `features/preview/components/PreviewActionRail.tsx` | `data-preview-subzone="PreviewActionRail"` |
| 媒体展示视口 | `PreviewMediaViewport` | 独立组件 | `features/preview/components/PreviewMediaViewport.tsx` | `data-preview-subzone="PreviewMediaViewport"` |
| 预览反馈层 | `PreviewFeedbackOverlay` | 独立组件（挂载于 `PreviewMediaViewport` 内） | `features/preview/components/PreviewFeedbackOverlay.tsx` | `data-preview-subzone="PreviewFeedbackOverlay"` |

编排关系（当前实现）：
1. `MediaPreviewPanel` 负责 B2 顶层编排，组合 `PreviewHeaderBar + MediaPreviewCanvas`。
2. `MediaPreviewCanvas` 负责 Body 编排，组合 `PreviewActionRail + PreviewMediaViewport`。
3. `PreviewFeedbackOverlay` 作为 `PreviewMediaViewport` 的子层（Overlay Layer）渲染。

命名约束：
1. 子分区命名统一使用 `Preview` 作为前缀，避免 `Header/Canvas/Rail` 单词裸用。
2. `PreviewHeaderBar` 必须包含且仅包含两行：`PreviewTitleRow` + `PreviewControlGroup`。
3. `MediaPreviewCanvas` 保留为“媒体渲染组件名”，其所在布局区域命名为 `PreviewMediaViewport`。
4. 后续新增子分区时，先在本表补充规范名，再进行实现。

#### 3.3.2 结构分层（ASCII）

```txt
┌────────────────────────────────────────────────────────────┐
│ B2. 预览面板区 Media Preview Panel Zone                    │
├────────────────────────────────────────────────────────────┤
│ [PreviewHeaderBar]                                         │
│  [PreviewTitleRow]   文件名（单行省略，title 保留全名）      │
│  [PreviewControlGroup] 遍历模式 | 间隔 | 自动播放 | 关闭      │
├────────────────────────────────────────────────────────────┤
│ [PreviewBody]                                              │
│ ┌──────────────┬─────────────────────────────────────────┐ │
│ │ PreviewAction│ PreviewMediaViewport                    │ │
│ │ 系统动作入口  │ - loading/error/empty/media 视图切换     │ │
│ │ tools/list 驱动│ - 通过快捷键触发上一项/下一项            │ │
│ └──────────────┴─────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

#### 3.3.3 输入与输出契约（Input/Output Contract）

输入（Input）：

1. 当前文件（Selected/Active File）。
2. 预览遍历状态（Traversal State）：顺序/随机、可前进/后退。
3. 自动播放状态（Auto-play State）：开关、间隔、视频结束/错误回调。
4. 动作工具元数据（Action Tool Metadata）：来自 `tools/list` 的 `name/title/scopes/mutation`。

输出（Output）：

1. 预览控制事件：`onToggleAutoPlay`、`onToggleTraversalOrder`。
2. 展示切换事件：`onOpenFullscreen`（仅面板态可用）、`onClose`。
3. 系统动作事件：触发当前工具 `name` 对应的 MCP `tools/call` 调用。

#### 3.3.4 状态矩阵（State Matrix）

1. `idle`：无文件可预览，显示空态提示。
2. `loading`：读取文件并生成 `objectURL`。
3. `ready`：媒体可交互（图片或视频）。
4. `error`：文件读取失败或媒体解码失败，显示错误文案。
5. `navigating`：快捷键或自动播放触发切换并回到 `loading` 或 `ready`。

#### 3.3.5 与全屏预览区关系

- 全屏预览区是 B2 的全屏表现状态（Fullscreen Presentation State）。
- 两者共享同一套预览业务逻辑（Traversal/Auto-play/Action）。
- 差异仅限表现层（Presentation Layer）：容器形态、边框样式、覆盖层层级（z-index）。

### 3.4 C 底部状态区（Status Bar Zone）

- 主要职责：展示可见文件统计与当前选中项元信息。
- 组件归属：`features/explorer/components/ExplorerStatusBar`。
- 边界约束：只读展示，不触发目录变更与预览控制。

### 3.5 D 全屏预览区（Lightbox Modal Zone）

- 主要职责：沉浸式媒体查看、键盘关闭、与侧栏一致的播放控制。
- 组件归属：`features/preview/components/MediaLightboxModal`。
- 边界约束：作为覆盖层，不改变底层工具区/网格区布局状态。
- 统一约束：全屏预览区是预览面板区（Media Preview Panel Zone）的全屏表现状态（Fullscreen Presentation State），只改变表现形式，不新增独立业务状态机。

## 4. 状态归属建议

- 页面编排状态（Layout State）：放 `layouts/*` 或页面入口（如面板宽度、是否显示面板）。
- 业务域状态（Feature State）：放 `features/*/hooks/*`（如预览遍历、自动播放、随机队列）。
- 基础 UI 状态（UI Local State）：仅放在 `ui/*` 内部（如按钮按压态、输入框聚焦态）。

## 5. 扩展落位规则

1. 新功能先判断所属分区，再决定放 `ui / features / layouts`。
2. 跨区协作通过事件与 props 契约（Contract）连接，避免跨区直接读写内部实现。
3. 插件动作入口统一放在功能区组件中（通常 B2），不下沉到 `ui` 基础组件。
