# 005 Local Data Contracts 本地数据契约

## 1. 目的 (Purpose)

定义 Fauplay 的本地数据统一契约，确保：

1. 本地数据单一真源固定为 SQLite。
2. 数据读写（DDL/DML）统一由 Gateway 承担，禁止插件直写。
3. 文件身份（`fileId`）与标签系统跨能力域一致。
4. 人脸、标注、分类能力在同一数据层下可查询、可组合、可演进。

## 2. 关键术语 (Terminology)

- 单一真源（Single Source of Truth）
- 数据网关层（Gateway Data Layer）
- 文件标识（`fileId`）
- 标签记录（Tag Record）
- 文件标签关联（File-Tag Binding）
- 计算插件（Compute Plugin）
- 声明式变更（Declarative Mutation）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 统一本地数据文件：`.fauplay/faudb.v1.sqlite`。
2. 统一 DDL、迁移、事务、索引、并发控制归属到 Gateway。
3. 定义统一文件与标签模型（含多来源标签）。
4. 定义 Gateway 原生 HTTP 读写接口契约。
5. 定义插件“只计算不直写”约束。

范围外：

1. 旧数据导入与兼容迁移。
2. 跨 root 数据合并。
3. 向量检索算法优化细节。

## 4. 架构契约 (Gateway as Single Data Layer)

1. Gateway 是唯一可访问 SQLite 的组件；前端与外部 MCP 插件不得直接读写数据库文件。
2. 插件仅负责计算与推断，不得包含 SQL DDL/DML。
3. 所有持久化操作必须由 Gateway 数据层统一执行。
4. Gateway 必须以事务方式应用一次写请求的全部数据变更，保证原子性。
5. Gateway 必须统一维护审计字段（`createdAt`、`updatedAt`、`source`）。

## 5. 数据与存储契约 (SQLite Contract)

### 5.1 文件路径与隔离

1. 数据库文件固定为：`<rootHandle>/.fauplay/faudb.v1.sqlite`。
2. 一个 root 对应一个库文件，禁止跨 root 共享库。
3. `schemaVersion=1`（`PRAGMA user_version=1`）。

### 5.2 统一主键与关系

1. `file.id` 为全局唯一 `UUID`，作为统一 `fileId`。
2. 所有业务数据（标签、人脸、分类结果映射）必须通过 `fileId` 关联文件。
3. `.annotations.v1.json`、`faces.v1.sqlite` 不再作为运行时数据源。

### 5.3 最小逻辑模型（表级约束）

1. `file`：`id`、`relativePath`、`fileSizeBytes`、`fileMtimeMs`、`bindingFp`、`createdAt`、`updatedAt`。
2. `tag`：`id`、`key`、`value`、`source`、`sourceRefId`、`confidence`、`status`、`createdAt`、`updatedAt`。
3. `file_tag`：`fileId`、`tagId`、`appliedAt`。
4. `annotation_record`：`id`、`fileId`、`fieldKey`、`value`、`status`、`orphanReason`、`updatedAt`。
5. `face`、`face_embedding`、`person`、`person_face`、`face_job_state` 保留并对齐统一 `fileId` 关系。

## 6. Gateway HTTP 接口契约 (Public HTTP APIs)

### 6.1 标签查询

1. `POST /v1/data/tags/file`
2. `POST /v1/data/tags/options`
3. `POST /v1/data/tags/query`

### 6.2 标注写入与维护

1. `POST /v1/annotations/set-value`
2. `POST /v1/annotations/refresh-bindings`
3. `POST /v1/annotations/cleanup-orphans`

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
2. `meta.annotation` 插件不再承担数据持久化职责。
3. `timm-classifier` 仅返回分类结果，落库由 Gateway 执行。

## 8. 兼容与迁移策略 (Compatibility)

1. 不兼容旧数据：不读取、不导入旧 `faces.v1.sqlite` 与旧 `.annotations.v1.json`。
2. 新版本仅认 `faudb.v1.sqlite`。
3. 旧文件存在时可记录告警日志，但不得阻断新库流程。

## 9. 功能需求 (FR)

1. `FR-LDC-01` 系统必须以 `faudb.v1.sqlite` 作为唯一运行时数据源。
2. `FR-LDC-02` Gateway 必须成为唯一 DDL/DML 执行者。
3. `FR-LDC-03` 插件不得直接访问 SQLite。
4. `FR-LDC-04` 所有可持久化数据必须统一关联 `fileId`。
5. `FR-LDC-05` 系统必须提供标签查询 HTTP 接口用于预览展示与过滤。
6. `FR-LDC-06` 单次写请求必须事务化，失败可回滚。
7. `FR-LDC-07` 标签来源必须可追踪（`source`、`sourceRefId`）。
8. `FR-LDC-08` 系统不得再读写 `.annotations.v1.json` 作为业务真源。

## 10. 验收标准 (AC)

1. `AC-LDC-01` 新 root 首次调用后自动创建 `.fauplay/faudb.v1.sqlite` 并可查询。
2. `AC-LDC-02` 标注写入后，标签查询接口可立即读到结果。
3. `AC-LDC-03` 人脸检测与聚类后，人物列表与文件标签查询结果一致。
4. `AC-LDC-04` 分类推理后，标签查询可用于过滤。
5. `AC-LDC-05` 插件进程异常时事务回滚，数据库无半写入状态。
6. `AC-LDC-06` 旧 sidecar/旧库存在时系统不读取且不崩溃。

## 11. 公共接口与类型影响 (Public Interfaces & Types)

1. 新增 HTTP DTO：`TagRecord`、`FileTagView`、`TagOption`。
2. 统一主键语义：业务关系主键统一 `fileId`。
3. 标注记录主键字段统一为 `id`（不再使用 `annotationId`）。

## 12. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 标注插件：[`../114-metadata-annotation/spec.md`](../114-metadata-annotation/spec.md)
- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 图像分类：[`../104-timm-classification-mcp/spec.md`](../104-timm-classification-mcp/spec.md)
