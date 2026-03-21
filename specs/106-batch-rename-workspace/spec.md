# 106 Batch Rename Workspace MCP 插件规范

## 1. 目的 (Purpose)

定义 Fauplay 的工作区级批量重命名工具契约，统一 `dry-run/confirm` 双阶段、掩码规则、查找替换与冲突去重语义。

## 2. 关键术语 (Terminology)

- 批量重命名（Batch Rename）
- 预演（Dry-run）
- 提交执行（Commit）
- 重命名掩码（Rename Mask）
- 自动序号去重（Auto Suffix Deduplication）
- 逐项结果（Item-level Result）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 通过 MCP `stdio` Server 暴露工作区工具 `fs.batchRename`。
2. 支持 `confirm=false/true` 两阶段行为。
3. 返回逐项结果并允许部分成功。
4. 支持掩码子集：`[N]`、`[P]`、`[G]`、`[C]`。
5. 支持普通文本/正则查找替换，允许替换为空字符串。
6. 同目录重名时自动追加 Windows 风格序号 ` (1)`、` (2)`。

范围外：

1. 文件内容编辑。
2. 目录递归重写。
3. 回收站/撤销历史持久化。

## 4. 用户可见行为契约 (User-visible Contract)

1. `tools/list` 可发现 `fs.batchRename`，其 `annotations.scopes` 必须为 `["workspace"]`。
2. `confirm=false` 时不得落盘，只返回预演结果。
3. `confirm=true` 时执行可执行项；外部并发写入导致的最终冲突逐项失败，不中断整批。
4. 结果必须包含汇总统计与逐项明细。
5. `confirm=true` 且工具调用成功后，客户端必须自动刷新当前目录视图，避免网格区继续显示旧文件名。
6. 自动刷新不得强制关闭已打开的侧栏预览；当原预览文件已重命名不可用时，客户端应回退到当前目录内可预览文件并保持面板状态。
7. `confirm=true` 且 `renamed>0` 时，Gateway 必须自动触发一次路径重绑（`batchRebindPaths`）；该后处理失败不得回滚重命名主流程。
8. 后处理失败时，返回结果应包含 `postProcessWarning` 用于提示“重命名成功但重绑失败”。

## 5. 工具契约 (Tool Contract)

### 5.1 `fs.batchRename`

输入参数：

- `rootPath: string`（必填）
- `relativePaths: string[]`（必填，至少 1 项）
- `nameMask?: string`（可选，默认 `[N]`）
- `findText?: string`（可选）
- `replaceText?: string`（可选，可为空字符串）
- `searchMode?: "plain" | "regex"`（可选，默认 `plain`）
- `regexFlags?: "g" | "gi" | "gm" | "gim" | "gu" | "giu" | "gs" | "gis"`（可选，仅 `regex` 生效；默认 `g`）
- `counterStart?: number | string`（可选，默认 `1`）
- `counterStep?: number | string`（可选，默认 `1`）
- `counterPad?: number | string`（可选，默认 `0`）
- `confirm?: boolean`（可选，默认 `false`）

掩码约束：

1. `[N]` 表示源文件名主体（不含扩展名）。
2. `[P]` 表示父目录名；当文件直接位于 `rootPath` 下时回退为 `basename(rootPath)`。
3. `[G]` 表示祖父目录名；层级不足时回退为空字符串。
4. `[C]` 表示计数器，按输入顺序递增，格式由 `counterStart/counterStep/counterPad` 控制。

规则约束：

1. 规则至少包含一项有效变换（`nameMask` 非默认值或 `findText` 非空）。
2. 规则默认仅作用于文件名主体（basename），不改扩展名。
3. 固定执行顺序：先掩码渲染，再查找替换，最后冲突去重。
4. 旧参数 `prefix/suffix` 已移除；若请求仍包含该参数必须返回 `MCP_INVALID_PARAMS`。
5. `relativePaths` 中目录项视为逐项失败（仅支持文件）。

冲突去重约束：

1. 去重范围为同目录。
2. 先尝试候选名 `basename.ext`，冲突时依次尝试 `basename (1).ext`、`basename (2).ext`。
3. 冲突来源同时覆盖：磁盘已存在文件、同批次内已分配目标名。
4. `dry-run` 与 `commit` 必须使用同一目标分配规则，保证可预期一致。

返回结构：

- `dryRun: boolean`
- `total: number`
- `renamed: number`
- `skipped: number`
- `failed: number`
- `items: Array<{
  relativePath: string;
  nextRelativePath?: string;
  ok: boolean;
  skipped?: boolean;
  reasonCode?: string;
  error?: string;
}>`

工具元数据约束：

