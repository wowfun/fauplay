# 114 Local Data Plugin 本地数据管理插件规范

## 1. 目的 (Purpose)

定义 `local.data` 插件在 Gateway 统一数据层下的契约：

1. 标注写入通过统一本地数据接口完成，且 `setAnnotationValue` 标签来源固定为 `source=meta.annotation`。
2. `file` 位置记录支持批量路径重绑与自动重绑，`fileId` 保持稳定。
3. 提供失效 `fileId` 的 dry-run/commit 清理能力，并在最后一个 `file` 消失时将对应 `asset` 软删除。
4. 人脸、分类、标注继续共享同一 `asset + file + tag + asset_tag` 数据模型。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `setAnnotationValue`：同资产同字段覆盖写入。
2. `batchRebindPaths`：按相对路径映射批量更新 `file.absolutePath`（支持链式映射）。
3. `reconcileFileBindings`：针对当前 `rootPath` 作用域内的 `file` 记录执行路径校验、候选搜索与自动重绑。
4. `cleanupInvalidFileIds`：失效 `fileId` 预演与提交清理。
5. 预览态 `0..9` 快捷打标链路与工作台标注面板。

范围外：

1. sidecar JSON 运行时读写与兼容。
2. `sha256` 管理与人工校验接口。
3. 失效状态持久化表（请求级返回，不新增状态表）。

## 3. 工具契约 (MCP Tool Contract)

1. 工具名固定为：`local.data`。
2. `operation` 枚举固定为：`setAnnotationValue | batchRebindPaths | reconcileFileBindings | cleanupInvalidFileIds`。
3. `local.data` 仅承载工作台元数据与操作入口；持久化由 Gateway HTTP 接口执行。

## 4. Gateway HTTP 接口契约 (HTTP Contract)

1. `PUT /v1/file-annotations`
   - 输入：`rootPath, relativePath, fieldKey, value, source?`
   - 语义：先解析 `rootPath + relativePath -> absolutePath -> file -> asset`，再按 `assetId + fieldKey + source=meta.annotation` 覆盖绑定（先删旧绑定再写新绑定）
   - 输出：`{ ok, fileId, assetId, relativePath, fieldKey, value }`
   - 读侧说明：用于顶部标签过滤与预览标签显示的读取接口（`/v1/data/tags/file`、`/v1/data/tags/query`）默认不按 `source=meta.annotation` 预过滤。
2. `PATCH /v1/files/relative-paths`
   - 输入：`rootPath, mappings[]`
   - `mappings[]` 项结构：`{ fromRelativePath, toRelativePath }`
   - 语义：基于 `rootPath` 将映射解析为绝对路径后批量重绑 `file.absolutePath`，两阶段更新避免唯一键冲突，逐项返回结果
   - 输出：`{ ok, total, updated, failed, items[] }`
3. `POST /v1/file-bindings/reconciliations`
   - 输入：`rootPath`
   - 语义：只针对当前 `rootPath` 作用域下的 `file` 记录执行路径校验与自动重绑；唯一命中时只更新当前行路径与快照，不更换 `fileId`
   - 输出：`{ ok, total, active, rebound, conflict, orphan, searchUnavailable, items[] }`
4. `POST /v1/file-bindings/cleanups`
   - 输入：`rootPath, confirm?`
   - 语义：按“刷新后无法唯一重绑”的结果集执行清理；`confirm=false` 仅预演，`confirm=true` 提交删除失效 `file`，并在必要时软删除最后一个 `file` 对应的 `asset`
   - 输出：`{ ok, dryRun, invalidFileIds[], impact, removed? }`
5. 历史维护接口已下线；调用时返回下线错误或 404。

## 5. 数据与行为契约 (Data & Behavior Contract)

### 5.1 标注写入

1. 标注标签来源固定为 `source=meta.annotation`。
2. 字段映射固定为 `key=fieldKey`、`value=fieldValue`。
3. Gateway 必须先按 `rootPath + relativePath` 解析到 `absolutePath`，再定位 `file` 与 `asset`。
4. 同资产同字段重复写入，仅保留一个当前绑定；共享同一 `asset` 的其他 `file` 结果必须立即可见相同标签。
5. 上述“来源固定”仅约束写入；过滤与显示读取链路默认读取全部 `source` 标签。

### 5.2 批量路径重绑（`batchRebindPaths`）

