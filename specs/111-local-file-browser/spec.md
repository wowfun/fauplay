# 111 Local File Browser 本地文件浏览器规范

## 1. 目的 (Purpose)

定义 Fauplay 的本地文件浏览器稳定契约（Local File Browser Contract），统一目录文件浏览、统一预览能力、底部结果面板（Bottom Result Panel）与结果投射（Result Projection）语义，确保：

1. 工作区主区始终保持目录文件浏览，而不是被工具结果替换。
2. 文件预览能力统一收敛为 `image | video | text | unsupported`，并覆盖文本超限与二进制降级。
3. 工具结果可通过顶层 `projection` 把文件集合投射到底部结果面板标签，而不是伪装成目录枚举。
4. 跨 Root 的投射文件可基于 `absolutePath` 完成缩略图、正文与内容延迟读取。
5. 右侧预览、选择、遍历与工作区动作目标统一跟随当前活动表面（Active Surface）。

## 2. 关键术语 (Terminology)

- 本地文件浏览器（Local File Browser）
- 目录表面（Directory Surface）
- 底部结果面板（Bottom Result Panel）
- 面板可见状态（Panel Visibility）
- 面板显示模式（Panel Display Mode）
- 结果投射（Result Projection）
- 投射标签（Projection Tab）
- 投射文件（Projection File）
- 投射进入方式（Projection Entry）
- 活动表面（Active Surface）
- 文件预览能力（File Preview Capability）
- 绝对路径原生读取（Absolute-path Native Fetch）

术语值映射：

1. 文件预览能力值固定为：`image | video | text | unsupported`。
2. 投射进入方式固定为：`auto | manual`。
3. 投射排序模式固定为：`listed | group_contiguous | mixed`。
4. 面板可见状态固定为：`open | closed`。
5. 面板显示模式固定为：`normal | maximized`。
6. 顶部类型筛选值保持：`all | image | video`。
7. 文本预览上限固定为：`1048576` 字节（`1MB`）。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 目录浏览默认展示全部文件类型。
2. 文件预览能力统一识别与渲染分支。
3. 文本预览白名单、体积上限、二进制降级与不可预览信息面板。
4. 工作区主区目录网格与底部结果面板的并存语义。
5. `tools/call.result.projection` 的稳定结构、进入方式与排序语义。
6. 跨 Root 投射文件的 `absolutePath` 延迟读取链路。
7. 活动表面下的选择、预览遍历与工具目标归属。

范围外：

1. 新增文档/音频/压缩等筛选维度。
2. 文本高亮、语法分析与全文搜索。
3. PDF、音频、Office 等新增内置预览渲染器。
4. 把所有 mutation 工具都升级为跨 Root 可执行目标。
5. 新增或修改快捷键绑定。

## 4. 核心语义 (Core Semantics)

1. 工作区主区固定显示当前目录枚举结果，不得因结果投射而替换为投射文件列表。
2. 结果投射固定绑定到某一条具体结果项，而不是绑定到工具名、工作台实例或目录上下文。
3. 工作区必须提供底部结果面板；投射结果以“投射标签”的形式存在，支持多标签并存、面板打开/关闭、垂直高度拖拽与最大化/恢复。
4. 底部结果面板必须支持三种表现状态：
   - `closed`：面板隐藏
   - `normal`：面板显示并占用可调垂直高度
   - `maximized`：面板覆盖整个文件网格区（B1），但不得覆盖预览面板区（B2）或底部状态区（C）
5. 面板在 `normal` 模式下拖拽得到的最后高度必须被记住；从 `maximized` 恢复时，必须回到该最后正常高度。
6. 面板关闭再打开后，必须恢复既有投射标签集合，并恢复关闭前的显示模式与最近正常高度。
7. 投射标签在路径导航与顶部筛选变化后继续保留；切换 Root 时必须统一关闭全部投射标签。
8. 任意时刻只能有一个活动表面，取值固定为：
   - `directory`
   - `projection tab`
9. 右侧预览、上一项/下一项遍历、范围选择与工作区工具目标都必须以当前活动表面为准。
10. 目录表面与每个投射标签都必须拥有独立的选择态、滚动位置与当前聚焦文件，不得互相覆盖。
11. 投射标签只展示文件，不展示目录项。
12. 对无法消费当前投射文件集合的工具，系统必须保持可见但禁用，不得伪造 `relativePath` 或 Root 上下文继续执行。
13. 投射文件显示路径必须遵循单一规则：
    - 有 `sourceRootPath + sourceRelativePath` 时优先显示 Root 相对路径。
    - 否则显示 `absolutePath`。

