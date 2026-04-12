# 003 UI/UX 交互规范

## 目的

定义 Fauplay 的用户界面与交互体验基线（UI/UX Baseline），约束信息架构（Information Architecture, IA）、交互流程（Interaction Flow）、状态反馈（State Feedback）、可访问性（Accessibility, A11y）与降级行为（Graceful Degradation）。

## 关键术语 (Terminology)

- 信息架构（Information Architecture, IA）
- 功能分区（Functional Zones）
- 视口模式（Viewport Mode）
- 输入模式（Input Mode）
- 访问模式（Access Mode）
- 完全访问（`full-access`）
- 远程只读（`remote-readonly`）
- 工作区插件（Workspace Plugin）
- 预览插件（Preview Plugin）
- 插件运行实例（Plugin Runtime Instance）
- 底部结果面板（Bottom Result Panel）
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
4. 键盘、触控与兼具输入下的交互入口规则。
5. 完全访问与远程只读两种访问模式的 UI / 交互差异。
6. 网关能力的 UI 降级行为。
7. 可访问性与反馈可见性最低要求。
8. 启动页在本机 `full-access` 场景下的本机管理入口与全屏管理面板表现约束。

范围外：

1. MCP 报文结构与错误码定义（归属 `002-contracts`）。
2. 网关与插件运行机制（归属 `001-architecture`）。
3. 远程鉴权、会话与发布安全边界（归属 `001-architecture`、`002-contracts`、`005-local-data-contracts`、`006-security` 与相关连接文档）。
4. 品牌视觉系统与像素级视觉稿。

## 三轴组织契约 (Three-axis Organization Contract)

1. `003-ui-ux` 的正式组织方式固定为三条主轴：
   - 视口模式：[`viewport-modes.md`](./viewport-modes.md)
   - 输入模式：[`input-modes.md`](./input-modes.md)
   - 访问模式：[`access-modes.md`](./access-modes.md)
2. 默认基线组合固定为：`wide + keyboard + full-access`。
3. 非基线组合视为对该基线的表现层或能力层增量约束，不得隐式创建新的业务域。
4. 三轴可组合，但各轴文档只定义本轴差异：
   - 视口模式只定义布局、主视图与面板表现态差异
   - 输入模式只定义交互入口、守卫与冲突规避差异
   - 访问模式只定义 UI 能力可见性、命名与模式回退差异
5. 具体功能细则以下挂文档承接，不作为第四条主轴：
   - 功能区职责：[`areas.md`](./areas.md)
   - 顶部标签过滤：[`top-toolbar-tag-filter.md`](./top-toolbar-tag-filter.md)
   - 触摸手势：[`touch-interactions.md`](./touch-interactions.md)
6. 若需要定义某个具体三轴组合（例如 `compact + touch-first + remote-readonly`），应在 `100+` 集成专题中承接；`003-ui-ux` 不再新增按场景拆分的主入口文档。

## 运行时实现分层契约 (Runtime Presentation Layer Contract)

1. 工作区运行时必须先把三轴输入收敛为单一表现层真源（Presentation Profile），再驱动具体壳层与面板表现。
2. 三轴组合判断不得散落在 `WorkspaceShell`、工具栏、预览组件与面板组件中各自重复计算。
3. 表现层真源至少必须产出：
   - 当前视口壳类型（`wide | compact`）
   - 文件主点击打开目标（侧栏预览或全屏预览）
   - 是否支持常驻预览面板
   - 顶部工具区表现态
   - 人物面板、结果面板与插件区的容器表现态
   - 预览导航按钮与触摸手势是否启用
