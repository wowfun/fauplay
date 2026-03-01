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
  - `features/preview/components/MediaPreviewCanvas`
  - `features/preview/components/MediaPlaybackControls`
- 边界约束：面板行为由预览域状态驱动，不反向控制网格渲染策略。

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