## 5. 用户可见行为契约 (User-visible Contract)

1. 进入任意目录后，文件列表必须展示目录内全部文件类型。
2. 顶部类型筛选保持 `全部/图片/视频` 三档不变。
3. `图片/视频` 筛选下，目录项仍必须保持可导航能力。
4. 非媒体文件在“全部”筛选下必须可见、可单击、可双击。
5. 预览能力矩阵固定为：
   - `image`：图像内嵌预览
   - `video`：视频内嵌预览
   - `text`：文本正文预览
   - `unsupported`：不可预览提示 + 文件信息面板
6. 文本文件超过 `1MB` 时，系统必须显示“文件过大”提示，不读取全文内容。
7. 文本内容检测到二进制特征（如 `NUL`）时，系统必须降级为不可文本预览。
8. 不可预览文件双击后仍需进入全屏，并保持“不可预览 + 信息面板”反馈。
9. 媒体播放控件与 `P/T/[ / ]`、自动播放只在当前预览为媒体文件时生效。
10. 底部结果面板必须提供显式的打开/关闭入口，以及“最大化/恢复面板大小”入口。
11. 当结果项返回 `projection.entry='auto'` 时，系统必须自动打开底部结果面板并激活对应投射标签。
12. 当结果项返回 `projection.entry='manual'` 时，结果面板必须保留显式“打开结果标签”入口；未打开前，目录表面保持不变。
13. 在 `normal` 模式下，目录主区与底部结果面板必须并存可见；投射文件只出现在底部结果面板，不得替换目录数据源。
14. 在 `maximized` 模式下，底部结果面板必须覆盖整个文件网格区；恢复后回到最大化前的正常面板高度。
15. 面板关闭后既有投射标签不得被隐式清空；再次打开后必须恢复既有标签与最近面板大小。
16. 投射标签支持多标签并存；重复打开同一结果项时，系统必须激活已有标签而不是重复创建。
17. 点击目录网格文件时，活动表面切换为目录；点击投射标签文件或切换投射标签时，活动表面切换为对应标签。
18. 投射结果若声明 `ordering.mode='group_contiguous'`，同组文件必须连续显示；若声明 `mixed`，必须按 payload 已声明口径混排，不得前端擅自拆分来源分段。
19. 当投射结果声明 `ordering.mode='group_contiguous'` 且结果项携带稳定 `groupId` 时，底部结果面板必须按组分行展示；同一可见行内不得混排多个 `groupId`。
20. 当投射标签采用“按组分行”布局时，底部结果面板仍必须保持独立的垂直滚动能力，并继续复用工作区网格现有快捷键语义（选择、清空选择、方向切换、分页切换、打开当前项）。
21. 当活动投射标签来自重复文件结果，且满足 `group_contiguous + groupId` 时，底部结果面板必须允许在标签顶部承载重复组专用规则条，并在每个组头承载组级动作。
22. 上述重复组专用规则条与组头动作只允许批量改写当前活动投射标签的选择态；不得把结果标签替换为新的数据源，也不得破坏现有键盘导航、滚动与预览跟随语义。
23. 当活动投射标签中的文件被工作区或预览区 mutation 工具成功删除后，底部结果面板必须同步移除这些已删文件，并清理相应选择态与焦点态；不得继续把已删文件保留为可操作目标。
24. 若删除后某个投射标签已无剩余文件，系统必须自动关闭该空标签；若仍有剩余文件，则应保持当前标签稳定，不得因本次删除强制跳转到其他标签或目录表面。
25. 对按组分行的投射标签，删除成功后的剔除必须同时清理缩略图卡片、复选框选中态与组头统计；用户不得继续在底部结果面板看到或重新勾选已删文件。

## 6. 投射 payload 契约 (Projection Payload Contract)

`tools/call.result` 顶层可选返回：

```json
{
  "projection": {
    "id": "duplicates:workspace:1742880000000",
    "title": "重复文件",
    "entry": "manual",
    "ordering": {
      "mode": "group_contiguous",
      "keys": ["groupRank:asc", "lastModifiedMs:desc", "displayPath:asc"]
    },
    "files": []
  }
}
```

约束：

