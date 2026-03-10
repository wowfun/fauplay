# 003 UI/UX 交互规范

## 目的

定义 Fauplay 的用户界面与交互体验基线（UI/UX Baseline），约束信息架构（Information Architecture, IA）、交互流程（Interaction Flow）、状态反馈（State Feedback）、可访问性（Accessibility, A11y）与降级行为（Graceful Degradation）。

## 关键术语 (Terminology)

- 信息架构（Information Architecture, IA）
- 功能分区（Functional Zones）
- 工作区插件（Workspace Plugin）
- 预览插件（Preview Plugin）
- 插件运行实例（Plugin Runtime Instance）
- 当前工作目录（Current Working Directory）
- 当前预览文件（Current Preview File）
- 当前选中文件列表（Selected File List）
- 网格多选（Grid Multi-selection）
- 范围选择（Range Selection）
- 预览域状态（Preview Domain State）
- 键盘契约（Keyboard Contract）
- 优雅降级（Graceful Degradation）
- 表现层（Presentation Layer）

## 范围

范围内：

1. 页面分区与职责边界。
2. 文件浏览与预览交互行为。
3. 预览面板与全屏预览关系约束。
4. 键盘快捷键规则与输入焦点保护。
5. 网关能力的 UI 降级行为。
6. 可访问性与反馈可见性最低要求。

范围外：

1. MCP 报文结构与错误码定义（归属 `002-contracts`）。
2. 网关与插件运行机制（归属 `001-architecture`）。
3. 品牌视觉系统与像素级视觉稿。

## 功能分区契约 (Functional Zone Contract)

1. 顶部工具区（Top Toolbar Zone）
2. 主内容区（Main Content Zone）
3. 底部状态区（Status Bar Zone）
4. 全屏覆盖层（Lightbox Modal Zone）

约束：

1. 跨区协作必须通过显式契约（props/events/state）连接。
2. 禁止跨区直接耦合内部实现细节。
3. 详细分区与子分区见 [`areas.md`](./areas.md)。
4. 工作区插件入口归属 B1 文件网格区侧，主要承载目录级或列表级操作。
5. 预览插件入口归属 B2 预览面板区及其全屏表现态，主要承载当前预览文件操作。
6. 工作区插件与预览插件必须复用同一套插件运行内核；两者差异仅体现在资源上下文与表现层。

## 预览面板与全屏关系契约 (Panel-Fullscreen Relation Contract)

1. 全屏预览区（Lightbox Modal Zone）是 B2 预览面板区（Media Preview Panel Zone）的全屏表现状态（Fullscreen Presentation State），不是独立业务域。
2. 侧栏预览与全屏预览必须共享同一套预览业务逻辑（Traversal / Auto-play / Action），禁止并行维护两套状态机。
3. 预览子分区语义在两种表现态下必须一致：`PreviewHeaderBar`、`PreviewControlGroup`、`PluginActionRail`、`PluginToolWorkbench`、`PluginToolResultPanel`、`PreviewMediaViewport`、`PreviewFeedbackOverlay`。
4. 两种表现态允许差异仅限表现层（Presentation Layer）：容器形态、边框样式、覆盖层层级（z-index）与焦点管理（Focus Management）。
5. 任一表现态新增预览交互能力时，另一表现态必须同步支持；如需临时例外，必须先在对应 Delta 记录与回补计划。
6. 插件运行时状态共享、折叠策略与三段式细则统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。

## 插件运行时引用契约 (Plugin Runtime Reference Contract)

1. 插件运行时专属细则（同构语义、状态边界、折叠持久化、结果队列表现）统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。
2. 本规范仅保留 UI 分区、跨区交互优先级与可访问性最低要求，不重复定义插件运行时实现细则。
3. B1 布局中动作入口必须位于文件网格区最右侧；其左侧承载工作台与结果队列容器。
4. B2 布局可按预览表现态调整容器样式，但不得破坏 `003` 与 `105` 共同约束的语义一致性。

## 核心交互契约 (Core Interaction Contract)

