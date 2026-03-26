# 105 Plugin Runtime Interaction 插件运行时交互总则

## 1. 目的 (Purpose)

定义 Fauplay 插件运行时交互总则（Plugin Runtime Interaction Baseline），统一 `workspace` / `file` 两类作用域实例在侧栏（Panel）与全屏（Lightbox）中的交互语义、状态边界与折叠行为，避免跨专题重复定义与语义漂移。

## 2. 关键术语 (Terminology)

- 插件运行时（Plugin Runtime）
- 同构实例（Isomorphic Instance）
- 作用域（Scope）：`workspace` / `file`
- 三段式交互（Three-segment Interaction）
- 动作入口侧栏（`PluginActionRail`）
- 工具工作台（`PluginToolWorkbench`）
- 工具结果面板（`PluginToolResultPanel`）
- 结果投射（Result Projection）
- 结果模式（Result Mode）
- 工作区工具面板折叠状态（`workspaceToolPanelCollapsed`）
- 预览工具面板折叠状态（`previewToolPanelCollapsed`）
- 工作区工具面板宽度状态（`workspaceToolPanelWidthPx`）
- 预览工具面板宽度状态（`previewToolPanelWidthPx`）
- 表现态（Presentation Surface）：`preview-panel` / `preview-lightbox` / `workspace-grid`

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `workspace` 与 `file` 两类插件实例的统一交互语义。
2. 三段式子分区（ActionRail / Workbench / ResultPanel）的职责边界。
3. 工具面板展开/收起与宽度状态的默认值、持久化与跨表现态一致性。
4. 结果队列与工作台状态在同一资源上下文下的一致性约束。
5. 与 `003-ui-ux` 的分工边界与引用关系。
6. 结果投射在工作区结果模式中的激活、替换与退出语义。

范围外：

1. MCP 协议字段、生命周期报文与错误码（归属 `002-contracts`）。
2. 单个工具输入输出业务语义（归属 `106+` 等功能专题）。
3. 像素级视觉规范与具体动效参数。

## 4. 用户可见行为契约 (User-visible Contract)

1. 系统必须以统一三段式呈现插件交互：`PluginActionRail -> PluginToolWorkbench -> PluginToolResultPanel`。
2. `workspace` 与 `file` 两个实例必须复用同一交互语义：工具上下文切换、选项维护、调用触发、结果入队、错误可见。
3. 结果展示采用调用队列平铺语义（后调用在前），每条结果项支持独立折叠/展开。
4. 工具面板收起后，动作入口仍必须可见并可触发展开恢复。
5. 收起/展开开关必须放置于各自 `PluginActionRail` 顶部，不得放在 `PluginToolResultPanel` 内。
6. `preview` 实例在侧栏与全屏之间切换时，折叠状态必须共享并保持一致。
7. `workspace` 与 `preview` 的折叠状态必须彼此隔离，互不影响。
8. 工具结果面板必须支持横向拖拽调宽，默认 `320px`，可调范围固定为 `320..640px`。
9. `workspace` 与 `preview` 的面板宽度状态必须彼此隔离，互不影响。
10. `preview` 实例在侧栏与全屏之间切换时，面板宽度状态必须共享并保持一致。
11. 本专题不新增快捷键契约；快捷键规则仍由 `003-ui-ux` 与 `src/config/shortcuts.ts` 管理。
12. 工作区结果项若携带 `projection`，系统必须按 `121-projected-file-grid` 的结果投射契约支持 `auto/manual` 进入结果模式。

## 5. 运行时同构与状态边界契约 (Runtime Isomorphism Contract)