1. `projection` 必须位于结果 payload 顶层，不得仅通过 `tools/list.annotations` 静态声明。
2. `projection.id` 必须在“该结果项”范围内稳定可引用。
3. `projection.title` 用于投射标签标题与可见上下文。
4. `projection.entry` 只能为 `auto | manual`。
5. `projection.ordering.mode` 只能为：
   - `listed`：按 `files[]` 原序展示
   - `group_contiguous`：按组连续展示
   - `mixed`：按同一扁平序列混排展示
6. `projection.ordering.keys[]` 为可选声明，采用 `<field>:<direction>` 字符串形式。
7. `projection.files[]` 最小字段固定为：
   - `absolutePath`
   - `name`
   - `previewKind`
   - `displayPath`
   - `sourceType`
8. `projection.files[]` 建议补充字段：
   - `mimeType`
   - `size`
   - `lastModifiedMs`
   - `sourceRootPath`
   - `sourceRelativePath`
   - `groupId`
   - `groupRank`
   - `isCurrentFile`
   - `deletedAt`

## 7. 跨组件共享语义与数据读取契约 (Shared Semantics & Data Fetch)

1. 文件预览能力判定必须基于统一入口；网格图标、预览渲染与快捷键不得各自独立判断。
2. 文本预览默认白名单覆盖常见文本/代码扩展名，如 `txt/md/json/yaml/xml/csv/log/js/ts/tsx/css/html/py/sh`。
3. 文本预览读取策略固定为：
   - 编码：UTF-8 容错解码
   - 超限：`too_large`
   - 二进制：`binary`
   - 其他读取失败：`error`
4. 投射文件不得在结果 payload 中内联大体积二进制内容；缩略图、正文与文件内容必须按需延迟读取。
5. Gateway 必须提供基于 `absolutePath` 的读取链路：
   - `GET /v1/files/content?absolutePath=...`
   - `GET /v1/files/thumbnail?absolutePath=...&sizePreset=...`
   - `POST /v1/files/text-preview`
6. `POST /v1/files/text-preview` 输入必须至少支持：
   - `absolutePath`
   - `sizeLimitBytes?`
7. 上述绝对路径读取接口的失败必须可见，但不得破坏其他目录文件或投射文件的继续浏览与选择。

## 8. 功能需求 (FR)

1. `FR-LFB-01` 系统必须在目录读取阶段纳入所有文件类型。
2. `FR-LFB-02` 系统必须提供统一的 `FilePreviewKind` 判定能力并供网格、预览与快捷键共享。
3. `FR-LFB-03` `FilterState.type` 必须保持 `all/image/video` 不变。
4. `FR-LFB-04` 文本预览必须仅对白名单扩展名生效。
5. `FR-LFB-05` 文本预览必须限制最大读取大小为 `1MB`。
6. `FR-LFB-06` 文本预览检测到二进制内容时必须回退为不可文本预览提示。
7. `FR-LFB-07` 不可预览文件必须提供信息面板，不得静默空白。
8. `FR-LFB-08` 双击任意文件（含不可预览文件）必须保持“打开全屏”行为。
9. `FR-LFB-09` 媒体播放控件展示与预览快捷键触发必须受媒体能力约束。
10. `FR-LFB-10` 工作区主区必须固定保持目录数据源，不得被结果投射替换。
11. `FR-LFB-11` 系统必须提供底部结果面板，并支持多个投射标签并存。
12. `FR-LFB-12` 底部结果面板必须支持显式打开/关闭。
13. `FR-LFB-13` 底部结果面板必须支持 `normal` 模式下的垂直高度拖拽调整。
14. `FR-LFB-14` 底部结果面板必须支持最大化覆盖整个文件网格区，以及恢复到上次正常高度。
15. `FR-LFB-15` 面板关闭再打开后，系统必须恢复既有投射标签集合与最近面板大小。
16. `FR-LFB-16` `projection` 的声明源必须是结果 payload，而不是 `tools/list` 静态注解。
17. `FR-LFB-17` 系统必须支持 `auto | manual` 两种投射打开方式。
18. `FR-LFB-18` 投射标签必须在路径导航与筛选变化后继续保留；切 Root 时统一关闭。
19. `FR-LFB-19` 右侧预览、遍历、范围选择与工作区动作目标必须统一跟随当前活动表面。
20. `FR-LFB-20` 目录表面与投射标签必须保持独立选择态与滚动状态。
21. `FR-LFB-21` 投射文件必须采用“基础字段内联 + 重内容延迟读取”的混合模型。
22. `FR-LFB-22` 系统必须支持基于 `absolutePath` 的跨 Root 缩略图、正文与内容读取。
23. `FR-LFB-23` 对无法由当前工具契约消费的投射文件集合，系统必须降级禁用，而不是伪造路径参数继续执行。
24. `FR-LFB-24` 本专题不得新增快捷键绑定。
25. `FR-LFB-25` 投射标签在按组分行布局下，必须继续支持底部结果面板自身的垂直滚动。
26. `FR-LFB-26` 投射标签在按组分行布局下，必须复用工作区网格现有快捷键语义，而不是退化为仅鼠标可操作视图。
27. `FR-LFB-27` 底部结果面板必须支持在特定投射标签上承载标签级辅助工具条，而不改变主目录网格与投射文件列表的并存语义。
28. `FR-LFB-28` 对重复文件等按组分行投射，底部结果面板必须支持在组头承载组级动作，并继续保持该标签的受控选择态与工作区工具目标一致。
29. `FR-LFB-29` 工作区或预览区 mutation 工具成功删除活动投射标签中的文件后，系统必须同步从该投射标签移除对应文件，并清理其选择态与焦点态。
30. `FR-LFB-30` 当投射标签因删除而变为空时，系统必须自动关闭该空标签；当仍有剩余文件时，不得强制跳转到其他标签或目录表面。
31. `FR-LFB-31` 对按组分行投射，删除成功后的投射清理必须同步更新组内文件卡片、复选框状态与组头统计，不得留下可交互的已删残留项。

