# 114 Metadata Annotation 标注插件规范

## 1. 目的 (Purpose)

定义 Fauplay 标注插件 `meta.annotation` 的统一契约，覆盖：

1. 文本型结构化标注（仅 enum 字段，首期不含图片/语音）。
2. 基于 fingerprint 的重命名/移动重绑能力。
3. orphan 标记与统一清理能力。
4. 预览态快捷打标（0-9 自动映射）。

## 2. 关键术语 (Terminology)

- 标注记录（Annotation Record）
- 标注字段（Annotation Field）
- 枚举值（Enum Value）
- 激活字段（Active Field）
- 绑定指纹（bindingFp）
- 精确指纹（exactFp）
- 相似指纹（simFp）
- 失效标注（orphan）
- 冲突标注（conflict）
- 指纹后台队列（Fingerprint Queue）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `meta.annotation` MCP 工具（`file/workspace` 双作用域）。
2. sidecar 标注库读写（不使用 SQLite）。
3. fingerprint 分层模型与重绑语义。
4. orphan 刷新与清理动作。
5. 插件选项区的字段配置入口与 0-9 快捷打标。
6. 预览头部已标注标签展示（基于 sidecar 快照，独立于工具启用状态）。

范围外：

1. 旧格式兼容与迁移。
2. 非 enum 字段类型（string/number）。
3. 非图片文件的“相似去重”算法。

## 4. 用户可见行为契约 (User-visible Contract)

1. 插件在预览区与工作区可见，工具名为 `meta.annotation`。
2. 用户可在插件选项区进入“标注配置”，配置字段与枚举值顺序。
3. 仅“当前激活字段”参与快捷键映射：按值定义顺序自动分配 `0..9`。
4. 在预览态（侧栏/全屏）按 `0..9` 时，立即提交当前文件该字段对应值。
5. `0..9` 仅在“未聚焦输入控件”且无修饰键时生效。
6. 超过 10 个值时，仅前 10 个有快捷键映射。
7. 刷新标注（`refreshBindings`）会统一执行重绑并更新 `active/orphan/conflict` 状态。
8. 清理失效标注（`cleanupOrphans`）仅删除 `orphan`，不删除 `conflict`。
9. `exactFp/simFp` 由插件选项控制，默认关闭；关闭时不触发对应计算。
10. 服务启动后应在后台异步尝试读取当前 root 下 `.fauplay/.annotations.v1.json`，不得阻塞 UI 主链路。
11. 预览头部标签展示必须与 `meta.annotation` 插件启用状态解耦；网关离线或工具未注册时，若 sidecar 存在且匹配当前文件，仍应展示标签。
12. 预览头部标签位于“文件名同行右侧”，默认展示当前文件 `active` 记录中的全部字段标签。
13. 文件名进入重命名编辑态时，右侧标签仍保持可见，输入框按剩余宽度自适应。

## 5. 数据与存储契约 (Data & Storage Contract)

### 5.1 Sidecar 文件

- 文件名：`.annotations.v1.json`
- 位置：当前 root 目录下 `.fauplay/`
- 编码：UTF-8 JSON
- 兼容策略：不读取旧路径 `.fauplay.annotations.v1.json`

### 5.2 标注记录结构

```json
{
  "schemaVersion": 1,
  "updatedAt": 0,
  "annotations": [
    {
      "annotationId": "uuid",
      "pathSnapshot": "a/b/c.jpg",
      "fieldValues": {
        "color": "red"
      },
      "fingerprints": {
        "bindingFp": "b1:12345:abcd...",
        "exactFp": "e1:....",
        "simFp": "s1:...."
      },
      "fileSizeBytes": 0,
      "fileMtimeMs": 0,
      "status": "active",
      "orphanReason": null,
      "updatedAt": 0
    }
  ]
}
```

字段约束：

1. `annotationId` 稳定 UUID，不得由 fingerprint 充当主键。
2. `status` 取值：`active | orphan | conflict`。
3. `orphanReason` 取值：`missing_path | ambiguous_rebind | no_candidate | search_unavailable`。
4. `fieldValues` 首期仅允许 enum 值。
5. `fileSizeBytes` / `fileMtimeMs` 为绑定快照字段，用于刷新阶段快速命中。

### 5.3 配置存储

- 全局默认配置：`localStorage.fauplay:annotation-schema:global:v1`
- root 覆盖配置：`localStorage.fauplay:annotation-schema:roots:v1`
- 覆盖规则：`rootId` 命中时“整套字段全量覆盖”；否则回退全局默认。

### 5.4 ES 搜索配置

- 默认配置：`tools/mcp/metadata-annotation/config.json`
- 本地覆盖：`tools/mcp/metadata-annotation/config.local.json`（可选）
- 最小字段：`esPath`（必填），可选字段：`instanceName`、`maxCandidates`

## 6. Fingerprint 契约 (bindingFp 无 mtime，重绑使用 size+mtime 快照)

### 6.1 指纹类型

