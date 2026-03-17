# 115 Facial Recognition 人脸识别规范

## 1. 目的 (Purpose)

定义 Fauplay 人脸识别（Facial Recognition）MVP 规范，统一以下契约：

1. Gateway/MCP 内嵌 Immich 兼容推理器 + 本地聚类分配的端到端流程。
2. 人脸检测结果、人物聚类与人物管理（命名/合并）的用户可见行为。
3. root 级 SQLite 持久化模型与迁移约束。
4. `vision.face` MCP 工具契约与结果类型约束。

## 2. 关键术语 (Terminology)

- 人脸检测（Face Detection）
- 人脸向量（Face Embedding）
- 人物聚类（Person Clustering）
- 核心点（Core Point）
- 延迟分配（Deferred Assignment）
- 夜间补聚类（Nightly Re-cluster）
- 人脸记录（Face Record）
- 人物记录（Person Record）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 单资产检测并生成人脸框、置信度、embedding。
2. 增量聚类分配（DBSCAN 派生语义）：新脸持续并入已有人物簇。
3. 预览区展示人脸框与归属人物。
4. 人物列表展示、人物命名、人物合并。
5. root 级 SQLite 持久化（`.fauplay/faces.v1.sqlite`）。
6. `vision.face` 工具的 `file/workspace` 双作用域契约。

范围外：

1. 手工框选/编辑人脸框。
2. 浏览器本地模型推理。
3. 向量 ANN/近似检索优化（v1 使用直接距离检索）。
4. 跨 root 的人物合并或跨库聚类。

## 4. 用户可见行为契约 (User-visible Contract)

1. 对单个资产触发检测后，预览区可见人脸框与检测置信度。
2. 进入图片预览时，若当前资产尚无人脸记录，系统应自动触发一次 `detectAsset`，并在可用时补跑 `clusterPending`。
3. 若首次触发预览人脸能力时 root 上下文（`rootHandle/rootId`）未就绪，系统应提示完成目录上下文绑定；绑定成功后继续本次检测/展示流程。
4. 对未分配人脸触发聚类后，系统自动分配到已有人物或创建新人物。
5. 当人脸不满足核心点条件时，本轮不创建人物，进入 deferred 状态等待后续补处理。
6. 夜间任务开启时，系统应自动对 deferred 人脸执行补聚类。
7. 人物列表展示每个人物的名称、人脸数量、代表脸（feature face）。
8. 人物命名后，人物列表和预览归属信息应立即一致更新。
9. 合并人物后，被合并人物从列表移除，原关联人脸全部归入目标人物。
10. 网关/ML 不可用时，应展示可读失败原因并允许重试，不得破坏已有人物数据。
11. 系统必须提供“人物列表”主入口于工作区工具栏（B1 区域）。
12. 预览区点击人脸框或人物标签时，系统必须支持跳转到该人物详情（关联图片列表）。

## 5. 架构链路契约 (Architecture Flow Contract)

标准链路：

`Frontend -> Gateway/MCP (Immich-compatible inference) -> Gateway clustering -> SQLite -> UI`

约束：

1. Gateway/MCP 内嵌推理器仅负责推理（检测框 + embedding），不承担持久化。
2. 聚类与人物归属决策在 Gateway 侧执行，作为本地权威结果写入 SQLite。
3. 前端只消费工具结果与本地持久化快照，不直接实现聚类算法。
4. 同一 root 必须使用独立数据库文件，根目录切换后不得复用上一个 root 的人物数据。
5. v1 固定采用 Gateway/MCP 内嵌 Immich 兼容推理器（`buffalo_l` 检测 + embedding），不再依赖外部 ML 服务。

## 6. 聚类算法契约 (Incremental Clustering Contract)

采用 Immich 风格的增量聚类（DBSCAN 派生）：

1. 相似判定：
   - 余弦距离 `distance <= maxDistance` 视为匹配。
2. 核心点判定：
   - 对当前人脸查询近邻，匹配数 `>= minFaces` 视为核心点。
3. 分配顺序：
   - 优先分配给“最相近且已有 personId 的匹配脸”。
   - 若无已归属匹配，且当前为核心点，则创建新人物并绑定。
   - 若非核心点，则标记 deferred，等待后续 `clusterPending` 或夜间任务。
4. 夜间补聚类：
   - 当 `clusterNewFacesNightly=true` 时，每日对 deferred 人脸重新执行上述流程。
5. 强制重跑（后续增量能力）：
   - 允许后续专题增加“全量重聚类”；本 v1 仅要求增量语义正确。

## 7. 数据与存储契约 (SQLite Contract)

### 7.1 库路径与隔离

1. 数据库路径固定为：`<rootHandle>/.fauplay/faces.v1.sqlite`（相对当前工作根目录）。
2. 一个 root 对应一个库文件，禁止跨 root 共用人物与人脸记录。
3. 若 `.fauplay` 不存在，初始化时应自动创建。
4. 前端/UI 层禁止拼接绝对数据库路径，只允许按当前 `rootHandle` 语义使用相对路径契约。

