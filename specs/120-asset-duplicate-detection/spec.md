# 120 Asset Duplicate Detection 资产级重复文件检测规范

## 1. 目的 (Purpose)

定义 Fauplay 基于现有 `asset` 身份的重复文件检测契约，确保：

1. 重复文件（Duplicate File）的判断继续以统一 `assetId` 为准，不引入新的 v1 真值流。
2. 预览区与工作区都可发起“按资产查重”，但两者的索引策略与进入方式明确区分。
3. 预览区允许对“当前文件”执行隐式单文件补索引后再查重；工作区不自动补索引。
4. 手动索引能力只对工作区开放，且仅对“缺失索引或索引过期”的文件生效。

## 2. 关键术语 (Terminology)

- 重复文件（Duplicate File）
- 种子文件（Seed File）
- 重复组（Duplicate Group）
- 查询作用域（Search Scope）
- 缺失索引（Missing Index）
- 过期索引（Stale Index）
- 显式索引（Explicit Indexing）
- 当前特征二次校验（Current-feature Secondary Validation）

术语值映射：

1. 查询作用域固定为：`global | root`。
2. 结果模式固定为：`file | workspace`。
3. 索引状态固定为：`fresh | missing | stale`。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `data.findDuplicateFiles` 的 `file/workspace` 双作用域契约。
2. 预览区当前文件的隐式单文件补索引语义。
3. 工作区“已选优先，否则当前可见”的种子集合语义。
4. 工作区专用 `local.data.ensureFileEntries` 显式索引动作。
5. 重复结果的分组结构、覆盖率统计与结果投射入口。

范围外：

1. `sha256` 精确校验工作流。
2. 全库后台自动建档或周期性重扫。
3. 工作区查重时的隐式自动补索引。
4. 统一结果模式与跨 Root 预览主链路细节（归属 `121-projected-file-grid`）。
5. 统一回收站与结果模式删除落点（归属 `122-unified-trash-route`）。

## 4. 核心语义 (Core Semantics)

1. v1 的“重复文件”固定等同于“命中同一 `assetId` 的多个 `file` 记录”。
2. 当前 `assetId` 身份继续沿用 `size + fingerprint + fpMethod` 约束；`sha256` 不参与本专题主身份。
3. 查询作用域 `global/root` 只决定“去哪里找重复副本”，不改变工作区种子集合来源。
4. 工作区种子集合固定为：
   - 存在已选文件时，仅处理已选文件。
   - 无已选文件时，处理当前可见文件。
   - 目录永远不作为查重或索引目标。
5. 索引状态定义固定为：
   - `fresh`：存在 `file` 记录，且 `file.fileMtimeMs` 与当前文件一致。
   - `missing`：不存在对应 `file` 记录。
   - `stale`：存在 `file` 记录，但 `file.fileMtimeMs` 与当前文件不一致。

## 5. 用户可见行为契约 (User-visible Contract)

### 5.1 预览区查重

1. `file` 作用域下，`data.findDuplicateFiles` 必须以“当前预览文件”为唯一种子。
2. 若当前文件为 `missing` 或 `stale`，Gateway 必须先隐式重建该单文件索引，再执行查重。
3. 预览区返回结果必须包含“当前文件本身 + 重复副本”，不得只返回“其他副本”。
4. 预览区投射结果排序固定为：
   - 当前文件固定第一位。
   - 其余副本按“当前 Root 优先”排序。
   - 同桶内按 `lastModifiedMs DESC`，再按 `displayPath ASC` 稳定排序。
5. 预览区结果投射入口固定为 `projection.entry='auto'`。

### 5.2 工作区查重

1. `workspace` 作用域下，`data.findDuplicateFiles` 必须基于当前目标集合批量查重。
2. 工作区查重不得隐式补索引；`missing` 与 `stale` 种子必须显式计入结果覆盖率，而不是静默忽略。
3. 对 `missing` 种子，不得伪造旧命中；结果中必须以“需索引”状态可见返回。
4. 对 `stale` 种子，允许先以旧索引召回候选，但最终保留结果前必须对“种子 + 命中项”双方执行当前特征二次校验。
5. 多个种子若最终落入同一 `assetId`，工作区结果中必须只产生一个重复组（Duplicate Group）。
6. 工作区结果投射入口固定为 `projection.entry='manual'`。

### 5.3 工作区显式索引

1. 手动索引能力只对工作区开放，不得在预览区暴露。
2. 工作区显式索引动作文案固定为：`索引当前目标文件`。
3. 该动作的目标集合固定复用工作区种子规则：已选优先，否则当前可见。
4. 该动作只允许处理 `missing | stale` 文件；`fresh` 文件必须返回 `skipped`，不得重复建档。

## 6. 工具与接口契约 (Tool & API Contract)

### 6.1 `data.findDuplicateFiles`

1. 工具名固定为：`data.findDuplicateFiles`。
2. `annotations.mutation` 固定为：`false`。
3. `annotations.scopes` 固定为：`["file", "workspace"]`。
4. 工具工作台可声明查询作用域选项：
   - `key='search.scope'`
   - `type='enum'`
   - `defaultValue='global'`
   - `sendToTool=true`
   - `argumentKey='searchScope'`

输入参数：