1. 两个实例必须保持运行时状态隔离：任一实例的 `activeTool`、`optionValues`、`resultQueue` 变更不得影响另一实例。
2. `file` 作用域在 `preview-panel` 与 `preview-lightbox` 两种表现态下必须共享同一份工具工作台状态与结果队列状态。
3. 在同一预览文件上下文中切换侧栏/全屏表现态时，结果队列与工作台状态不得被重置。
4. `workspace` 作用域结果队列分桶键应按目录上下文维护；`file` 作用域结果队列分桶键应按文件上下文维护。
5. 当工具声明 `annotations.toolOptions` 或 `annotations.toolActions` 时，对应实例应展示 `PluginToolWorkbench`；两者均为空时不展示工作台。
6. `PluginActionRail` 图标渲染应优先消费 `annotations.icon`；不可解析时回退工具名缩写（最多 `3` 个字符）。
7. `preview.continuousCall.enabled` 作为标准工具选项键时，切换预览文件后应在资源 `ready` 阶段自动调用该工具，并在动作图标提供激活态提示。
8. 持续调用发起前应基于当前文件结果队列执行历史命中检查；若同 `tool + file + 请求签名` 已存在成功或失败记录，则本次持续调用静默跳过（不新增结果项）。
9. 当 `workspace` 作用域工具声明 `mutation=true` 且本次调用为真实执行（非 dry-run）并成功时，系统必须自动刷新当前目录视图。
10. 触发上述自动刷新时，若侧栏预览原本处于打开状态且刷新后仍存在可预览文件，系统不得强制关闭预览面板；应回退到可用文件并保持面板打开。
11. 每条结果项头部文案格式应统一为：`<工具名>: <调用时间> <调用状态>`，其中调用状态取值为“运行中/成功/失败”。
12. 工具结果详情应统一采用结构化 key-value 语义：简单类型展示 `<key>: <value>`，对象类型递归展示子键值，`list[dict]` 优先表格化展示，其余复杂类型提供 JSON 兜底视图；`result.ok` 仅用于状态判定，不在详情区重复展示。
13. `workspace` 作用域必须存在“当前激活结果投射”状态；该状态固定绑定到某条具体结果项，而不是绑定到工具。
14. 当结果投射被激活后，工作区网格、选择、预览遍历与工作区动作目标都必须切换到投射列表语义。
15. 路径导航、筛选变化与手动关闭结果模式后，激活中的结果投射必须被清空。

## 6. 面板折叠契约 (Panel Collapse Contract)

1. 系统必须暴露两个独立折叠状态接口：
   - `workspaceToolPanelCollapsed`
   - `previewToolPanelCollapsed`
2. 两个状态默认值均为 `false`（默认展开）。
3. 两个状态必须持久化到本地存储（localStorage）；读取失败或值非法时必须回退默认展开。
4. `workspaceToolPanelCollapsed` 仅影响 B1 工作区插件的工作台与结果面板容器，不影响 B1 动作入口可见性。
5. `previewToolPanelCollapsed` 同时影响侧栏预览与全屏预览中的插件工作台与结果面板容器。
6. `PluginToolResultPanel` 不承担面板级开关职责，不得内置“面板整体收起/展开”控制。
7. 收起与展开仅改变面板可见性，不得清空已存在结果队列与工作台选项值。

## 7. 面板宽度契约 (Panel Width Contract)

1. 系统必须暴露两个独立宽度状态接口：
   - `workspaceToolPanelWidthPx`
   - `previewToolPanelWidthPx`
2. 两个状态默认值均为 `320`（单位：像素）。
3. 两个状态必须支持拖拽调宽，且宽度范围固定为 `320..640`。
4. 拖拽计算后的宽度必须执行边界钳制（clamp），不得越界。
5. `workspaceToolPanelWidthPx` 仅影响 B1 工作区插件的工作台与结果面板容器。
6. `previewToolPanelWidthPx` 同时影响侧栏预览与全屏预览中的插件工作台与结果面板容器。
7. 两个宽度状态必须持久化到 localStorage；读取失败或值非法时必须回退默认 `320`。
8. 收起/展开工具面板不得重置已记忆的面板宽度值。

## 8. 功能需求 (FR)