4. `compact` 下的次级 overlay 不得继续复用桌面 split-pane 作为内部布局基线；若某面板在 `wide` 下依赖左侧列表 + 右侧详情并列布局，`compact` 下必须允许转译为 staged list/detail flow、抽屉或等价的单列全宽表现态。
5. `WorkspaceShell` 负责工作区状态、业务门控与共享状态机装配，不得继续承担所有三轴表现差异的直接渲染。
6. 视口主壳必须按 `wide` / `compact` 拆分；输入模式与访问模式差异应作为壳内行为 profile 的增量约束，而不是继续衍生新的场景壳。
7. 侧栏预览与全屏预览必须继续共享同一套预览状态机；三轴组合只允许改变打开入口、容器形态和可见控件，不得分叉出移动专用或远程专用状态机。

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
6. 主内容区必须允许在目录主区与预览主区之外，承载工作区级“底部结果面板”子区，用于展示结果投射文件视图。
7. 工作区结果若返回文件投射，投射文件视图必须进入底部结果面板，不得覆盖目录主区，也不得伪装为底部状态区。
8. 底部结果面板必须支持显式打开/关闭、垂直高度调整，以及最大化覆盖整个文件网格区后的恢复。
9. 工作区插件与预览插件必须复用同一套插件运行内核；两者差异仅体现在资源上下文与表现层。
10. 顶部工具区必须允许承载只读帮助入口；其首批职责至少包含“查看当前快捷键”。
11. 视口差异导致的主视图、面板与 overlay 转译统一归属 [`viewport-modes.md`](./viewport-modes.md)。
12. 键盘、触控与兼具输入导致的交互入口差异统一归属 [`input-modes.md`](./input-modes.md) 与 [`touch-interactions.md`](./touch-interactions.md)。
13. 完全访问与远程只读导致的 UI 可见性与回退差异统一归属 [`access-modes.md`](./access-modes.md)。
14. 启动页上的本机 remembered-device 管理入口属于 `full-access` 启动态的本机管理能力，不得并入 `remote-readonly` 工作区主链路。

## 预览面板与全屏关系契约 (Panel-Fullscreen Relation Contract)

1. 全屏预览区（Lightbox Modal Zone）是 B2 预览面板区（File Preview Panel Zone）的全屏表现状态（Fullscreen Presentation State），不是独立业务域。
2. 侧栏预览与全屏预览必须共享同一套预览业务逻辑（Traversal / Auto-play / Action），禁止并行维护两套状态机。
3. 预览子分区语义在两种表现态下必须一致：`PreviewHeaderBar`、`PreviewControlGroup`、`PluginActionRail`、`PluginToolWorkbench`、`PluginToolResultPanel`、`FilePreviewViewport`、`PreviewFeedbackOverlay`。
4. 两种表现态允许差异仅限表现层（Presentation Layer）：容器形态、边框样式、覆盖层层级（z-index）与焦点管理（Focus Management）。
5. 任一表现态新增预览交互能力时，另一表现态必须同步支持；如需临时例外，必须先在对应 Delta 记录与回补计划。
6. 插件运行时状态共享、折叠策略与三段式细则统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。
7. 全屏预览覆盖层不得遮挡底部状态区（Status Bar Zone）；状态栏在侧栏与全屏预览两种表现态下都必须持续可见。
8. 三轴差异只允许改变预览的入口、容器或可触发动作，不得分叉出独立预览状态机。

## 插件运行时引用契约 (Plugin Runtime Reference Contract)

