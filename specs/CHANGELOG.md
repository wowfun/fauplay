# CHANGELOG

## 2026-03-15
### Changed
- 更新 `specs/100-preview-playback/spec.md`、`src/config/shortcuts.ts`、`docs/shortcuts.md`、`src/features/preview/hooks/usePreviewTraversal.ts`、`src/features/workspace/components/WorkspaceShell.tsx` 与预览组件链路：新增视频快捷键 `J/L/R`（快退/快进/循环倍速），新增预览头部“快进步长（3/5/10s）”与“倍速（0.5/1/3/5x）”下拉并与快捷键联动；步长与倍速状态支持 localStorage 持久化并在侧栏/全屏共享。
- 更新 `specs/114-metadata-annotation/spec.md`、`specs/003-ui-ux/spec.md`、`specs/003-ui-ux/areas.md`、`src/features/preview/utils/annotationDisplayStore.ts`、`src/features/workspace/components/WorkspaceShell.tsx`、`src/layouts/ExplorerWorkspaceLayout.tsx` 与 `src/features/explorer/components/ExplorerToolbar.tsx`：顶部标签过滤改为自动模式判定（移除手动 `all/boolean` 切换）；当 include/exclude 任一非空时等价布尔过滤、均为空时等价 `all`，`OR/AND` 单独切换不触发过滤；继续保留 sidecar 门控隐藏与门控失效回退 `all` 语义。
- 更新 `specs/114-metadata-annotation/spec.md`、`src/features/preview/utils/annotationDisplayStore.ts`、`src/features/workspace/components/WorkspaceShell.tsx`、`src/features/preview/components/FilePreviewPanel.tsx` 与 `src/features/preview/components/PreviewHeaderBar.tsx`：预览头部标签展示改为独立于 `meta.annotation` 插件启用状态（基于当前 root 的 `.fauplay/.annotations.v1.json` 后台异步预加载），并调整为与文件名同行右侧展示；重命名编辑态下标签保持可见。
- 更新 `specs/100-preview-playback/spec.md`、`src/config/shortcuts.ts`、`docs/shortcuts.md`、`src/features/workspace/components/WorkspaceShell.tsx`、`src/features/preview/components/FilePreviewCanvas.tsx` 与 `src/features/preview/components/FilePreviewViewport.tsx`：新增预览态 `Space` 视频播放/暂停快捷键，优先控制全屏视频，其次控制侧栏视频，并与侧栏/全屏快捷键语义保持一致。
- 更新 `specs/113-preview-inline-rename/spec.md` 与 `src/features/preview/components/PreviewTitleRow.tsx`：重命名编辑态输入框改为占满标题区可用宽度，避免默认 `20ch` 窄输入框影响长文件名编辑。
- 更新 `specs/113-preview-inline-rename/spec.md` 与 `src/features/preview/hooks/usePreviewTraversal.ts`：修复随机遍历模式下重命名后误回退首项的问题；当刷新窗口出现短暂状态不一致时不再强制回落到媒体首项，保持重命名文件的预览锚点。
- 更新 `specs/105-plugin-runtime-interaction/spec.md`、`src/layouts/ExplorerWorkspaceLayout.tsx`、`src/features/plugin-runtime/components/PluginToolResultPanel.tsx`、`src/features/explorer/components/WorkspacePluginHost.tsx`、`src/features/preview/components/PreviewPluginHost.tsx` 及预览链路组件：为工作区/预览插件工具面板新增拖拽调宽与 localStorage 持久化（默认 `320px`，钳制 `320..640px`），并保持预览侧栏与全屏共享同一宽度状态。
- 更新 `specs/003-ui-ux/spec.md` 与 `src/features/workspace/components/WorkspaceShell.tsx`：预览面板主分栏宽度在用户手动拖拽后新增 localStorage 持久化与启动恢复（键 `fauplay:preview-pane-width-ratio`），并在恢复手动宽度后继续禁用自适应默认宽度覆盖。
- 更新 `specs/114-metadata-annotation/spec.md`：将指纹执行约束从“必须前端 Web Worker”调整为“必须后台异步队列（前端 Worker 或 MCP server 队列均可）”，并明确当前实现推荐服务端队列以减少前后端双实现成本。
- 更新 `specs/114-metadata-annotation/spec.md` 与 `specs/114-metadata-annotation/plan.md`：sidecar 路径统一为 `.fauplay/.annotations.v1.json`。
- 更新 `src/features/plugin-runtime/components/AnnotationQuickTagPanel.tsx`：修复字段编辑器输入时因不稳定 React key 导致的逐字符失焦问题。
- 更新 `tools/mcp/metadata-annotation/server.mjs`：sidecar 写入迁移到 `.fauplay/.annotations.v1.json`（读取兼容旧路径 `.fauplay.annotations.v1.json`），并为目录扫描/指纹计算增加 `EIO/EACCES/EPERM/ENOENT` 容错跳过，避免 `refreshBindings` 因单路径 I/O 异常整体失败。
- 更新 `.fauplay/mcp.json` 与 `src/lib/gateway.ts`：为 `meta.annotation` 提升调用超时预算到 `120000ms`，避免 `refreshBindings` 在大目录下触发 `MCP_SERVER_TIMEOUT`。
- 更新 `specs/114-metadata-annotation/spec.md`：刷新语义重构为“逐标注项校验（size/mtime 快照）+ ES 候选搜索 + bindingFp 比对”，并新增 `fileSizeBytes/fileMtimeMs` 与 `orphanReason=search_unavailable` 契约，明确不再兼容旧 sidecar 路径。
- 更新 `tools/mcp/metadata-annotation/server.mjs`：`refreshBindings` 移除 root 递归全量指纹索引构建，改为逐条标注重绑；`setValue` 新增 `fileSizeBytes/fileMtimeMs` 落盘；sidecar 读取仅保留 `.fauplay/.annotations.v1.json`。
- 新增 `tools/mcp/metadata-annotation/config.json`：为 `meta.annotation` 提供独立 ES 配置入口（`esPath/instanceName/maxCandidates`）。