- `rootPath: string`
- `relativePath?: string`
- `relativePaths?: string[]`
- `searchScope?: 'global' | 'root'`

参数约束：

1. `relativePath` 与 `relativePaths` 必须二选一。
2. `file` 作用域只接受 `relativePath`。
3. `workspace` 作用域只接受 `relativePaths`。
4. `searchScope` 默认值固定为 `global`。

### 6.2 Gateway HTTP

1. `POST /v1/files/duplicates/query`
2. 输入：
   - `rootPath`
   - `relativePath?`
   - `relativePaths?`
   - `searchScope`
3. 语义：
   - `file` 模式：若当前文件 `missing/stale`，先隐式重建该单文件索引，再执行查询。
   - `workspace` 模式：不自动索引；`missing/stale` 种子进入覆盖率统计；`stale` 命中需做当前特征二次校验。

## 7. 结果结构契约 (Result Contract)

### 7.1 文件模式

返回结构至少包含：

- `ok`
- `mode: 'file'`
- `searchScope`
- `target`
- `duplicateCount`
- `duplicates[]`
- `indexing`
- `projection`

其中：

1. `target` 必须表示当前文件，且需带 `isCurrentFile=true`。
2. `indexing` 至少包含：
   - `strategy: 'implicit_current_file'`
   - `targetStatus: 'fresh' | 'reindexed'`
3. `projection` 必须符合 `121-projected-file-grid` 的通用投射契约。

### 7.2 工作区模式

返回结构至少包含：

- `ok`
- `mode: 'workspace'`
- `searchScope`
- `seedCount`
- `indexedSeedCount`
- `needsIndexingCount`
- `skippedSeeds[]`
- `duplicateGroupCount`
- `groups[]`
- `projection`

其中：

1. `skippedSeeds[]` 至少包含：
   - `relativePath`
   - `reasonCode`
2. `reasonCode` 首期至少支持：
   - `MISSING_INDEX`
   - `STALE_INDEX`
   - `NOT_FILE`
3. `groups[]` 至少包含：
   - `groupId`
   - `assetId`
   - `seedRelativePaths[]`
   - `items[]`
4. 工作区 `projection.ordering.mode` 固定为 `group_contiguous`。

## 8. 功能需求 (FR)

1. `FR-ADD-01` 系统必须以同一 `assetId` 作为重复文件唯一判断依据。
2. `FR-ADD-02` 系统必须暴露只读工具 `data.findDuplicateFiles`，且其作用域固定为 `file/workspace`。
3. `FR-ADD-03` 预览区查重必须在当前文件 `missing/stale` 时先隐式重建该单文件索引。
4. `FR-ADD-04` 工作区查重不得自动重建种子索引。
5. `FR-ADD-05` 工作区查重种子集合必须遵循“已选优先，否则当前可见”。
6. `FR-ADD-06` 工作区结果必须显式返回覆盖率信息，不得静默丢弃 `missing/stale` 种子。
7. `FR-ADD-07` 对 `stale` 种子命中的候选项，系统必须执行当前特征二次校验后再保留结果。
8. `FR-ADD-08` 工作区显式索引能力必须只对 `missing/stale` 文件生效。
9. `FR-ADD-09` 预览区不得暴露手动索引入口。
10. `FR-ADD-10` 文件模式结果必须包含当前文件自身，且当前文件固定排序第一。
11. `FR-ADD-11` 工作区结果必须按 `assetId` 聚合重复组，并保证同一 `assetId` 只返回一个组。
12. `FR-ADD-12` 查询作用域默认值必须为 `global`，并支持显式切换到 `root`。

## 9. 验收标准 (AC)

1. `AC-ADD-01` 预览当前文件已存在新鲜索引时，执行查重可直接返回“当前文件 + 其重复副本”。
2. `AC-ADD-02` 预览当前文件无索引时，执行查重会先补建该文件索引，再返回重复结果。
3. `AC-ADD-03` 预览当前文件索引过期时，执行查重会先刷新该文件索引，再返回重复结果。
4. `AC-ADD-04` 工作区有选中文件时，只基于选中文件形成种子；无选中时，基于当前可见文件形成种子。
5. `AC-ADD-05` 工作区存在 `missing` 种子时，结果会增加 `needsIndexingCount` 与逐项 `skippedSeeds`，而不是静默忽略该文件。
6. `AC-ADD-06` 工作区存在 `stale` 种子且旧索引命中已失效时，二次校验后该失效命中不会继续出现在最终结果中。
7. `AC-ADD-07` 多个工作区种子命中同一 `assetId` 时，最终只返回一个重复组。
8. `AC-ADD-08` 执行工作区 `索引当前目标文件` 时，仅 `missing/stale` 文件被实际建档；已是新鲜索引的文件返回 `skipped`。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 查询作用域默认值固定为 `global`。
2. 工作区显式索引动作名称固定为 `索引当前目标文件`。
3. 预览区隐式索引只允许作用于“当前文件”这一单文件目标。
4. `data.findDuplicateFiles` 虽可能触发预览区单文件补索引，但对外工具语义仍保持只读查重。
5. 本专题不新增快捷键。

## 11. 关联主题 (Related Specs)

- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 本地文件浏览器：[`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 结果投射文件网格：[`../121-projected-file-grid/spec.md`](../121-projected-file-grid/spec.md)
