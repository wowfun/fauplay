# 114 Local Data Plugin 本地数据管理插件规范

## 1. 目的 (Purpose)

定义 `local.data` 插件在 Gateway 统一数据层下的契约：

1. 标注写入通过统一本地数据接口完成，标签来源保持 `source=meta.annotation`。
2. `file` 表支持批量路径重绑与自动重绑，`fileId` 保持稳定。
3. 提供失效 `fileId` 的 dry-run/commit 清理能力，并保证关联数据一致性收敛。
4. 人脸、分类、标注继续共享同一 `file + tag + file_tag` 数据模型。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `setAnnotationValue`：同文件同字段覆盖写入。
2. `batchRebindPaths`：按路径映射批量更新 `file.relativePath`（支持链式映射）。
3. `reconcileFileBindings`：针对 `file` 表执行路径校验、候选搜索与自动重绑。
4. `cleanupInvalidFileIds`：失效 `fileId` 预演与提交清理。
5. 预览态 `0..9` 快捷打标链路与工作台标注面板。

范围外：

1. sidecar JSON 运行时读写与兼容。
2. `findExactDuplicates/findSimilarImages` 等历史分析操作。
3. 失效状态持久化表（请求级返回，不新增状态表）。

## 3. 工具契约 (MCP Tool Contract)

1. 工具名固定为：`local.data`。
2. `operation` 枚举固定为：`setAnnotationValue | batchRebindPaths | reconcileFileBindings | cleanupInvalidFileIds`。
3. `local.data` 仅承载工作台元数据与操作入口；持久化由 Gateway HTTP 接口执行。

## 4. Gateway HTTP 接口契约 (HTTP Contract)

1. `PUT /v1/file-annotations`
   - 输入：`rootPath, relativePath, fieldKey, value, source?`
   - 语义：按 `fileId + fieldKey + source=meta.annotation` 覆盖绑定（先删旧绑定再写新绑定）
   - 输出：`{ ok, fileId, relativePath, fieldKey, value }`
2. `PATCH /v1/files/relative-paths`
   - 输入：`rootPath, mappings[]`
   - `mappings[]` 项结构：`{ fromRelativePath, toRelativePath }`
   - 语义：按映射批量重绑 `file.relativePath`，两阶段更新避免唯一键冲突，逐项返回结果
   - 输出：`{ ok, total, updated, failed, items[] }`
3. `POST /v1/file-bindings/reconciliations`
   - 输入：`rootPath`
   - 语义：对 `file` 表逐条执行路径校验与自动重绑；唯一命中时只更新当前行路径与快照，不更换 `fileId`
   - 输出：`{ ok, total, active, rebound, conflict, orphan, searchUnavailable, items[] }`
4. `POST /v1/file-bindings/cleanups`
   - 输入：`rootPath, confirm?`
   - 语义：按“刷新后无法唯一重绑”的结果集执行清理；`confirm=false` 仅预演，`confirm=true` 提交删除
   - 输出：`{ ok, dryRun, invalidFileIds[], impact, removed? }`
5. 旧路径下线并返回 404：
   - `/v1/local-data/set-value`
   - `/v1/local-data/refresh-file-bindings`
   - `/v1/local-data/cleanup-invalid-fileids`
   - `/v1/annotations/*`

## 5. 数据与行为契约 (Data & Behavior Contract)

### 5.1 标注写入

1. 标注标签来源固定为 `source=meta.annotation`。
2. 字段映射固定为 `key=fieldKey`、`value=fieldValue`。
3. 同文件同字段重复写入，仅保留一个当前绑定。

### 5.2 批量路径重绑（`batchRebindPaths`）

1. 每项路径映射独立校验并返回逐项状态，允许部分成功。
2. 至少覆盖以下失败原因码：
   - `SOURCE_NOT_FOUND`
   - `TARGET_OCCUPIED`
   - `INVALID_SOURCE_PATH`
   - `INVALID_TARGET_PATH`