## 2026-03-14
### Added
- 新增 `specs/114-metadata-annotation/spec.md`：定义 `meta.annotation` 标注插件规范，覆盖 sidecar 标注库、`bindingFp/exactFp/simFp` 分层指纹（去除 `mtime` 依赖）、Web Worker 按需懒计算队列、orphan/conflict 重绑语义，以及预览态 enum 字段 `0..9` 自动快捷打标契约。

### Changed
- 更新 `specs/109-soft-delete/spec.md`：新增“预览软删除提交后自动续选”契约，明确当前预览文件删除成功后不得回退首项；媒体文件复用预览遍历模式（顺序/随机），非媒体文件按当前列表顺序前进且末项回绕到首项。
- 更新 `src/features/preview/types/mutation.ts`、`PreviewPluginHost.tsx` 与 `WorkspaceShell.tsx`：预览 mutation 回调新增 `mutationToolName/deletedRelativePath` 上下文透传，`fs.softDelete` 成功后在目录刷新前先完成目标续选（媒体走 `next` 遍历，非媒体走列表 next + wrap），修复删除后光标回到首项的问题。
- 更新 `.fauplay/mcp.json`：注册 `metadata-annotation` MCP server（`node tools/mcp/metadata-annotation/server.mjs`）。
- 更新 `tools/mcp/metadata-annotation/server.mjs`：落地 `meta.annotation` 插件基础能力，支持 `setValue/refreshBindings/cleanupOrphans/findExactDuplicates/findSimilarImages`、sidecar 标注库 `.fauplay.annotations.v1.json` 读写、`bindingFp`（无 `mtime` 依赖）与可选 `exact/sim` 指纹计算、orphan/conflict 重绑语义。
- 更新 `src/features/plugin-runtime/components/PluginToolWorkbench.tsx`、`AnnotationQuickTagPanel.tsx` 与 `PreviewPluginHost.tsx`：新增标注字段配置入口（全局默认 + root 覆盖）与预览态 enum 值快捷打标链路（点击值按钮或数字键触发 `meta.annotation.setValue`）。
- 更新 `src/config/shortcuts.ts` 与 `docs/shortcuts.md`：新增预览态 `0-9` 快捷标注规则（仅激活字段、按定义顺序映射前 10 个枚举值）。

## 2026-03-13
### Added
- 新增 `specs/113-preview-inline-rename/spec.md`：定义预览标题点击重命名契约，覆盖侧栏/全屏同构交互、`Enter/失焦` 提交与 `Esc` 取消、严格冲突失败语义（禁止自动序号去重提交）、以及刷新后预览回绑约束。
- 新增 `specs/112-video-same-duration-search/spec.md`：定义 `media.searchSameDurationVideos` 文件级插件契约，覆盖 `search/openPath/openEverything` 三操作、`search.scope`（`global|root`）选项语义、表格化结果与行级打开动作，以及持续调用命中历史静默跳过规则。
- 新增 `tools/mcp/video-same-duration/`：提供 `server.mjs` 与 `config.json`，支持基于 ES 的相同时长视频检索、系统默认应用打开与 Everything 搜索唤起能力。

### Changed
- 更新 `src/features/preview/components/FilePreviewPanel.tsx`、`PreviewHeaderBar.tsx`、`PreviewTitleRow.tsx`、`usePreviewTraversal.ts`、`WorkspaceShell.tsx` 与预览布局接线：新增预览标题内联重命名（复用 `fs.batchRename` 的 `dry-run -> 校验 -> commit` 链路），并在重命名成功后通过 `preferredPreviewPath` 优先回绑当前预览文件。
- 更新 `.fauplay/mcp.json`：注册 `video-same-duration` MCP server。
- 更新插件结果渲染链路：结构化结果支持表格单元格动作按钮（用于行级“打开”）。
- 更新预览插件状态管理：仅对 `media.searchSameDurationVideos.search.scope` 增加 LocalStorage 持久化与刷新恢复。
- 更新 `tools/mcp/video-same-duration/server.mjs` 与配置契约：ES 输出解析改为固定 `UTF-8/GBK` 自动识别（不再暴露手工编码配置项），修复中文路径乱码导致的“打开失败”问题。
- 更新 `tools/mcp/video-same-duration/config.json` 与 `server.mjs`：容差字段从 `toleranceSeconds` 切换为 `toleranceMs`（默认 `500`），匹配判定升级为毫秒级（无向后兼容字段读取）。
- 更新 `tools/mcp/video-same-duration/config.json` 与专题规范：`esPath` 默认值迁移为共享路径 `tools/bin/everything/es.exe`，用于后续多场景复用。
- 更新 `tools/mcp/video-same-duration/config.json`、`server.mjs` 与专题规范：新增 `toleranceSize`（KB）大小容差配置；`-1` 表示忽略大小容差，`>=0` 时按 `size` 容差范围参与 `search/openEverything` 等价查询与结果过滤。
- 更新 `tools/mcp/video-same-duration/server.mjs` 与专题规范：新增 WSL `drvfs` 挂载失效自动修复（命中 `No such device` 时自动执行 `sudo -S mount -t drvfs <DRIVE>: /mnt/<drive>` 并单次重试），密码来源仅 `SUDO_PASSWORD`（不兼容 `sudo_password`）。
- 更新 `tools/mcp/video-same-duration/server.mjs` 与专题规范：为 `ffprobe/stat` 与自动重挂载流程增加超时与失败短路，避免挂载异常时触发前端 `MCP_CLIENT_TIMEOUT`。

