# 109 Soft Delete 软删除规范

## 1. 目的 (Purpose)

定义 Fauplay 目录浏览上下文下的软删除能力契约，包含 `fs.softDelete` 与 `fs.restore` 两个工具、Toolbar 回收站入口、`.trash` 可见性控制，以及“回收站上下文下软删/还原互斥显示”语义；结果模式与统一回收站的跨 Root 回收行为由 `122-unified-trash-route` 另行定义。

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
8. `.trash` 目标语义只作用于普通目录浏览上下文。

范围外：

1. 清空回收站（empty trash）。
2. 基于元数据索引恢复原路径（本期仅按 `.trash/` 前缀推导）。
3. 调用系统回收站能力。
4. 结果模式删除进入全局回收区的行为（归属 `122-unified-trash-route`）。
5. 统一回收站中 `global_recycle` 项的恢复参数模型（归属 `122-unified-trash-route`）。

## 4. 用户可见行为契约 (User-visible Contract)

1. `tools/list` 可发现 `fs.softDelete` 与 `fs.restore`，二者 `annotations.mutation` 均为 `true`。
2. `confirm=false` 不得落盘，仅返回预演结果。
3. `confirm=true` 执行可执行项，逐项失败不得中断整批。
4. ActionRail 点击 `fs.softDelete` 默认直接执行提交（不弹二次确认）。
5. 预览插件栏在非回收站支持单文件软删除，`Delete` 快捷键触发提交执行。
6. 回收站上下文显示还原插件并隐藏软删除插件；非回收站显示软删除插件并隐藏还原插件。
7. 非回收站上下文下，`workspace` 与 `preview` 两处 `PluginActionRail` 中 `fs.softDelete` 按钮必须固定显示在最后一个位置。
8. `workspace` 作用域还原支持选中项批量还原（文件+目录）。
9. `file` 作用域还原支持当前预览文件还原。
10. 回收站上下文下 `Delete` 不触发任何操作（由于 `fs.softDelete` 隐藏）。
11. Toolbar 仅保留“回收站”按钮；其最终入口与可用性由 `122-unified-trash-route` 的统一回收站契约定义，本专题不再以当前 Root `.trash` 是否存在作为唯一启用条件。
12. Gateway 离线时，回收站可浏览，插件能力按现有降级不可用。
13. 预览作用域 `fs.softDelete confirm=true` 成功删除“当前预览文件”后，系统必须自动续选下一个预览目标，不得回退到目录首项。
14. 自动续选规则：媒体文件按当前预览遍历模式（顺序/随机）取下一项；非媒体文件按当前列表顺序取下一项，末项回绕到首项。
15. 当删除动作发生在结果模式投射列表上时，不得沿用本专题的 `.trash` 目标语义；该场景必须按 `122-unified-trash-route` 的统一回收站契约处理。

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
8. `FR-SD-08` Toolbar 仅提供回收站入口；入口路由与启用条件由 `122-unified-trash-route` 的统一回收站契约统一定义。
9. `FR-SD-09` 回收站上下文必须隐藏 `fs.softDelete` 并显示 `fs.restore`。
10. `FR-SD-10` 非回收站上下文必须显示 `fs.softDelete` 并隐藏 `fs.restore`。
11. `FR-SD-11` 回收站上下文下 `Delete` 快捷键不得触发软删除。
12. `FR-SD-12` 非回收站上下文下，`workspace` 与 `preview` 的 ActionRail 按钮顺序必须满足 `fs.softDelete` 固定置尾。
13. `FR-SD-13` 预览作用域软删除提交成功且删除目标为当前预览文件时，系统必须在刷新前完成自动续选。
14. `FR-SD-14` 自动续选时，媒体文件必须复用 `100-preview-playback` 的当前遍历策略；非媒体文件必须按当前列表顺序前进并在末项回绕到首项。
15. `FR-SD-15` 本专题的 `.trash` 目标语义必须只适用于普通目录浏览与直接 `.trash` 上下文，不覆盖结果模式删除。
16. `FR-SD-16` 本专题的 `fs.restore` 参数模型必须只覆盖 `.trash` 路径，不覆盖统一回收站中的 `global_recycle` 项恢复。

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
11. `AC-SD-11` Toolbar 无“还原”按钮，仅保留“回收站”入口；其最终打开目标由 `122` 定义。
12. `AC-SD-12` `.trash` 不出现在网格和地址栏子目录候选中。
13. `AC-SD-13` 非回收站上下文中，不论网关返回工具顺序如何，`workspace` 与 `preview` ActionRail 内 `fs.softDelete` 均显示在最后一个按钮位。
14. `AC-SD-14` 预览中删除当前媒体文件后，顺序/随机模式均按对应“下一项”续播，不回退到目录首项。
15. `AC-SD-15` 预览中删除当前非媒体文件后，按当前列表顺序跳到下一文件；删除末项时回绕到首项。
16. `AC-SD-16` 结果模式下删除跨 Root 文件时，不会尝试把文件移动到当前 `rootPath/.trash`。
17. `AC-SD-17` 当统一回收站中存在 `global_recycle` 项时，前端不会尝试用 `fs.restore(rootPath + relativePath)` 直接恢复该类项。

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
- 统一回收站虚拟路由：[`../122-unified-trash-route/spec.md`](../122-unified-trash-route/spec.md)