3. 成功项仅更新 `relativePath` 与 `updatedAt`。
4. 实现必须采用两阶段更新（临时路径 -> 目标路径），避免唯一索引冲突与链式重命名失败。

### 5.3 file 表自动重绑（`reconcileFileBindings`）

1. 对每条 `file` 记录按 `relativePath` 执行 `stat`。
2. 若 `size/mtime` 与 `fileSizeBytes/fileMtimeMs` 一致，则记为 `active`（不重绑）。
3. 路径缺失或快照不一致时，使用 Everything Search 在当前 `rootPath` 内检索同 `size+mtime` 候选。
4. 对候选逐个计算 `bindingFp` 并与原记录 `bindingFp` 比对：
   - 唯一命中：更新 `relativePath/fileSizeBytes/fileMtimeMs/bindingFp/updatedAt`，`fileId` 不变。
   - 多命中：记 `conflict`，原因 `ambiguous_rebind`。
   - 无命中：记 `orphan`，原因 `no_candidate`。
5. ES 配置缺失或查询失败：记 `orphan`，原因 `search_unavailable`，且不中断整次刷新。

### 5.4 失效 fileId 清理（`cleanupInvalidFileIds`）

1. 失效判定基于“刷新后无法唯一重绑”的条目（`conflict/orphan`）。
2. `confirm=false`：返回失效 `fileId` 清单与影响预估（`file_tag/face/face_embedding/person_face/person/tag`）。
3. `confirm=true`：删除失效 `file` 行，依赖 FK 级联清理关联记录。
4. 提交后必须执行一致性收敛：
   - 删除空 `person`
   - 清理无绑定 `tag`
   - 刷新人脸人物缓存与 `vision.face` 标签投影

## 6. 功能需求 (FR)

1. `FR-LD-01` 系统必须暴露 `local.data` 工具，且操作枚举仅包含 `setAnnotationValue/batchRebindPaths/reconcileFileBindings/cleanupInvalidFileIds`。
2. `FR-LD-02` 标注写入必须投影到统一标签模型，且来源固定为 `meta.annotation`。
3. `FR-LD-03` `batchRebindPaths` 成功项必须保持 `fileId` 不变。
4. `FR-LD-04` `reconcileFileBindings` 在 ES 不可用时不得整次失败。
5. `FR-LD-05` `cleanupInvalidFileIds` 必须支持 dry-run 与 commit 双阶段。
6. `FR-LD-06` 提交清理后必须完成人物与标签一致性收敛。
7. `FR-LD-07` 旧 `/v1/local-data/*` 与 `/v1/annotations/*` 接口不得继续提供写入或维护能力。

## 7. 验收标准 (AC)

1. `AC-LD-01` 新 root 下 `setAnnotationValue` 可写入 `tag+file_tag`，`source` 为 `meta.annotation`。
2. `AC-LD-02` 同文件同字段重复写入后，仅保留一个当前绑定。
3. `AC-LD-03` 链式映射 `A->B, B->C` 经 `batchRebindPaths` 成功执行且 `fileId` 不变。
4. `AC-LD-04` `reconcileFileBindings` 在 ES 不可用时请求成功返回，结果中包含 `search_unavailable` 统计与条目。
5. `AC-LD-05` 清理 dry-run 与 commit 的目标数量一致，commit 后级联数据被清理。
6. `AC-LD-06` 清理后人脸聚类、人物列表、重命名、合并流程仍可用且标签投影一致。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. 时间戳统一使用毫秒（ms）。
2. 所有写请求必须事务化（全成或全败）。
3. 不新增 file 绑定状态持久化表，状态只在请求结果中返回。

## 9. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 批量重命名：[`../106-batch-rename-workspace/spec.md`](../106-batch-rename-workspace/spec.md)
- 预览改名：[`../113-preview-inline-rename/spec.md`](../113-preview-inline-rename/spec.md)
- 命名分层专题：[`../116-rename-driven-rebind/spec.md`](../116-rename-driven-rebind/spec.md)
- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