1. `FR-PRI-01` 系统必须提供统一三段式插件交互结构。
2. `FR-PRI-02` `workspace` 与 `file` 两类实例必须复用同构交互语义。
3. `FR-PRI-03` 系统必须提供 `workspaceToolPanelCollapsed` 与 `previewToolPanelCollapsed` 两个独立状态接口。
4. `FR-PRI-04` 两个折叠状态默认值必须为 `false`。
5. `FR-PRI-05` 两个折叠状态必须持久化到 localStorage，并在读取异常时安全降级为默认展开。
6. `FR-PRI-06` 收起/展开开关必须位于对应 `PluginActionRail` 顶部。
7. `FR-PRI-07` `preview` 实例在侧栏与全屏表现态下必须共享同一折叠状态。
8. `FR-PRI-08` 收起行为不得导致结果队列或工作台选项值丢失。
9. `FR-PRI-09` `PluginToolResultPanel` 不得提供面板级整体收起/展开控制。
10. `FR-PRI-10` 本专题不得新增快捷键契约。
11. `FR-PRI-11` `preview.continuousCall.enabled` 在资源 `ready` 阶段必须触发连续调用，并具备结果队列历史命中静默跳过能力。
12. `FR-PRI-12` `workspace` 作用域 `mutation=true` 且真实执行成功时，系统必须自动刷新当前目录视图。
13. `FR-PRI-13` mutation 自动刷新后若仍存在可预览文件，系统不得强制关闭已打开的侧栏预览。
14. `FR-PRI-14` 结果项头部文案与结构化结果详情渲染必须遵循统一格式约束。
15. `FR-PRI-15` 系统必须提供 `workspaceToolPanelWidthPx` 与 `previewToolPanelWidthPx` 两个独立宽度状态接口。
16. `FR-PRI-16` 两个宽度状态默认值必须为 `320`，并支持 `320..640` 区间拖拽调宽。
17. `FR-PRI-17` 宽度状态必须持久化到 localStorage，并在读取异常或值非法时安全降级为 `320`。
18. `FR-PRI-18` `preview` 实例在侧栏与全屏表现态下必须共享同一宽度状态。
19. `FR-PRI-19` 收起/展开行为不得重置面板宽度状态。
20. `FR-PRI-20` 面板宽度更新必须执行边界钳制，不得越过 `320..640`。
21. `FR-PRI-21` `workspace` 结果项若携带 `projection`，系统必须支持按 `auto/manual` 进入结果模式。
22. `FR-PRI-22` 同一工作区上下文在任意时刻只允许一个激活中的结果投射。
23. `FR-PRI-23` 结果模式下的网格、选择、预览遍历与工作区动作目标必须统一以投射列表为准。
24. `FR-PRI-24` 路径导航、筛选变化与手动关闭必须退出结果模式并清空激活投射。

## 9. 验收标准 (AC)

1. `AC-PRI-01` 在 B1 点击收起后，仅隐藏工作台与结果面板，`WorkspaceActionRail` 仍可见且可点击恢复。
2. `AC-PRI-02` 在预览侧栏点击收起后，切换到全屏仍保持收起；从全屏返回侧栏状态一致。
3. `AC-PRI-03` `workspace` 与 `preview` 的折叠状态可独立切换，互不联动。
4. `AC-PRI-04` 刷新页面后，折叠状态可从 localStorage 恢复。
5. `AC-PRI-05` localStorage 不可用或值非法时，系统回退默认展开且不阻断工具调用。
6. `AC-PRI-06` 收起前后工具结果队列与工作台选项值保持一致，不发生重置。
7. `AC-PRI-07` `PluginToolResultPanel` 仅包含工作台与队列分层，不包含面板级整体开关。
8. `AC-PRI-08` 本专题交付后 `src/config/shortcuts.ts` 与 `docs/shortcuts.md` 不新增条目。
9. `AC-PRI-09` 连续调用启用后，切换文件会在 `ready` 态自动触发调用；已存在同签名历史记录时不会重复入队。
10. `AC-PRI-10` `workspace` mutation 工具真实执行成功后，网格区自动刷新为最新文件系统状态。
11. `AC-PRI-11` mutation 自动刷新后，若目录仍有可预览文件，侧栏预览保持打开并回退到可用文件。
12. `AC-PRI-12` 结果项头部格式与结构化详情渲染符合统一约束，`result.ok` 不在详情区重复展示。
13. `AC-PRI-13` 在 B1 可通过拖拽调宽工具面板，宽度始终落在 `320..640`。
14. `AC-PRI-14` 在预览侧栏可通过拖拽调宽工具面板，宽度始终落在 `320..640`。
15. `AC-PRI-15` 在预览侧栏调宽后切换到全屏，宽度保持一致；返回侧栏仍一致。
16. `AC-PRI-16` `workspace` 与 `preview` 宽度状态可独立调整，互不联动。
17. `AC-PRI-17` 刷新页面后，宽度状态可从 localStorage 恢复。
18. `AC-PRI-18` 收起后再展开，面板恢复收起前宽度值，不发生重置。
19. `AC-PRI-19` 某条工作区结果返回 `projection.entry='auto'` 后，工作区立即进入该结果模式。
20. `AC-PRI-20` 某条工作区结果返回 `projection.entry='manual'` 后，必须通过该结果项显式进入结果模式，未进入前目录网格保持不变。
21. `AC-PRI-21` 激活结果模式后，网格选择与预览遍历顺序与投射列表顺序一致。
22. `AC-PRI-22` 导航到其他路径、修改筛选或手动关闭结果模式后，工作区恢复目录浏览语义。

