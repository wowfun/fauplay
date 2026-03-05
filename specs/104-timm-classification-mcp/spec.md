# 104 Timm Classification MCP 插件规范

## 1. 目的 (Purpose)

定义 Fauplay 的 `timm` 图像分类 MCP 插件行为契约（Timm Classification MCP Contract），统一单图分类与批量分类工具的输入输出、错误语义、设备选择和模型生命周期规则。

## 2. 关键术语 (Terminology)

- 图像分类（Image Classification）
- 单图分类（Single-image Classification）
- 批量分类（Batch Classification）
- 模型目录（Model Directory）
- Safetensors 权重（Safetensors Weights）
- Top-K 预测（Top-K Predictions）
- 模型预热（Model Warm-up）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 通过 `stdio` MCP Server 暴露 `ml.classifyImage` 与 `ml.classifyBatch`。
2. 本地路径输入（`rootPath + relativePath(s)`）的校验与安全约束。
3. `config.json + model.safetensors` 模型目录加载、设备自动选择与推理返回结构。
4. 批量调用的部分成功语义与项级错误返回。

范围外：

1. 工作区/预览 UI 入口改造。
2. 远程推理服务化（HTTP/gRPC）与在线模型下载。
3. 训练流程、评估指标与模型结构搜索。

## 4. 用户可见行为契约 (User-visible Contract)

1. 插件注册成功后，网关 `tools/list` 中应可发现 `ml.classifyImage` 与 `ml.classifyBatch`。
2. 单图分类返回按置信度降序的 `predictions` 列表，并包含 `device` 与 `timingMs`。
3. 批量分类支持混合结果：成功项返回预测，失败项返回错误信息，不因单项失败终止整批。
4. 首次调用允许出现模型加载开销；后续调用应复用已加载权重，不重复加载模型文件。
5. 调用方（如 Web 端）在触发 `ml.classifyImage` / `ml.classifyBatch` 时必须使用长超时预算（不少于 `120000ms`），避免首轮模型加载被默认短超时中断。
6. 当调用方超时取消请求时，用户可见错误必须为可读超时提示，不得直接暴露浏览器原始中止文案（例如 `signal is aborted without reason`）。

## 5. 工具契约 (Tools Contract)

### 5.1 `ml.classifyImage`

输入参数：

- `rootPath: string`（必填）
- `relativePath: string`（必填）
- `topK: number`（可选，默认 `5`，范围 `1-20`）
- `minScore: number`（可选，默认 `0.0`，范围 `0-1`）

结果结构：

- `model: string`
- `device: string`（`cpu` 或 `cuda`）
- `timingMs: number`
- `predictions: Array<{ label: string; score: number; index: number }>`

错误约束：

1. 参数缺失、越界、路径不安全时返回 `MCP_INVALID_PARAMS`。
2. 工具名错误时返回 `MCP_TOOL_NOT_FOUND`。
3. 模型加载或推理失败时返回 `MCP_TOOL_CALL_FAILED`。

### 5.2 `ml.classifyBatch`

输入参数：

- `rootPath: string`（必填）
- `relativePaths: string[]`（必填，至少 `1` 项）
- `topK: number`（可选，默认 `5`，范围 `1-20`）
- `minScore: number`（可选，默认 `0.0`，范围 `0-1`）
- `maxItems: number`（可选，默认 `256`，范围 `1-1024`）

结果结构：

- `model: string`
- `device: string`
- `timingMs: number`
- `succeeded: number`
- `failed: number`
- `items: Array<{ relativePath: string; ok: boolean; predictions?: Array<{ label: string; score: number; index: number }>; error?: string }>`

批量语义：

1. 单项参数错误、文件不存在、文件不可解码时，仅标记该项失败。
2. 全局初始化错误（配置缺失、权重加载失败）直接返回 MCP 错误。

## 6. 配置契约 (Configuration Contract)

插件配置文件：`.fauplay/timm-classifier.json`

必填字段：