1. `bindingFp`（默认启用）
   - 格式：`b1:<fileSize>:<sampleSha256_128>`
   - `sampleSha256_128`：对采样字节做 SHA-256 后取前 128bit（32 hex）。
   - 采样规则：`head 64KiB + tail 64KiB`；文件小于等于 128KiB 时读取全量。
   - 约束：`bindingFp` 本身不包含 `mtime`。
2. `exactFp`（可选）
   - 格式：`e1:<sha256_256>`
   - 全文件 SHA-256。
3. `simFp`（可选，仅图片）
   - 格式：`s1:<phash64_hex>`
   - 用于图片相似聚类，不用于自动重绑。

### 6.2 刷新与重绑顺序（逐标注项）

1. 对每条标注按 `pathSnapshot` 执行 `stat`：
   - 若 `size/mtime` 与记录的 `fileSizeBytes/fileMtimeMs` 一致 -> `active`（不重算 fingerprint）。
2. 若路径不存在或上一步不一致：
   - 使用 ES 在当前 `rootPath` 范围搜索同 `size + mtime` 的候选文件。
3. 对候选逐个计算 `bindingFp`，与标注记录中的 `bindingFp` 比对：
   - 唯一命中 -> 自动重绑并更新 `pathSnapshot + fileSizeBytes + fileMtimeMs`。
   - 多命中 -> `conflict` + `orphanReason=ambiguous_rebind`。
4. 无候选或无 `bindingFp` 可比对 -> `orphan` + `orphanReason=no_candidate`。
5. ES 配置缺失或搜索失败 -> `orphan` + `orphanReason=search_unavailable`（不中断整次刷新）。

约束：`simFp` 仅用于“相似候选展示”，不得触发自动重绑。

## 7. 后台队列契约 (Lazy + Non-blocking UI)

1. 所有 fingerprint 计算按需触发，不做首开全量计算。
2. 指纹计算必须走后台异步队列，不得阻塞前端交互主链路。
3. 后台队列实现可选：
   - 前端 Web Worker 队列；
   - MCP server 进程内队列（当前推荐）。
4. 队列要求：任务去重、并发上限、优先级、取消能力。
5. 默认优先级：当前预览文件 > 可见文件 > 批量后台刷新。
6. `exactFp/simFp` 关闭时，不入队对应任务。
7. 任一指纹任务失败不得阻断标注写入主流程；失败应可重试。
8. `refreshBindings` 不再以 root 递归全量扫描构建索引为前置步骤。

## 8. 插件选项与交互契约 (Field Config & Hotkeys)

### 8.1 字段配置

1. 首期仅支持 `enum` 字段。
2. 字段结构：
   - `key`（机器键，唯一）
   - `label`（展示名）
   - `values`（按顺序）
3. 插件选项区提供“标注配置”入口，使用结构化编辑器（非 JSON 文本框）。

### 8.2 激活字段与快捷键

1. 仅激活字段参与 `0..9` 映射。
2. 映射规则固定为“按定义顺序 `0->9`”：
   - `values[0] -> 0`
   - `values[1] -> 1`
   - ...
   - `values[9] -> 9`
3. 按键后立即提交（直接工具调用），无需二次确认。
4. 生效范围：预览态（侧栏 + 全屏）；网格态不生效。

### 8.3 计算开关

插件选项包含：

1. `fingerprint.exact.enabled`（boolean，默认 `false`）
2. `fingerprint.similarImage.enabled`（boolean，默认 `false`）

## 9. 工具契约 (Tool Contract)

工具名：`meta.annotation`  
作用域：`annotations.scopes = ["file", "workspace"]`

### 9.1 输入参数

公共参数：

- `rootPath: string`（必填）
- `operation: "setValue" | "refreshBindings" | "cleanupOrphans" | "findExactDuplicates" | "findSimilarImages"`（必填）
- `exactEnabled?: boolean`（可选，默认 `false`）
- `similarImageEnabled?: boolean`（可选，默认 `false`）

分支参数：

1. `setValue`
   - `relativePath: string`（必填）
   - `fieldKey: string`（必填）
   - `value: string`（必填）
   - `source?: "hotkey" | "click"`（可选，默认 `click`）
2. `refreshBindings`
   - 无额外必填参数
3. `cleanupOrphans`
   - `confirm?: boolean`（默认 `false`，`false`=dry-run，`true`=commit）
4. `findExactDuplicates`
   - 要求 `exactEnabled=true`
5. `findSimilarImages`
   - 要求 `similarImageEnabled=true`

### 9.2 输出结构

1. `setValue`
   - `{ ok, annotationId, relativePath, fieldKey, value }`
2. `refreshBindings`
   - `{ ok, total, active, orphan, conflict, rebound }`
3. `cleanupOrphans`
   - `{ ok, dryRun, totalOrphans, removed }`
4. `findExactDuplicates`
   - `{ ok, groups: Array<{ exactFp, paths: string[] }> }`
5. `findSimilarImages`
   - `{ ok, groups: Array<{ simClusterId, paths: string[] }> }`

