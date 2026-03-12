# 111 Local File Browser 本地文件浏览器转向规范

## 1. 目的 (Purpose)

定义 Fauplay 从“本地图片/视频浏览器”转向“本地文件浏览器”的 MVP 行为契约（Local File Browser MVP Contract），统一全文件枚举、文件能力识别、按能力预览与媒体播放边界，作为实现与回归验收依据。

## 2. 关键术语 (Terminology)

- 本地文件浏览器（Local File Browser）
- 全文件枚举（All-file Enumeration）
- 文件预览能力（File Preview Capability）
- 媒体预览（Media Preview）
- 文本预览（Text Preview）
- 不可预览文件（Unsupported Preview File）
- 信息面板（File Info Panel）

术语值映射：

1. 文件预览能力值：`image`、`video`、`text`、`unsupported`。
2. 文本预览上限：`1048576` 字节（`1MB`）。
3. 类型筛选值保持：`all`、`image`、`video`。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 目录浏览默认展示所有文件类型（不再只展示媒体文件）。
2. 文件预览能力统一识别与渲染分支。
3. 文本预览能力（白名单扩展名 + 体积上限 + 二进制降级）。
4. 不可预览文件的信息面板展示与全屏行为。
5. 媒体播放快捷键与自动播放的“媒体限定”语义。

范围外（非目标）：

1. 新增类型筛选维度（本轮不扩展为文档/音频/压缩等分类按钮）。
2. 文本高亮、语法分析与搜索（本轮仅纯文本展示）。
3. PDF/音频/Office 等新增内置预览渲染器。
4. 新增或修改快捷键绑定。

## 4. 用户可见行为契约 (User-visible Contract)

1. 进入任意目录后，文件列表必须展示目录内全部文件类型。
2. 顶部类型筛选保持 `全部/图片/视频` 三档不变。
3. `图片/视频` 筛选时，目录项仍保留可导航能力。
4. 非媒体文件在“全部”筛选下必须可见、可单击、可双击。
5. 预览能力矩阵必须满足：
   - `image`：图像内嵌预览
   - `video`：视频内嵌预览
   - `text`：文本内容预览
   - `unsupported`：显示不可预览提示 + 文件信息面板
6. 文本文件超过 `1MB` 时，系统必须显示“文件过大”提示，不读取全文内容。
7. 文本内容检测到二进制特征（如 `NUL`）时，系统必须降级为不可文本预览。
8. 不可预览文件双击后仍需进入全屏，并保持“不可预览 + 信息面板”反馈。
9. 预览头部播放控件仅在媒体文件下显示。
10. 快捷键 `P/T/[ / ]` 与自动播放仅在当前预览为媒体文件时生效。

## 5. 跨组件共享语义定义 (Shared Semantics)

1. 文件预览能力判定
   - 基于统一能力判定入口，禁止网格图标、预览渲染、快捷键各自独立判断。
2. 文本预览白名单
   - 默认覆盖常见文本/代码扩展名（如 `txt/md/json/yaml/xml/csv/log/js/ts/tsx/css/html/py/sh`）。
3. 文本预览读取策略
   - 编码：UTF-8 容错解码。
   - 超限：`too_large`。
   - 二进制：`binary`。
   - 其他读取失败：`error`。
4. 信息面板语义
   - 至少展示：`MIME`、`大小`、`修改时间`。

## 6. 功能需求 (FR)

1. `FR-LFB-01` 系统必须在目录读取阶段纳入所有文件类型。
2. `FR-LFB-02` 系统必须提供统一的 `FilePreviewKind` 判定能力并供网格/预览/快捷键共享。
3. `FR-LFB-03` `FilterState.type` 必须保持 `all/image/video` 不变。
4. `FR-LFB-04` 文本预览必须仅对白名单扩展名生效。
5. `FR-LFB-05` 文本预览必须限制最大读取大小为 `1MB`。
6. `FR-LFB-06` 文本预览检测到二进制内容时必须回退为不可文本预览提示。
7. `FR-LFB-07` 不可预览文件必须提供信息面板，不得静默空白。
8. `FR-LFB-08` 双击任意文件（含不可预览文件）必须保持“打开全屏”行为。
9. `FR-LFB-09` 播放控件展示与预览快捷键触发必须受媒体能力约束。
10. `FR-LFB-10` 本轮不得新增快捷键绑定，`src/config/shortcuts.ts` 与 `docs/shortcuts.md` 需保持键位一致。
11. `FR-LFB-11` 组件命名必须完成 `MediaPreview*` 到 `FilePreview*` 的主链路重命名。

## 7. 验收标准 (AC)

1. `AC-LFB-01` 目录包含 `jpg/mp4/txt/zip` 时，“全部”视图可见全部文件。
2. `AC-LFB-02` 切换到“图片”仅显示图片+目录；切换到“视频”仅显示视频+目录。
3. `AC-LFB-03` `txt/md/json` 等文本文件在 `<=1MB` 时可在侧栏与全屏看到正文内容。
4. `AC-LFB-04` 文本文件超过 `1MB` 时显示超限提示，不展示正文。
5. `AC-LFB-05` 非文本二进制文件显示“无法预览此文件”并带信息面板。
6. `AC-LFB-06` 不可预览文件双击后仍打开全屏并显示同样提示与信息。
7. `AC-LFB-07` 媒体文件预览下 `P/T/[ / ]` 行为与改造前一致。
8. `AC-LFB-08` 非媒体文件预览下按 `P/T/[ / ]` 不触发播放状态变化。
9. `AC-LFB-09` 插件入口在媒体/文本/不可预览文件之间切换时保持可用。
10. `AC-LFB-10` 主链路组件已切换为 `FilePreview*` 命名并通过类型检查与 lint。

## 8. 失败与降级行为 (Failure & Degradation)

1. 文件读取失败时必须显示错误态，不得导致预览区域卡死。
2. 文本解码失败时必须降级为可见错误提示。
3. 文本超限与二进制命中时必须降级为提示态，不阻塞文件浏览。
4. 网关离线不影响本地文件浏览与按能力预览主链路。

## 9. 测试与验收场景 (Test Scenarios)

1. 混合目录文件枚举：普通视图与平铺视图一致性。
2. 类型筛选与目录导航并存验证。
3. 文本预览成功/超限/二进制/解码失败四类分支验证。
4. 不可预览文件侧栏与全屏行为一致性。
5. 媒体播放快捷键在媒体与非媒体之间切换的守卫验证。
6. 命名重构后懒加载、预加载与预览打开路径回归。

## 10. 公共接口与类型影响 (Public Interfaces & Types)

1. 新增：`FilePreviewKind = 'image' | 'video' | 'text' | 'unsupported'`。
2. 新增：`TextPreviewPayload`（包含 `status/content/fileSizeBytes/sizeLimitBytes/error`）。
3. 保持：`FilterState.type = 'all' | 'image' | 'video'`。

## 11. 关联主题 (Related Specs)

- 上游基线：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 交互基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 预览播放：[`../100-preview-playback/spec.md`](../100-preview-playback/spec.md)
- 缩略图管线：[`../101-thumbnail-pipeline/spec.md`](../101-thumbnail-pipeline/spec.md)