1. 插件运行时专属细则（同构语义、状态边界、折叠持久化、结果队列表现）统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。
2. 本规范仅保留 UI 分区、跨区交互优先级与可访问性最低要求，不重复定义插件运行时实现细则。
3. B1 布局中动作入口必须位于文件网格区最右侧；其左侧承载工作台与结果队列容器。
4. B2 布局可按预览表现态调整容器样式，但不得破坏 `003` 与 `105` 共同约束的语义一致性。
5. `PluginToolResultPanel` 仍属于插件运行时结构化结果面板；工作区底部结果面板属于文件浏览子区，两者不得混淆。
6. 底部结果面板中的投射标签、活动表面与跨 Root 浏览语义统一归属 [`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)。

## 核心交互契约 (Core Interaction Contract)

1. 单击目录进入目录。
2. 单击文件打开侧栏预览（必要时自动打开侧栏）。
3. 双击文件打开全屏预览。
4. `Esc` 关闭优先级必须为：全屏预览 -> 侧栏预览。
5. 侧栏与全屏共享“上一项/下一项、顺序/随机、自动播放”语义。
6. 非媒体文件（如文本/压缩包）必须允许进入预览域；不可内嵌预览时提供可见提示与文件信息面板。
7. 工作区插件主要作用于当前工作目录或当前选中文件列表，不以“当前预览文件”作为唯一上下文。
8. 预览插件主要作用于当前预览文件，不扩展为目录级批处理入口。
9. 工作区结果投射打开后，投射文件浏览进入底部结果面板；在 `normal` 模式下目录主区继续可见，在 `maximized` 模式下底部结果面板可覆盖文件网格区。
10. 文件网格区应支持复选框多选，且文件与目录均可被勾选。
11. 网格区应支持范围选择（`Shift + 单击`、`Shift + 方向键`），默认覆盖当前勾选集合。
12. `Ctrl/Cmd + 单击` 网格项应仅切换勾选态，不触发目录进入或预览打开。
13. 底部状态区必须持续展示当前活动表面的 `可见 / 已选` 统计，并在存在明确目标文件时补充 `大小 / 修改时间 / 父目录路径` 元信息。
14. 上述交互描述默认口径为 `wide + keyboard + full-access` 基线；其他组合的差异统一由三轴文档增量定义。
15. 三轴差异可以新增触摸入口、抽屉或回退动作，但不得无上游记录地改写浏览、预览与遍历语义。
16. 工作区中会改变用户可见上下文的导航状态至少包含：`currentPath` 与当前可见预览态（`pane | lightbox` + 当前文件）；运行时必须将这些状态接入浏览器 History API，使浏览器 `后退 / 前进` 优先在工作区内部回放，而不是直接离开当前站点。
17. 上述浏览器历史接入不要求引入独立前端路由系统，但地址栏 URL 必须随工作区导航状态变化而更新，且不得把仅属当前工作区的临时态泄漏为新的业务域路由。

## 布局默认值契约 (Layout Default Contract)

1. 预览面板默认宽度应保证在缩略图 `512` 档位下，左侧文件网格默认可呈现每行 `3` 列缩略图（以当前卡片宽度与间距计算口径为准）。
2. 默认宽度应按主内容区容器宽度自适应计算；当容器宽度不足以同时满足该列数与最小面板宽度时，允许回退到最小面板宽度。
3. 用户手动拖拽调整预览面板宽度后，系统不得再自动覆盖该手动宽度选择。
4. 手动宽度选择必须持久化到 localStorage，并在刷新或重启后恢复；读取失败或值非法时应回退默认宽度。

## 状态契约 (State Contract)

1. 预览可视状态必须覆盖：`idle`、`loading`、`ready`、`error`；其中 `ready` 允许媒体与文本预览两类内容态。
2. 预览导航触发过程可进入 `navigating` 过渡态。
3. 工具动作运行态必须覆盖：`default`、`loading`、`error`、`disabled`。
4. 错误状态必须用户可见，不得静默失败。
5. 网格选择状态至少覆盖：活跃项（Active Item）与勾选集合（Checked Set）。
6. 插件调用可见性、结果队列、工作台、连续调用、折叠状态与 mutation 刷新联动细则统一归属 [`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)。

## 快捷键契约 (Keyboard Contract)

1. 快捷键默认配置唯一真源为 `src/config/shortcuts.json`；运行时覆盖链按 `src/config/shortcuts.json -> ~/.fauplay/global/shortcuts.json -> <root>/.fauplay/shortcuts.json` 解析。
2. 输入控件聚焦时，非全局快捷键必须失效。
3. 快捷键文档 `docs/shortcuts.md` 必须与配置一致。
4. 预览快捷键在侧栏与全屏表现态下语义必须一致。
5. 网格多选快捷键至少覆盖：`Ctrl/Cmd + A` 全选与 `Esc` 清空选择（仅在无打开预览时生效）。
6. 快捷键运行时读取入口必须统一；组件不得各自维护独立的快捷键真源或解析逻辑。
7. 顶部工具栏帮助面板展示的快捷键列表必须来自运行时合并结果，而不是静态默认配置快照。
8. 快捷键帮助状态不得将输入焦点、`event.repeat` 或 `defaultPrevented` 直接展示为“当前不可用”。
9. 快捷键在 `touch` 输入模式下属于加速入口而非唯一入口；核心操作不得仅依赖快捷键暴露。

## 能力与降级契约 (Capability & Degradation Contract)