## 2026-03-12
### Added
- 新增 `specs/111-local-file-browser/spec.md`：定义“本地文件浏览器转向”MVP 契约，覆盖全文件枚举、统一预览能力矩阵（`image/video/text/unsupported`）、文本预览 `1MB` 上限与二进制降级、非媒体文件信息面板与媒体快捷键守卫语义。

### Changed
- 更新 `specs/000-foundation/spec.md`、`specs/003-ui-ux/spec.md`、`specs/003-ui-ux/areas.md`、`specs/100-preview-playback/spec.md`、`specs/101-thumbnail-pipeline/spec.md` 与 `specs/README.md`：将产品主定位收敛为“本地文件浏览器”，并将 `100/101` 明确为文件浏览主链路下的媒体子能力专题；同步将预览主链路组件命名语义从 `MediaPreview*` 切换为 `FilePreview*`。
- 更新 `src/lib/fileSystem.ts` 与 `src/hooks/useFileSystem.ts`：目录读取改为默认纳入所有文件类型，类型筛选保持 `all/image/video` 三档不变。
- 新增 `src/lib/filePreview.ts` 并更新网格/预览/遍历链路：统一文件能力识别（`FilePreviewKind`），新增文本白名单判定与 `TEXT_PREVIEW_MAX_BYTES=1MB`。
- 重构预览组件命名与实现：`MediaPreviewPanel/Canvas/Lightbox/Viewport` 重命名为 `FilePreviewPanel/Canvas/Lightbox/Viewport`，并新增文本预览、超限/二进制降级提示与不可预览文件信息面板。
- 更新 `usePreviewTraversal` 与 `WorkspaceShell` 快捷键守卫：`P/T/[ / ]` 与自动播放仅在媒体预览下触发，非媒体文件不响应播放控制。
- 更新 `README.md`、`src/layouts/DirectorySelectionLayout.tsx` 与 `docs/shortcuts.md`：文案与说明同步到“本地文件浏览”定位，快捷键键位不变，仅补充媒体适用条件。
- 更新 `specs/109-soft-delete/spec.md`、`WorkspacePluginHost` 与 `PreviewPluginHost`：新增 `fs.softDelete` 动作栏置尾约束，确保非回收站上下文下软删除按钮在工作区/预览 ActionRail 永远位于最后一位。

## 2026-03-11
### Added
- 新增 `specs/109-soft-delete/spec.md`：定义 `fs.softDelete` 单工具双作用域（`file/workspace`）契约、`confirm=false/true` 双阶段语义、`.trash` 软删除目标与预览快捷键触发规则。
- 新增 `tools/mcp/soft-delete/server.mjs`：落地 `fs.softDelete` MCP server，支持单文件/批量输入、`dry-run/commit`、逐项结果与同目录 Windows 风格序号去重。
- 新增 `specs/110-folder-favorites/spec.md`：定义“收藏指定文件夹”契约，覆盖星标收藏切换、收藏列表回访、跨根目录恢复、失败保留与容量上限配置语义。
- 新增 `src/config/app.json` 与 `src/config/appConfig.ts`：引入应用级配置文件机制，提供 `favorites.maxItems` 配置项并在非法值时回退默认 `100`（安全钳制 `1..1000`）。

### Changed
- 更新 `specs/102-address-bar-navigation/spec.md` 与 `ExplorerToolbar` 地址栏编辑态：新增提示补全能力（当前输入父路径子目录 + 跨根收藏 + 跨根历史），支持 `ArrowUp/ArrowDown` 选择、`Tab` 接受候选、`Enter` 高亮优先提交；命中跨根候选时先切根再导航；候选来源标签改为与路径同一行右对齐显示；补全读取失败可见但不阻断手动提交。
- 更新 `.fauplay/mcp.json`：注册 `soft-delete` MCP server（`node tools/mcp/soft-delete/server.mjs`）。
- 更新工作区/预览插件运行时：`WorkspacePluginHost` 对 `fs.softDelete` 改为“仅选中文件可执行”；预览插件链路补齐 mutation 提交后的目录刷新回调，确保软删除后文件列表与预览回退状态同步。
- 更新 `src/lib/fileSystem.ts` 与 `src/hooks/useFileSystem.ts`：将 `.trash` 目录加入默认隐藏集合，目录读取与地址栏子目录枚举均不展示该系统目录。
- 更新 `src/config/shortcuts.ts` 与 `docs/shortcuts.md`：新增预览软删除快捷键 `Delete`（触发 `fs.softDelete` 提交执行）。
- 更新 `specs/109-soft-delete/spec.md`、`tools/mcp/soft-delete/server.mjs` 与 `WorkspacePluginHost`：`workspace` 作用域的 `fs.softDelete` 支持选中目录软删除（目录整体移动到 `.trash`），并在祖先/子路径同时输入时仅执行祖先目录；`preview` 的 `relativePath` 仍保持单文件语义。
- 更新 `specs/109-soft-delete/spec.md`、`tools/mcp/soft-delete/server.mjs` 与工作区 Toolbar：新增回收站入口与 `fs.restore` 还原能力（Gateway 执行链路），支持回收站浏览、选中项还原、冲突自动序号去重，并将 109 主题目录从 `109-soft-delete-plugin` 重命名为 `109-soft-delete`。
- 更新 `specs/109-soft-delete/spec.md`、`tools/mcp/soft-delete/server.mjs`、`WorkspacePluginHost` 与 `PreviewPluginHost`：还原能力改为插件驱动（`fs.restore` 支持 `file/workspace`），移除 Toolbar 还原按钮，并在回收站上下文切换为“显示还原/隐藏软删”（非回收站反向）。
- 更新 `src/hooks/useFileSystem.ts`、`src/features/explorer/components/ExplorerToolbar.tsx`、`src/layouts/DirectorySelectionLayout.tsx`、`src/App.tsx` 与工作区布局接线：新增收藏夹能力（当前目录星标收藏/取消、收藏下拉打开与移除、开始页收藏入口、跨根目录收藏打开），收藏数据持久化到 `localStorage.fauplay:favorite-folders` 并按 `rootId+path` 去重、最近收藏优先排序、按配置上限截断。
- 更新 `specs/README.md`：增加 `110-folder-favorites` 专题入口。