### 7.2 Schema 版本与迁移

1. `schemaVersion=1`（通过 `PRAGMA user_version=1` 或等价元信息持久化）。
2. v1 只接受前向迁移：`n -> n+1`，禁止回退迁移覆盖。
3. 迁移失败时必须保持库可恢复（事务回滚），并返回可读错误码。

### 7.3 固定表契约

必须存在以下固定表名：

1. `face`
2. `face_embedding`
3. `person`
4. `person_face`
5. `face_job_state`

最小字段要求：

| Table | Required Fields |
| --- | --- |
| `face` | `id (text pk)`, `assetPath (text)`, `x1/y1/x2/y2 (real)`, `score (real)`, `status (text: unassigned/assigned/deferred)`, `createdAt`, `updatedAt` |
| `face_embedding` | `faceId (text pk, fk->face.id)`, `dim (int, default 512)`, `embedding (blob, float32)` |
| `person` | `id (text pk)`, `name (text)`, `featureFaceId (text, nullable)`, `faceCount (int cache)`, `createdAt`, `updatedAt` |
| `person_face` | `personId (text fk->person.id)`, `faceId (text unique fk->face.id)`, `assignedBy (text: auto/manual/merge)`, `assignedAt` |
| `face_job_state` | `faceId (text pk fk->face.id)`, `detectStatus`, `clusterStatus`, `deferred (int bool)`, `attempts (int)`, `lastErrorCode (text, nullable)`, `lastRunAt`, `nextRunAt` |

索引最小要求：

1. `face(assetPath)`
2. `face(status)`
3. `person_face(personId)`
4. `face_job_state(clusterStatus, deferred)`

## 8. 工具契约 (Tool Contract)

工具名：`vision.face`  
作用域：`annotations.scopes = ["file", "workspace"]`

### 8.1 operation 固定枚举

1. `detectAsset`
2. `clusterPending`
3. `listPeople`
4. `renamePerson`
5. `mergePeople`
6. `listAssetFaces`

### 8.2 输入输出最小契约

公共输入：

- `rootPath: string`（必填）
- `operation: string`（必填，取值见 8.1）

说明：

- 前端调用层使用 `rootHandle/rootId` 作为目录上下文；
- Gateway dispatch 层负责将该上下文解析/注入为 MCP 所需的 `rootPath`。

分支最小输入：

1. `detectAsset`
   - `relativePath: string`（必填）
2. `clusterPending`
   - `nightly?: boolean`（可选，默认 `false`）
   - `limit?: number`（可选）
3. `listPeople`
   - `page?: number`、`size?: number`（可选）
4. `renamePerson`
   - `personId: string`、`name: string`（必填）
5. `mergePeople`
   - `targetPersonId: string`、`sourcePersonIds: string[]`（必填）
6. `listAssetFaces`
   - `relativePath: string`（必填）

结果类型（最小字段）：

1. `FaceDetectionResult`
   - `{ ok, assetPath, detected, created, updated, skipped, faces: FaceRecord[] }`
2. `PersonSummary`
   - `{ personId, name, faceCount, featureFaceId }`
3. `ClusterRunSummary`
   - `{ ok, processed, assigned, createdPersons, deferred, skipped, failed }`
4. `FaceRecord`
   - `{ faceId, assetPath, boundingBox: {x1,y1,x2,y2}, score, personId|null, status }`

### 8.3 错误码命名约束

统一前缀：`FACE_`，最小集合：

1. `FACE_ML_UNAVAILABLE`
2. `FACE_ML_TIMEOUT`
3. `FACE_EMBEDDING_MISSING`
4. `FACE_CLUSTER_CONFLICT`
5. `FACE_DB_LOCKED`
6. `FACE_DB_MIGRATION_FAILED`
7. `FACE_JOB_INTERRUPTED`

## 9. 配置契约 (Config Contract)

v1 固定配置项与默认值：

1. `modelName = "buffalo_l"`
2. `minScore = 0.7`
3. `maxDistance = 0.5`
4. `minFaces = 3`
5. `clusterNewFacesNightly = true`

v1 运行时配置（不影响工具契约）：

1. `modelRepo = "immich-app/buffalo_l"`（用于本地模型下载）
2. `modelCacheDir`（本地模型缓存目录，默认由实现决定）
3. `allowModelDownload = false`（默认仅使用本地模型文件，不在运行时触网下载）

约束：

1. `minScore` 仅影响检测过滤，不回写历史检测结果。
2. `maxDistance/minFaces` 影响新一轮聚类决策，可用于 deferred 重处理。
3. 配置变更不得破坏已持久化人物关系；重算策略由显式任务触发。

## 10. 失败与降级行为 (Failure & Degradation)

