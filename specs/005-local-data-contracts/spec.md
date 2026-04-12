# 005 Local Data Contracts 本地数据契约

## 1. 目的 (Purpose)

定义 Fauplay 的本地数据统一契约，确保：

1. 本地数据单一真源固定为全局 SQLite。
2. 数据读写（DDL/DML）统一由 Gateway 承担，禁止插件直写。
3. 内容身份（`assetId`）与路径索引（`file.absolutePath`）在标签、人脸、分类等能力域下职责清晰。
4. 人脸、标注、分类能力在同一数据层下可查询、可组合、可演进。
5. 文件型运行时配置按“应用配置归应用、工具配置归工具”收敛，不再把 repo 默认值、工具默认值、全局覆盖、root 覆盖与浏览器私有状态混作一层。
6. 基于 `asset + file` 的重复文件查询与显式建档继续复用同一数据模型，不引入并行身份体系。

## 2. 关键术语 (Terminology)

- 单一真源（Single Source of Truth）
- 数据网关层（Gateway Data Layer）
- 资产标识（`assetId`）
- 文件路径索引（File Path Index）
- 资产标签关联（Asset-Tag Binding）
- 计算插件（Compute Plugin）
- 应用配置（App-owned Runtime Config）
- 工具配置（Tool-owned Runtime Config）
- 全局配置根（Global Config Root）
- Root 配置根（Root Config Root）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 统一本地数据文件：`${HOME}/.fauplay/global/faudb.sqlite`。
2. 统一 DDL、迁移、事务、索引、并发控制归属到 Gateway。
3. 定义统一 `asset + file + tag + asset_tag` 数据模型（含多来源标签）。
4. 定义 Gateway 原生 HTTP 读写接口契约。
5. 定义插件“只计算不直写”约束。
6. 定义文件型运行时配置的统一分层、路径与覆盖顺序。
7. 定义基于 `assetId` 的重复文件查询与显式建档接口契约。

范围外：

1. 旧 per-root 数据导入与兼容迁移。
2. `sha256` 生成流程与人工校验工作流。
3. 全局管理/校验 UI 设计细节。
4. 全库后台自动补索引策略。

## 4. 架构契约 (Gateway as Single Data Layer)

1. Gateway 是唯一可访问 SQLite 的组件；前端与外部 MCP 插件不得直接读写数据库文件。
2. 插件仅负责计算与推断，不得包含 SQL DDL/DML。
3. 所有持久化操作必须由 Gateway 数据层统一执行。
4. Gateway 必须以事务方式应用一次写请求的全部数据变更，保证原子性。

### 4.1 文件型运行时配置分层

1. app-owned 运行时配置按以下顺序解析：`src/config/<domain>.json -> ~/.fauplay/global/<domain>.json -> <root>/.fauplay/<domain>.json`。
2. app-owned 进程环境层固定读取 `~/.fauplay/global/.env`；该层只负责 Gateway 及其子进程的环境变量注入，不与 JSON 文件型配置做字段级合并。
3. tool-owned 默认配置必须与工具一起发布在 `tools/mcp/<tool>/config.json`，不再强制迁入 `src/config/`。
4. tool-owned 配置不得自动读取 `~/.fauplay/global/<domain>.json` 或 `<root>/.fauplay/<domain>.json` 作为内建覆盖层。
5. Host 如需覆盖工具内部配置，必须通过 `~/.fauplay/global/mcp.json` 显式改写对应 server 的 `args/env/command/cwd`，或在独立运行工具时显式传入 `--config <path>`。
6. 同名环境变量优先级固定为：`servers.<name>.env` > `~/.fauplay/global/.env` > 启动 Gateway 的 shell 环境变量。
7. 并非所有 app-owned 配置域都支持 root 覆盖；只有显式声明为 root-scoped 的域才允许读取 `<root>/.fauplay/<domain>.json`。
8. `mcp` 注册配置固定为 default + global 两层：`src/config/mcp.json -> ~/.fauplay/global/mcp.json`；Gateway 启动时不得读取 `<root>/.fauplay/mcp.json`。
9. 浏览器 `localStorage` 与 `IndexedDB` 不参与文件型运行时配置解析链。
10. 当 `root=~` 时，`~/.fauplay/<domain>.json` 仍视为 root 级配置，`~/.fauplay/global/<domain>.json` 仍只视为全局级配置；实现必须按精确文件路径、非递归方式查找，避免串层。
11. 项目目录下的 `.fauplay/` 仅表示“以项目目录为 root 的本地数据与配置目录”，不再承载 repo 发布的默认配置。
12. `*.local.json` 不再属于运行时兼容路径；旧文件允许遗留，但系统不得继续读取。
13. `shortcuts` 属于 root-scoped 的 app-owned 配置域；默认值位于 `src/config/shortcuts.json`，并允许 `~/.fauplay/global/shortcuts.json` 与 `<root>/.fauplay/shortcuts.json` 覆盖。
14. `remote-access` 属于 default + global 两层的 app-owned 配置域；默认值位于 `src/config/remote-access.json`，并仅允许 `~/.fauplay/global/remote-access.json` 覆盖，Gateway 启动时不得读取 `<root>/.fauplay/remote-access.json`。
15. `remote-access` 的 token 不属于 JSON 配置字段；Gateway 必须从 `~/.fauplay/global/.env` 中读取 `FAUPLAY_REMOTE_ACCESS_TOKEN`。
16. 远程 remember-device 的服务端持久化状态不属于 JSON 配置链；默认文件路径固定为 `~/.fauplay/global/remote-remembered-devices.v1.json`。
17. `remote-remembered-devices.v1.json` 仅允许 Gateway 读写，用于保存 remembered device 的服务端最小元数据；浏览器不得直接读写或通过配置覆盖该文件。
18. `remote-remembered-devices.v1.json` 的当前记录 schema 必须至少包含：`id`、`tokenHash`、`label`、`autoLabel`、`userAgentSummary`、`createdAtMs`、`lastUsedAtMs`、`expiresAtMs`。
19. `tokenHash` 必须保持为不可逆摘要；文件中不得保存可直接复用的 remembered-device cookie 原值。
20. 旧版 v1 记录在首次加载时必须升级补齐新字段，并以保守默认值回写；缺失字段的默认口径至少包括：`label=''`、`autoLabel='旧版已记住设备'`、`userAgentSummary=''`。
21. remembered-device 服务端状态与远程 session 的绑定关系属于 Gateway 内部运行时状态，不进入浏览器持久化与公开 JSON 配置链。
22. `remote-access` JSON 配置必须新增 `rootSource: 'manual' | 'local-browser-sync'`；缺省值固定为 `manual`。
23. 当 `remote-access.rootSource='manual'` 时，Gateway 继续以 `remote-access.roots[]` 作为远程 roots 真源。
24. 当 `remote-access.rootSource='local-browser-sync'` 时，远程 roots 真源必须切换为 Gateway 私有持久化文件 `~/.fauplay/global/remote-published-roots.v1.json`；浏览器 `IndexedDB` 缓存与 `localStorage` 绑定只允许作为 loopback-only 同步输入，不得直接成为远程公开真源。
25. 远程共享收藏必须固定由 Gateway 管理在 `~/.fauplay/global/remote-shared-favorites.v1.json`；该文件不属于 JSON 配置链，且浏览器不得直接读写。