## 2026-03-10
### Added
- 新增 `specs/105-plugin-runtime-interaction/spec.md`：重建 105 主题为“插件运行时交互总则”，统一 `workspace/file` 同构实例、三段式交互、面板折叠状态（`workspaceToolPanelCollapsed` / `previewToolPanelCollapsed`）、本地持久化与侧栏/全屏一致性契约。

### Changed
- 修复同名根目录缓存混淆并完成 `rootPath` 存储清理迁移：`src/lib/reveal.ts` 将 `fauplay:host-root-path-map` 固定为 `v3`（仅 `byRootId`）且不再兼容 `v2`/`byRootLabel`/旧 `rootLabel -> path` 结构（读取旧结构按空映射处理）；`src/lib/rootHandleCache.ts` 移除按目录名匹配缓存项的回退逻辑，`src/lib/actionDispatcher.ts` 与插件运行时调用链改为“缺失 `rootId` 即阻断调用”，`src/App.tsx` 的兜底会话 `rootId` 改为按目录句柄生成唯一值，避免“同名不同路径”根目录在插件调用阶段互相串绑；同步更新 `specs/102-address-bar-navigation/spec.md` 新增隔离约束与验收条款。
- 落地 `105-plugin-runtime-interaction` 折叠能力：`PluginActionRail` 新增面板收起/展开开关（顶部入口），`WorkspacePluginHost` 与 `PreviewPluginHost` 在收起态隐藏 `PluginToolResultPanel` 并保留动作入口；`ExplorerWorkspaceLayout` 新增 `workspace/preview` 两套独立折叠状态及 localStorage 持久化，且预览侧栏与全屏共享同一 `preview` 折叠状态。
- 更新 `specs/002-contracts/spec.md`：在 “Server 注册配置（Host Registration）” 吸收旧 105 的稳定约束，明确 `tools/mcp/<plugin>/server.*` 目录口径、主配置与本地覆盖层合并优先级、本地覆盖 JSON 非法失败启动与旧路径兼容层禁止策略。
- 更新 `docs/mcp-inspector.md`：强化“通用调试指引”定位，并补充到 `specs/002-contracts/spec.md` 的契约引用。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：抽离插件运行时专属细则到 `105-plugin-runtime-interaction`，`003` 收敛为 UI 高层分区与交互基线并改为单一引用入口。
- 更新 `specs/107-stale-config-code-cleanup/spec.md`：关联主题由旧 `105-mcp-plugin-layout` 切换到新 `105-plugin-runtime-interaction`。
- 更新 `specs/106-batch-rename-workspace/spec.md` 与 `tools/mcp/batch-rename/server.mjs`：`fs.batchRename` 移除 `prefix/suffix`，新增 `nameMask`（支持 `[N]/[P]/[G]/[C]`）、普通/正则查找替换（`replaceText` 允许空字符串）、`counterStart/counterStep/counterPad` 计数器参数，并将同目录命名冲突策略升级为 Windows 风格自动序号去重（`name.ext` -> `name (1).ext` ...）。
- 更新 `specs/106-batch-rename-workspace/spec.md` 与 `tools/mcp/batch-rename/server.mjs`：将 `regexFlags` 从自由文本改为枚举选项（`g/gi/gm/gim/gu/giu/gs/gis`），工作台改为下拉选择并在服务端按枚举值校验。

### Archived
- 归档 `specs/105-mcp-plugin-layout/spec.md` 到 `specs/_archive/2026-03-10/105-mcp-plugin-layout/spec.md`：原 MCP 插件目录布局专题完成吸收并退出活动专题目录。

## 2026-03-08
### Added
- 新增 `specs/004-performance-governance/spec.md`：定义性能治理基线（术语与口径、`FR-PG-*`/`AC-PG-*` 模板、性能变更五项信息集：基线/目标/测量方法/回归门槛/降级策略）。
- 新增 `specs/108-dev-cold-start-performance/spec.md`：定义“开发冷启动首次刷新慢”专项规范，覆盖问题证据、开始页优先可见、工作区重模块延后加载、首次进入工作区加载占位与稳定优先 `warmup` 约束。

