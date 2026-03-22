# 114 Local Data Plugin 本地数据管理插件规范

## 1. 目的 (Purpose)

定义 `local.data` 插件在 Gateway 统一数据层下的契约：

1. 标注写入通过统一本地数据接口完成，且 `setAnnotationValue` 标签来源固定为 `source=meta.annotation`。
2. `file` 仅作为当前路径索引；批量路径重绑只维护 `absolutePath`，不再承诺位置身份连续性。
3. 提供缺失路径的 dry-run/commit 清理能力，并在最后一个 `file` 消失时将对应 `asset` 软删除。
4. 人脸、分类、标注继续共享同一 `asset + file + tag + asset_tag` 数据模型。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `setAnnotationValue`：同资产同字段覆盖写入。
2. `batchRebindPaths`：按相对路径映射批量更新 `file.absolutePath`（支持链式映射）。
3. `cleanupMissingFiles`：缺失路径预演与提交清理。
5. 预览态 `0..9` 快捷打标链路与工作台标注面板。

范围外：

1. sidecar JSON 运行时读写与兼容。
2. `sha256` 管理与人工校验接口。
3. 失效状态持久化表（请求级返回，不新增状态表）。

## 3. 工具契约 (MCP Tool Contract)

1. 工具名固定为：`local.data`。
2. `operation` 枚举固定为：`setAnnotationValue | bindAnnotationTag | unbindAnnotationTag | batchRebindPaths | cleanupMissingFiles`。
3. `local.data` 仅承载工作台元数据与操作入口；持久化由 Gateway HTTP 接口执行。

### 3.1 命名分层与入口收敛

1. 外部语义层（HTTP / MCP 操作名）固定使用业务语义：`setAnnotationValue`、`bindAnnotationTag`、`unbindAnnotationTag`、`batchRebindPaths`、`cleanupMissingFiles`。
2. 内部数据层（仓储 / 核心函数）可保留 CRUD 风格或实现导向命名，但不得改变外部语义层契约。
3. `batchRebindPaths` 是改名后路径维护的统一入口；工作区批量改名与预览单文件改名成功后，均应通过该入口执行后处理重绑。

## 4. Gateway HTTP 接口契约 (HTTP Contract)

1. `PUT /v1/file-annotations`
   - 输入：`rootPath, relativePath, fieldKey, value, source?`
   - 语义：先解析 `rootPath + relativePath -> absolutePath -> file -> asset`，再按 `assetId + fieldKey + source=meta.annotation` 覆盖绑定（先删旧绑定再写新绑定）
   - 输出：`{ ok, assetId, absolutePath, relativePath, fieldKey, value }`
   - 读侧说明：用于顶部标签过滤与预览标签显示的读取接口（`/v1/data/tags/file`、`/v1/data/tags/query`）默认不按 `source=meta.annotation` 预过滤。
2. `POST /v1/file-annotations/tags/bind`
   - 输入：`rootPath, relativePath, key, value`
   - 语义：仅新增 `source=meta.annotation` 的同名标签绑定，不删除任何同名派生来源
   - 输出：`{ ok, assetId, absolutePath, relativePath, key, value, source: 'meta.annotation' }`
3. `POST /v1/file-annotations/tags/unbind`
   - 输入：`rootPath, relativePath, key, value`
   - 语义：仅移除 `source=meta.annotation` 的同名标签绑定，不删除任何同名派生来源
   - 输出：`{ ok, assetId, absolutePath, relativePath, key, value, source: 'meta.annotation' }`
4. `PATCH /v1/files/relative-paths`
   - 输入：`rootPath, mappings[]`
   - `mappings[]` 项结构：`{ fromRelativePath, toRelativePath }`
   - 语义：基于 `rootPath` 将映射解析为绝对路径后批量重绑 `file.absolutePath`，两阶段更新避免唯一键冲突，逐项返回结果
   - 输出：`{ ok, total, updated, failed, items[] }`
5. `POST /v1/files/missing/cleanups`
   - 输入：`rootPath, confirm?`
   - 语义：按当前 `rootPath` 作用域扫描缺失路径；`confirm=false` 仅预演，`confirm=true` 提交删除缺失 `file`，并在必要时软删除最后一个 `file` 对应的 `asset`
   - 输出：`{ ok, dryRun, missingAbsolutePaths[], impact, removed? }`
6. `POST /v1/file-bindings/reconciliations` 已下线；调用时返回下线错误或 404。
7. 历史维护接口已下线；调用时返回下线错误或 404。

## 5. 数据与行为契约 (Data & Behavior Contract)

### 5.1 标注写入

1. 标注标签来源固定为 `source=meta.annotation`。
2. 字段映射固定为 `key=fieldKey`、`value=fieldValue`。
3. Gateway 必须先按 `rootPath + relativePath` 解析到 `absolutePath`，再定位 `file` 与 `asset`。
4. 同资产同字段重复写入，仅保留一个当前绑定；共享同一 `asset` 的其他 `file` 结果必须立即可见相同标签。
5. 上述“来源固定”仅约束写入；过滤与显示读取链路默认读取全部 `source` 标签。

### 5.2 逻辑标签补来源 / 删来源

