# CHANGELOG

## 2026-04-06
### Changed
- 更新 `specs/111-local-file-browser/spec.md`、`specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/top-toolbar-tag-filter.md`：新增“顶部工具栏过滤状态按 root 持久化”契约，固定持久化范围为搜索、类型、隐藏空文件夹、排序与标签 include/exclude + `OR/AND`，并明确 `source/key` 分面、面板开关、缩略图尺寸与平铺视图不纳入持久化。

## 2026-03-31
### Added
- 新增 `specs/124-app-entry-composition/spec.md`：定义应用入口装配重构专题，约束 `src/App.tsx` 仅整理目录选择快捷键副作用、目录选择页/工作区分支 props 装配与稳定兜底 `rootId` 语义，不引入新的用户可见行为。
- 新增 `specs/125-gateway-route-composition/spec.md`：定义 Gateway 路由装配重构专题，要求 `scripts/gateway/server.mjs` 的 JSON HTTP 路由可达判断与执行处理共享单一注册表，并将 `tools/call` 后处理从主请求分支中抽离，保持对外协议不变。

### Changed
- 归档 `specs/107-stale-config-code-cleanup/`、`specs/108-dev-cold-start-performance/`、`specs/124-app-entry-composition/` 与 `specs/125-gateway-route-composition/` 到 `specs/_archive/2026-03-31/`，并为归档文档补充历史引用头注与迁移后相对链接修正。

## 2026-03-30
### Added
- 新增 `specs/123-status-bar/spec.md`：定义底部状态栏专题，收敛状态栏统计、单文件元信息、父目录路径解析与全屏预览可见性契约。

### Changed
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：补充底部状态区展示约束，并明确全屏预览覆盖层不得遮挡状态栏。
- 更新 `specs/123-status-bar/spec.md`：状态栏单文件元信息目标从“单个勾选文件优先”收敛为“当前预览文件优先，缺失时再回退到单个勾选文件”。
- 更新 `specs/100-preview-playback/spec.md`、`src/features/preview/hooks/usePreviewTraversal.ts` 与 `docs/shortcuts.md`：预览遍历模式改为写入本地存储，刷新后恢复最近一次顺序/随机选择，同时保持“仅恢复设置、不自动打开预览”的约束。
- 更新 `specs/105-plugin-runtime-interaction/spec.md`：补充插件运行时内部一致性约束，要求工具选项解析/动作可见性共享规则，结果队列入队与完成态更新复用统一状态迁移语义，避免 `workspace` 与 `preview` 实例分叉。

## 2026-03-28
### Changed
- 更新 `specs/109-soft-delete/spec.md`、`specs/111-local-file-browser/spec.md` 与 `specs/122-unified-trash-route/spec.md`：新增统一“删除撤销”契约，明确删除后会话级撤销栈、`Ctrl/Cmd + Z`、提示条、删除前 UI 快照，以及文件网格/底部结果面板/预览状态的恢复语义。
- 更新 `src/config/shortcuts.ts`、`src/config/shortcuts.json` 与 `docs/shortcuts.md`：新增应用级快捷键 `Ctrl/Cmd + Z`，用于撤销最近一次成功删除批次。
- 更新 `specs/120-asset-duplicate-detection/spec.md` 与 `specs/111-local-file-browser/spec.md`：为重复文件底部结果标签新增 Duplicate Cleaner Pro 风格的快捷选择规则，首期提供 `保留最新/保留最旧/保留当前文件或首项/清空全部`、组头 `重应用本组/清空本组`，并固定“已选 = 待处理项”语义。
- 更新 `specs/111-local-file-browser/spec.md` 与 `specs/122-unified-trash-route/spec.md`：收紧结果投射标签删除后的前端收尾语义，要求删除成功后立即从当前投射标签移除已删文件、清理对应选择态，并在标签删空时自动关闭空标签。
- 更新 `specs/122-unified-trash-route/spec.md`：将统一回收区物理存储收敛为“全局元数据 + 同卷托管池”，对非 home 卷文件改为使用该卷上的 `.fauplay/global/recycle/files`，避免结果标签删除跨卷写入 home 托管池。
- 更新 `specs/111-local-file-browser/spec.md` 与 `specs/122-unified-trash-route/spec.md`：进一步收紧按组分行结果标签的删除收尾语义，要求删除成功后同步清除组内残留缩略图、复选框与组头统计，避免已删文件继续可见或被重新勾选。
- 更新 `specs/111-local-file-browser/spec.md` 与 `specs/122-unified-trash-route/spec.md`：明确结果投射标签删除后的清理语义同样覆盖右侧预览动作区触发的删除，不得只刷新预览而遗漏底部结果标签。

