# 114 Metadata Annotation 标注能力规范

## 1. 目的 (Purpose)

定义 Fauplay 标注能力在 Gateway 统一数据层下的契约：

1. 标注写入、刷新、清理由 Gateway HTTP 接口承载。
2. 标注数据统一持久化到 `.fauplay/faudb.v1.sqlite`。
3. 标注记录主键统一为 `id`，文件关联统一为 `fileId`。
4. 标注结果与其他来源标签（人脸、分类）共享同一标签模型。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 标注写入（`setValue`）
2. 标注重绑刷新（`refreshBindings`）
3. orphan 清理（`cleanupOrphans`）
4. 预览头标签展示与工作区标签过滤的查询契约

范围外：

1. sidecar JSON 兼容
2. 旧 `.annotations.v1.json` 迁移导入
3. 非文本标签编辑器 UI 细节

## 3. 用户可见行为契约 (User-visible Contract)

1. 预览态快捷打标（`0..9`）保持可用。
2. 写入后预览头标签与过滤选项应通过网关查询立即可见。
3. 执行刷新后，`active/orphan/conflict` 状态可被后续查询消费。
4. 执行清理 orphan 时，仅删除 `orphan` 记录，不删除 `conflict`。
5. 预览切换到某文件时，系统必须异步读取该文件标签并即时刷新预览头标签；该读取不得阻塞预览主体 UI 渲染。

## 4. 数据与存储契约 (SQLite Contract)

1. 不再使用 `.fauplay/.annotations.v1.json` 作为运行时数据源。
2. 标注数据持久化到 `faudb.v1.sqlite` 的 `annotation_record` 及统一标签表。
3. 标注主键为 `id`（UUID），不得再使用 `annotationId` 命名。
4. 标注记录最小字段：
   - `id`
   - `fileId`
   - `fieldKey`
   - `value`
   - `status`（`active|orphan|conflict`）
   - `orphanReason`
   - `updatedAt`

## 5. Gateway HTTP 接口契约 (HTTP Contract)

1. `POST /v1/annotations/set-value`
   - 输入：`rootPath, relativePath, fieldKey, value, source?`
   - 输出：`{ ok, id, fileId, relativePath, fieldKey, value }`
2. `POST /v1/annotations/refresh-bindings`
   - 输出：`{ ok, total, active, orphan, conflict, rebound }`
3. `POST /v1/annotations/cleanup-orphans`
   - 输入：`confirm?`
   - 输出：`{ ok, dryRun, totalOrphans, removed }`

说明：

- 标注展示与过滤数据通过 Gateway 标签查询接口获取，不再从 sidecar 读取。

## 6. 功能需求 (FR)

1. `FR-MA-01` 标注能力必须通过 Gateway HTTP 接口读写。
2. `FR-MA-02` 运行时不得依赖 sidecar JSON。
3. `FR-MA-03` 标注主键字段必须统一为 `id`。
4. `FR-MA-04` 所有标注记录必须关联统一 `fileId`。
5. `FR-MA-05` 标注写入后必须同步到统一标签模型。
6. `FR-MA-06` `refreshBindings` 必须更新 `active/orphan/conflict`。
7. `FR-MA-07` `cleanupOrphans` 仅处理 `orphan`。
8. `FR-MA-08` 预览文件切换时必须按文件粒度发起标签查询（`/v1/data/tags/file`），不得依赖全量标签快照完成。

## 7. 验收标准 (AC)

1. `AC-MA-01` 调用 `set-value` 后，标签查询可立即看到新增/变更标签。
2. `AC-MA-02` 调用 `refresh-bindings` 后，状态计数与数据库状态一致。
3. `AC-MA-03` `cleanup-orphans` dry-run 与 commit 计数语义一致。
4. `AC-MA-04` 不存在 `.annotations.v1.json` 时，标注能力仍完整可用。
5. `AC-MA-05` 在大目录下预览切换文件时，文件内容区先渲染；标签区在后台查询返回后更新，期间界面不冻结。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. 标注状态默认 `active`。
2. 时间戳统一使用毫秒（ms）。
3. 写请求必须事务化（全成或全败）。

## 9. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