### 4.2 Gateway WSL `drvfs` 恢复

1. `/mnt/<drive>/...` 路径上的 `No such device` 恢复属于 Gateway 横切运行时保障，而非任一 tool-owned config 的私有能力。
2. 当 Gateway 自身文件访问或经 Gateway 发起的路径型工具调用命中上述错误时，Gateway 必须尝试执行 `sudo -S mount -t drvfs <DRIVE>: /mnt/<drive>` 并仅重试一次。
3. 自动重挂载仅使用进程环境变量 `SUDO_PASSWORD`；缺失、密码错误或挂载超时时必须快速失败并返回可读错误。

## 5. 数据与存储契约 (SQLite Contract)

### 5.1 文件路径与隔离

1. 数据库文件固定为：`${HOME}/.fauplay/global/faudb.sqlite`。
2. 全应用共享单一全局库；`rootPath` 仅作为请求过滤条件，不是持久化实体。
3. `schemaVersion=5`（`PRAGMA user_version=5`）。

### 5.2 统一主键与关系

1. `asset.id` 为全局唯一 `UUID`，作为统一业务真源 `assetId`。
2. `file.absolutePath` 为 `file` 表主键，作为唯一位置身份；`file` 仅承载当前路径索引，不再暴露独立 `fileId` 对外语义。
3. `asset` 以 `UNIQUE(size, fingerprint, fpMethod)` 作为主内容身份约束；`sha256` 为可空预留字段，不参与 v1 主身份与共享判定。
4. `file` 以 `absolutePath UNIQUE` 作为唯一位置身份；数据库不持久化 `relativePath`。
5. `tag` 使用复合主键 `PRIMARY KEY(key, value, source)`，并额外保留 `id UNIQUE` 供 `asset_tag.tagId` 引用。
6. `asset_tag` 作为资产-标签唯一绑定层，`PRIMARY KEY(assetId, tagId)`。
7. 旧 `.annotations.v1.json`、`faces.v1.sqlite` 与 `<root>/.fauplay/faudb.v1.sqlite` 不再作为运行时数据源。

### 5.3 最小逻辑模型（表级约束）

1. `asset`：`id`、`size`、`fingerprint`、`fpMethod`、`sha256`（可空）、`deletedAt`（可空）、`createdAt`、`updatedAt`。
2. `file`：`absolutePath`、`assetId`、`fileMtimeMs`、`lastSeenAt`、`createdAt`、`updatedAt`。
3. `tag`：`id`、`key`、`value`、`source`。
4. `asset_tag`：`assetId`、`tagId`、`appliedAt`、`score`（可空，当前仅分类使用）。
5. `face`、`face_embedding`、`person`、`person_face` 保留并对齐统一 `assetId` 关系；其中 `person_face` 是人物归属真源，`face.status` 负责表达自动/人工处理状态。
6. `face` 必须额外支持 `mediaType`（`image | video`）与 `frameTsMs`（视频采样帧毫秒时间点，可空）字段。
7. `asset_face_detection`：`assetId`、`mediaType`、`status`、`detectedAt`、`faceCount`、`error`（可空）、`updatedAt`，用于记录资产级人脸检测完成状态。
8. `annotation_record`、`face_job_state`、`root`、`asset_fingerprint` 与任何 `*_tag_ext` 扩展表不再保留。

### 5.4 路径与查询语义

