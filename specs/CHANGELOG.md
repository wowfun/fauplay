# CHANGELOG

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