1. 预览头部手动管理的逻辑标签身份固定为 `key + value`，不包含 `source`。
2. `bindAnnotationTag` 仅为该逻辑标签补一条 `source=meta.annotation` 绑定，不删除同名派生来源。
3. `unbindAnnotationTag` 仅删除该逻辑标签的 `source=meta.annotation` 绑定，不删除同名派生来源。
4. 当同一逻辑标签同时拥有 `meta.annotation` 与派生来源时，前端展示必须以 `meta.annotation` 为代表来源。
5. 读侧继续返回全部来源；前端按 `key + value` 聚合候选、展示与过滤。
### 5.3 批量路径重绑（`batchRebindPaths`）

1. 每项路径映射独立校验并返回逐项状态，允许部分成功。
2. 至少覆盖以下失败原因码：
   - `SOURCE_NOT_FOUND`
   - `TARGET_OCCUPIED`
   - `INVALID_SOURCE_PATH`
   - `INVALID_TARGET_PATH`
3. 成功项更新同一条 `file` 记录的 `absolutePath`、`fileMtimeMs`、`lastSeenAt` 与 `updatedAt`；`assetId` 保持稳定。
4. 实现必须采用两阶段更新（临时路径 -> 目标路径），避免唯一索引冲突与链式重命名失败。
5. `fs.batchRename` 与预览单文件改名等上游改名链路在提交成功后，应复用该能力完成路径侧后处理；若后处理失败，只能告警，不得回滚已完成的文件重命名。

### 5.4 缺失路径清理（`cleanupMissingFiles`）

1. 只对 `absolutePath` 落在当前 `rootPath` 前缀内的 `file` 记录执行校验。
2. `confirm=false`：返回缺失路径清单与影响预估。
3. `confirm=true`：删除缺失 `file` 行；若某个 `asset` 因此失去最后一个 `file`，则将 `asset.deletedAt` 置值做软删除。
4. 不再提供基于候选搜索的自动重绑；外部重命名后若新路径已被建档，内容连续性由共享 `assetId` 承担。
5. 提交后必须刷新人物缓存与 `vision.face` 标签投影，并保证普通查询只读取活跃资产。

## 6. 功能需求 (FR)

1. `FR-LD-01` 系统必须暴露 `local.data` 工具，且操作枚举仅包含 `setAnnotationValue/bindAnnotationTag/unbindAnnotationTag/batchRebindPaths/cleanupMissingFiles`。
2. `FR-LD-02` 标注写入必须投影到统一标签模型，且来源固定为 `meta.annotation`。
3. `FR-LD-03` `batchRebindPaths` 必须只维护路径索引，不再对外暴露 `fileId`。
4. `FR-LD-04` `cleanupMissingFiles` 必须支持 dry-run 与 commit 双阶段。
6. `FR-LD-06` 失效清理提交后，若某资产失去最后一个位置，系统必须将其软删除而不是物理清空资产级标签/人脸数据。
7. `FR-LD-07` 历史维护接口不得继续提供写入或维护能力。
8. `FR-LD-08` 标签读取接口用于顶部过滤与预览显示时，不得默认限制为 `source=meta.annotation`。
9. `FR-LD-09` 系统必须支持对现有逻辑标签单独补一条 `meta.annotation` 来源绑定，而不删除同名派生来源。
10. `FR-LD-10` 系统必须支持仅移除逻辑标签的 `meta.annotation` 来源绑定，而不删除同名派生来源。

## 7. 验收标准 (AC)

1. `AC-LD-01` `setAnnotationValue` 可通过 `rootPath + relativePath` 正确定位到 `file -> asset` 并写入 `tag+asset_tag`，`source` 为 `meta.annotation`。
2. `AC-LD-02` 同资产同字段重复写入后，仅保留一个当前绑定。
3. `AC-LD-03` 链式映射 `A->B, B->C` 经 `batchRebindPaths` 成功执行，目标路径索引正确更新。
4. `AC-LD-04` 外部重命名后若直接访问新路径，新路径可正常建档并通过共享 `assetId` 复用标签与人脸。
5. `AC-LD-05` `cleanupMissingFiles` dry-run 与 commit 的目标数量一致；commit 后缺失 `file` 被删除，最后一个 `file` 消失的 `asset` 会进入软删除。
7. `AC-LD-07` 当文件仅存在非 `meta.annotation` 来源标签时，`/v1/data/tags/file` 与 `/v1/data/tags/query` 仍可返回该标签供顶部过滤与预览显示使用。
8. `AC-LD-08` 当文件已有 `vision.face(person=Alice)` 时，调用 `bindAnnotationTag(person, Alice)` 后会额外新增 `meta.annotation(person=Alice)`，且不会删除原 `vision.face(person=Alice)`。
9. `AC-LD-09` 当文件同时拥有 `meta.annotation(person=Alice)` 与 `vision.face(person=Alice)` 时，调用 `unbindAnnotationTag(person, Alice)` 后仅移除 `meta.annotation`，`vision.face` 结果保留。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. 时间戳统一使用毫秒（ms）。
2. 所有写请求必须事务化（全成或全败）。
3. 不新增 file 绑定状态持久化表，状态只在请求结果中返回。

## 9. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 批量重命名：[`../106-batch-rename-workspace/spec.md`](../106-batch-rename-workspace/spec.md)
- 预览改名：[`../113-preview-inline-rename/spec.md`](../113-preview-inline-rename/spec.md)
- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 预览头部逻辑标签管理：[`../117-preview-header-tag-management/spec.md`](../117-preview-header-tag-management/spec.md)