1. `absolutePath` 必须以 Linux 风格绝对路径持久化，作为唯一位置身份。
2. `relativePath` 仅在读请求显式携带 `rootPath` 时，由 Gateway 基于 `absolutePath` 动态换算后返回。
3. 重叠 root（如先打开 `rootA`，再打开 `rootA/sub`）不得产生重复 `file` 记录；同一物理文件只允许存在一条 `file(absolutePath)`。
4. 普通文件、标签、人物查询默认仅返回 `asset.deletedAt IS NULL` 的活跃资产；`includeDeleted` 仅为未来全局管理/校验接口预留。

### 5.5 标签语义

1. `source=meta.annotation`：`key=fieldKey`、`value=fieldValue`，写入 `asset_tag`。
2. `source=vision.face`：`key='person'`、`value=personName`，由 `person_face` 投影生成资产级标签。
3. `source=ml.classify`：`key='class'`、`value=label`，`score` 写入 `asset_tag.score`。
4. 同名人物允许存在；资产级 `vision.face` 标签按人物显示名维度合并，file-centered 查询会把资产级标签展开到每个可见 `file`。
5. `source` 用于来源追踪与标签去重维度，不作为前端过滤/预览显示的默认读取门槛。
6. 前端展示、过滤与候选去重的逻辑标签身份固定为 `key + value`；`source` 是同一逻辑标签的附加来源维度。
7. 当同一逻辑标签同时存在 `meta.annotation` 与其他来源时，前端代表来源必须优先选择 `meta.annotation`。

### 5.6 资产级重复文件语义

1. “重复文件”固定定义为：多个 `file.absolutePath` 命中同一 `assetId`。
2. 查询作用域 `global/root` 只影响候选副本过滤，不改变请求方提交的种子集合。
3. `missing index` 固定表示：当前文件不存在对应 `file` 记录。
4. `stale index` 固定表示：存在 `file` 记录，但记录内 `fileMtimeMs` 与当前文件实际 `mtime` 不一致。
5. 预览区查重允许在请求链路内对“当前文件”执行隐式单文件补索引；该能力不得扩展为工作区批量自动索引。
6. 工作区显式索引只允许处理 `missing | stale` 文件；`fresh` 文件必须返回 `skipped`。
7. 工作区对 `stale` 种子执行查重时，可先基于旧索引召回候选，但最终结果必须经过“种子 + 命中项”双方当前特征二次校验。

### 5.7 参考文档

1. 详细 DDL 与行为映射见：[`./tag-core-v2-reference.md`](./tag-core-v2-reference.md)。
2. 文件型运行时配置分层、路径矩阵与作用域表见：[`./runtime-config-reference.md`](./runtime-config-reference.md)。

## 6. Gateway HTTP 接口契约 (Public HTTP APIs)

### 6.1 标签查询

1. `POST /v1/data/tags/file`
2. `POST /v1/data/tags/options`
3. `POST /v1/data/tags/query`
4. `/v1/data/tags/file` 仅支持通过 `rootPath + relativePath` 定位，内部统一解析为 `absolutePath -> file -> asset`。
5. `/v1/data/tags/options` 与 `/v1/data/tags/query` 默认执行全局查询，并支持显式 `rootPath` 过滤。
6. file-centered 查询结果必须返回 `assetId + absolutePath`；当请求携带 `rootPath` 时，响应还必须返回动态换算后的 `relativePath`。
7. `/v1/data/tags/file` 与 `/v1/data/tags/query` 默认返回多来源标签集合，不得隐式按 `source=meta.annotation` 预过滤。
8. 标签统计按可见 `file` 行计数，不按去重后的 `asset` 数计数，以保持与 file-centered 结果一致。
9. `/v1/data/tags/options` 返回的候选项允许包含同一 `key + value` 的多来源记录；前端必须先保留来源信息，再按逻辑标签聚合。

### 6.2 本地数据管理

1. `PUT /v1/file-annotations`
2. `POST /v1/file-annotations/tags/bind`
3. `POST /v1/file-annotations/tags/unbind`
4. `PATCH /v1/files/relative-paths`
5. `POST /v1/files/missing/cleanups`
6. `POST /v1/files/indexes`
7. `POST /v1/files/duplicates/query`
8. `file-annotations/tags/bind` 仅新增 `source=meta.annotation` 的同名标签绑定，不删除同 `key + value` 的派生来源。
9. `file-annotations/tags/unbind` 仅移除 `source=meta.annotation` 的同名标签绑定，不删除同 `key + value` 的派生来源。
10. 以上接口对外继续接收 `rootPath + relativePath`，但持久化层只落 `absolutePath`。
11. 历史维护接口全部下线（返回下线错误或 404）。
12. `POST /v1/files/indexes` 只允许显式补建当前目标文件的 `file/asset` 记录，不得承诺全库扫描。
13. `POST /v1/files/duplicates/query` 必须继续以同一 `assetId` 作为重复身份判断依据，不得引入新的 v1 重复真源。

### 6.3 人脸流程

