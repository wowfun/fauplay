# 122 Unified Trash Route 统一回收站虚拟路由规范

## 1. 目的 (Purpose)

定义 Fauplay 的统一回收站（Unified Trash）契约，确保：

1. 回收站入口统一收敛为虚拟工作区路由 `@trash`，而不是直接暴露某个真实目录。
2. 结果投射标签上下文下的删除落点切换为全局回收区（Global Recycle Pool），不再复用旧 `.trash` 路径模型。
3. 普通目录浏览下的软删除/还原继续保留 `rootPath/.trash` 语义，不做破坏性迁移。
4. 统一回收站可混排展示“当前 Root 的旧 `.trash`”与“全局回收区”两类来源，并按统一时间口径排序。

## 2. 关键术语 (Terminology)

- 统一回收站（Unified Trash）
- 虚拟路由（Virtual Route）
- 全局回收区（Global Recycle Pool）
- 旧 Root 回收目录（Legacy Root Trash）
- 结果投射标签上下文（Projection Tab Context）
- 来源类型（Source Type）
- 原始路径（Original Path）
- 托管文件池（Managed File Pool）
- 恢复冲突自动改名（Restore Auto Rename）

术语值映射：

1. 回收站虚拟路由固定为：`@trash`。
2. 来源类型固定为：`root_trash | global_recycle`。
3. 默认排序固定为：`deletedAt DESC`，`sourceType ASC`。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `@trash` 路由的地址栏、历史与工作区展示语义。
2. 当前 Root `.trash` 与全局回收区的聚合浏览。
3. 结果投射标签删除进入全局回收区的落点语义。
4. 全局回收区的列出、移动、恢复接口契约。
5. 恢复冲突自动重命名语义。

范围外：

1. 清空回收站（Empty Trash）。
2. 追溯聚合所有历史 Root 的 `.trash` 目录。
3. 将普通目录浏览删除链路整体迁移到全局回收区。
4. 收藏 `@trash`、把 `@trash` 当作真实文件系统目录处理。

## 4. 用户可见行为契约 (User-visible Contract)

1. 顶部工具栏“回收站”入口打开的目标必须是虚拟路由 `@trash`。
2. `@trash` 必须复用工作区主布局，不得伪装成真实目录，也不得要求存在实际 `@trash/` 路径。
3. `@trash` 必须参与最近路径历史；但不得允许加入收藏。
4. `@trash` 列表默认混排以下两类来源：
   - 当前 Root 的旧 `.trash`
   - 全局回收区
5. 统一回收站列表默认排序固定为：
   - `deletedAt DESC`
   - `sourceType ASC`
6. 列表项必须展示来源类型徽标，便于用户区分旧 `.trash` 与全局回收区。
7. 在结果投射标签中触发删除时，目标必须进入全局回收区，而不是当前 Root 的 `.trash`。
8. 普通目录浏览下的 `fs.softDelete / fs.restore` 语义继续保持 `109-soft-delete` 现状，不被本专题覆盖。
9. 恢复回原路径时若发生命名冲突，系统必须按 Windows 风格 ` (1)/(2)` 自动改名，不弹阻塞确认。

## 5. 路由与列表语义 (Route & Listing Semantics)

1. `@trash` 是特殊虚拟路径，不参与目录存在性校验，也不走普通相对路径解析。
2. 地址栏、最近路径与补全命中 `@trash` 时，系统必须直接切换到统一回收站上下文。
3. `@trash` 默认只聚合“当前 Root 的旧 `.trash`”，不回溯其他已打开过 Root 的 `.trash`。
4. 对旧 `.trash` 项，若不存在独立删除时间元数据，列表层必须以回收目录内条目的文件系统时间作为 `deletedAt` 兼容近似值返回。
5. 对全局回收区项，`deletedAt` 必须来自受控元数据记录，而不是运行时推导。

## 6. 数据与存储契约 (Data & Storage Contract)

1. 全局回收区存储固定为 `~/.fauplay/global/` 下的受控托管文件池与元数据记录。
2. 全局回收区必须至少记录：
   - `recycleId`
   - `storedAbsolutePath`
   - `originalAbsolutePath`
   - `originalRootPath?`
   - `name`
   - `size`
   - `mimeType?`
   - `deletedAt`
   - `createdAt`
   - `updatedAt`
3. 全局回收区中的文件物理位置不得继续依赖原 Root 的 `.trash` 目录结构。
4. 从结果投射标签进入全局回收区的删除动作必须保留可恢复原路径所需的最小元数据。