### Changed
- 优化根目录缓存与系统工具联动：`rootPath` 映射由“仅按 `rootLabel`”升级为“优先按 `rootId`（兼容 `rootLabel` 回退）”；选择目录或从缓存恢复目录时会预绑定绝对路径，减少首次插件调用时的输入弹窗。
- 修复 `102-address-bar-navigation` 跨根历史回访错位问题：最近路径模型升级为 `rootId/rootName/path/visitedAt` 根目录感知结构，历史点击支持“自动切换到历史所属根目录后再导航”；旧版无根信息历史在升级时清空，避免误映射到当前根目录。
- 新增根目录句柄缓存能力（IndexedDB，最多 `10` 项，LRU 淘汰）：`useFileSystem` 增加 `cachedRoots/openCachedRoot/openHistoryEntry`，开始页新增缓存目录入口，刷新后可直接恢复缓存根目录，缓存缺失或权限失效时降级提示重选目录。
- 更新 `specs/000-foundation/spec.md`：将“刷新后需重新授权目录”基线调整为“优先恢复缓存句柄，失效再重选授权”，并明确目录句柄缓存属于可选增强能力。
- 建立“性能治理 -> 性能专项”双层规范关系：`004-performance-governance` 作为跨专题上游约束，`108-dev-cold-start-performance` 作为首个落地专项入口。
- 落地 `108-dev-cold-start-performance`：`App` 改为“开始页轻入口 + 工作区懒加载（`React.lazy + Suspense`）”，将工作区重依赖与网关能力探测后置到 `WorkspaceShell`；首次进入工作区新增可见加载占位；`vite.config.ts` 增加 `server.warmup.clientFiles` 预热开始页关键模块，优化开发冷启动首刷体验。
- 优化 `108-dev-cold-start-performance` 工作区进入性能：`readDirectory` 默认改为“快速列表”模式（首轮不强制读取每个媒体文件 `getFile()` 元数据），并调整 `date/size` 排序在缺失元数据时回退名称排序；视频缩略图链路新增超时与清理机制，避免失败场景长时间挂起与重复 `blob:* net::ERR_FILE_NOT_FOUND` 噪声。
- 继续优化 `108-dev-cold-start-performance` 工作区首屏：`ExplorerWorkspaceLayout` 将 `WorkspacePluginHost/MediaPreviewPanel/MediaLightboxModal` 改为按需懒加载（仅在有工具或打开预览时加载）；`WorkspaceShell` 将 gateway 能力探测改为异步动态导入，移除对首屏模块图的前置依赖；`vite` 预热扩展到工作区核心渲染链路（不含插件/预览重模块）。
- 继续优化 `108-dev-cold-start-performance` 预览首开性能：`MediaPreviewCanvas` 拆分为“媒体渲染主路径 + 懒加载 `PreviewPluginHost`”，无 gateway/无工具时不再拉起 `plugin-runtime` 模块链；`WorkspaceShell` 新增工作区空闲态预热预览模块，降低首次点击文件时的冷编译等待。
- 调整 `108-dev-cold-start-performance` 预览预热策略：`WorkspaceShell` 预热由“面板+全屏”改为“仅预览面板主路径与关键子模块”，并在文件点击时兜底触发一次性预热，降低无效编译竞争与首点预览等待。
- 更新地址栏交互细节：编辑态新增“地址栏外左键点击即退出”语义；最近路径历史在加载与维护时强制去重，同一路径仅保留最新一条记录。
- 落地 `102-address-bar-navigation`：`ExplorerToolbar` 新增地址栏双态（面包屑/编辑）、路径编辑提交与取消（`Enter/Esc`）、路径段子目录下拉导航、最近路径历史（localStorage 持久化）与当前路径复制能力；`useFileSystem` 扩展为导航成功布尔返回与目录直接子目录查询接口，`App/ExplorerWorkspaceLayout` 完成地址栏能力接线并保持地址栏导航后平铺视图复位语义。
- 新增 `specs/102-address-bar-navigation/spec.md`：将原 102 主题升级为“地址栏导航”稳定规范，覆盖双态地址栏、分段下拉、最近路径历史与复制路径契约，并明确本轮不新增全局快捷键约束。
- 归档 `specs/102-breadcrumb-navigation/spec.md` 到 `specs/_archive/2026-03-08/102-breadcrumb-navigation/spec.md`：原面包屑语义并入新 102 规范，作为地址栏能力子集保留。
- 更新 `README.md` 与 `specs/README.md`：专题入口从 `102-breadcrumb-navigation` 切换为 `102-address-bar-navigation`。
- 新增 `specs/107-stale-config-code-cleanup/spec.md`：定义“过期配置与冗余代码清理”边界，约束 TS 单一配置源、构建缓存忽略与冗余别名移除验收标准。
- 更新 `tsconfig.json`：补齐 `composite=true` 与 `tsBuildInfoFile=./node_modules/.tmp/tsconfig.app.tsbuildinfo`，保留 `tsc -b` 增量构建路径并避免根目录缓存污染。
- 删除 `tsconfig.app.json` 与 `tsconfig.tsbuildinfo`：移除重复 TS 配置与被误跟踪构建缓存文件。
- 更新 `.gitignore`：新增 `*.tsbuildinfo` 忽略规则，防止构建缓存再次入库。
- 删除 `src/features/preview/types/toolResult.ts` 与 `src/features/preview/types/toolWorkbench.ts`：清理未被入口可达图引用的类型别名层。
- 更新 `specs/106-batch-rename-workspace/spec.md` 与 `tools/mcp/batch-rename/server.mjs`：为 `fs.batchRename` 增加推荐图标配置 `annotations.icon="replace-all"`。
- 更新 `specs/002-contracts/spec.md` 与 `specs/003-ui-ux/spec.md`：`tools/list` 注解新增 `annotations.icon`（Lucide 图标名）契约；`PluginActionRail` 图标渲染改为“注解优先，失败回退工具名首字母缩写（最多 3 字母）”。
- 更新 `scripts/gateway/mcp/runtime.mjs` 与 `src/lib/gateway.ts`：网关归一化与前端解析链路支持透传/消费 `annotations.icon`，移除按工具名硬编码图标映射。
- 更新 `src/features/plugin-runtime/components/PluginActionRail.tsx` 与插件运行时类型：动作图标支持 Lucide 动态解析（PascalCase/kebab-case），异常场景统一回退缩写 glyph。
- 更新 `tools/mcp/reveal-cli/server.mjs`：为 `system.reveal` 与 `system.openDefault` 补充 `annotations.icon`，保持内置系统工具默认视觉语义。
- 新增 `specs/106-batch-rename-workspace/spec.md`：定义工作区批量重命名插件契约（`fs.batchRename`、`confirm=false/true`、逐项结果、冲突逐项跳过、仅文件与主体名规则）。
- 新增 `tools/mcp/batch-rename/server.mjs`：落地工作区批量重命名 MCP server（`fs.batchRename`），支持 `dry-run/commit` 动作、字符串规则选项与逐项结果返回。
- 更新 `.fauplay/mcp.json`：注册 `batch-rename` MCP server（`node tools/mcp/batch-rename/server.mjs`）。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：插件三段式基线由 `Preview*` 收敛为通用 `PluginActionRail/PluginToolWorkbench/PluginToolResultPanel`，并明确 `workspace` 与 `preview` 为同构运行实例；B1 固定为“右侧动作入口 + 左侧工作台与结果队列”布局。
- 更新 `specs/002-contracts/spec.md`：补充 `workspace/file` 作用域同构消费约束与“批处理部分成功 + item 逐项结果”语义，并扩展 `toolOptions`（`string` + `sendToTool/argumentKey`）与 `toolActions.arguments` 注解约定。
- 插件运行内核抽象：新增 `src/features/plugin-runtime/*`（通用组件 + `usePluginRuntime`），统一工具筛选、上下文切换、选项状态、调用入队与结果折叠逻辑。
- 预览实例迁移：`MediaPreviewCanvas` 改为基于 `usePluginRuntime` 的 `file` 作用域装配层，连续调用能力保留为 file 实例策略。
- 工作区实例落地：新增 `WorkspacePluginHost`，在 B1 右侧提供 `workspace` 作用域工具入口，左侧展示同构工作台与结果队列，目标集合策略为“选中优先，否则当前目录可见文件（仅文件）”。
- 工具分发统一：`dispatchSystemTool` 改为通用参数透传，去除单文件 `relativePath` 硬依赖，供 `workspace/file` 两实例复用；`src/lib/gateway.ts` 同步支持 `string` 类型工具选项与动作参数透传。
- 修复工作区 mutation 插件执行后视图未同步问题：`workspace` 作用域下 `mutation=true` 且非 dry-run 的成功调用会自动刷新当前目录，网格区文件名即时与落盘结果一致。
- 修复刷新联动体验问题：工作区 mutation 自动刷新后不再意外关闭侧栏预览；当原预览文件失效时，预览自动回退到当前目录内可用文件并保持面板打开。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：预览区新增 `PreviewToolWorkbench` 子区语义，明确“工具工作台（选项+操作）与结果队列分层”及侧栏/全屏共享状态契约。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：`PreviewToolResultPanel` 移除面板级标题/描述/收起控制，结果项头部统一为 `<工具名>: <调用时间> <调用状态>`，并收敛为统一结构化结果渲染（key-value、对象递归、`list[dict]` 表格、JSON 兜底，`result.ok` 仅用于状态判定）。
- 重构 `tools/mcp/timm-classifier/server.py`：基于 HuggingFace `AutoModelForImageClassification + AutoImageProcessor + ImageClassificationPipeline` 重写推理路径，移除手写 `timm + safetensors + transform` 链路。
- 更新 `tools/mcp/timm-classifier/config.json` 与 `specs/104-timm-classification-mcp/spec.md`：新增 `batch_size` 配置（默认 `64`），并约束 `ml.classifyBatch` 使用该配置进行 pipeline 批推理。
- 收敛 `ml.classifyImage/ml.classifyBatch` 输出结构：`predictions` 改为 `{label, score}`，移除 `index` 字段契约。
- 新增 `tools/mcp/timm-classifier/tests/test_server_integration.py`：增加 `unittest` 集成测试（单图、批量、`batch_size` 配置生效），成功判据为获取非空预测结果。
- 迁移插件测试样本：`.references/img1.jpg` 移动到 `tools/mcp/timm-classifier/tests/fixtures/img1.jpg`。
- 迁移 `timm-classifier` 配置文件：`.fauplay/timm-classifier.json` 移动到 `tools/mcp/timm-classifier/config.json`，并同步更新 `.fauplay/mcp.json`、`tools/mcp/timm-classifier/server.py` 默认 `--config` 与 `docs/mcp-timm-classifier.md`。
- 更新 `specs/002-contracts/spec.md`：新增 `tools/list` 注解约定 `annotations.toolOptions` 与 `annotations.toolActions`，并定义最小字段与“非法项忽略”处理原则。
- 更新 `specs/104-timm-classification-mcp/spec.md`：`ml.classifyImage` 新增 `annotations.toolOptions.preview.continuousCall.enabled` 契约，用于预览区持续调用分类能力。
- 重构 `tools/mcp/timm-classifier/server.py`：移除手写 `timm + torch` 推理链路，改为基于 HuggingFace `transformers.pipelines.ImageClassificationPipeline` 标准接口实现，并保持 `ml.classifyImage/ml.classifyBatch` 的 MCP 输入输出契约。
- 更新 `docs/mcp-timm-classifier.md`：依赖说明切换为 `torch + transformers + pillow`，并同步模型目录要求到 HuggingFace `ImageClassificationPipeline` 契约。
- 更新持续调用防泛滥逻辑：基于当前文件结果队列执行历史命中跳过（`tool + file + 请求签名`），命中后静默跳过持续调用请求；手动调用保持强制重算。
- 新增 `specs/105-mcp-plugin-layout/spec.md`：定义 MCP 插件目录布局规范与 Inspector 独立调试最小生命周期契约。
- MCP 插件目录迁移：`scripts/gateway/mcp-servers/*` 迁移为 `tools/mcp/<plugin>/server.*`，并清理旧目录。
- 更新 `.fauplay/mcp.json`：`reveal-cli` 与 `timm-classifier` 的入口路径切换到 `tools/mcp`。
- 新增 `docs/mcp-inspector.md`：提供 Inspector 通用操作指引（安装/启动、`command/args/env/cwd` 填写、生命周期调试顺序与常见错误排查），不包含插件清单。
- 更新 `docs/mcp-timm-classifier.md` 与 `docs/troubleshooting.md`：同步 MCP 脚本路径到 `tools/mcp`。
- 更新 `specs/002-contracts/spec.md` 与 `specs/105-mcp-plugin-layout/spec.md`：新增本地覆盖层契约，网关支持 `.fauplay/mcp.json` + `.fauplay/mcp.local.json` 合并加载，且本地同名 server 覆盖主配置。
- 更新 `scripts/gateway/server.mjs`：MCP 配置加载支持自动读取 `.fauplay/mcp.local.json`，缺省可忽略；当本地配置 JSON 非法时返回 `MCP_CONFIG_ERROR` 并标注路径。
- 更新 `.gitignore`：忽略 `.fauplay/mcp.local.json` 与 `tools/mcp-local/`，用于私有/第三方插件本地接入。