1. 单击目录进入目录。
2. 单击文件打开侧栏预览（必要时自动打开侧栏）。
3. 双击文件打开全屏预览。
4. `Esc` 关闭优先级必须为：全屏预览 -> 侧栏预览。
5. 侧栏与全屏共享“上一项/下一项、顺序/随机、自动播放”语义。
6. 工作区插件主要作用于当前工作目录或当前选中文件列表，不以“当前预览文件”作为唯一上下文。
7. 预览插件主要作用于当前预览文件，不扩展为目录级批处理入口。
8. 文件网格区应支持复选框多选，且文件与目录均可被勾选。
9. 网格区应支持范围选择（`Shift + 单击`、`Shift + 方向键`），默认覆盖当前勾选集合。
10. `Ctrl/Cmd + 单击` 网格项应仅切换勾选态，不触发目录进入或预览打开。

## 布局默认值契约 (Layout Default Contract)

1. 预览面板默认宽度应保证在缩略图 `512` 档位下，左侧文件网格默认可呈现每行 `3` 列缩略图（以当前卡片宽度与间距计算口径为准）。
2. 默认宽度应按主内容区容器宽度自适应计算；当容器宽度不足以同时满足该列数与最小面板宽度时，允许回退到最小面板宽度。
3. 用户手动拖拽调整预览面板宽度后，系统不得再自动覆盖用户当前会话内的手动宽度选择。

## 状态契约 (State Contract)

1. 预览可视状态必须覆盖：`idle`、`loading`、`ready`、`error`。
2. 预览导航触发过程可进入 `navigating` 过渡态。
3. 工具动作运行态必须覆盖：`default`、`loading`、`error`、`disabled`。
4. 错误状态必须用户可见，不得静默失败。
5. 网格选择状态至少覆盖：活跃项（Active Item）与勾选集合（Checked Set）。
6. 插件调用可见性、结果队列、工作台、连续调用、折叠状态与 mutation 刷新联动细则统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。

## 快捷键契约 (Keyboard Contract)

1. 快捷键配置唯一来源为 `src/config/shortcuts.ts`。
2. 输入控件聚焦时，非全局快捷键必须失效。
3. 快捷键文档 `docs/shortcuts.md` 必须与配置一致。
4. 预览快捷键在侧栏与全屏表现态下语义必须一致。
5. 网格多选快捷键至少覆盖：`Ctrl/Cmd + A` 全选与 `Esc` 清空选择（仅在无打开预览时生效）。

## 能力与降级契约 (Capability & Degradation Contract)

1. 网关离线时，核心浏览链路（目录浏览、筛选、预览）必须保持可用。
2. 系统动作入口只在对应工具可用时展示或可点击。
3. 工具调用中必须提供进行态反馈，失败必须提供错误反馈。
4. 网关离线时，工作区插件与预览插件入口均可隐藏或禁用，但不得阻断核心浏览与预览链路。
5. 网格多选能力不得依赖网关在线状态。
6. 返回结构化 JSON 的 `file` 作用域工具应提供统一结构化结果展示与 JSON 兜底能力，不依赖按工具名定制渲染器。

## 可访问性基线 (Accessibility Baseline)

1. 图标按钮必须提供可读名称（`title` 或 `aria-label`）。
2. 状态表达不得仅依赖颜色传达，必须有文本或结构化提示。

## 命名与分层约束 (Naming & Layering Contract)

1. 分层遵循：`ui` / `features` / `layouts`。
2. 命名应表达语义职责，避免过度抽象命名。
3. 预览媒体域子分区采用 `Preview*` 前缀命名；插件三段式子分区采用 `Plugin*` 前缀命名。

## 非目标

1. 不定义协议字段与网关内部实现细节。
2. 不定义像素级视觉规范与品牌系统。
3. 不定义功能专题的排期与任务拆解。

## 关联主题

- 上游基线：`000-foundation`
- 架构边界：`001-architecture`
- 协议契约：`002-contracts`
- 插件运行时交互：`105-plugin-runtime-interaction`
- 功能专题：`100+`
- 网格多选：`103-grid-multi-selection`