1. `POST /v1/faces/detect-asset`
2. `POST /v1/faces/cluster-pending`
3. `POST /v1/faces/list-people`
4. `POST /v1/faces/rename-person`
5. `POST /v1/faces/merge-people`
6. `POST /v1/faces/list-asset-faces`
7. `POST /v1/faces/list-review-faces`
8. `POST /v1/faces/suggest-people`
9. `POST /v1/faces/assign-faces`
10. `POST /v1/faces/create-person-from-faces`
11. `POST /v1/faces/unassign-faces`
12. `POST /v1/faces/ignore-faces`
13. `POST /v1/faces/restore-ignored-faces`
14. `POST /v1/faces/requeue-faces`
15. `POST /v1/faces/detect-assets`
16. `POST /v1/faces/detect-assets/jobs`
17. `GET /v1/faces/detect-assets/jobs/:jobId`
18. `POST /v1/faces/detect-assets/jobs/:jobId/cancel`
19. `GET /v1/faces/detect-assets/jobs/:jobId/items`
20. `GET /v1/faces/crops/:faceId`

说明：

- `/v1/mcp` 继续保留用于通用插件调用，不承载上述业务主链路。
- 前端业务侧应优先使用 Gateway 原生 HTTP 接口。
- `list-people` 与人物上下文 `list-asset-faces` 必须支持显式 `scope: 'global' | 'root'`，不得仅通过是否携带 `rootPath` 推断查询作用域。
- `detect-asset` 必须支持可选 `runCluster?: boolean`，用于检测写入后在同一次请求内串行补跑 `cluster-pending`；视频资产的即时聚类必须采用保守策略，避免陌生 face 单次触发大量创建人物。
- `detect-assets` 必须支持工作区批量扫描：输入为 `rootPath + relativePaths[]`，目标由前端按“选中优先，否则当前可见”传入；Gateway 只处理未成功检测过的图片/视频资产，并在扫描前后执行保守聚类。
- `detect-assets/jobs` 必须作为大量工作区扫描的任务入口，任务状态仅保存在 Gateway 内存中；查询接口必须返回进度与摘要，逐项结果通过 `items?offset&limit` 分页读取。
- `detect-assets/jobs/:jobId/cancel` 必须支持批间取消：已排队任务立即取消，运行中任务在当前单文件推理完成后停止，取消任务不得执行最终 post-cluster。
- 人脸相关公开结果必须支持 `mediaType: 'image' | 'video'` 与 `frameTsMs: number | null`。
- `GET /v1/faces/crops/:faceId` 必须同时支持图片 face 与视频采样帧 face，不新增并行裁切路由。

### 6.4 局域网远程只读入口

1. `GET /v1/remote/capabilities`
2. `POST /v1/remote/session/login`
3. `POST /v1/remote/session/logout`
4. `GET /v1/remote/roots`
5. `POST /v1/remote/files/list`
6. `POST /v1/remote/files/text-preview`
7. `GET /v1/remote/files/content`
8. `GET /v1/remote/files/thumbnail`
9. `POST /v1/remote/tags/options`
10. `POST /v1/remote/tags/query`
11. `POST /v1/remote/tags/file`
12. `POST /v1/remote/faces/list-people`
13. `POST /v1/remote/faces/list-person-faces`
14. `GET /v1/remote/faces/crops/:faceId`
15. `GET /v1/remote/favorites`
16. `POST /v1/remote/favorites/upsert`
17. `POST /v1/remote/favorites/remove`

说明：

- 远程只读入口必须通过 `rootId + relativePath` 定位目标，不得接收 `absolutePath` 作为公开输入。
- 远程只读入口内部可复用现有 SQLite / 标签 / 人脸 / 文件读取数据层，但响应不得泄露服务器绝对路径。
- 远程只读文件列表返回的 `items[]` 仅允许暴露只读文件元信息子集，不得把 mutation 所需内部字段直接外露到 LAN。
- `GET /v1/remote/capabilities` 必须允许未登录访问；远程会话必须由 `POST /v1/remote/session/login` 完成一次性 Bearer 登录交换；除能力探测与登录接口外的远程入口改由同源 session cookie 鉴权。
- `GET /v1/remote/files/content` 必须支持浏览器原生媒体所需的 `Range` / `206 Partial Content` / `Accept-Ranges: bytes`。
- `GET /v1/remote/files/thumbnail` 必须返回服务端缩略图派生资源，而不是要求浏览器每次直接回源原文件生成缩略图。
- 远程共享收藏必须以服务端状态为真源；浏览器本地收藏只能作为 loopback-only 播种输入，不得作为 `remote-readonly` 的权威数据面。
- 远程共享收藏公开 DTO 固定只暴露 `rootId + path + favoritedAtMs`，不得暴露服务器绝对路径或浏览器本地 `rootId`。

### 6.5 Loopback-only Remote State Sync

1. `POST /v1/admin/remote-published-roots/sync-from-local-browser`

说明：

- 该接口固定为 loopback-only admin 面，不属于 `/v1/remote/*`。
- 请求体必须为全量快照：`Array<{ label: string; absolutePath: string; favoritePaths: string[] }>`。
- `absolutePath` 仅允许在该 loopback-only 同步入口出现；Gateway 必须把它转换为服务端稳定 `rootId` 后再进入远程公开数据面。
- 全量快照替换远程已发布 roots 时，缺席 root 必须被下线；其下属远程共享收藏也必须同步清理。
- `favoritePaths` 只负责对服务端远程共享收藏执行增量播种，不得因本地未收藏而删除已存在的远程共享收藏。

## 7. 插件职责约束 (Plugin Responsibility)

