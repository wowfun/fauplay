# 112 相同时长视频搜索插件规范

## 1. 目的 (Purpose)

定义 `media.searchSameDurationVideos` 插件契约：针对当前预览视频按“同秒/容差秒 + 容差大小”检索相同时长视频，提供结构化结果表格、行级打开动作、Everything 搜索入口，以及持续调用一致性语义。
实现与排障时可参考文档：[`../../docs/everything-search.md`](../../docs/everything-search.md)。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 以 `stdio` MCP server 暴露 `media.searchSameDurationVideos`（`file` 作用域）。
2. 支持 `search/openPath/openEverything` 三类操作。
3. 预览工作台支持持续调用与搜索范围选项。
4. 结果区支持表格行级“打开”按钮动作。
5. 仅对 `search.scope` 选项做 LocalStorage 持久化。
6. WSL 下挂载失效（`No such device`）时支持自动重挂载并单次重试。

范围外：

1. 新增快捷键。
2. 新增工作区作用域工具。
3. 结果区顶部 Everything 按钮（本专题改为工作台动作入口）。

## 3. 用户可见行为契约 (User-visible Contract)

1. 预览插件区可见工具 `media.searchSameDurationVideos`。
2. 工具手动执行时，返回表格列固定为：`duration`、`size`、`path`、`openAction`。
3. `openAction` 为行级按钮，点击后用系统默认应用打开对应文件。
4. Everything 搜索入口位于工具工作台动作区（`openEverything`），不在结果区顶部重复提供。
5. 搜索范围选项支持：
   - `global`（全局，默认）
   - `root`（当前根目录）
6. `search.scope` 修改后应持久化，页面刷新后恢复。
7. 持续调用开启后，切换预览文件自动触发。
8. 同文件 + 同请求签名命中历史成功或失败记录时，持续调用静默跳过；手动触发仍强制执行并生成新结果项。

## 4. 工具契约 (Tools Contract)

工具名：`media.searchSameDurationVideos`

作用域：`annotations.scopes = ["file"]`

输入（按 `operation` 分支）：

1. `search`（默认）
   - `rootPath: string`（必填）
   - `relativePath: string`（必填）
   - `searchScope?: "global" | "root"`（可选，默认 `global`）
2. `openPath`
   - `rootPath: string`（必填）
   - `absolutePath: string`（必填）
3. `openEverything`
   - `rootPath: string`（必填）
   - `relativePath: string`（必填）
   - `searchScope?: "global" | "root"`（可选，默认 `global`）

输出：

1. `search` 返回结构化对象，包含 `resultsTable.columns` 和 `resultsTable.rows`。
2. 每行 `openAction` 字段为可执行动作对象（触发本工具 `openPath`）。
3. `search` 返回 `toleranceSizeKB` 与 `targetSizeBytes` 字段，用于展示本次大小容差与目标文件大小。
4. `openAction` 默认采用静默执行（不新增结果队列项）。
5. `openPath/openEverything` 返回 `{ ok: true }` 语义结果。

工具注解：

1. `toolOptions`
   - `preview.continuousCall.enabled`（boolean，默认 `false`）
   - `search.scope`（enum：`global|root`，默认 `global`，`sendToTool=true`，`argumentKey="searchScope"`）
2. `toolActions`
   - `openEverything`（执行参数包含 `operation: "openEverything"`）

## 5. 配置契约 (Configuration Contract)

配置文件：

1. 默认：`tools/mcp/video-same-duration/config.json`
2. 显式覆盖：独立运行时可传 `--config <path>`；Gateway 如需覆盖，应在 `~/.fauplay/global/mcp.json` 中改写该 server 的 `args`

字段：

1. `esPath: string`（默认 `tools/bin/everything/es.exe`）
2. `everythingPath: string`
3. `instanceName: string`（默认 `1.5a`）
4. `toleranceMs: integer`（默认 `500`，最小 `0`）
5. `toleranceSize: integer`（单位 KB，默认 `-1`，最小 `-1`；`-1` 表示忽略大小容差）
6. `maxResults: integer`（默认 `200`，最小 `1`）

规则：