## 9. 验收标准 (AC)

1. `AC-LFB-01` 目录包含 `jpg/mp4/txt/zip` 时，“全部”视图可见全部文件。
2. `AC-LFB-02` 切换到“图片”仅显示图片+目录；切换到“视频”仅显示视频+目录。
3. `AC-LFB-03` `txt/md/json` 等文本文件在 `<=1MB` 时可在侧栏与全屏看到正文内容。
4. `AC-LFB-04` 文本文件超过 `1MB` 时显示超限提示，不展示正文。
5. `AC-LFB-05` 非文本二进制文件显示“无法预览此文件”并带信息面板。
6. `AC-LFB-06` 不可预览文件双击后仍打开全屏并显示同样提示与信息。
7. `AC-LFB-07` 媒体文件预览下 `P/T/[ / ]` 行为与改造前一致。
8. `AC-LFB-08` 非媒体文件预览下按 `P/T/[ / ]` 不触发播放状态变化。
9. `AC-LFB-09` 结果返回 `projection.entry='auto'` 后，底部结果面板自动打开并激活对应投射标签。
10. `AC-LFB-10` 结果返回 `projection.entry='manual'` 后，必须通过结果项显式打开投射标签；未打开前目录表面保持不变。
11. `AC-LFB-11` 在 `normal` 模式下，底部结果面板可通过拖拽调整高度，且目录主区仍可见。
12. `AC-LFB-12` 点击“最大化面板大小”后，底部结果面板覆盖整个文件网格区；点击“恢复面板大小”后，回到最大化前的正常高度。
13. `AC-LFB-13` 面板关闭后再次打开，既有投射标签、最近正常高度与最近显示模式得到恢复。
14. `AC-LFB-14` 同时打开多个投射标签时，可切换、关闭且互不覆盖选择态与滚动位置。
15. `AC-LFB-15` 路径导航与筛选变化后，已打开投射标签继续保留；切 Root 后全部关闭。
16. `AC-LFB-16` 点击目录文件后，右侧预览与工作区动作目标跟随目录；点击投射标签文件后，预览与动作目标跟随对应标签。
17. `AC-LFB-17` 激活投射标签后打开图片、视频、文本文件时，仍按统一 `FilePreviewKind` 规则进入对应预览分支。
18. `AC-LFB-18` 当投射声明 `ordering.mode='group_contiguous'` 或 `mixed` 时，底部标签展示顺序符合 payload 声明。
19. `AC-LFB-19` 跨 Root 投射文件可通过 `absolutePath` 成功显示缩略图或正文，无需依赖当前 `rootHandle`。
20. `AC-LFB-20` 对重复文件等 `group_contiguous` 投射，底部结果面板中每个可见分组行只包含一个重复组；不同组不会出现在同一行内。
21. `AC-LFB-21` 对重复文件等按组分行投射，滚轮或触控板可在底部结果面板内继续向下浏览后续分组，不会在中途卡住或留在首屏。
22. `AC-LFB-22` 对重复文件等按组分行投射，激活底部结果标签后继续支持工作区网格已有快捷键切换当前文件与打开当前项，且不会新增额外快捷键集合。
23. `AC-LFB-23` 对重复文件等按组分行投射，底部结果面板可在标签顶部显示专用规则条，并在每个组头显示组级动作，而不会替换目录主区或破坏投射标签滚动。
24. `AC-LFB-24` 通过重复文件结果标签顶部规则条或组头动作改写选择态后，右侧预览、状态栏计数与工作区工具目标仍跟随当前活动投射标签的选中项。
25. `AC-LFB-25` 在活动投射标签中删除已选文件成功后，这些文件会立即从当前投射标签与其选中集合中移除，不会继续留在底部结果面板中作为可删除目标；无论删除入口来自工作区动作栏还是右侧预览动作区。
26. `AC-LFB-26` 若活动投射标签中的最后一个文件被删除成功，则该结果标签自动关闭；若标签中仍有其他文件，则当前标签保持打开且不跳转到其他标签或目录表面。
27. `AC-LFB-27` 在按组分行的重复文件结果标签中删除任意已选文件成功后，被删文件的缩略图卡片、复选框和组头计数会立即消失或更新；用户无法再次勾选这些已删文件，动作栏删除按钮不会因残留项进入异常闪烁状态。