## 2026-03-26
### Changed
- 合并活动专题 `specs/111-local-file-browser/spec.md` 与 `specs/121-projected-file-grid/spec.md`：新的活动 `111` 吸收目录文件浏览、统一预览能力、`projection` payload、底部结果面板、投射标签、活动表面与跨 Root `absolutePath` 读取契约；原“结果模式接管主网格”语义退役。
- 归档旧活动 `111` 与 `121` 到 `specs/_archive/2026-03-26/`，并在归档文档顶部补充 merged-into 声明；同步移除 `specs/README.md` 中的活动 `121` 入口。
- 更新 `specs/002-contracts/spec.md`、`specs/105-plugin-runtime-interaction/spec.md`、`specs/120-asset-duplicate-detection/spec.md`、`specs/122-unified-trash-route/spec.md` 与根 `README.md`：将结果投射结构归属统一切换到新的活动 `111`，并把“结果模式”相关表述收敛为“底部结果面板/投射标签”语义。
- 更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：为新的工作区 IA 补充 B3 底部结果面板区，明确投射文件视图落位、与 `PluginToolResultPanel` 的职责分离，以及“目录主区保持可见、投射结果进入底部面板”的高层布局约束。
- 更新 `specs/111-local-file-browser/spec.md`、`specs/105-plugin-runtime-interaction/spec.md`、`specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：参考 VS Code 收敛底部结果面板交互，新增面板高度拖拽、显式打开/关闭、最大化覆盖整个文件网格区、恢复最近正常高度与重开恢复最近面板状态等契约。
- 更新 `specs/120-asset-duplicate-detection/spec.md` 与 `specs/111-local-file-browser/spec.md`：工作区重复文件在命中重复组时改为自动打开结果标签；`group_contiguous` 投射新增“按组分行、单行只显示一个 groupId”展示约束。
- 更新 `specs/111-local-file-browser/spec.md`：明确按组分行的底部结果标签仍需保留面板内垂直滚动能力，并继续复用工作区网格现有快捷键语义，不新增新的快捷键集合。
- 更新 `specs/120-asset-duplicate-detection/spec.md` 与 `specs/105-plugin-runtime-interaction/spec.md`：为 `data.findDuplicateFiles` 增补预览区 `preview.continuousCall.enabled` 持续调用语义，并明确该开关仅在 `file` 作用域预览实例可见，工作区工作台不得展示。
- 更新 `specs/120-asset-duplicate-detection/spec.md`：收紧“无重复命中”语义，要求重复文件工具在 `duplicateCount/duplicateGroupCount = 0` 时不返回空投射或单文件投射，并自动关闭该工具旧的底部结果标签。
- 更新 `specs/120-asset-duplicate-detection/spec.md`：补充“切回已有成功重复结果的文件时应重新激活结果标签”语义，避免历史静默跳过后底部结果面板保持关闭。

## 2026-03-25
### Added
- 新增 `specs/120-asset-duplicate-detection/spec.md`：定义基于现有 `assetId` 的重复文件检测专题，明确预览区单文件隐式补索引、工作区“已选优先否则当前可见”查重、`missing/stale` 覆盖率统计，以及工作区专用 `索引当前目标文件` 语义。
- 新增 `specs/121-projected-file-grid/spec.md`：定义通用结果投射与结果模式专题，明确 `projection` 来自具体结果 payload、`auto/manual` 进入方式、`listed/group_contiguous/mixed` 排序模式，以及基于 `absolutePath` 的跨 Root 预览读取链路。
- 新增 `specs/122-unified-trash-route/spec.md`：定义统一回收站虚拟路由专题，明确 `@trash` 路由、当前 Root `.trash` + 全局回收区混排、结果模式删除进入全局回收区，以及恢复冲突自动改名语义。

### Changed
- 更新 `specs/119-person-management-face-correction/spec.md`：按基础规范补充 `关键术语 (Terminology)` 章节，并将专题中的人物管理、人脸纠错、人物归属、人工未归属、忽略态与 Root 作用域等核心术语显式收敛。
- 更新 `specs/002-contracts/spec.md`、`specs/005-local-data-contracts/spec.md`、`specs/102-address-bar-navigation/spec.md`、`specs/105-plugin-runtime-interaction/spec.md`、`specs/109-soft-delete/spec.md`、`specs/111-local-file-browser/spec.md`、`specs/114-local-data-plugin/spec.md` 与 `specs/README.md`：为 `120/121/122` 补齐上游与相邻专题锚点，收敛 `tools/call.result.projection`、`POST /v1/files/indexes` / `POST /v1/files/duplicates/query`、`@trash` 虚拟路由、工作区结果模式，以及目录浏览 `.trash` 与结果模式全局回收区的职责边界。

## 2026-03-24
### Changed
- 新增 `specs/119-person-management-face-correction/spec.md`，并更新 `specs/115-facial-recognition/spec.md`、`specs/005-local-data-contracts/spec.md` 与 `specs/005-local-data-contracts/tag-core-v2-reference.md`：新增“人物级管理 + face 级纠错”专题，明确 `person_face` 为人物归属真源、`face.status` 的五态语义、`global/root` 显式查询作用域、批量纠错 HTTP 接口，以及跨 Root 人脸裁切与人物工作台整理契约。
- 新增 `specs/118-toolbar-help-shortcuts/spec.md`，并更新 `specs/003-ui-ux/spec.md`、`specs/003-ui-ux/areas.md` 与 `docs/shortcuts.md`：顶部工具栏新增只读 `帮助` 入口专题，首批支持查看当前运行时快捷键；列表固定按 `App / Grid / Preview / Tag` 分组展示，动态逻辑标签快捷键单列为 `Tag` 组，状态指示基于运行时上下文而非单次按键事件。
- 新增 `specs/116-configurable-shortcuts/spec.md`，并更新 `specs/003-ui-ux/spec.md`、`specs/005-local-data-contracts/spec.md` 与 `specs/005-local-data-contracts/runtime-config-reference.md`：将快捷键定义为 root-scoped 的 app-owned 配置域，默认真源切换为 `src/config/shortcuts.json`，配置链统一为 `src/config -> ~/.fauplay/global -> <root>/.fauplay`；同时明确扁平 `snake_case` action id、单次组合键 DSL、`none` 禁用语义、局部容错与 Gateway 全局只读配置接口契约。
- 更新 `specs/116-configurable-shortcuts/spec.md`、`specs/117-preview-header-tag-management/spec.md` 与 `docs/shortcuts.md`：将动态逻辑标签快捷键契约收敛为所见即所得的 `tag:${key}=${value}` 原始字符串语法，支持直接写中文、空格与常见特殊字符；仅当目标逻辑标签存在于当前候选快照时才生效，并在与预览内建快捷键冲突时由逻辑标签快捷键优先。
- 更新 `specs/116-configurable-shortcuts/spec.md` 与 `scripts/gateway/server.mjs`：Gateway 启动日志新增 shortcuts 配置文件来源输出，固定打印 `~/.fauplay/global/shortcuts.json` 的当前状态，并在缺失或 JSON 非法时分别显示 `missing, skipped` / `invalid JSON`，且不阻断网关启动。

## 2026-03-23
### Changed
- 更新 `specs/117-preview-header-tag-management/spec.md`、`src/config/shortcuts.ts` 与 `docs/shortcuts.md`：为预览头部“绑定逻辑标签”新增预览态快捷键 `#`，语义与点击 `+` 一致；输入焦点保护保持生效；当侧栏预览与全屏预览同时存在时固定由全屏响应，避免双面板同时打开。