1. 未显式传入 `--config` 时，工具只读取同目录默认配置文件。
2. 显式传入 `--config` 时，工具只读取该文件。
3. 工具不得自动读取 `~/.fauplay/global/video-same-duration.json`、`<root>/.fauplay/video-same-duration.json` 或其他 `*.local.json` 作为内建覆盖层。
4. 搜索默认排序为 `size-descending`。
5. `searchScope=root` 时仅检索当前 `rootPath` 范围。
6. ES 输出解码固定为自动判定（原始字节在 UTF-8 与 GBK 之间择优解码），不暴露手工编码配置项。
7. 同时长判定以毫秒为准：候选项需满足 `|candidateDurationMs - targetDurationMs| <= toleranceMs`。
8. 大小容差启用条件：`toleranceSize >= 0`；启用后候选项需满足 `|candidateSizeBytes - targetSizeBytes| <= toleranceSize * 1024`。
9. `openEverything` 生成的查询条件需与插件内搜索等价；启用大小容差时必须包含对应 `size` 条件。
10. 当目标文件位于 `/mnt/<drive>/...` 且探测阶段报错包含 `No such device` 时，系统需尝试执行 `sudo -S mount -t drvfs <DRIVE>: /mnt/<drive>` 并仅重试一次。
11. 自动重挂载仅使用环境变量 `SUDO_PASSWORD`；不支持 `sudo_password` 兼容读取。
12. 探测与自动重挂载流程需设置超时并快速失败，避免长时间阻塞导致前端 `MCP_CLIENT_TIMEOUT`。

## 6. 持续调用与去重语义

1. 持续调用使用统一请求签名（包含工具名、文件上下文、工具参数）。
2. 参数签名必须包含 `searchScope` 与所有 sendToTool 选项值。
3. 历史命中判断条件：同 `tool + file + requestSignature` 且结果状态为成功或失败。
4. 命中后持续调用静默跳过，不新增结果项。
5. 手动调用不参与跳过，必须执行并新增结果项。

## 7. 功能需求 (FR)

1. `FR-SDS-01` 系统必须注册并暴露 `media.searchSameDurationVideos` 文件级工具。
2. `FR-SDS-02` 工具必须支持 `search/openPath/openEverything` 三种 `operation`。
3. `FR-SDS-03` `search.scope` 默认值必须为 `global`，并通过 LocalStorage 持久化。
4. `FR-SDS-04` 结果表格必须包含固定列：`duration/size/path/openAction`。
5. `FR-SDS-05` 行级 `openAction` 必须可触发系统默认应用打开目标文件。
6. `FR-SDS-06` Everything 搜索入口必须位于工作台 `toolActions`，不在结果区顶部重复提供。
7. `FR-SDS-07` 连续调用必须支持历史命中静默跳过，手动调用必须强制重算。
8. `FR-SDS-08` 系统必须支持 `toleranceSize` 配置项，`-1` 表示忽略大小容差，`0` 表示精确大小匹配，正整数表示 KB 容差范围匹配。
9. `FR-SDS-09` `openEverything` 必须复用与 `search` 相同的大小容差条件生成等价查询。
10. `FR-SDS-10` 探测阶段命中 `No such device` 时，系统必须按 `/mnt/<drive>` 自动重挂载并单次重试。
11. `FR-SDS-11` 当 `SUDO_PASSWORD` 缺失或挂载失败时，系统必须返回可读错误（含盘符与操作建议）。
12. `FR-SDS-12` 重挂载或探测超时时，系统必须在单次工具调用内快速返回 `MCP_TOOL_CALL_FAILED`，而不是等待客户端超时。

## 8. 验收标准 (AC)

1. `AC-SDS-01` 手动触发 `search` 后，结果区展示固定列顺序表格。
2. `AC-SDS-02` 行级“打开”按钮可成功打开对应视频。
3. `AC-SDS-03` 工作台 `openEverything` 可打开 Everything 并应用等价查询。
4. `AC-SDS-04` `search.scope=global` 与 `search.scope=root` 返回范围差异符合预期。
5. `AC-SDS-05` 刷新页面后 `search.scope` 恢复上次值；其他工具选项不要求持久化。
6. `AC-SDS-06` 开启持续调用后切换文件自动执行；命中历史成功/失败时静默跳过。
7. `AC-SDS-07` 手动重复执行同参数请求时仍生成新结果项。
8. `AC-SDS-08` `toleranceSize=-1` 时搜索结果不受大小容差过滤；`toleranceSize=0` 时仅命中与目标文件大小一致的结果。
9. `AC-SDS-09` `toleranceSize>0` 时，`search` 与 `openEverything` 均应用相同大小容差范围。
10. `AC-SDS-10` `/mnt/e/...` 场景首次探测报 `No such device` 时，可自动重挂载后重试成功。
11. `AC-SDS-11` 未配置 `SUDO_PASSWORD` 时返回明确报错，且不尝试读取 `sudo_password`。
12. `AC-SDS-12` 模拟重挂载命令卡住时，工具在预设超时内返回可读错误，不出现 `Gateway request timed out after 20s`。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. 默认 `esPath = tools/bin/everything/es.exe`。
2. 默认 `search.scope = global`。
3. 默认 `toleranceMs = 500`。
4. 默认 `toleranceSize = -1`（忽略大小容差）。
5. 默认 `maxResults = 200`。
6. 本专题不新增快捷键，`src/config/shortcuts.ts` 与 `docs/shortcuts.md` 不变。

## 10. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