## 2026-03-05
### Added
- 新增 `specs/104-timm-classification-mcp/spec.md`：定义 `timm` 图像分类 MCP 插件规范（`ml.classifyImage`、`ml.classifyBatch`、配置契约、路径安全与模型缓存语义）。
- 新增 `scripts/gateway/mcp-servers/timm-classifier-cli.py`：提供 Python `stdio` MCP server，支持单图与批量分类、JSON-RPC 生命周期与错误码映射。
- 新增 `.fauplay/timm-classifier.json`：提供 `timm` 分类插件模型配置样例。
- 新增 `docs/mcp-timm-classifier.md`：补充依赖安装、配置说明与 MCP 调用示例。

### Changed
- 更新 `.fauplay/mcp.json`：注册 `timm-classifier` MCP server（`python3 scripts/gateway/mcp-servers/timm-classifier-cli.py`）。
- 调整 `timm` 分类插件模型契约：由 `checkpoint + labels` 收敛为目录模型格式（`config.json + model.safetensors`），并同步更新 `specs/104-timm-classification-mcp/spec.md`、`scripts/gateway/mcp-servers/timm-classifier-cli.py`、`.fauplay/timm-classifier.json` 与 `docs/mcp-timm-classifier.md`。
- 更新 `specs/104-timm-classification-mcp/spec.md`：补充分类工具调用超时预算与客户端超时错误可读化要求。
- 更新 `src/lib/gateway.ts`：`ml.classify*` 工具默认超时提升为 `120000ms`，并将浏览器 `AbortError` 统一映射为 `MCP_CLIENT_TIMEOUT` 可读错误。
- 更新 `.fauplay/mcp.json`：为 `timm-classifier` 增加 `callTimeoutMs=120000`，避免首轮模型加载触发网关下游超时。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：新增预览工具结果展示契约与 `PreviewToolResultPanel` 子分区定义。
- 更新 `specs/104-timm-classification-mcp/spec.md`：新增 `ml.classifyImage` Top-K 表格化推荐展示语义与结果可见性验收条款。
- 修复预览工具结果状态一致性：侧栏预览与全屏预览改为共享同一份结果运行时状态，避免两种表现态显示不一致。
- 修复表现态切换误清空问题：结果状态重置由 `MediaPreviewCanvas` 下沉副作用改为布局层按“当前预览文件路径变化”统一触发，确保同一文件下侧栏/全屏切换不丢结果。
- 更新预览工具结果模型：从“工具单条 + 标签切换”调整为“调用队列平铺 + 单项折叠”，并按文件维度保留最近队列（切换文件可恢复）。

