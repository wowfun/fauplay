# 104 TIMM Classification 推理规范

## 1. 目的 (Purpose)

定义 `timm-classifier` 在 Gateway 统一数据层架构下的契约：

1. 插件仅提供图像分类推理。
2. 分类结果由 Gateway 统一持久化为标签数据。
3. 分类标签与标注/人脸标签共享统一查询与过滤模型。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 单图/批量分类推理输入输出契约。
2. 分类结果字段标准化（`label/score`）。
3. Gateway 侧分类标签持久化。

范围外：

1. 模型训练与微调。
2. 分类标签人工编辑 UI。

## 3. 插件职责契约 (Plugin Responsibility)

1. `ml.classifyImage` 与 `ml.classifyBatch` 仅返回推理结果。
2. 插件不得执行本地数据持久化（不得直写 SQLite）。

## 4. 数据落盘契约 (Gateway Persistence)

1. Gateway 接收分类结果后，按 `tag + file_tag` 双层模型落盘。
2. 标签来源固定：`source=ml.classify`。
3. `tag` 仅承载标签身份：`id,key,value,source`（`PRIMARY KEY(key,value,source)` + `id UNIQUE`）。
4. 分类置信度必须写入 `file_tag.score`，不得再写入 `tag` 扩展字段。
5. 文件关联必须通过统一 `fileId`。

## 5. 工具契约 (Tool Contract)

工具名保持：

1. `ml.classifyImage`
2. `ml.classifyBatch`

返回结构保持：

1. `predictions: Array<{ label: string; score: number }>`
2. 批量 `items: Array<{ relativePath: string; ok: boolean; predictions?: ...; error?: string }>`

## 6. 功能需求 (FR)

1. `FR-TIMM-01` 分类插件必须仅承担推理职责。
2. `FR-TIMM-02` 分类结果必须由 Gateway 持久化为统一标签。
3. `FR-TIMM-03` 分类标签必须可被统一标签过滤查询消费。
4. `FR-TIMM-04` 分类失败不得破坏已落盘标签数据。
5. `FR-TIMM-05` 分类 `score` 必须以 `file_tag.score` 持久化。

## 7. 验收标准 (AC)

1. `AC-TIMM-01` 单图分类成功后，统一标签查询可读到分类标签。
2. `AC-TIMM-02` 批量分类部分失败时，成功项标签可落盘，失败项不产生脏数据。
3. `AC-TIMM-03` 关闭/重启后分类标签可恢复查询。
4. `AC-TIMM-04` 分类标签查询可返回 `file_tag.score`，非分类来源标签该字段保持 `NULL`。

## 8. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 插件运行时：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