1. `annotations.toolOptions` 应包含并透传：`nameMask`、`findText`、`replaceText`、`searchMode`、`regexFlags`、`counterStart`、`counterStep`、`counterPad`；其中 `regexFlags` 必须使用 `enum` 选项展示。
2. `annotations.toolActions` 应至少包含：
   - `dryRun`（`arguments.confirm=false`）
   - `commit`（`arguments.confirm=true`）
3. `annotations.mutation` 应声明为 `true`。
4. 推荐声明 `annotations.icon = "replace-all"` 作为批量重命名动作图标。

逐项错误码建议：

- `RENAME_NO_CHANGE`
- `RENAME_SOURCE_NOT_FOUND`
- `RENAME_UNSUPPORTED_KIND`
- `RENAME_INVALID_PATH`

## 6. 安全与路径约束 (Security & Path Constraints)

1. `relativePaths` 禁止 `..` 越界段。
2. 目标路径必须落在 `rootPath` 内。
3. 目标文件名非法时应逐项失败，不得隐式修正。
4. 不得覆盖已有文件；必须通过自动序号选择新文件名。

## 7. 功能需求 (FR)

1. `FR-BR-01` 工具必须声明 `scopes=["workspace"]`。
2. `FR-BR-02` `confirm=false` 必须只预演不落盘。
3. `FR-BR-03` `confirm=true` 必须支持部分成功并返回逐项结果。
4. `FR-BR-04` 同目录重名必须自动分配 Windows 风格序号，不中断整批。
5. `FR-BR-05` 客户端应将该工具落位在 B1 工作区插件三段式实例中。
6. `FR-BR-06` `confirm=true` 成功后，客户端应触发当前目录刷新。
7. `FR-BR-07` 刷新后若存在可预览文件，客户端应保持侧栏预览面板打开状态。
8. `FR-BR-08` 工具必须支持 `searchMode=plain|regex`，且 `replaceText` 允许为空字符串。
9. `FR-BR-09` 工具必须支持 `[N]/[P]/[G]/[C]` 掩码子集。
10. `FR-BR-10` 请求包含 `prefix/suffix` 时必须返回 `MCP_INVALID_PARAMS`。
11. `FR-BR-11` `confirm=true && renamed>0` 时，系统必须自动执行批量路径重绑（逐项映射）。
12. `FR-BR-12` 路径重绑失败不得影响已成功落盘的重命名结果。

## 8. 验收标准 (AC)

1. `AC-BR-01` 对同一输入执行 `confirm=false` 后，文件系统无任何重命名落盘。
2. `AC-BR-02` 同目录目标名冲突时，结果自动回退到 ` (1)`、` (2)` 等可用名称。
3. `AC-BR-03` 返回结果中 `total/renamed/skipped/failed` 与 `items` 一致。
4. `AC-BR-04` 输入包含目录项时，目录项被标记失败且其他文件项仍可执行。
5. `AC-BR-05` 非法路径输入返回 `MCP_INVALID_PARAMS` 或逐项 `RENAME_INVALID_PATH`。
6. `AC-BR-06` 执行成功后，网格区自动展示重命名后的最新文件名。
7. `AC-BR-07` 执行成功触发刷新后，若目录内仍有可预览文件，侧栏预览保持打开且切换到有效文件。
8. `AC-BR-08` `searchMode=regex` 且 `findText` 非法正则时返回 `MCP_INVALID_PARAMS`。
9. `AC-BR-09` 请求包含 `prefix/suffix` 时返回 `MCP_INVALID_PARAMS`。
10. `AC-BR-10` `[P]/[G]` 在层级不足时按契约回退（`[P]=rootName`、`[G]=""`）。
11. `AC-BR-11` 批量改名成功后，`file` 表中对应 `relativePath` 同步更新，且 `fileId` 保持稳定。
12. `AC-BR-12` 人工构造重绑失败时，批量改名结果仍成功返回，并带 `postProcessWarning`。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. `confirm` 默认值为 `false`。
2. `nameMask` 默认值为 `[N]`。
3. `searchMode` 默认值为 `plain`；`regexFlags` 默认值为 `g`，可选值为 `g/gi/gm/gim/gu/giu/gs/gis`。
4. `counterStart/counterStep/counterPad` 默认值分别为 `1/1/0`。
5. 工作区默认目标集合策略：优先选中集；无选中时使用当前目录可见文件列表（仅文件）。
6. 工作区结果队列分桶键默认为目录路径。
7. 推荐图标默认值：`fs.batchRename -> replace-all`。

## 10. 关联主题 (Related Specs)

- 架构边界：[`../001-architecture/spec.md`](../001-architecture/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 分区：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