## 2026-03-22
### Changed
- 更新 `specs/002-contracts/spec.md`、`specs/005-local-data-contracts/spec.md`、`specs/005-local-data-contracts/runtime-config-reference.md` 与 `specs/112-video-same-duration-search/spec.md`：将 WSL `drvfs` 自动重挂载从 `video-same-duration` 插件私有逻辑上收为 Gateway 横切保障，并新增 `~/.fauplay/global/.env` 作为 Gateway 统一进程环境文件，明确优先级为 `servers.<name>.env` > 全局 `.env` > shell env。
- 更新 `specs/104-timm-classification-mcp/spec.md`、`src/config/mcp.json` 与 `docs/mcp-timm-classifier.md`：`timm-classifier` 的默认 MCP 启动解释器固定为项目 `.venv/bin/python`，避免系统 `python3` 缺少 `torch` 等依赖导致分类调用失败。
- 更新 `specs/002-contracts/spec.md`、`specs/005-local-data-contracts/spec.md`、`specs/005-local-data-contracts/runtime-config-reference.md`、`specs/112-video-same-duration-search/spec.md`、`specs/114-local-data-plugin/spec.md`、`specs/104-timm-classification-mcp/spec.md` 与 `specs/115-facial-recognition/spec.md`：收敛“应用配置归应用、工具配置归工具”边界，`timm-classifier`、`video-same-duration`、`vision-face`、`local-data` 的默认配置回归 `tools/mcp/<tool>/config.json`，并退役按 `~/.fauplay/global/<domain>.json` 自动覆盖工具内部配置的约定。
- 更新 `specs/002-contracts/spec.md` 与 `scripts/gateway/server.mjs`：Gateway 启动日志改为打印本次实际读取的 MCP 配置文件清单，明确区分 `default/global/custom` 来源，并在全局覆盖缺失时显示 `missing, skipped`。
- 更新 `specs/005-local-data-contracts/spec.md`、新增 `specs/005-local-data-contracts/runtime-config-reference.md`，并同步更新 `specs/002-contracts/spec.md`、`specs/112-video-same-duration-search/spec.md` 与 `specs/115-facial-recognition/spec.md`：文件型运行时配置统一收敛为 `src/config -> ~/.fauplay/global -> <root>/.fauplay`，`mcp` 改为 default + global 两层，`*.local.json` 兼容读取移除，全局数据库路径改为 `~/.fauplay/global/faudb.sqlite`。
- 更新 `specs/003-ui-ux/top-toolbar-tag-filter.md` 与 `src/features/explorer/components/ExplorerToolbar.tsx`：顶部标签过滤候选面板新增“全选”按钮，按当前 `source` / `key` 分面后的可见候选批量勾选，不清除当前被分面隐藏的已选标签。
- 新增 `specs/003-ui-ux/top-toolbar-tag-filter.md`，并更新 `specs/003-ui-ux/spec.md` 与 `specs/003-ui-ux/areas.md`：将顶部标签过滤细则下沉为 `003` 下独立参考文件；主规范保留门控、回退、全来源读取与开面板强制刷新等基线约束；新增候选面板 `source` / `key` 分面、面板级临时状态与“未标注”显示边界规则。
- 更新 `specs/117-preview-header-tag-management/spec.md`：预览切换到文件时，必须按文件粒度强制刷新该文件标签并从数据库读取最新信息，不再因已有前端快照而跳过读库；允许先展示缓存后无感更新头部标签。
- 更新 `specs/003-ui-ux/spec.md`：顶部工具栏标签过滤在点击打开“包含标签/排除标签”面板时，必须立即强制刷新当前 root 标签快照并从数据库读取最新标签信息，不再只依赖进入 root 时的首次快照。
- 新增 `specs/117-preview-header-tag-management/spec.md`，并更新 `specs/005-local-data-contracts/spec.md` 与 `specs/114-local-data-plugin/spec.md`：预览头部标签与顶部过滤改为按逻辑标签 `key + value` 聚合；同一逻辑标签同时存在 `meta.annotation` 与派生来源时以前者为代表来源；`local.data` 新增 `bindAnnotationTag/unbindAnnotationTag` 与对应 `file-annotations/tags/*` 写契约，用于仅补/删 `meta.annotation` 来源而不影响派生来源。
- 更新 `specs/002-contracts/spec.md`：`tools/list` 的 `annotations.toolActions[]` 新增 `visible?: boolean` 元数据，前端工作台按 `visible !== false` 渲染动作。
- 更新 `specs/005-local-data-contracts/spec.md` 与 `specs/005-local-data-contracts/tag-core-v2-reference.md`：`file` 从“稳定位置记录”收敛为“路径索引表”，`absolutePath` 升级为主键；对外接口移除 `fileId`，下线 `reconcileFileBindings`，并将清理接口改为 `POST /v1/files/missing/cleanups`。
- 更新 `specs/114-local-data-plugin/spec.md`：`local.data` 的 operation 收敛为 `setAnnotationValue | batchRebindPaths | cleanupMissingFiles`；删除“刷新 file 绑定”能力，缺失路径清理替代原失效 `fileId` 清理。
- 归档 `specs/116-rename-driven-rebind/spec.md` 到 `specs/_archive/2026-03-22/116-rename-driven-rebind/spec.md`，并将其中仍有效的“命名分层”和“`batchRebindPaths` 作为改名后统一路径维护入口”约束并入 `specs/114-local-data-plugin/spec.md`；同步移除 `specs/README.md` 与 `specs/005-local-data-contracts/spec.md` 对活动 `116` 主题的引用。
- 更新 `specs/005-local-data-contracts/spec.md` 与 `specs/005-local-data-contracts/tag-core-v2-reference.md`：本地数据真源从 per-root `faudb.v1.sqlite` 切换为全局 `faudb.global.sqlite`，核心模型重构为 `asset + file + tag + asset_tag`，并明确 `absolutePath` 为唯一位置身份、`rootPath` 仅为请求过滤条件、`asset.deletedAt` 为普通查询默认隐藏的软删除语义。
- 更新 `specs/114-local-data-plugin/spec.md`：`local.data` 写入/重绑/清理链路统一改为 `rootPath + relativePath -> absolutePath -> file -> asset`，并明确 `fileId` 仅表示位置记录、内容变更可切换 `assetId`、最后一个 `file` 消失时对应 `asset` 进入软删除。
- 更新 `specs/115-facial-recognition/spec.md` 与 `specs/104-timm-classification-mcp/spec.md`：人脸与分类结果统一切换到 `assetId` 真源；人物空间默认全局，不再按 root 隔离；同内容文件的多路径位置共享同一套 `vision.face` / `ml.classify` 结果。

