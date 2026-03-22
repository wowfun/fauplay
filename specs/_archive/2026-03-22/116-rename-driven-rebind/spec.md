# 116 Rename Driven Rebind 改名驱动重绑规范

> Archived on 2026-03-22. Remaining valid contract content has been merged into [`../../../114-local-data-plugin/spec.md`](../../../114-local-data-plugin/spec.md).

## 1. 目的 (Purpose)

定义“文件改名后本地数据重绑”的统一契约，确保：

1. 文件改名后 `file` 表路径可增量更新，`fileId` 保持稳定。
2. 外部接口保持业务语义，内部数据层命名保持 CRUD 风格。
3. Gateway HTTP 接口采用 RESTful 路径与方法，历史维护接口下线。
4. `fs.batchRename` 成功提交后自动触发重绑，失败仅告警不阻断主流程。

## 2. 命名分层 (Naming Layers)

1. 外部语义层（HTTP/MCP 操作名）采用业务语义：
   - `setAnnotationValue`
   - `batchRebindPaths`
   - `reconcileFileBindings`
   - `cleanupInvalidFileIds`
2. 内部数据层（仓储/核心函数）采用 CRUD 风格列级命名：
   - `batchUpdateRelativePaths(tx, mappings)`
3. 约束：`batchRebindPaths` 负责输入校验、冲突判定、结果汇总；`batchUpdateRelativePaths` 只负责 DB 更新语义。

## 3. RESTful HTTP 契约 (HTTP Contract)

1. `PUT /v1/file-annotations`
   - 对应语义：`setAnnotationValue`
2. `PATCH /v1/files/relative-paths`
   - 对应语义：`batchRebindPaths`
3. `POST /v1/file-bindings/reconciliations`
   - 对应语义：`reconcileFileBindings`
4. `POST /v1/file-bindings/cleanups`
   - 对应语义：`cleanupInvalidFileIds`
5. 历史维护接口直接下线（返回下线错误或 404）。

## 4. 批量重绑行为 (Batch Rebind Behavior)

1. 输入为路径映射数组：`{ fromRelativePath, toRelativePath }[]`。
2. 每项独立判定，允许部分成功。
3. 失败项必须返回可枚举 `reasonCode`；其余项继续执行。
4. 至少覆盖以下失败原因：
   - `SOURCE_NOT_FOUND`
   - `TARGET_OCCUPIED`
   - `INVALID_SOURCE_PATH`
   - `INVALID_TARGET_PATH`
5. 成功项仅更新 `file.relativePath` 与 `updatedAt`，不重算 `bindingFp/fileSizeBytes/fileMtimeMs`。

## 5. 两阶段更新 (Two-phase Update)

1. 先将所有可执行源路径更新到临时路径（phase-1）。
2. 再从临时路径更新到目标路径（phase-2）。
3. 目标：避免唯一索引冲突与链式映射失败（如 `A->B, B->C`）。

## 6. 自动触发链路 (Auto-trigger Flow)

1. 当 `fs.batchRename` 满足 `confirm=true && renamed>0` 时，Gateway 自动触发一次 `batchRebindPaths`。
2. 仅对 rename 成功项构建映射并执行重绑。
3. 若重绑失败：
   - 不回滚文件重命名主流程
   - 在返回结果附带 `postProcessWarning`
   - 记录网关日志用于排查

## 7. 功能需求 (FR)

1. `FR-RDR-01` 系统必须支持命名分层：外部语义、内部 CRUD。
2. `FR-RDR-02` 系统必须提供新的 RESTful 路径与方法，并下线历史维护接口。
3. `FR-RDR-03` `batchRebindPaths` 必须返回逐项结果并支持部分成功。
4. `FR-RDR-04` 路径批量更新必须使用两阶段更新，保证链式映射成功。
5. `FR-RDR-05` `fs.batchRename` 成功后必须自动触发重绑，失败仅告警不阻断。

## 8. 验收标准 (AC)

1. `AC-RDR-01` 新 RESTful 路径可用，历史维护接口返回下线错误或 404。
2. `AC-RDR-02` `batchRebindPaths` 调用后内部实际走 `batchUpdateRelativePaths`。
3. `AC-RDR-03` 链式映射 `A->B, B->C` 成功且 `fileId` 不变。
4. `AC-RDR-04` 目标占用/源不存在/非法路径分别返回约定 `reasonCode`，其余项继续执行。
5. `AC-RDR-05` 预览单改名与工作区批量改名成功后均能自动重绑并保持标签/人脸关联。

## 9. 关联主题 (Related Specs)

- 本地数据契约：[`../../../005-local-data-contracts/spec.md`](../../../005-local-data-contracts/spec.md)
- 批量重命名：[`../../../106-batch-rename-workspace/spec.md`](../../../106-batch-rename-workspace/spec.md)
- 预览改名：[`../../../113-preview-inline-rename/spec.md`](../../../113-preview-inline-rename/spec.md)
- 本地数据插件：[`../../../114-local-data-plugin/spec.md`](../../../114-local-data-plugin/spec.md)
