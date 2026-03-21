# 114 Metadata Annotation 标注能力规范

## 1. 目的 (Purpose)

定义 Fauplay 标注能力在 Gateway 统一数据层下的契约：

1. 标注写入仅通过 `POST /v1/annotations/set-value` 承载。
2. 标注数据统一持久化到 `.fauplay/faudb.v1.sqlite` 的 `tag + file_tag`。
3. 标注结果与其他来源标签（人脸、分类）共享同一标签模型。
4. 同文件同字段仅保留一个当前绑定值。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 标注写入（`setValue`）
2. 预览头标签展示与工作区标签过滤的查询契约
3. 按文件 + 字段覆盖写入的绑定语义

范围外：

1. sidecar JSON 兼容
2. 旧 `.annotations.v1.json` 迁移导入
3. 非文本标签编辑器 UI 细节

## 3. 用户可见行为契约 (User-visible Contract)

1. 预览态快捷打标（`0..9`）保持可用。
2. 写入后预览头标签与过滤选项应通过网关查询立即可见。
3. 同文件同字段重复写入时，旧值绑定被覆盖，仅保留新值。
4. 预览切换到某文件时，系统必须异步读取该文件标签并即时刷新预览头标签；该读取不得阻塞预览主体 UI 渲染。

## 4. 数据与存储契约 (SQLite Contract)

1. 不再使用 `.fauplay/.annotations.v1.json` 作为运行时数据源。
2. 标注数据只落在统一标签模型：
   - `tag`: `id,key,value,source`
   - `file_tag`: `fileId,tagId,appliedAt,score`
3. 标注标签来源固定为 `source=meta.annotation`。
4. 标注字段映射规则固定为：`key=fieldKey`、`value=fieldValue`。
5. 不再引入 `annotation_record` 与任何 `annotation_tag_ext`。

## 5. Gateway HTTP 接口契约 (HTTP Contract)

1. `POST /v1/annotations/set-value`
   - 输入：`rootPath, relativePath, fieldKey, value, source?`
   - 语义：按 `fileId + fieldKey + source=meta.annotation` 覆盖绑定（先移除旧绑定，再写入新绑定）
   - 输出：`{ ok, fileId, relativePath, fieldKey, value }`
2. `POST /v1/annotations/refresh-bindings`
   - 已下线，不再提供维护语义。
3. `POST /v1/annotations/cleanup-orphans`
   - 已下线，不再提供维护语义。

说明：

- 标注展示与过滤数据通过 Gateway 标签查询接口获取，不再从 sidecar 读取。

## 6. 功能需求 (FR)

1. `FR-MA-01` 标注能力必须通过 Gateway HTTP 接口读写。
2. `FR-MA-02` 运行时不得依赖 sidecar JSON。
3. `FR-MA-03` 标注写入必须投影到统一标签模型（`source=meta.annotation`）。
4. `FR-MA-04` 所有标注写入必须关联统一 `fileId`。
5. `FR-MA-05` `set-value` 必须按“同文件同字段覆盖”语义执行。
6. `FR-MA-06` 系统不得再暴露 `refresh-bindings` 与 `cleanup-orphans` 维护接口。
7. `FR-MA-07` 预览文件切换时必须按文件粒度发起标签查询（`/v1/data/tags/file`），不得依赖全量标签快照完成。

## 7. 验收标准 (AC)

1. `AC-MA-01` 调用 `set-value` 后，标签查询可立即看到新增/变更标签。
2. `AC-MA-02` 同文件同字段重复写入后，仅存在一个当前值绑定。
3. `AC-MA-03` 不存在 `.annotations.v1.json` 时，标注能力仍完整可用。
4. `AC-MA-04` 在大目录下预览切换文件时，文件内容区先渲染；标签区在后台查询返回后更新，期间界面不冻结。
5. `AC-MA-05` 调用 `refresh-bindings` 与 `cleanup-orphans` 时返回下线错误（或 404）。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. `set-value` 输入 `source` 为可选元信息；无论是否提供，标签来源均固定投影为 `meta.annotation`。
2. 时间戳统一使用毫秒（ms）。
3. 写请求必须事务化（全成或全败）。

## 9. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