1. ML 不可用/超时：
   - 当前任务失败并可重试；
   - 已存在 `face/person` 数据不得被清空。
2. embedding 缺失：
   - 标记 `clusterStatus=failed` 与 `FACE_EMBEDDING_MISSING`；
   - 保留检测框记录，允许后续补算。
3. 聚类冲突（并发分配）：
   - 以事务重试或失败回滚保证一致性，不得出现一脸多人归属。
4. DB 锁冲突：
   - 返回 `FACE_DB_LOCKED`，任务入重试队列（指数退避由实现决定）。
5. 任务中断恢复：
   - 通过 `face_job_state` 恢复 unfinished/deferred 项，避免全量重跑。

## 11. 功能需求 (FR)

1. `FR-FACE-01` 系统必须支持单资产人脸检测并写入人脸框、置信度与 embedding。
2. `FR-FACE-02` 系统必须支持增量聚类分配并维护人物归属。
3. `FR-FACE-03` 系统必须实现核心点判定（`minFaces`）与 deferred 语义。
4. `FR-FACE-04` 系统必须支持夜间 deferred 补聚类。
5. `FR-FACE-05` 系统必须提供人物列表、人物命名与人物合并能力。
6. `FR-FACE-06` 系统必须将数据持久化到 root 级 SQLite（`.fauplay/faces.v1.sqlite`）。
7. `FR-FACE-07` 系统必须提供 `vision.face` 固定 operation 契约。
8. `FR-FACE-08` 系统必须提供统一 `FACE_*` 错误码并保持失败可重试。
9. `FR-FACE-09` v1 不得引入本地模型推理与手工框选编辑。
10. `FR-FACE-10` 系统必须在工作区工具栏提供“人物列表”主入口，并可进入人物列表视图。
11. `FR-FACE-11` 系统必须支持从预览人脸框/人物标签跳转到对应人物详情（关联图片列表）。
12. `FR-FACE-12` 系统必须在图片预览首次触发时处理 root 上下文缺失场景（提示绑定并在成功后继续检测与展示）。

## 12. 验收标准 (AC)

1. `AC-FACE-01` 对单资产执行 `detectAsset` 后，预览可见人脸框与对应置信度。
2. `AC-FACE-02` 同一人物跨多个资产可在 `clusterPending` 后聚类到同一 `personId`。
3. `AC-FACE-03` 非核心点在首次聚类不建人物，后续 deferred/夜间补聚类可被分配。
4. `AC-FACE-04` 执行 `renamePerson` 后，人物列表与预览归属名称立即一致。
5. `AC-FACE-05` 执行 `mergePeople` 后，源人物移除且人脸归属完整迁移到目标人物。
6. `AC-FACE-06` 重启后再次进入同 root，可恢复既有人物与人脸归属数据。
7. `AC-FACE-07` ML 不可用或超时时，任务失败可见且已有聚类数据保持不变。
8. `AC-FACE-08` 数据库被锁时返回 `FACE_DB_LOCKED` 且任务可重试，不发生脏写。
9. `AC-FACE-09` 用户点击工作区工具栏“人物”入口后，可打开人物列表并看到人物卡片集合。
10. `AC-FACE-10` 用户在预览区点击某个人脸框或人物标签后，可跳转到该人物详情并看到其关联图片列表。
11. `AC-FACE-11` 在未预先完成 root 上下文绑定的新 root 下，首次进入图片预览时会提示绑定；绑定成功后同一流程可展示检测到的人脸框。

## 13. 公共接口与类型影响 (Public Interfaces & Types)

说明：本节只定义规范层公共契约，不要求本专题内立即落代码实现。

1. 新增工具契约：`vision.face`（`file/workspace` 双作用域）。
2. 新增 operation 枚举：`detectAsset|clusterPending|listPeople|renamePerson|mergePeople|listAssetFaces`。
3. 新增结果类型：`FaceDetectionResult`、`PersonSummary`、`ClusterRunSummary`、`FaceRecord`。
4. 新增本地持久化契约：`schemaVersion=1` 与 root 级 SQLite 隔离语义。

## 14. 默认值与一致性约束 (Defaults & Consistency)

1. v1 存储方案固定为 SQLite，不做 JSON 双写。
2. embedding 存储格式固定为 `float32 blob`。
3. 人物聚类语义固定为增量模式，不要求 v1 全量重聚类能力。
4. 本专题不新增快捷键；`src/config/shortcuts.ts` 与 `docs/shortcuts.md` 保持不变。
5. 若采用内嵌推理器实现，模型加载流程需保持 Immich 兼容（`detection/model.onnx` + `recognition/model.onnx`）。

## 15. 关联主题 (Related Specs)

- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 插件运行时：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 标注插件（数据侧参考）：[`../114-metadata-annotation/spec.md`](../114-metadata-annotation/spec.md)