## 2026-03-04
### Added
- 新增 `specs/102-breadcrumb-navigation/spec.md` 首版面包屑导航规范（根目录段、分段跳转、当前段刷新与平铺复位语义）。
- 新增 `specs/103-grid-multi-selection/spec.md` 首版文件网格多选规范（复选框多选、范围选择、`Esc` 优先级兼容与 lasso Phase 2 规划）。

### Changed
- 开始落地 `102-breadcrumb-navigation`：顶栏路径改为可点击面包屑，支持根目录跳转、逐级跳转、当前段刷新，并在面包屑跳转后自动退出平铺视图。
- 在 `specs/000-foundation/spec.md` 新增“文档源头契约（Documentation Source-of-Truth Contract）”，明确 README 仅保留入口信息，细规格以 `specs/<topic>/spec.md` 为单一事实来源。
- 重构根 `README.md` 为“定位 + 上手 + 命令 + 文档索引”结构，并清理过期 `specs` 路径引用。
- 调整预览面板默认宽度策略：基线比率为 `0.375`，并按主内容区容器宽度自适应，优先保障 `512` 缩略图档位下左侧网格默认每行 `3` 列；用户手动拖拽后不再自动覆盖当前会话宽度。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：明确工作区插件与预览插件职责边界与分区落位规则（工作区插件面向当前工作目录/选中文件列表，预览插件面向当前预览文件）。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：补充网格多选基线（复选框、范围选择、`Ctrl/Cmd + A`、`Esc` 与预览关闭优先级兼容）。
- 开始落地 `103-grid-multi-selection`：文件网格支持文件/目录复选框、`Shift` 范围选择、`Ctrl/Cmd + 单击` 切换勾选、`Ctrl/Cmd + A` 全选、`Esc` 条件清空，并在状态栏展示勾选数量与单文件元信息。
- 快捷键文档对齐：`src/config/shortcuts.ts` 与 `docs/shortcuts.md` 新增网格多选快捷键说明（`Ctrl/Cmd + A`、`Esc`）。

