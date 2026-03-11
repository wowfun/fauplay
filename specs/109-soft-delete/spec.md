# 109 Soft Delete 软删除规范

## 1. 目的 (Purpose)

定义 Fauplay 回收站能力的统一契约，包含 `fs.softDelete` 与 `fs.restore` 两个工具、Toolbar 回收站入口、`.trash` 可见性控制，以及“回收站上下文下软删/还原互斥显示”语义。

## 2. 关键术语 (Terminology)

- 软删除（Soft Delete）
- 还原（Restore）
- 预演（Dry-run）
- 提交执行（Commit）
- 回收目录（Trash Directory）
- 逐项结果（Item-level Result）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 通过 MCP `stdio` Server 暴露 `fs.softDelete` 与 `fs.restore`。
2. `fs.softDelete` 与 `fs.restore` 均支持 `file/workspace` 双作用域。
3. `workspace` 作用域支持文件+目录混合批处理。
4. 支持 `confirm=false/true` 两阶段行为。
5. Toolbar 提供“回收站入口”（不承载还原动作）。
6. 回收站上下文插件可见性切换：显示 `fs.restore`、隐藏 `fs.softDelete`；非回收站相反。
7. `.trash` 在网格与地址栏子目录候选中默认隐藏。

范围外：

1. 清空回收站（empty trash）。
2. 基于元数据索引恢复原路径（本期仅按 `.trash/` 前缀推导）。
3. 调用系统回收站能力。

## 4. 用户可见行为契约 (User-visible Contract)

1. `tools/list` 可发现 `fs.softDelete` 与 `fs.restore`，二者 `annotations.mutation` 均为 `true`。
2. `confirm=false` 不得落盘，仅返回预演结果。
3. `confirm=true` 执行可执行项，逐项失败不得中断整批。
4. ActionRail 点击 `fs.softDelete` 默认直接执行提交（不弹二次确认）。
5. 预览插件栏在非回收站支持单文件软删除，`Delete` 快捷键触发提交执行。
6. 回收站上下文显示还原插件并隐藏软删除插件；非回收站显示软删除插件并隐藏还原插件。
7. `workspace` 作用域还原支持选中项批量还原（文件+目录）。
8. `file` 作用域还原支持当前预览文件还原。
9. 回收站上下文下 `Delete` 不触发任何操作（由于 `fs.softDelete` 隐藏）。
10. Toolbar 仅保留“回收站”按钮；当 `.trash` 不存在或为空时禁用。
11. Gateway 离线时，回收站可浏览，插件能力按现有降级不可用。

## 5. 工具契约 (Tool Contract)

### 5.1 `fs.softDelete`

输入参数：

- `rootPath: string`（必填）
- `relativePath?: string`（`file` 作用域）
- `relativePaths?: string[]`（`workspace` 作用域）
- `confirm?: boolean`（默认 `true`，`false`=dry-run，`true`=commit）

参数约束：

1. `relativePath` 与 `relativePaths` 必须二选一，且至少提供一项有效目标。
2. `relativePath`（`file`）仅支持文件；目录输入必须逐项失败。
3. `relativePaths`（`workspace`）支持文件与目录混合输入。
4. 当 `relativePaths` 同时包含祖先目录和其子路径时，仅保留祖先目录执行。
5. 所有目标必须在 `rootPath` 内，禁止越界路径。

目标路径与去重：

1. 目标候选路径固定为 `rootPath/.trash/<normalizedRelativePath>`。
2. 同名冲突按 Windows 风格 ` (1)/(2)` 后缀去重。
3. 冲突来源覆盖磁盘已存在与同批次预分配。

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

### 5.2 `fs.restore`

输入参数：

- `rootPath: string`（必填）
- `relativePath?: string`（`file` 作用域）
- `relativePaths?: string[]`（`workspace` 作用域）
- `confirm?: boolean`（默认 `true`，`false`=dry-run，`true`=commit）

参数约束：