1. `vision-face` 插件仅保留推理能力（检测框与 embedding），不负责持久化。
2. `vision-face` 对视频输入仅负责按时长自适应抽帧检测、embedding 计算、视频内去重与候选上限收敛，不负责人物写入或标签投影。
3. `local.data` 插件仅承载工作台入口与操作元数据，不直接读写 SQLite。
4. `timm-classifier` 仅返回分类结果，落库由 Gateway 执行。

## 8. 兼容与迁移策略 (Compatibility)

1. 不兼容旧数据：不读取、不导入旧 `faces.v1.sqlite`、旧 `.annotations.v1.json` 与旧 `<root>/.fauplay/faudb.v1.sqlite`。
2. 若旧全局数据库 `${HOME}/.fauplay/faudb.global.sqlite` 存在且新路径 `${HOME}/.fauplay/global/faudb.sqlite` 缺失，系统必须先完成一次迁移，再打开新路径。
3. 当检测到旧全局 schema 时，直接重建数据库（不备份）。
4. 新版本仅认 `schemaVersion=6`。

## 9. 功能需求 (FR)

1. `FR-LDC-01` 系统必须以 `${HOME}/.fauplay/global/faudb.sqlite` 作为唯一运行时数据源。
2. `FR-LDC-02` Gateway 必须成为唯一 DDL/DML 执行者。
3. `FR-LDC-03` 插件不得直接访问 SQLite。
4. `FR-LDC-04` 所有可持久化业务数据必须统一关联 `assetId`；`file` 仅表示当前路径索引。
5. `FR-LDC-05` 系统必须提供 file-centered 标签查询 HTTP 接口用于预览展示与过滤。
6. `FR-LDC-06` 单次写请求必须事务化，失败可回滚。
7. `FR-LDC-07` 标签来源必须可追踪（`source`）。
8. `FR-LDC-08` 系统不得再读写旧 sidecar 或旧 per-root 数据库作为业务真源。
9. `FR-LDC-09` 系统必须支持 `file` 路径索引的批量路径重绑与缺失路径清理；外部重命名后不再保证位置身份连续性。
10. `FR-LDC-10` 标签读取接口默认不得将 `source=meta.annotation` 作为隐式过滤条件。
11. `FR-LDC-11` 普通查询必须默认隐藏 `deletedAt` 非空的软删除资产。
12. `FR-LDC-12` `sha256` 仅作为预留字段存在，不参与 v1 主身份、唯一键、共享判定与接口设计。
13. `FR-LDC-13` 前端逻辑标签展示、过滤与候选去重必须按 `key + value` 聚合，而非按 `source` 分裂。
14. `FR-LDC-14` 系统必须提供“仅补/删 `meta.annotation` 来源”的逻辑标签写接口，不得影响派生来源标签。
15. `FR-LDC-15` app-owned 文件型运行时配置必须统一按 `src/config -> ~/.fauplay/global -> <root>/.fauplay` 解析；只有显式 root-scoped 域可读取 root 级配置。
16. `FR-LDC-16` MCP 注册配置必须仅解析 `src/config/mcp.json` 与 `~/.fauplay/global/mcp.json`，不得在 Gateway 启动时读取 root 级 `mcp.json`。
17. `FR-LDC-17` 系统不得继续读取 `.fauplay/mcp.local.json`、`config.local.json` 或其他 `*.local.json` 作为运行时配置兼容路径。
18. `FR-LDC-18` 项目目录下 `.fauplay/` 必须只作为该目录被当作 root 时的本地数据/配置目录，不再承载 repo 发布默认值。
19. `FR-LDC-19` 浏览器 `localStorage` 与 `IndexedDB` 不得参与文件型运行时配置覆盖链。
20. `FR-LDC-20` 当 root 为用户家目录时，root 级 `.fauplay/<domain>.json` 与全局 `.fauplay/global/<domain>.json` 必须保持作用域隔离，不得递归串层。
21. `FR-LDC-21` `local-data`、`video-same-duration`、`timm-classifier`、`vision-face` 等 tool-owned 默认配置必须位于 `tools/mcp/<tool>/config.json`，且不得自动读取 `~/.fauplay/global/<domain>.json` 作为内建覆盖层。
22. `FR-LDC-22` Gateway 必须在启动前读取可选的 `~/.fauplay/global/.env` 作为 app-owned 进程环境层，且同名环境变量优先级固定为 `servers.<name>.env` > `~/.fauplay/global/.env` > shell env。
23. `FR-LDC-23` `/mnt/<drive>/...` 上的 `No such device` 恢复必须由 Gateway 统一承担；tool-owned 插件不得再把该恢复逻辑作为私有配置契约对外承诺。
24. `FR-LDC-24` `shortcuts` 配置域必须按 `src/config/shortcuts.json -> ~/.fauplay/global/shortcuts.json -> <root>/.fauplay/shortcuts.json` 解析，且仅 `shortcuts` 这类显式 root-scoped 域允许读取 root 层文件。
25. `FR-LDC-25` `remote-access` 配置域必须按 `src/config/remote-access.json -> ~/.fauplay/global/remote-access.json` 解析，且不得读取 root 级 `remote-access.json`。
26. `FR-LDC-26` Gateway 必须从 `~/.fauplay/global/.env` 读取 `FAUPLAY_REMOTE_ACCESS_TOKEN` 作为远程只读入口 token，不得从 JSON 配置读取该 secret。
27. `FR-LDC-27` 系统必须提供 `/v1/remote/*` 只读入口，并通过 `rootId + relativePath` 访问受 allowlist 保护的远程文件、标签与人物数据。
28. `FR-LDC-28` `/v1/remote/*` 响应不得返回服务器绝对路径。
29. `FR-LDC-29` face correction 相关写请求必须直接修改 `person_face` 与 `face.status`，不得把 `vision.face` 标签当作人物归属真源。
30. `FR-LDC-30` `person_face.assignedBy` 必须支持 `auto | manual | merge`。
31. `FR-LDC-31` `face.status` 必须支持 `assigned | unassigned | deferred | manual_unassigned | ignored`。
32. `FR-LDC-32` 自动聚类默认仅处理 `unassigned | deferred`；`manual_unassigned` 与 `ignored` 不得被后台自动改写。
33. `FR-LDC-33` 远程 remember-device 的服务端持久化状态必须固定由 Gateway 管理在 `~/.fauplay/global/remote-remembered-devices.v1.json`，且不得进入公开 JSON 配置链或浏览器持久化状态。
33. `FR-LDC-33` 人脸 mutation 接口必须允许部分成功，并返回逐项结果与稳定错误码。
34. `FR-LDC-34` 系统必须提供 `POST /v1/files/indexes` 作为显式补建 `file/asset` 记录的统一入口。
35. `FR-LDC-35` 显式补建接口必须只处理 `missing | stale` 文件；`fresh` 文件不得重复建档。
36. `FR-LDC-36` 系统必须提供 `POST /v1/files/duplicates/query` 作为按 `assetId` 查重的统一查询入口。
37. `FR-LDC-37` 工作区查重对 `stale` 种子必须执行当前特征二次校验后再保留结果。
38. `FR-LDC-38` `face` 表必须支持同时持久化图片 face 与视频采样帧 face，并通过 `mediaType/frameTsMs` 区分来源。
39. `FR-LDC-39` 对视频执行 `detect-asset` 时，系统必须支持把抽样后代表 faces 落到现有 `face/face_embedding` 模型，而不是引入并行视频人脸表。
40. `FR-LDC-40` `GET /v1/faces/crops/:faceId` 必须可从视频文件按 `frameTsMs` 取帧后返回裁切图。
41. `FR-LDC-41` 系统必须持久化资产级人脸检测完成状态，确保检测过但 0 张脸的资产也可被批量扫描跳过。
42. `FR-LDC-42` 系统必须提供 `POST /v1/faces/detect-assets` 作为工作区批量扫描入口，并保持逐项成功/跳过/失败汇总。
43. `FR-LDC-43` 系统必须提供 Gateway 内存任务形式的工作区人脸扫描入口，支持进度查询、批间取消与逐项结果分页读取，避免大量目标依赖单个长请求和超大响应体。
44. `FR-LDC-44` `remote-access` 配置域必须支持 `rootSource: 'manual' | 'local-browser-sync'`，缺省值固定为 `manual`。
45. `FR-LDC-45` 当 `rootSource='local-browser-sync'` 时，远程 roots 真源必须固定为 `~/.fauplay/global/remote-published-roots.v1.json`，而不是浏览器本地缓存。
46. `FR-LDC-46` Gateway 必须提供 loopback-only 的本机 roots 自动发布同步入口，并接受全量快照 `Array<{ label, absolutePath, favoritePaths[] }>`。
47. `FR-LDC-47` Gateway 必须把自动发布 roots 持久化到 `~/.fauplay/global/remote-published-roots.v1.json`，其记录 schema 至少包含 `id`、`label`、`absolutePath`、`createdAtMs`、`lastSyncedAtMs`。
48. `FR-LDC-48` 自动发布 root 的 `id` 必须由规范化后的 `absolutePath` 稳定派生，不得直接复用浏览器本地 `rootId`。
49. `FR-LDC-49` Gateway 必须把远程共享收藏持久化到 `~/.fauplay/global/remote-shared-favorites.v1.json`，并以服务端 `rootId + normalizedPath` 作为唯一收藏键。
50. `FR-LDC-50` `GET /v1/remote/favorites`、`POST /v1/remote/favorites/upsert` 与 `POST /v1/remote/favorites/remove` 必须以服务端远程共享收藏为真源，并且只接受 `rootId + path`。
51. `FR-LDC-51` 浏览器本地 `full-access` 收藏只允许在 loopback-only 自动同步时向远程共享收藏做增量播种，不得与服务端远程共享收藏形成双向镜像真源。
52. `FR-LDC-52` 当自动发布 roots 的全量快照移除某个 root 时，Gateway 必须同步删除该 `rootId` 下的远程共享收藏，避免 orphan favorites。
53. `FR-LDC-53` 当远程根目录集合变化导致某个共享收藏不再命中现有 root 时，`GET /v1/remote/favorites` 不得返回该失效收藏。