- `modelDir: string`（模型目录路径）

可选字段：

- `device: "auto" | "cpu" | "cuda"`（默认 `auto`）

约束：

1. 相对路径按配置文件目录解析。
2. `modelDir` 必须同时包含 `config.json` 与 `model.safetensors`。
3. `config.json` 必须提供 `architecture`、`num_classes` 与 `label_names`。
4. `label_names` 长度必须与 `num_classes` 一致。
5. `device=auto` 时优先 CUDA，不可用时回退 CPU。
6. `.fauplay/mcp.json` 中 `timm-classifier` 注册项应配置 `callTimeoutMs >= 120000`，以覆盖首轮模型加载耗时。

## 7. 安全与路径约束 (Security & Path Constraints)

1. `relativePath(s)` 禁止包含 `..` 越界段。
2. 文件绝对路径必须落在 `rootPath` 内。
3. 插件只处理常见图片扩展名（`jpg/jpeg/png/webp/bmp/gif`），其他类型视为无效参数。

## 8. 功能需求 (FR)

1. `FR-TIMM-01` 系统必须通过 `.fauplay/mcp.json` 以 `stdio` 方式注册该插件。
2. `FR-TIMM-02` 系统必须支持 `initialize` / `notifications/initialized` / `tools/list` / `tools/call`。
3. `FR-TIMM-03` 系统必须在进程内缓存模型实例，避免每次调用重复加载权重。
4. `FR-TIMM-04` 系统必须在 `ml.classifyImage` 返回 Top-K 预测并按分数降序排序。
5. `FR-TIMM-05` 系统必须在 `ml.classifyBatch` 支持部分成功并提供项级错误信息。
6. `FR-TIMM-06` 系统必须输出稳定错误码到 `error.data.code`。
7. `FR-TIMM-07` 网关侧 `timm-classifier` 注册必须提供不少于 `120000ms` 的下游调用超时预算（`callTimeoutMs`）。
8. `FR-TIMM-08` 前端网关调用层必须为 `ml.classify*` 工具提供不少于 `120000ms` 的默认调用超时。
9. `FR-TIMM-09` 前端网关调用层必须将请求中止（Abort）统一映射为可读超时错误（建议内部码：`MCP_CLIENT_TIMEOUT`）。

## 9. 验收标准 (AC)

1. `AC-TIMM-01` `tools/list` 可见 `ml.classifyImage` 与 `ml.classifyBatch`。
2. `AC-TIMM-02` 有效输入下，单图工具返回非空预测列表与 `device/timingMs`。
3. `AC-TIMM-03` 批量输入包含无效项时，整批仍返回成功结果对象，`failed` 计数正确。
4. `AC-TIMM-04` 首次调用后再次调用不重复加载权重（日志或运行时状态可观测）。
5. `AC-TIMM-05` 越界路径与非法参数返回 `MCP_INVALID_PARAMS`。
6. `AC-TIMM-06` 首次模型加载超过 `5s` 的场景下，Web 端仍可等待完成或返回可读超时错误，不出现原始浏览器中止文案。
7. `AC-TIMM-07` 预览区结果展示在 `ml.classifyImage` 成功后可直接看到 Top-K 预测（`label/score/index`），无需依赖浏览器 Network 面板。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 默认 `topK=5`，默认 `minScore=0.0`。
2. 默认批量上限 `maxItems=256`。
3. 默认设备策略为 `auto`（CUDA 优先，CPU 回退）。
4. 插件元数据中 `ml.classifyImage` 的 `scopes` 为 `["file"]`，`ml.classifyBatch` 的 `scopes` 为 `["workspace"]`。
5. 推荐 UI 呈现语义：`ml.classifyImage.predictions` 以 Top-K 表格展示（列：`label`、`score`、`index`），并保留通用 JSON 兜底视图。

## 11. 关联主题 (Related Specs)

- 架构边界：[`../001-architecture/spec.md`](../001-architecture/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 分区：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