## 2026-03-21
### Changed
- 清理活动专题规范中的过期表述：`114-local-data-plugin`、`116-rename-driven-rebind`、`005-local-data-contracts`（含 `tag-core-v2-reference`）不再显式枚举已下线旧接口路径，统一改为“历史维护接口已下线（返回下线错误或 404）”；`114-local-data-plugin/plan.md` 同步修正为 RESTful 口径并更新 operation 名称；`003-ui-ux/spec.md` 与 `003-ui-ux/areas.md` 将“sidecar 快照门控”统一为“标签快照门控”术语。
- 更新 `specs/003-ui-ux/spec.md`、`specs/114-local-data-plugin/spec.md` 与 `specs/005-local-data-contracts/spec.md`：明确顶部标签过滤与预览标签显示默认读取统一标签模型中的全部来源标签（不再以 `source=meta.annotation` 作为读取前置条件）；“未标注”语义收敛为“无任何来源标签”；同时保留 `setAnnotationValue` 写入来源固定为 `meta.annotation`。
- 更新 `specs/115-facial-recognition/spec.md`：新增预览人脸框显示/隐藏开关契约，明确默认隐藏、`localStorage` 持久化键 `fauplay:preview-face-bbox-visible`，以及侧栏预览与全屏预览状态一致性验收。
- 更新 `specs/115-facial-recognition/spec.md`：补充“人脸框显示状态与后台检测/识别解耦”约束，明确开关仅控制覆盖层渲染，不得门控 `detect-asset/list-asset-faces/cluster-pending/list-people`。
- 更新 `specs/115-facial-recognition/spec.md`：新增“预览标签即时同步”约束；自动 `detect-asset/cluster-pending` 与预览内手动 `vision.face` 成功后，当前文件标签需在同一预览会话内通过文件级快照刷新即时可见。