## 10. 公共接口与类型影响 (Public Interfaces & Types)

说明：本节定义规范层约束，不限定具体实现文件结构。

1. 折叠状态接口
   - `workspaceToolPanelCollapsed: boolean`
   - `previewToolPanelCollapsed: boolean`
2. 折叠状态切换入口
   - 必须存在对应 toggle 能力（例如 `setWorkspaceToolPanelCollapsed`、`setPreviewToolPanelCollapsed`）。
3. 折叠状态持久化
   - 必须存在 localStorage 读写与容错策略。
4. 预览状态共享
   - `preview-panel` 与 `preview-lightbox` 必须消费同一 `previewToolPanelCollapsed` 数据源。
5. 宽度状态接口
   - `workspaceToolPanelWidthPx: number`
   - `previewToolPanelWidthPx: number`
6. 宽度状态切换入口
   - 必须存在对应更新能力（例如 `setWorkspaceToolPanelWidthPx`、`setPreviewToolPanelWidthPx`）。
7. 宽度状态持久化
   - 必须存在 localStorage 读写、边界钳制与容错策略。
8. 预览宽度状态共享
   - `preview-panel` 与 `preview-lightbox` 必须消费同一 `previewToolPanelWidthPx` 数据源。
9. 工作区结果模式状态
   - 必须存在“当前激活结果投射”状态接口（例如 `activeWorkspaceProjection`）。

## 11. 失败与降级行为 (Failure & Degradation)

1. localStorage 读写失败时，系统应降级为会话态内存状态，不得阻断核心浏览与插件调用链路。
2. 折叠开关异常（如图标加载失败）不得阻断动作入口，必须保留文本可访问名称。
3. 当工具不可用或网关离线时，可隐藏或禁用动作入口，但不得破坏非插件核心浏览流程。
4. 宽度拖拽交互异常时，系统应保留可用默认宽度（`320`）并继续允许工具调用。

## 12. 默认值与一致性约束 (Defaults & Consistency)

1. 主题编号固定为 `105`，主题目录固定为 `105-plugin-runtime-interaction`。
2. 折叠状态默认值固定为展开（`false`）。
3. `preview` 折叠状态在侧栏与全屏必须共享同一事实源。
4. 面板宽度默认值固定为 `320`，最小值固定为 `320`，最大值固定为 `640`。
5. `preview` 宽度状态在侧栏与全屏必须共享同一事实源。
6. 规范职责分工：`003-ui-ux` 维护 UI 高层分区与交互基线，本规范维护插件运行时交互细则。
7. 结果投射的结构与字段契约归属 `121-projected-file-grid`；本规范只约束其运行时激活与退出语义。

## 13. 关联主题 (Related Specs)

- 上游基线：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 架构边界：[`../001-architecture/spec.md`](../001-architecture/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 工作区批量重命名专题：[`../106-batch-rename-workspace/spec.md`](../106-batch-rename-workspace/spec.md)
- 结果投射文件网格：[`../121-projected-file-grid/spec.md`](../121-projected-file-grid/spec.md)
