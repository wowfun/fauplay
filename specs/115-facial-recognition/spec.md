# 115 Facial Recognition 人脸识别规范

## 1. 目的 (Purpose)

定义 Fauplay 人脸识别能力在 Gateway 统一数据层下的契约：

1. 检测与 embedding 推理由插件提供。
2. 聚类、人物归属、人物管理、持久化由 Gateway 执行。
3. 人脸与人物数据统一持久化在 `faudb.v1.sqlite`。
4. 文件关联主键统一为 `fileId`。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 单资产检测并产出检测框与 embedding。
2. Gateway 侧增量聚类、人物命名、人物合并。
3. 预览人脸框展示与人物详情查询（含显示/隐藏切换）。
4. 统一标签系统的人物标签写入（`source=vision.face`）。

范围外：

1. 手工框选编辑。
2. 跨 root 聚类合并。
3. 全量重聚类优化。

## 3. 架构契约 (Architecture Contract)

1. `vision-face` 插件仅负责推理，不得执行 SQLite DDL/DML。
2. Gateway 为人脸与人物数据唯一写入者。
3. 前端人脸流程统一调用 Gateway HTTP 接口。

## 4. 数据与存储契约 (SQLite Contract)

### 4.1 路径与隔离

1. 数据库路径固定为：`<rootHandle>/.fauplay/faudb.v1.sqlite`。
2. 一个 root 一个库，禁止跨 root 共用。

### 4.2 最小表契约

必须存在：

1. `file`
2. `face`
3. `face_embedding`
4. `person`
5. `person_face`
6. `tag`
7. `file_tag`

约束：

1. `face.fileId` 必须关联 `file.id`。
2. `person_face.faceId` 唯一，保证一脸一人物。
3. 向量格式保持 `float32 blob`。
4. 不再持久化 `face_job_state`。

### 4.3 标签投影契约（`vision.face`）

1. 文件级人物标签必须由 `person_face` 关系投影生成。
2. 标签格式固定为：`source=vision.face`、`key='person'`、`value=person.name`。
3. 同名人物允许存在；文件级标签在名字维度合并，不保证人物级可区分过滤。
4. `rename-person` 与 `merge-people` 后，相关文件的 `vision.face` 标签必须同步更新。

## 5. Gateway HTTP 接口契约 (HTTP Contract)

1. `POST /v1/faces/detect-asset`
2. `POST /v1/faces/cluster-pending`
3. `POST /v1/faces/list-people`
4. `POST /v1/faces/rename-person`
5. `POST /v1/faces/merge-people`
6. `POST /v1/faces/list-asset-faces`

输入参数沿用现有 `relativePath/personId/targetPersonId/sourcePersonIds/page/size/limit` 语义。

## 6. 聚类契约 (Incremental Clustering)

1. 相似判定：余弦距离 `<= maxDistance`。
2. 核心点判定：匹配数 `>= minFaces`。
3. 分配顺序：优先已有人物 -> 否则新建人物 -> 否则 deferred。
4. 聚类与归属变更必须事务提交。

## 7. 功能需求 (FR)

1. `FR-FACE-01` 人脸数据必须持久化到 `faudb.v1.sqlite`。
2. `FR-FACE-02` 插件不得直写人脸/人物表。
3. `FR-FACE-03` 所有人脸记录必须统一关联 `fileId`。
4. `FR-FACE-04` 系统必须提供上述 Gateway HTTP 人脸接口。
5. `FR-FACE-05` 人物命名/合并后，列表与预览展示必须一致。
6. `FR-FACE-06` 人物归属应同步写入统一标签模型（`source=vision.face`）。
7. `FR-FACE-07` 系统不得依赖 `face_job_state` 作为流程状态真源。
8. `FR-FACE-08` 预览区必须提供“人脸框显示/隐藏”显式开关，且开关状态需持久化到 `localStorage`（键：`fauplay:preview-face-bbox-visible`）。
9. `FR-FACE-09` 人脸框开关默认值必须为“隐藏”，并在侧栏预览与全屏预览间保持一致。
10. `FR-FACE-10` 人脸框显示状态仅影响前端覆盖层渲染，不得作为后台检测/识别（`detect-asset/list-asset-faces/cluster-pending/list-people`）的门控条件。
11. `FR-FACE-11` 预览文件的人脸检测/识别完成后，当前预览头部标签必须在同一预览会话内即时同步，无需切换文件。

## 8. 验收标准 (AC)

1. `AC-FACE-01` `detect-asset` 后可查询到人脸框数据。
2. `AC-FACE-02` `cluster-pending` 后同人物跨资产可归并。
3. `AC-FACE-03` `rename-person` 与 `merge-people` 后查询结果立即一致。
4. `AC-FACE-04` 重启后同 root 可恢复人脸与人物数据。
5. `AC-FACE-05` 人脸流程后，文件级 `vision.face` 标签与 `person_face` 关系一致。
6. `AC-FACE-06` 旧 `faces.v1.sqlite` 存在时新流程不读取且不崩溃。
7. `AC-FACE-07` 首次进入预览（无持久化值）时不显示人脸框；用户显式开启后刷新页面仍保持开启。
8. `AC-FACE-08` 侧栏预览与全屏预览切换时，人脸框开关状态一致且实时生效。
9. `AC-FACE-09` 在图片预览中关闭人脸框后，后台仍可继续执行检测/识别流程并更新人物归属；再次开启时可直接展示最新识别结果。
10. `AC-FACE-10` 自动 `detect-asset/cluster-pending` 或预览内手动 `vision.face` 成功后，当前文件预览标签在一次异步刷新内可见，不依赖切换文件触发。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. v1 运行时配置：`modelName/minScore/maxDistance/minFaces` 保持既有语义。
2. 写请求事务化，失败可回滚。
3. 错误码前缀保持 `FACE_`。
4. `localStorage` 不可用时允许降级为仅会话内状态，且默认仍为隐藏。
5. “即时同步”语义为同一预览会话内完成一次文件级标签快照刷新即可，不要求阻塞 UI。

## 10. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