## 2026-03-20
### Added
- 归档旧 114 文档到 `specs/_archive/2026-03-20/114-metadata-annotation/`（包含 `spec.md` 与 `plan.md`）。
- 新增 `specs/116-rename-driven-rebind/spec.md`：定义“命名分层（外部语义 + 内部 CRUD）+ RESTful 路径切换 + `fs.batchRename` 成功后自动路径重绑 + 两阶段更新”契约。

### Changed
- 重写 `specs/114-local-data-plugin/spec.md`：主题切换为 `local.data` 本地数据管理插件，能力收敛为 `setAnnotationValue + batchRebindPaths + reconcileFileBindings + cleanupInvalidFileIds`，标签来源保持 `meta.annotation`。
- 更新 `specs/005-local-data-contracts/spec.md` 与 `specs/005-local-data-contracts/tag-core-v2-reference.md`：本地数据接口切换为 RESTful（`/v1/file-annotations`、`/v1/files/relative-paths`、`/v1/file-bindings/*`），并补充 `file` 表重绑与失效 `fileId` 清理契约。
- 更新 `specs/115-facial-recognition/spec.md` 与 `specs/README.md`：将 114 关联语义从“标注插件”改为“本地数据管理插件”。
- 更新 `specs/114-local-data-plugin/spec.md`：`local.data` 的 `operation` 枚举切换为 `setAnnotationValue/batchRebindPaths/reconcileFileBindings/cleanupInvalidFileIds`，并新增 `batchRebindPaths` 两阶段更新与逐项 `reasonCode` 约束。
- 更新 `specs/106-batch-rename-workspace/spec.md` 与 `specs/113-preview-inline-rename/spec.md`：补充“改名成功后自动触发路径重绑，失败仅 `postProcessWarning` 告警不回滚主流程”行为。
- 更新 `specs/README.md`：新增 `116-rename-driven-rebind` 主题入口。