1. 每项路径映射独立校验并返回逐项状态，允许部分成功。
2. 至少覆盖以下失败原因码：
   - `SOURCE_NOT_FOUND`
   - `TARGET_OCCUPIED`
   - `INVALID_SOURCE_PATH`
   - `INVALID_TARGET_PATH`
3. 成功项更新同一条 `file` 记录的 `absolutePath`、`fileMtimeMs`、`lastSeenAt` 与 `updatedAt`，`fileId` 与 `assetId` 保持稳定。
4. 实现必须采用两阶段更新（临时路径 -> 目标路径），避免唯一索引冲突与链式重命名失败。

### 5.3 file 表自动重绑（`reconcileFileBindings`）

1. 只对 `absolutePath` 落在当前 `rootPath` 前缀内的 `file` 记录执行校验。
2. 对每条 `file` 记录按 `absolutePath` 执行 `stat`；若当前文件内容仍匹配关联 `asset` 的 `(size, fingerprint, fpMethod)` 身份，则记为 `active` 并刷新 `lastSeenAt`。
3. 路径缺失或内容不一致时，使用 Everything Search 在当前 `rootPath` 内检索同 `size+mtime` 候选。
4. 对候选逐个计算 `b1` 指纹并与原 `asset` 身份比对：
   - 唯一命中：更新 `absolutePath/fileMtimeMs/lastSeenAt/updatedAt`，`fileId` 不变。
   - 内容变化但路径仍指向有效文件：允许在保留 `fileId` 的前提下切换 `assetId` 到新的内容资产。
   - 多命中：记 `conflict`，原因 `ambiguous_rebind`。
   - 无命中：记 `orphan`，原因 `no_candidate`。
5. ES 配置缺失或查询失败：记 `orphan`，原因 `search_unavailable`，且不中断整次刷新。

### 5.4 失效 fileId 清理（`cleanupInvalidFileIds`）

1. 失效判定基于当前 `rootPath` 作用域内“刷新后无法唯一重绑”的条目（`conflict/orphan`）。
2. `confirm=false`：返回失效 `fileId` 清单与影响预估。
3. `confirm=true`：删除失效 `file` 行；若某个 `asset` 因此失去最后一个 `file`，则将 `asset.deletedAt` 置值做软删除。
4. 提交后必须刷新人物缓存与 `vision.face` 标签投影，并保证普通查询只读取活跃资产。

## 6. 功能需求 (FR)

1. `FR-LD-01` 系统必须暴露 `local.data` 工具，且操作枚举仅包含 `setAnnotationValue/batchRebindPaths/reconcileFileBindings/cleanupInvalidFileIds`。
2. `FR-LD-02` 标注写入必须投影到统一标签模型，且来源固定为 `meta.annotation`。
3. `FR-LD-03` `batchRebindPaths` 成功项必须保持 `fileId` 不变。
4. `FR-LD-04` `reconcileFileBindings` 在 ES 不可用时不得整次失败。
5. `FR-LD-05` `cleanupInvalidFileIds` 必须支持 dry-run 与 commit 双阶段。
6. `FR-LD-06` 失效清理提交后，若某资产失去最后一个位置，系统必须将其软删除而不是物理清空资产级标签/人脸数据。
7. `FR-LD-07` 历史维护接口不得继续提供写入或维护能力。
8. `FR-LD-08` 标签读取接口用于顶部过滤与预览显示时，不得默认限制为 `source=meta.annotation`。

## 7. 验收标准 (AC)

1. `AC-LD-01` `setAnnotationValue` 可通过 `rootPath + relativePath` 正确定位到 `file -> asset` 并写入 `tag+asset_tag`，`source` 为 `meta.annotation`。
2. `AC-LD-02` 同资产同字段重复写入后，仅保留一个当前绑定。
3. `AC-LD-03` 链式映射 `A->B, B->C` 经 `batchRebindPaths` 成功执行且 `fileId` 保持稳定。
4. `AC-LD-04` `reconcileFileBindings` 在 ES 不可用时请求成功返回，结果中包含 `search_unavailable` 统计与条目。
5. `AC-LD-05` 同一路径内容被替换时，`fileId` 保持稳定但可切换到新的 `assetId`。
6. `AC-LD-06` 清理 dry-run 与 commit 的目标数量一致；commit 后失效 `file` 被删除，最后一个 `file` 消失的 `asset` 会进入软删除。
7. `AC-LD-07` 当文件仅存在非 `meta.annotation` 来源标签时，`/v1/data/tags/file` 与 `/v1/data/tags/query` 仍可返回该标签供顶部过滤与预览显示使用。

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