1. 网关离线时，核心浏览链路（目录浏览、筛选、预览）必须保持可用。
2. 系统动作入口只在对应工具可用时展示或可点击。
3. 工具调用中必须提供进行态反馈，失败必须提供错误反馈。
4. 网关离线时，工作区插件与预览插件入口均可隐藏或禁用，但不得阻断核心浏览与预览链路。
5. 网格多选能力不得依赖网关在线状态。
6. 返回结构化 JSON 的 `file` 作用域工具应提供统一结构化结果展示与 JSON 兜底能力，不依赖按工具名定制渲染器。
7. 顶部工具区“标签过滤相关 UI”显示必须由标签快照门控（存在可读取标签快照文件且存在可过滤标注）；任一条件不满足时必须完全隐藏该 UI 区块。
8. 当标签过滤 UI 因门控失效被隐藏时，系统必须自动将标签过滤状态回退到 `all`，避免不可见过滤残留。
9. 顶部标签过滤详细交互统一归属 [`./top-toolbar-tag-filter.md`](./top-toolbar-tag-filter.md)，包括 include/exclude 面板行为、候选列表、“未标注”特殊项、`source` / `key` 分面、面板级临时状态与刷新联动。
10. 顶部标签过滤不提供手动 `all/boolean` 切换控件；过滤模式由 include/exclude 条件自动推导（任一非空=`boolean`，全空=`all`）。
11. 顶部标签过滤与预览头部标签显示在读取标签时，不得以 `source=meta.annotation` 作为前置条件；默认应基于统一标签模型读取全部来源标签。
12. “未标注”语义固定为：当前文件在统一标签模型中不存在任何来源标签。
13. 用户点击顶部标签过滤的“包含标签”或“排除标签”按钮并打开候选面板时，前端必须立即强制刷新当前 root 的标签快照，从数据库读取最新标签信息；面板内容可先展示缓存并在刷新完成后无感更新，但不得继续停留在仅首次进入 root 时的旧快照。
14. 顶部工具栏中会影响文件结果集的过滤状态必须按 `rootId` 持久化到本地，并在同一 root 刷新或重进后恢复；范围固定为搜索、类型、隐藏空文件夹、排序以及标签 include/exclude 与 `OR/AND`。
15. 上述过滤状态持久化不得包含面板级临时态与非过滤项，包括 `source` / `key` 分面、浮层开关、帮助/收藏/历史/地址栏展开态、缩略图尺寸与平铺视图。
16. 三轴差异引入的抽屉、overlay、bottom sheet 或模式切换入口，不得隐式改变对应业务域的核心语义与状态归属。

## 可访问性基线 (Accessibility Baseline)

1. 图标按钮必须提供可读名称（`title` 或 `aria-label`）。
2. 状态表达不得仅依赖颜色传达，必须有文本或结构化提示。

## 命名与分层约束 (Naming & Layering Contract)

1. 分层遵循：`ui` / `features` / `layouts`。
2. 命名应表达语义职责，避免过度抽象命名。
3. 文件预览子分区采用 `*Preview*` 命名族（如 `FilePreviewViewport`）；插件三段式子分区采用 `Plugin*` 前缀命名。

## 非目标

1. 不定义协议字段与网关内部实现细节。
2. 不定义像素级视觉规范与品牌系统。
3. 不定义功能专题的排期与任务拆解。

## 关联主题

- 上游基线：`000-foundation`
- 架构边界：`001-architecture`
- 协议契约：`002-contracts`
- 视口模式细则：[`./viewport-modes.md`](./viewport-modes.md)
- 输入模式细则：[`./input-modes.md`](./input-modes.md)
- 访问模式细则：[`./access-modes.md`](./access-modes.md)
- 功能区细则：[`./areas.md`](./areas.md)
- 顶部标签过滤细则：[`./top-toolbar-tag-filter.md`](./top-toolbar-tag-filter.md)
- 触摸交互细则：[`./touch-interactions.md`](./touch-interactions.md)
- 插件运行时交互：`105-plugin-runtime-interaction`
- 本地文件浏览器：`111-local-file-browser`
- 触控优先紧凑远程只读工作区：`126-touch-first-compact-remote-readonly-workspace`