## 2026-03-19
### Added
- 新增 `specs/005-local-data-contracts/tag-core-v2-reference.md`：集中定义 Tag Core v2 参考契约（`file + tag + file_tag` 核心模型、保留人脸业务表、移除表清单、接口行为映射与验收场景）。

### Changed
- 更新 `specs/005-local-data-contracts/spec.md`：schema 升级为 v2，`tag` 收敛为 `id,key,value,source`，`file_tag` 新增通用可空 `score`，并明确移除 `annotation_record/face_job_state/*_tag_ext`。
- 更新 `specs/114-metadata-annotation/spec.md`：标注能力收敛为仅 `set-value` 覆盖写入，不再依赖 `annotation_record`，并下线 `refresh-bindings/cleanup-orphans`。
- 更新 `specs/115-facial-recognition/spec.md`：移除 `face_job_state` 表依赖，新增 `person_face -> vision.face` 文件标签投影一致性契约。
- 更新 `specs/104-timm-classification-mcp/spec.md`：分类 `score` 持久化位置改为 `file_tag.score`，不再写入 `tag` 扩展字段。

## 2026-03-18
### Added
- 新增 `specs/005-local-data-contracts/spec.md`：定义“Gateway 唯一数据层 + `.fauplay/faudb.v1.sqlite` 单一真源 + 统一 `fileId` + 插件仅计算不直写”基础契约，并明确标签/标注/人脸业务主链路迁移为 Gateway HTTP 接口。