## 10. 公共接口与类型影响 (Public Interfaces & Types)

1. `FilePreviewKind = 'image' | 'video' | 'text' | 'unsupported'`
2. `TextPreviewPayload`
   - `status`
   - `content`
   - `fileSizeBytes`
   - `sizeLimitBytes`
   - `error`
3. `FilterState.type = 'all' | 'image' | 'video'`
4. `ResultProjectionEntry = 'auto' | 'manual'`
5. `ResultProjectionOrderingMode = 'listed' | 'group_contiguous' | 'mixed'`
6. `ResultProjection`
   - `id`
   - `title`
   - `entry`
   - `ordering?`
   - `files[]`
7. 工作区必须存在“活动表面”与“投射标签集合”的状态接口，但本规范不限定具体实现命名。
8. 工作区必须存在底部结果面板状态接口：
   - 可见状态（如 `isResultPanelOpen`）
   - 显示模式（如 `resultPanelDisplayMode: 'normal' | 'maximized'`）
   - 最近正常高度（如 `resultPanelHeightPx`）

## 11. 失败与降级行为 (Failure & Degradation)

1. 文件读取失败时必须显示错误态，不得导致预览区域卡死。
2. 文本解码失败时必须降级为可见错误提示。
3. 文本超限与二进制命中时必须降级为提示态，不阻塞文件浏览。
4. `absolutePath` 读取失败时，系统必须仅影响当前文件的缩略图或正文，不得破坏其他目录文件或投射文件的浏览。
5. 工具不可用、网关离线或上下文不兼容时，可见性可保留，但执行入口必须安全禁用，不得破坏非插件核心浏览流程。

## 12. 默认值与一致性约束 (Defaults & Consistency)

1. 主题编号固定为 `111`，主题目录固定为 `111-local-file-browser`。
2. 顶部类型筛选值固定为 `all | image | video`。
3. `projection.ordering.mode` 缺失时，默认按 `listed` 解释。
4. 投射文件显示路径始终遵循“Root 相对优先，否则绝对路径”的单一规则。
5. 底部结果面板初始默认状态为 `closed`；首次打开时使用默认正常高度。
6. 底部结果面板关闭/打开与最大化/恢复都必须保留最近正常高度。
7. 投射标签不要求跨会话持久化；刷新页面后可不恢复。
8. 本专题不新增快捷键。

## 13. 关联主题 (Related Specs)

- 上游基线：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 交互基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 预览播放：[`../100-preview-playback/spec.md`](../100-preview-playback/spec.md)
- 缩略图管线：[`../101-thumbnail-pipeline/spec.md`](../101-thumbnail-pipeline/spec.md)
- 资产级重复文件检测：[`../120-asset-duplicate-detection/spec.md`](../120-asset-duplicate-detection/spec.md)
- 统一回收站虚拟路由：[`../122-unified-trash-route/spec.md`](../122-unified-trash-route/spec.md)