## 10. 验收标准 (AC)

1. `AC-LDC-01` 首次调用后自动创建 `${HOME}/.fauplay/global/faudb.sqlite` 并可查询。
2. `AC-LDC-02` 同一物理文件从重叠 root 打开两次时，只生成一条 `file(absolutePath)` 记录。
3. `AC-LDC-03` 同内容文件在不同路径下命中同一 `asset` 后，任一路径写入标签，其余路径可立即看到相同标签。
4. `AC-LDC-04` 分类推理后，`asset_tag.score` 可查询，非分类标签 `score` 为 `NULL`。
5. `AC-LDC-05` 人脸检测与聚类后，人物列表、资产标签与 file-centered 查询结果一致。
6. `AC-LDC-06` 旧 sidecar、旧人脸库与旧 per-root 库存在时，系统不读取且不崩溃。
7. `AC-LDC-07` `files/relative-paths` 支持链式映射（如 `A->B, B->C`），并能正确更新目标路径索引。
8. `AC-LDC-08` 外部重命名后若新路径先被建档，标签与人脸仍通过共享 `assetId` 正常复用；执行缺失路径清理后旧路径索引被删除。
9. `AC-LDC-09` 当文件仅存在非 `meta.annotation` 来源标签时，`/v1/data/tags/file` 与 `/v1/data/tags/query` 仍可返回该标签供顶部过滤与预览显示使用。
10. `AC-LDC-10` 当某个 `asset` 的最后一个 `file` 消失时，普通查询不再返回该资产；同内容文件再次出现时会自动复活原 `asset`。
11. `AC-LDC-11` 同一文件同时拥有 `vision.face(person=Alice)` 与 `meta.annotation(person=Alice)` 时，前端逻辑标签聚合后仅显示一个 `person=Alice` 项，并优先以 `meta.annotation` 为代表来源。
12. `AC-LDC-12` 调用 `file-annotations/tags/unbind` 删除 `meta.annotation(person=Alice)` 后，若 `vision.face(person=Alice)` 仍存在，则查询结果仍保留该逻辑标签。
13. `AC-LDC-13` `mcp.local.json`、`config.local.json` 等旧本地覆盖文件存在时，系统不读取且不崩溃。
14. `AC-LDC-14` 当 `root=~` 时，`~/.fauplay/<domain>.json` 可作为 root 级文件生效，但 `~/.fauplay/global/<domain>.json` 不会被误识别为 root 级配置。
15. `AC-LDC-15` 若旧路径 `${HOME}/.fauplay/faudb.global.sqlite` 存在且新路径缺失，首次打开数据库后新路径生效，旧路径不再作为运行时读写真源。
16. `AC-LDC-16` `~/.fauplay/global/timm-classifier.json`、`video-same-duration.json`、`vision-face.json`、`local-data.json` 等旧 tool-owned 全局覆盖文件存在时，系统忽略它们且不崩溃。
17. `AC-LDC-17` `~/.fauplay/global/.env` 缺失时 Gateway 仍可正常启动；当其与 shell 中同名环境变量冲突时，以 `.env` 值为准，但 `servers.<name>.env` 仍可继续覆盖。
18. `AC-LDC-18` Gateway 自身文件访问或经 Gateway 发起的路径型工具调用在 `/mnt/<drive>/...` 命中 `No such device` 时，可自动重挂载后单次重试成功；失败时返回可读错误且不升级为前端 `MCP_CLIENT_TIMEOUT`。
19. `AC-LDC-19` `~/.fauplay/global/shortcuts.json` 与 `<root>/.fauplay/shortcuts.json` 缺失时，系统继续使用 `src/config/shortcuts.json` 默认值；当其存在时，仅覆盖已声明的快捷键动作。
20. `AC-LDC-20` `remote-access` 仅读取 `src/config/remote-access.json` 与 `~/.fauplay/global/remote-access.json`；即使 `<root>/.fauplay/remote-access.json` 存在，系统也不会读取。
21. `AC-LDC-21` `FAUPLAY_REMOTE_ACCESS_TOKEN` 仅从 `~/.fauplay/global/.env` 注入；`remote-access.json` 中不存在 token 字段也不影响远程鉴权契约。
22. `AC-LDC-22` 对 `/v1/remote/files/content`、`/v1/remote/files/thumbnail` 与 `/v1/remote/files/text-preview` 提交绝对路径、`..` 或未知 `rootId` 时，服务端统一拒绝访问。
23. `AC-LDC-23` 对 face 执行 assign/create-person/unassign/ignore/restore/requeue 后，`person_face`、`face.status`、人物列表计数与 `vision.face` 资产标签结果保持一致。
24. `AC-LDC-24` 对 `POST /v1/files/indexes` 提交一组混合 `fresh/missing/stale` 文件时，仅 `missing/stale` 项会被实际建档，`fresh` 项返回 `skipped`。
25. `AC-LDC-25` 对 `POST /v1/files/duplicates/query` 发起预览单文件查重时，当前文件无索引或索引过期可先被隐式补建，再返回重复结果。
26. `AC-LDC-26` 对 `POST /v1/files/duplicates/query` 发起工作区查重时，`missing` 种子会出现在覆盖率统计中而不是被静默忽略。
27. `AC-LDC-27` 对 `POST /v1/files/duplicates/query` 发起工作区查重时，`stale` 种子的旧命中若经当前特征二次校验失效，则不会出现在最终结果中。
28. `AC-LDC-28` 对视频执行 `POST /v1/faces/detect-asset` 后，数据库中的 `face` 记录会写入 `mediaType='video'` 与非空 `frameTsMs`，并可继续参与既有人物聚类。
29. `AC-LDC-29` 对视频执行 `POST /v1/faces/detect-asset` 且 `runCluster=true` 后，匹配已有人物或达到保守聚类证据要求的 face 可产生 `vision.face(person=...)` 标签投影；证据不足的陌生视频 face 保持待整理状态。
30. `AC-LDC-30` 对视频来源 face 调用 `GET /v1/faces/crops/:faceId` 时，可返回裁切图而不是 404 或仅支持图片。
31. `AC-LDC-31` 对 `POST /v1/faces/detect-assets` 提交混合目标时，非媒体、已成功检测和重复路径返回 skipped，未检测图片/视频会执行检测并记录资产级检测状态。
32. `AC-LDC-32` 对已成功检测但 0 张脸的资产再次执行批量扫描时，该资产会被跳过而不是重复推理。
33. `AC-LDC-33` 对大量图片/视频提交 `detect-assets/jobs` 后，任务状态查询可看到 `processed/total` 递增；取消运行中任务时当前文件完成后停止，且不会执行最终 post-cluster。
34. `AC-LDC-34` `remote-access.rootSource` 缺失时，系统按 `manual` 解释；`remote-access.roots[]` 的现有远程行为保持不变。
35. `AC-LDC-35` 当 `rootSource='local-browser-sync'` 时，只有“已在 cached roots 中且已有 `rootPath` 绑定”的根目录会出现在 `GET /v1/remote/roots`；未绑定项不会被远程发布。
36. `AC-LDC-36` 同一绝对路径即使浏览器本地 `rootId` 变化，自动发布后的远程 `rootId` 仍保持稳定；不同绝对路径即使同名，也不会合并。
37. `AC-LDC-37` 对 `POST /v1/admin/remote-published-roots/sync-from-local-browser` 提交新快照后，缺席的已发布 roots 会被下线，且其下属远程共享收藏被同步清理。
38. `AC-LDC-38` 本机 `full-access` 收藏在自动同步后可播种到服务端远程共享收藏；本地随后取消收藏时，不会自动删除已存在的远程共享收藏。
39. `AC-LDC-39` 远程设备 A 对共享收藏执行新增后，设备 B 重新读取 `GET /v1/remote/favorites` 可见同一结果；任一设备移除后其他设备刷新也同步消失。
40. `AC-LDC-40` 当某个共享收藏对应的 `rootId` 不再属于当前远程 roots 集合时，`GET /v1/remote/favorites` 不会再返回该收藏。