### Changed
- 更新 `specs/115-facial-recognition/spec.md`：补充预览区自动检测契约（图片预览无人脸记录时自动触发 `detectAsset` 并补跑 `clusterPending`），并将 SQLite 路径表述收敛为基于 `rootHandle` 的相对路径（`<rootHandle>/.fauplay/faces.v1.sqlite`）；同步新增 root 上下文缺失时的绑定与继续执行语义（`FR-FACE-12` / `AC-FACE-11`）。
- 更新 `specs/114-metadata-annotation/spec.md`：标注能力改为 Gateway HTTP + SQLite 持久化模式，移除 sidecar 运行时依赖，并将记录主键语义统一为 `id`（不再使用 `annotationId`）。
- 更新 `specs/115-facial-recognition/spec.md`：人脸持久化库名统一为 `faudb.v1.sqlite`，人脸/人物关系统一 `fileId`，并明确 `vision-face` 插件仅保留推理职责。
- 更新 `specs/104-timm-classification-mcp/spec.md`：分类插件收敛为推理角色，分类结果由 Gateway 落统一标签模型（`source=ml.classify`）。

## 2026-03-17
### Added
- 新增 `specs/115-facial-recognition/spec.md`：定义人脸识别 MVP 规范，固定“Gateway/MCP 内嵌 Immich 兼容推理 + Gateway 增量聚类 + root 级 SQLite 持久化（`.fauplay/faces.v1.sqlite`）”路线，并明确 `vision.face` 工具契约、`minScore/maxDistance/minFaces` 核心参数、deferred/夜间补聚类语义与 `FACE_*` 失败降级约束。

### Changed
- 更新 `specs/102-address-bar-navigation/spec.md`：新增开始页缓存目录 `rootPath` 可见性、手动强制重绑入口，以及命中 `rootPath` 路径类错误后“提示重绑 + 手动重试（不自动重试）”契约与验收条款。
- 更新 `specs/115-facial-recognition/spec.md`：补充人物功能入口与导航契约，明确“工作区工具栏（B1）人物主入口”与“预览人脸框/人物标签跳转人物详情（关联图片列表）”，并同步新增对应 `FR/AC` 条款。
- 更新 `specs/115-facial-recognition/spec.md`：收敛 v1 推理实现口径为“Gateway/MCP 内嵌 Immich 兼容推理器（`buffalo_l`）”，移除外部 ML 服务依赖，并新增 `modelRepo/modelCacheDir/allowModelDownload` 运行时配置与模型目录兼容约束。

## 2026-03-16
### Changed
- 更新 `specs/114-metadata-annotation/spec.md`、`src/types/index.ts`、`src/features/preview/utils/annotationDisplayStore.ts`、`src/features/workspace/components/WorkspaceShell.tsx`、`src/hooks/useFileSystem.ts` 与 `src/features/explorer/components/ExplorerToolbar.tsx`：顶部排序条件新增“标注时间（`updatedAt`）”；应用该排序时已标注项按时间升降序排序，未标注项始终置底（不随升降序翻转），未标注组内按名称次级排序。
- 更新 `specs/100-preview-playback/spec.md`、`specs/114-metadata-annotation/spec.md` 与 `src/features/preview/hooks/usePreviewTraversal.ts`：修复随机遍历 + “包含标签：未标注”过滤下当前文件打标后的续播退化问题；当当前项因过滤移出结果集时，随机模式优先沿用 `shuffleQueue` 续播下一项，不再回退到顺序列表项。

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