### 9.3 工具注解约束

1. `annotations.mutation = true`
2. `annotations.icon = "tags"`
3. `annotations.toolOptions` 至少包含：
   - `fingerprint.exact.enabled`（boolean, sendToTool=true, argumentKey=`exactEnabled`）
   - `fingerprint.similarImage.enabled`（boolean, sendToTool=true, argumentKey=`similarImageEnabled`）
4. `annotations.toolActions` 至少包含：
   - `refreshBindings`
   - `cleanupOrphansDryRun`（`confirm=false`）
   - `cleanupOrphansCommit`（`confirm=true`）
   - `findExactDuplicates`
   - `findSimilarImages`

## 10. 功能需求 (FR)

1. `FR-MA-01` 插件必须使用 sidecar 文件 `.fauplay/.annotations.v1.json`，不得依赖 SQLite。
2. `FR-MA-02` `annotationId` 必须稳定 UUID，不得使用 fingerprint 作为主键。
3. `FR-MA-03` `bindingFp` 计算不得依赖 `mtime`，但标注记录必须保存 `fileSizeBytes/fileMtimeMs` 快照。
4. `FR-MA-04` 指纹计算必须按需懒触发，并通过后台异步队列执行（前端 Worker 或服务端队列均可）。
5. `FR-MA-05` `exactFp/simFp` 必须由插件选项控制，默认关闭。
6. `FR-MA-06` 刷新标注必须按“逐标注项校验 -> ES 候选 -> bindingFp 比对”执行重绑，并更新 orphan/conflict。
7. `FR-MA-07` 清理失效标注仅处理 `orphan`，不处理 `conflict`。
8. `FR-MA-08` 插件必须支持字段/值配置，且首期字段类型仅 `enum`。
9. `FR-MA-09` 快捷键 `0..9` 仅作用于激活字段，按定义顺序自动映射。
10. `FR-MA-10` `0..9` 快捷键仅在预览态生效，且按键后立即提交。
11. `FR-MA-11` 配置作用域必须支持“全局默认 + root 覆盖全量替换”。
12. `FR-MA-12` `simFp` 仅用于图片相似候选，不得用于自动重绑。
13. `FR-MA-13` sidecar 不兼容旧路径 `.fauplay.annotations.v1.json`。
14. `FR-MA-14` 客户端必须支持基于 `rootHandle` 的 sidecar 相对路径读取能力，并在根目录就绪后后台异步预加载当前 root 标注快照。
15. `FR-MA-15` 预览头部标签展示判定必须仅依赖 `rootId + 当前文件路径 + sidecar 快照`，不得依赖 `tools/list` 中是否存在 `meta.annotation`。
16. `FR-MA-16` 预览头部标签默认仅展示 `status=active` 记录；`orphan/conflict` 不进入头部标签展示。

## 11. 验收标准 (AC)

1. `AC-MA-01` 改名或移动后执行 `refreshBindings`，唯一候选可自动重绑。
2. `AC-MA-02` 同时命中多个候选时，记录为 `conflict` 且不自动重绑。
3. `AC-MA-03` 删除文件后刷新，记录变为 `orphan`。
4. `AC-MA-04` `cleanupOrphans` 的 dry-run 与 commit 结果计数一致。
5. `AC-MA-05` `exact/sim` 默认关闭时，不产生对应指纹任务。
6. `AC-MA-06` 开启 `exact` 后可返回精确重复分组结果。
7. `AC-MA-07` 开启 `sim` 后仅图片参与相似分组。
8. `AC-MA-08` 字段值顺序变更后，`0..9` 映射同步更新。
9. `AC-MA-09` 预览态按 `0..9` 可立即提交；输入框聚焦时按键不触发。
10. `AC-MA-10` root 有覆盖配置时优先使用 root 配置；无覆盖回退全局。
11. `AC-MA-11` `refreshBindings` 不触发 root 递归全量扫描。
12. `AC-MA-12` 本专题快捷键文档与配置同步更新（`src/config/shortcuts.ts` 与 `docs/shortcuts.md`）。
13. `AC-MA-13` ES 不可用时，条目标记为 `orphan(search_unavailable)`，整次刷新不中断。
14. `AC-MA-14` 在网关离线或 `meta.annotation` 未注册时，若 sidecar 存在匹配当前文件的 `active` 标注，预览头部仍可展示标签。
15. `AC-MA-15` 预览头部标签与文件名处于同一行且右侧对齐；进入重命名编辑态后标签不消失。
16. `AC-MA-16` sidecar 缺失或 JSON 非法时，标签区静默降级为空，不阻塞预览打开与交互。

## 12. 默认值与一致性约束 (Defaults & Consistency)

1. `schemaVersion` 固定为 `1`。
2. `exactEnabled=false`，`similarImageEnabled=false`。
3. 指纹采样窗口固定 `64KiB + 64KiB`。
4. 快捷映射固定顺序 `0->9`。
5. 首期仅 enum 字段，不扩展字段类型。

## 13. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 本地文件浏览：[`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)
