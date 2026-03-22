# 005 Local Data Contracts 本地数据契约

## 1. 目的 (Purpose)

定义 Fauplay 的本地数据统一契约，确保：

1. 本地数据单一真源固定为全局 SQLite。
2. 数据读写（DDL/DML）统一由 Gateway 承担，禁止插件直写。
3. 内容身份（`assetId`）与路径索引（`file.absolutePath`）在标签、人脸、分类等能力域下职责清晰。
4. 人脸、标注、分类能力在同一数据层下可查询、可组合、可演进。

## 2. 关键术语 (Terminology)

- 单一真源（Single Source of Truth）
- 数据网关层（Gateway Data Layer）
- 资产标识（`assetId`）
- 文件路径索引（File Path Index）
- 资产标签关联（Asset-Tag Binding）
- 计算插件（Compute Plugin）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 统一本地数据文件：`${HOME}/.fauplay/faudb.global.sqlite`。
2. 统一 DDL、迁移、事务、索引、并发控制归属到 Gateway。
3. 定义统一 `asset + file + tag + asset_tag` 数据模型（含多来源标签）。
4. 定义 Gateway 原生 HTTP 读写接口契约。
5. 定义插件“只计算不直写”约束。

范围外：

1. 旧 per-root 数据导入与兼容迁移。
2. `sha256` 生成流程与人工校验工作流。
3. 全局管理/校验 UI 设计细节。

## 4. 架构契约 (Gateway as Single Data Layer)

1. Gateway 是唯一可访问 SQLite 的组件；前端与外部 MCP 插件不得直接读写数据库文件。
2. 插件仅负责计算与推断，不得包含 SQL DDL/DML。
3. 所有持久化操作必须由 Gateway 数据层统一执行。
4. Gateway 必须以事务方式应用一次写请求的全部数据变更，保证原子性。

## 5. 数据与存储契约 (SQLite Contract)

### 5.1 文件路径与隔离

1. 数据库文件固定为：`${HOME}/.fauplay/faudb.global.sqlite`。
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

### 5.6 参考文档

1. 详细 DDL 与行为映射见：[`./tag-core-v2-reference.md`](./tag-core-v2-reference.md)。

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

### 6.2 本地数据管理

1. `PUT /v1/file-annotations`
2. `PATCH /v1/files/relative-paths`
3. `POST /v1/files/missing/cleanups`
5. 以上接口对外继续接收 `rootPath + relativePath`，但持久化层只落 `absolutePath`。
6. 历史维护接口全部下线（返回下线错误或 404）。

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
2. 当检测到旧全局 schema 时，直接重建数据库（不备份）。
3. 新版本仅认 `schemaVersion=3`。

## 9. 功能需求 (FR)

1. `FR-LDC-01` 系统必须以 `faudb.global.sqlite` 作为唯一运行时数据源。
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

## 10. 验收标准 (AC)

1. `AC-LDC-01` 首次调用后自动创建 `${HOME}/.fauplay/faudb.global.sqlite` 并可查询。
2. `AC-LDC-02` 同一物理文件从重叠 root 打开两次时，只生成一条 `file(absolutePath)` 记录。
3. `AC-LDC-03` 同内容文件在不同路径下命中同一 `asset` 后，任一路径写入标签，其余路径可立即看到相同标签。
4. `AC-LDC-04` 分类推理后，`asset_tag.score` 可查询，非分类标签 `score` 为 `NULL`。
5. `AC-LDC-05` 人脸检测与聚类后，人物列表、资产标签与 file-centered 查询结果一致。
6. `AC-LDC-06` 旧 sidecar、旧人脸库与旧 per-root 库存在时，系统不读取且不崩溃。
7. `AC-LDC-07` `files/relative-paths` 支持链式映射（如 `A->B, B->C`），并能正确更新目标路径索引。
8. `AC-LDC-08` 外部重命名后若新路径先被建档，标签与人脸仍通过共享 `assetId` 正常复用；执行缺失路径清理后旧路径索引被删除。
9. `AC-LDC-09` 当文件仅存在非 `meta.annotation` 来源标签时，`/v1/data/tags/file` 与 `/v1/data/tags/query` 仍可返回该标签供顶部过滤与预览显示使用。
10. `AC-LDC-10` 当某个 `asset` 的最后一个 `file` 消失时，普通查询不再返回该资产；同内容文件再次出现时会自动复活原 `asset`。

## 11. 公共接口与类型影响 (Public Interfaces & Types)

1. `TagRecord` 时间字段语义收敛到 `asset_tag.appliedAt`。
2. `TagRecord.score` 作为通用可空字段新增，当前仅分类来源使用。
3. file-centered 查询结果统一返回 `assetId + absolutePath`；`relativePath` 仅在请求携带 `rootPath` 时返回。
4. 标注与文件维护接口保持 `/v1/file-annotations`、`/v1/files/relative-paths`、`/v1/files/missing/cleanups` 路径，但内部真源切换到 `absolutePath -> file -> asset`。

## 12. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 图像分类：[`../104-timm-classification-mcp/spec.md`](../104-timm-classification-mcp/spec.md)
