# 114 Metadata Annotation 实施计划

## 1. 目的

本计划用于将 [`spec.md`](./spec.md) 的标注插件契约拆解为可执行增量，重点覆盖当前已落地能力之外的差距项，并给出下一步实现顺序与验收口径。

## 2. 当前实现对照

### 2.1 已落地能力

1. 已新增 `meta.annotation` MCP server，并注册到 `.fauplay/mcp.json`。
2. 已支持 sidecar `.fauplay/.annotations.v1.json` 读写与 `schemaVersion=1`。
3. 已实现 `setValue/refreshBindings/cleanupOrphans/findExactDuplicates/findSimilarImages` 五类操作。
4. 已实现 `bindingFp`（无 `mtime` 依赖）与可选 `exactFp/simFp` 开关透传。
5. 已实现预览态 `0..9` 快捷打标与 Workbench 字段配置入口。
6. 已实现“全局默认 + root 覆盖”配置持久化与激活字段选择。

### 2.2 未实现功能 / 主要差距

1. 指纹后台队列仍是“固定并发批处理”，尚未实现任务级去重、优先级、取消。
2. `simFp` 仍为采样哈希简化实现，不是规范中的图片感知指纹（pHash）。
3. `setValue` 未按当前 schema 强校验（字段存在性、枚举值合法性、非法写入拦截）。
4. `refreshBindings` 为全量扫描模型，尚未提供增量缓存与恢复策略。
5. `findSimilarImages` 当前为全量两两比较，目录规模增大时成本较高。
6. 缺少自动化测试（server 契约测试、前端快捷键与配置回归测试）。
7. 结果可观测性不足（队列进度、失败分类、耗时指标未结构化输出）。

## 3. 增量规范 (Delta)

### Delta MA-D1：指纹队列能力补齐

状态：`pending`

目标：

1. 将“并发批处理”升级为“后台任务队列”。
2. 补齐任务去重、优先级、取消能力。

落地点：

1. `tools/mcp/metadata-annotation/server.mjs` 增加队列调度层。
2. `operation` 执行链路区分“交互优先任务（setValue）”与“批量任务（refresh/find）”。

验收：

1. 同路径同算法重复入队仅执行一次。
2. `setValue` 任务在批量刷新期间仍可快速返回。
3. 目录切换或请求中断时，低优先级任务可取消。

---

### Delta MA-D2：相似指纹升级为真实图片 pHash

状态：`pending`

目标：

1. 将 `simFp` 从采样哈希替换为图片感知哈希（pHash）。
2. 保持“仅图片生效、不参与自动重绑”语义。

落地点：

1. `tools/mcp/metadata-annotation/server.mjs` 增加图片解码 + pHash 计算流程。
2. `findSimilarImages` 改为基于 pHash 的候选聚类。

验收：

1. 同图缩放/轻度压缩后仍可聚到同组。
2. 非图片文件不会生成 `simFp`。
3. 相似分组误报率较当前版本下降（以固定样本集回归）。

---

### Delta MA-D3：schema 强校验与写入约束

状态：`pending`

目标：

1. `setValue` 严格遵循 schema（字段与枚举值合法性）。
2. 防止无效字段/值写入 sidecar。

落地点：

1. 在 server 侧读取并应用“root 覆盖优先”的 schema。
2. `setValue` 参数校验失败返回 `MCP_INVALID_PARAMS`。

验收：

1. 非法 `fieldKey` 或非枚举值无法落盘。
2. 根目录覆盖 schema 与全局 schema 行为一致可复现。

---

### Delta MA-D4：增量索引与性能收敛

状态：`pending`

目标：

1. 避免 `refreshBindings` 每次全量重算全部文件指纹。
2. 降低大目录场景下等待时间与 I/O 峰值。

落地点：

1. sidecar 或独立缓存文件中保存“路径 -> 指纹快照”。
2. 根据 `size + bindingFp` 命中复用，未命中再重算。

验收：

1. 二次刷新耗时显著低于首次全量计算。
2. 文件新增/删除/替换后可正确更新索引。

---

### Delta MA-D5：测试与可观测性

状态：`pending`

目标：

1. 建立最小自动化测试基线与回归样本。
2. 增强排障可观测性。

落地点：

1. `tools/mcp/metadata-annotation` 新增集成测试（JSON-RPC + 文件夹样本）。
2. 前端新增快捷键行为测试（输入焦点拦截、预览态生效）。
3. server 输出结构化日志字段（operation/耗时/任务量/失败原因）。

验收：

1. 核心场景（改名/移动/删除/冲突/orphan 清理）可自动回归。
2. 快捷键与配置覆盖策略具备自动化断言。

## 4. 下一步建议（执行顺序）

1. 先做 `MA-D3`（schema 强校验），先把数据正确性锁住。
2. 再做 `MA-D1`（队列能力补齐），改善交互延迟与可控性。
3. 然后做 `MA-D2`（真实 pHash），提升相似去重质量。
4. 接着做 `MA-D4`（增量索引），解决大目录性能。
5. 最后做 `MA-D5`（测试与可观测性），形成可持续迭代基础。

## 5. 回归清单

1. `setValue`：点击与 `0..9` 快捷键均可正确写入。
2. `refreshBindings`：改名/移动后可重绑；多候选进入 `conflict`。
3. `cleanupOrphans`：dry-run/commit 计数一致。
4. `exact` 开关关闭时不计算 `exactFp`；开启后重复组结果稳定。
5. `sim` 开关关闭时不计算 `simFp`；开启后仅图片参与。
6. root 覆盖配置切换后，激活字段与快捷映射正确更新。

## 6. 关联文档

1. 稳定规范：[`spec.md`](./spec.md)
2. 变更日志：[`../CHANGELOG.md`](../CHANGELOG.md)