## 11. 公共接口与类型影响 (Public Interfaces & Types)

1. `TagRecord` 时间字段语义收敛到 `asset_tag.appliedAt`。
2. `TagRecord.score` 作为通用可空字段新增，当前仅分类来源使用。
3. file-centered 查询结果统一返回 `assetId + absolutePath`；`relativePath` 仅在请求携带 `rootPath` 时返回。
4. 标注与文件维护接口保持 `/v1/file-annotations`、`/v1/files/relative-paths`、`/v1/files/missing/cleanups` 路径，但内部真源切换到 `absolutePath -> file -> asset`。
5. 前端逻辑标签主模型新增 `tagKey/key/value/sources/hasMetaAnnotation/representativeSource`，用于按 `key + value` 聚合多来源标签。
6. 新增显式建档接口：`POST /v1/files/indexes`。
7. 新增重复文件查询接口：`POST /v1/files/duplicates/query`。
8. 重复文件查询结果需支持覆盖率字段（如 `seedCount/indexedSeedCount/needsIndexingCount`）与分组结果（如 `groups[]`）。
9. 人脸公开记录新增 `mediaType: 'image' | 'video'` 与 `frameTsMs: number | null`。
10. 新增资产级人脸检测状态表，用于区分“未检测”与“已检测但 0 张脸”。
11. 视频检测配置新增/收敛 `videoShortIntervalMs`、`videoShortMaxDurationMs`、`videoMaxFrames`、`videoMinScore`、`videoDedupeMaxDistance` 与 `videoMaxFacesPerAsset`，用于限制视频候选 face 数量。
12. 工作区大量人脸扫描新增内存任务接口；任务状态不持久化，不改变 SQLite schema。
13. 新增 app-owned 运行时配置类型：`RemoteAccessConfig` 与 `RemoteAccessRootEntry`。
14. 新增远程只读文件 DTO：以 `rootId + path` 表示公开路径，不包含服务器绝对路径字段。
15. `RemoteAccessConfig` 必须新增 `rootSource: 'manual' | 'local-browser-sync'`。
16. 新增 loopback-only roots 自动发布同步接口：`POST /v1/admin/remote-published-roots/sync-from-local-browser`。
17. 新增远程共享收藏接口：`GET /v1/remote/favorites`、`POST /v1/remote/favorites/upsert`、`POST /v1/remote/favorites/remove`。
18. 新增 Gateway 私有状态文件：`remote-published-roots.v1.json` 与 `remote-shared-favorites.v1.json`。

## 12. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 图像分类：[`../104-timm-classification-mcp/spec.md`](../104-timm-classification-mcp/spec.md)
- 预览头部逻辑标签管理：[`../117-preview-header-tag-management/spec.md`](../117-preview-header-tag-management/spec.md)
- 资产级重复文件检测：[`../120-asset-duplicate-detection/spec.md`](../120-asset-duplicate-detection/spec.md)
- 触控优先紧凑远程只读工作区：[`../126-touch-first-compact-remote-readonly-workspace/spec.md`](../126-touch-first-compact-remote-readonly-workspace/spec.md)