1. `relativePath` 与 `relativePaths` 必须二选一，且至少提供一项有效目标。
2. `relativePath`（`file`）仅支持文件语义。
3. `relativePaths`（`workspace`）支持文件与目录混合输入。
4. 所有输入项必须位于 `.trash/` 下。
5. 当 `relativePaths` 同时包含祖先目录与子路径时，仅保留祖先目录执行。
6. 所有路径必须在 `rootPath` 内，禁止越界路径。

目标路径与去重：

1. 还原目标路径通过去掉 `.trash/` 前缀推导。
2. 若目标冲突，按 Windows 风格 ` (1)/(2)` 后缀去重。
3. 冲突来源覆盖磁盘已存在与同批次预分配。

返回结构：

- `dryRun: boolean`
- `total: number`
- `restored: number`
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

## 6. 安全与可见性约束 (Security & Visibility)

1. 所有路径参数必须做归一化与越界校验。
2. 目标路径必须确保落在 `rootPath` 内。
3. `.trash` 为系统保留目录，默认在网格与地址栏子目录候选中隐藏。
4. 默认隐藏不等于禁止访问；可通过直接路径访问 `.trash`。

## 7. 功能需求 (FR)

1. `FR-SD-01` `fs.softDelete` 必须声明 `scopes=["file","workspace"]`。
2. `FR-SD-02` `fs.restore` 必须声明 `scopes=["file","workspace"]`。
3. `FR-SD-03` `confirm=false` 必须仅预演不落盘。
4. `FR-SD-04` `confirm=true` 必须支持部分成功并返回逐项结果。
5. `FR-SD-05` 软删除目标固定为 `.trash` 并支持冲突自动序号去重。
6. `FR-SD-06` 还原目标由 `.trash/` 前缀剥离推导并支持冲突自动序号去重。
7. `FR-SD-07` ActionRail 默认点击软删除应直接执行提交语义。
8. `FR-SD-08` Toolbar 仅提供回收站入口，且在 `.trash` 缺失或为空时禁用。
9. `FR-SD-09` 回收站上下文必须隐藏 `fs.softDelete` 并显示 `fs.restore`。
10. `FR-SD-10` 非回收站上下文必须显示 `fs.softDelete` 并隐藏 `fs.restore`。
11. `FR-SD-11` 回收站上下文下 `Delete` 快捷键不得触发软删除。

## 8. 验收标准 (AC)

1. `AC-SD-01` `fs.softDelete confirm=false` 返回 `dryRun=true` 且文件系统无落盘移动。
2. `AC-SD-02` `fs.softDelete confirm=true` 后目标项（文件/目录）移动到 `.trash` 下。
3. `AC-SD-03` `fs.restore confirm=false` 返回 `dryRun=true` 且文件系统无落盘移动。
4. `AC-SD-04` `fs.restore confirm=true` 后目标项（文件/目录）从 `.trash` 移回推导路径。
5. `AC-SD-05` 软删除与还原在同名冲突时均自动分配 ` (1)`、` (2)` 后缀。
6. `AC-SD-06` 非 `.trash` 路径调用 `fs.restore` 时逐项失败并返回原因码。
7. `AC-SD-07` 祖先/子路径同时输入时仅执行祖先路径，不产生子路径噪声失败。
8. `AC-SD-08` 非回收站中显示软删除插件并隐藏还原插件（workspace + preview）。
9. `AC-SD-09` 回收站中显示还原插件并隐藏软删除插件（workspace + preview）。
10. `AC-SD-10` 回收站上下文下按 `Delete` 不触发操作。
11. `AC-SD-11` Toolbar 无“还原”按钮，仅保留“回收站”入口。
12. `AC-SD-12` `.trash` 不出现在网格和地址栏子目录候选中。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. `confirm` 默认值固定为 `true`。
2. 回收目录名称固定为 `.trash`。
3. `fs.restore` 与 `fs.softDelete` 共用同一 MCP server，不拆独立 server。
4. 不新增还原快捷键；回收站中 `Delete` 保持无动作。

## 10. 关联主题 (Related Specs)

- 基线：[`../000-foundation/spec.md`](../000-foundation/spec.md)
- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- UI 分区：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
