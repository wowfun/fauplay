# 005 Local Data Contracts 本地数据契约

## 1. 目的 (Purpose)

定义 Fauplay 的本地数据统一契约，确保：

1. 本地数据单一真源固定为全局 SQLite。
2. 数据读写（DDL/DML）统一由 Gateway 承担，禁止插件直写。
3. 内容身份（`assetId`）与路径索引（`file.absolutePath`）在标签、人脸、分类等能力域下职责清晰。
4. 人脸、标注、分类能力在同一数据层下可查询、可组合、可演进。
5. 文件型运行时配置按“应用配置归应用、工具配置归工具”收敛，不再把 repo 默认值、工具默认值、全局覆盖、root 覆盖与浏览器私有状态混作一层。

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

范围外：

1. 旧 per-root 数据导入与兼容迁移。
2. `sha256` 生成流程与人工校验工作流。
3. 全局管理/校验 UI 设计细节。

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

### 4.2 Gateway WSL `drvfs` 恢复

1. `/mnt/<drive>/...` 路径上的 `No such device` 恢复属于 Gateway 横切运行时保障，而非任一 tool-owned config 的私有能力。
2. 当 Gateway 自身文件访问或经 Gateway 发起的路径型工具调用命中上述错误时，Gateway 必须尝试执行 `sudo -S mount -t drvfs <DRIVE>: /mnt/<drive>` 并仅重试一次。
3. 自动重挂载仅使用进程环境变量 `SUDO_PASSWORD`；缺失、密码错误或挂载超时时必须快速失败并返回可读错误。

## 5. 数据与存储契约 (SQLite Contract)

### 5.1 文件路径与隔离

1. 数据库文件固定为：`${HOME}/.fauplay/global/faudb.sqlite`。
2. 全应用共享单一全局库；`rootPath` 仅作为请求过滤条件，不是持久化实体。
3. `schemaVersion=3`（`PRAGMA user_version=3`）。

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
5. `face`、`face_embedding`、`person`、`person_face` 保留并对齐统一 `assetId` 关系。
6. `annotation_record`、`face_job_state`、`root`、`asset_fingerprint` 与任何 `*_tag_ext` 扩展表不再保留。

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

### 5.6 参考文档

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
6. `file-annotations/tags/bind` 仅新增 `source=meta.annotation` 的同名标签绑定，不删除同 `key + value` 的派生来源。
7. `file-annotations/tags/unbind` 仅移除 `source=meta.annotation` 的同名标签绑定，不删除同 `key + value` 的派生来源。
8. 以上接口对外继续接收 `rootPath + relativePath`，但持久化层只落 `absolutePath`。
9. 历史维护接口全部下线（返回下线错误或 404）。

### 6.3 人脸流程

1. `POST /v1/faces/detect-asset`
2. `POST /v1/faces/cluster-pending`
3. `POST /v1/faces/list-people`
4. `POST /v1/faces/rename-person`
5. `POST /v1/faces/merge-people`
6. `POST /v1/faces/list-asset-faces`

说明：

- `/v1/mcp` 继续保留用于通用插件调用，不承载上述业务主链路。
- 前端业务侧应优先使用 Gateway 原生 HTTP 接口。

## 7. 插件职责约束 (Plugin Responsibility)

1. `vision-face` 插件仅保留推理能力（检测框与 embedding），不负责持久化。
2. `local.data` 插件仅承载工作台入口与操作元数据，不直接读写 SQLite。
3. `timm-classifier` 仅返回分类结果，落库由 Gateway 执行。

## 8. 兼容与迁移策略 (Compatibility)

1. 不兼容旧数据：不读取、不导入旧 `faces.v1.sqlite`、旧 `.annotations.v1.json` 与旧 `<root>/.fauplay/faudb.v1.sqlite`。
2. 若旧全局数据库 `${HOME}/.fauplay/faudb.global.sqlite` 存在且新路径 `${HOME}/.fauplay/global/faudb.sqlite` 缺失，系统必须先完成一次迁移，再打开新路径。
3. 当检测到旧全局 schema 时，直接重建数据库（不备份）。
4. 新版本仅认 `schemaVersion=3`。

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

## 11. 公共接口与类型影响 (Public Interfaces & Types)

1. `TagRecord` 时间字段语义收敛到 `asset_tag.appliedAt`。
2. `TagRecord.score` 作为通用可空字段新增，当前仅分类来源使用。
3. file-centered 查询结果统一返回 `assetId + absolutePath`；`relativePath` 仅在请求携带 `rootPath` 时返回。
4. 标注与文件维护接口保持 `/v1/file-annotations`、`/v1/files/relative-paths`、`/v1/files/missing/cleanups` 路径，但内部真源切换到 `absolutePath -> file -> asset`。
5. 前端逻辑标签主模型新增 `tagKey/key/value/sources/hasMetaAnnotation/representativeSource`，用于按 `key + value` 聚合多来源标签。

## 12. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 图像分类：[`../104-timm-classification-mcp/spec.md`](../104-timm-classification-mcp/spec.md)
- 预览头部逻辑标签管理：[`../117-preview-header-tag-management/spec.md`](../117-preview-header-tag-management/spec.md)