## 2026-03-03
### Added
- 新增 `specs/000-foundation/spec.md` 首版基线规范（产品定位、技术栈、兼容性、持久化、性能与降级原则）。
- 新增 `specs/001-architecture/spec.md` 首版架构规范（三层边界、依赖方向、降级策略与演进规则）。
- 新增 `specs/002-contracts/spec.md` 首版契约规范（网关入口、JSON-RPC、响应封装、错误码与插件运行契约）。
- 新增 `specs/003-ui-ux/areas.md` 作为 UI 分区引用细则，补充分区职责、预览子分区映射、状态矩阵与扩展落位规则。
- 新增 `specs/100-preview-playback/spec.md` 首版预览播放规范（自动播放、顺序/随机遍历、快捷键与侧栏/全屏一致性契约）。
- 新增 `specs/101-thumbnail-pipeline/spec.md` 首版缩略图管线规范（触发、优先级、并发、去重、缓存一致性、尺寸档位与失败降级契约）。

### Changed
- 建立新主题编号与命名体系：`000-foundation`、`001-architecture`、`002-contracts`、`003-ui-ux`。
- 统一活动主题骨架为 `spec.md`、`plan.md`、`tasks.md`。
- 调整 `000-foundation` 安全基线：系统集成能力不强制确认，显式确认仅要求文件变更类能力。
- 新增术语表达规则：重要概念使用“中英文并列”或标准英文表达，并同步修订 `000` 与 `001` 规范术语。
- 架构对齐修复：预览组件不再硬编码 `system.*` 工具名；系统动作调用路径统一收敛到 `actionDispatcher`。
- MCP 落地改造：网关 `/v1/mcp` 改为 JSON-RPC 标准响应，增加 `initialize/notifications/initialized` 生命周期，`tools/list` 移除顶层 `plugins` 返回。
- MCP 契约收敛：`tools/list` 不再返回非标准来源字段。
- 外部 MCP Server 注册入口迁移为 `.fauplay/mcp.json`，移除 env allowlist 路径与相关兼容残留。
- 内置 MCP Server 彻底 stdio 化：`reveal` 剥离为独立 CLI，并通过 `.fauplay/mcp.json` 以 `stdio` 方式注册，不再存在 inproc 路径。
- 落盘 `specs/003-ui-ux/spec.md` 首版交互规范，明确 Functional Zone、Panel-Fullscreen Relation、State、Keyboard、Capability & Degradation 等契约。
- 调整 `003-ui-ux` 可访问性条款，移除“所有可操作控件必须可键盘触达”要求。
- 修正文档一致性：`docs/shortcuts.md` 移除未实现的 `Shift + D`，与 `src/config/shortcuts.ts` 对齐。
- 收敛 `specs/100-preview-playback/spec.md` 表达方式：移除代码片段与实现路径引用，统一为行为契约与语义定义。
- 进一步收敛 `specs/100-preview-playback/spec.md` 术语写法：英文值集中到术语章节，正文统一使用中文名称。
- 修正根 `README.md` 缩略图规范链接，指向活动主题 `specs/101-thumbnail-pipeline/spec.md`。
- 调整 `101-thumbnail-pipeline` 并发口径：默认并发 `8`，并发上限可配置。
- 开始落地 `101-thumbnail-pipeline`：新增缩略图队列管线、默认并发 `8`、可见区优先调度、同键请求去重与失败可见回退。

### Archived
- 旧规范文件已整体归档到 `specs/_archive/2026-03-02/`。