## 7. Gateway HTTP 接口契约 (HTTP Contract)

### 7.1 `POST /v1/recycle/items/move`

输入：

- `absolutePaths: string[]`
- `reason?: string`

输出至少包含：

- `ok`
- `total`
- `moved`
- `failed`
- `items[]`

其中每个 `items[]` 至少包含：

- `absolutePath`
- `ok`
- `recycleId?`
- `deletedAt?`
- `reasonCode?`
- `error?`

### 7.2 `POST /v1/recycle/items/list`

输入：

- `rootPath?: string`
- `includeRootTrash?: boolean`
- `includeGlobalRecycle?: boolean`

输出至少包含：

- `ok`
- `items[]`
- `ordering`

其中：

1. `ordering` 固定返回：
   - `mode: 'mixed'`
   - `keys: ['deletedAt:desc', 'sourceType:asc']`
2. `items[]` 至少包含：
   - `sourceType`
   - `displayPath`
   - `name`
   - `absolutePath`
   - `deletedAt`
   - `originalAbsolutePath?`
   - `recycleId?`

### 7.3 `POST /v1/recycle/items/restore`

输入：

- `items: Array<{ sourceType: 'root_trash' | 'global_recycle'; recycleId?: string; absolutePath?: string }>`

输出至少包含：

- `ok`
- `total`
- `restored`
- `failed`
- `items[]`

其中每个 `items[]` 至少包含：

- `sourceType`
- `ok`
- `nextAbsolutePath?`
- `reasonCode?`
- `error?`

## 8. 功能需求 (FR)

1. `FR-UTR-01` 系统必须把统一回收站入口收敛为虚拟路由 `@trash`。
2. `FR-UTR-02` `@trash` 必须参与最近路径历史，但不得允许加入收藏。
3. `FR-UTR-03` `@trash` 默认必须混排“当前 Root 的旧 `.trash` + 全局回收区”两类来源。
4. `FR-UTR-04` 统一回收站默认排序必须为 `deletedAt DESC`、`sourceType ASC`。
5. `FR-UTR-05` 结果投射标签删除必须进入全局回收区，而不是旧 `.trash`。
6. `FR-UTR-06` 普通目录浏览下的删除/还原语义必须继续保持 `109-soft-delete` 的 `.trash` 模型。
7. `FR-UTR-07` 全局回收区必须采用“托管文件池 + 元数据记录”模型存储。
8. `FR-UTR-08` 恢复冲突时系统必须自动生成 ` (1)/(2)` 后缀目标名。
9. `FR-UTR-09` 旧 `.trash` 聚合范围在 v1 必须限制为当前 Root，不得隐式扩展到全部历史 Root。

## 9. 验收标准 (AC)

1. `AC-UTR-01` 点击顶部回收站入口后，地址栏进入 `@trash` 上下文，工作区展示统一回收站列表。
2. `AC-UTR-02` `@trash` 会写入最近路径历史，并可从历史重新打开。
3. `AC-UTR-03` `@trash` 不会出现在收藏列表，也无法被加入收藏。
4. `AC-UTR-04` 统一回收站列表可同时看到当前 Root `.trash` 项与全局回收区项，且默认按 `deletedAt DESC` 混排。
5. `AC-UTR-05` 在结果投射标签中删除跨 Root 文件后，该文件进入全局回收区而不是任意 Root 的 `.trash`。
6. `AC-UTR-06` 在普通目录浏览模式下执行软删除后，文件仍进入当前 Root 的 `.trash`，不进入全局回收区。
7. `AC-UTR-07` 从统一回收站恢复文件时，若原路径已存在同名文件，系统自动恢复为 `name (1).ext` 等可用目标名。
8. `AC-UTR-08` 关闭并重新打开应用后，全局回收区项仍可通过元数据记录列出与恢复。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 回收站虚拟路由名称固定为 `@trash`。
2. 默认聚合范围固定为“当前 Root 的旧 `.trash` + 全局回收区”。
3. 默认排序固定为 `deletedAt DESC`，`sourceType ASC`。
4. `@trash` 参与历史但不参与收藏的约束不得被主题内其他入口绕过。
5. 本专题不新增快捷键。

## 11. 关联主题 (Related Specs)

- 地址栏导航：[`../102-address-bar-navigation/spec.md`](../102-address-bar-navigation/spec.md)
- 软删除：[`../109-soft-delete/spec.md`](../109-soft-delete/spec.md)
- 本地文件浏览器：[`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)
