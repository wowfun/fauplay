# 109 Soft Delete Plugin 软删除插件规范

## 1. 目的 (Purpose)

定义 Fauplay 软删除工具 `fs.softDelete` 的统一契约，覆盖 `file/workspace` 双作用域、`dry-run/commit` 双阶段、`.trash` 落盘策略与预览快捷键触发语义。

## 2. 关键术语 (Terminology)

- 软删除（Soft Delete）
- 预演（Dry-run）
- 提交执行（Commit）
- 回收目录（Trash Directory）
- 逐项结果（Item-level Result）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 通过 MCP `stdio` Server 暴露 `fs.softDelete`。
2. 单工具覆盖 `file`（单文件）与 `workspace`（批量）两种作用域。
3. 支持 `confirm=false/true` 两阶段行为。
4. 目标项（文件/目录）移动到 `rootPath/.trash/<relativePath>`，并支持同目录冲突自动序号去重。
5. 预览快捷键 `Delete` 触发当前预览文件软删除。
6. `workspace` 软删除允许“选中项集合（文件+目录）”触发。
7. `.trash` 在网格与地址栏子目录候选中默认隐藏。

范围外：

1. 恢复文件（restore）与清空回收目录（empty trash）。
2. 调用系统回收站能力。
3. 预览作用域（`relativePath`）的目录软删除能力。

## 4. 用户可见行为契约 (User-visible Contract)

1. `tools/list` 可发现 `fs.softDelete`，`annotations.scopes` 必须为 `["file", "workspace"]`，`annotations.mutation` 必须为 `true`。
2. `confirm=false` 时不得落盘，只返回预演结果。
3. `confirm=true` 时执行可执行项，逐项失败不得中断整批。
4. ActionRail 点击 `fs.softDelete` 默认直接执行提交（不弹二次确认）。
5. 预览插件栏支持单文件软删除；工作区插件栏支持批量软删除。
6. 工作区无选中项时，`fs.softDelete` 必须禁用，不得默认删除当前目录全部可见项。
7. 执行成功后客户端必须刷新当前目录视图；若原预览文件不可用，应自动回退到可预览文件并保持预览面板状态。
8. `Delete` 快捷键仅在预览文件上下文生效，输入态（Input/Textarea/Select/ContentEditable）不得触发。
9. `.trash` 默认不显示在网格与地址栏子目录候选中。

## 5. 工具契约 (Tool Contract)

### 5.1 `fs.softDelete`

输入参数：

- `rootPath: string`（必填）
- `relativePath?: string`（`file` 作用域）
- `relativePaths?: string[]`（`workspace` 作用域）
- `confirm?: boolean`（默认 `true`，`false`=dry-run，`true`=commit）

参数约束：

1. `relativePath` 与 `relativePaths` 必须二选一，且至少提供一项有效目标。
2. `relativePaths` 为空数组或包含非法值时返回 `MCP_INVALID_PARAMS`。
3. 请求目标必须位于 `rootPath` 内，禁止 `..` 越界。
4. `relativePath`（预览）输入目录项时必须逐项失败（仅支持单文件软删除）。
5. `relativePaths`（工作区）输入允许文件与目录混合，且目录应按“整体移动目录”语义处理。
6. 当 `relativePaths` 同时包含祖先目录和其子路径时，必须仅保留祖先目录执行，避免子路径噪声失败。

路径与去重约束：

1. 目标候选路径固定为 `rootPath/.trash/<normalizedRelativePath>`。
2. 若候选路径冲突，按 Windows 风格追加序号：`name.ext` -> `name (1).ext` -> `name (2).ext`。
3. 冲突来源同时覆盖：磁盘已存在路径、同批次内已预分配路径。
4. `dry-run` 与 `commit` 使用同一分配规则，保证可预期一致。

返回结构：

- `dryRun: boolean`
- `total: number`
- `moved: number`
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

1. `annotations.toolActions` 至少包含：
   - `dryRun`（`arguments.confirm=false`）
   - `commit`（`arguments.confirm=true`）
2. `annotations.icon` 推荐使用 `trash-2`。

逐项错误码建议：

- `SOFT_DELETE_SOURCE_NOT_FOUND`
- `SOFT_DELETE_UNSUPPORTED_KIND`
- `SOFT_DELETE_INVALID_PATH`
- `SOFT_DELETE_TARGET_EXISTS`

## 6. 安全与可见性约束 (Security & Visibility)

1. 所有路径参数必须做归一化与越界校验。
2. 目标路径必须确保落在 `rootPath` 内。
3. `.trash` 属于系统保留目录，默认在网格与地址栏子目录候选中隐藏。
4. 默认隐藏不等于禁止访问；手动输入路径仍可访问 `.trash`。

## 7. 功能需求 (FR)

1. `FR-SD-01` 工具必须声明 `scopes=["file","workspace"]`。
2. `FR-SD-02` `confirm=false` 必须仅预演不落盘。
3. `FR-SD-03` `confirm=true` 必须支持部分成功并返回逐项结果。
4. `FR-SD-04` 软删除目标固定为 `.trash` 并支持冲突自动序号去重。
5. `FR-SD-05` ActionRail 默认点击应直接执行提交语义。
6. `FR-SD-06` `workspace` 无选中项时，软删除工具必须禁用。
7. `FR-SD-07` mutation 提交成功后，客户端必须刷新当前目录并保持预览可用性回退语义。
8. `FR-SD-08` 预览快捷键 `Delete` 必须触发当前预览文件软删除。
9. `FR-SD-09` `.trash` 必须在目录读取与地址栏子目录枚举中默认隐藏。
10. `FR-SD-10` `workspace` 作用域必须支持目录软删除（目录整体移动到 `.trash`）。
11. `FR-SD-11` `relativePaths` 同时包含祖先/子路径时，必须仅执行祖先目录。

## 8. 验收标准 (AC)

1. `AC-SD-01` `confirm=false` 返回 `dryRun=true` 且文件系统无移动落盘。
2. `AC-SD-02` `confirm=true` 后目标项（文件/目录）移动到 `.trash` 下，目录结构保持与原相对路径一致。
3. `AC-SD-03` 同名冲突时目标自动分配 ` (1)`、` (2)` 后缀。
4. `AC-SD-04` `relativePath` 输入目录项时返回逐项失败（`SOFT_DELETE_UNSUPPORTED_KIND`）。
5. `AC-SD-05` `relativePaths` 输入包含目录项时，目录项与文件项均可执行并计入 `moved`。
6. `AC-SD-06` `relativePaths` 同时包含祖先目录与子路径时，仅祖先目录执行，子路径不产生误报失败。
7. `AC-SD-07` 路径越界请求返回 `MCP_INVALID_PARAMS` 或逐项 `SOFT_DELETE_INVALID_PATH`。
8. `AC-SD-08` 预览插件执行软删除后，预览不被强制关闭，且能回退到可用文件。
9. `AC-SD-09` 工作区无选中项时软删除工具为禁用态。
10. `AC-SD-10` `Delete` 仅在预览上下文生效，输入焦点场景不触发。
11. `AC-SD-11` `.trash` 不出现在网格和地址栏子目录候选中。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. `confirm` 默认值固定为 `true`。
2. 回收目录名称固定为 `.trash`。
3. 单工具双作用域为本专题固定形态，不拆分为独立 `file/batch` 工具。

## 10. 关联主题 (Related Specs)

- 基线：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 分区：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
