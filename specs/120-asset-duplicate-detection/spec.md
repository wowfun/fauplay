# 120 Asset Duplicate Detection 资产级重复文件检测规范

## 1. 目的 (Purpose)

定义 Fauplay 基于现有 `asset` 身份的重复文件检测契约，确保：

1. 重复文件（Duplicate File）的判断继续以统一 `assetId` 为准，不引入新的 v1 真值流。
2. 预览区与工作区都可发起“按资产查重”，但两者的索引策略与进入方式明确区分。
3. 预览区允许对“当前文件”执行隐式单文件补索引后再查重；工作区不自动补索引。
4. 手动索引能力只对工作区开放，且仅对“缺失索引或索引过期”的文件生效。
5. 预览区重复文件工具支持标准持续调用能力，用于在切换预览文件后自动执行查重。

## 2. 关键术语 (Terminology)

- 重复文件（Duplicate File）
- 种子文件（Seed File）
- 重复组（Duplicate Group）
- 查询作用域（Search Scope）
- 返回模式（Response Mode）
- 缺失索引（Missing Index）
- 过期索引（Stale Index）
- 显式索引（Explicit Indexing）
- 当前特征二次校验（Current-feature Secondary Validation）

术语值映射：

1. 查询作用域固定为：`global | root`。
2. 返回模式固定为：`file | workspace`。
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
4. 统一底部结果面板与跨 Root 预览主链路细节（归属 `111-local-file-browser`）。
5. 统一回收站与投射结果标签删除落点（归属 `122-unified-trash-route`）。

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
5. 仅当 `duplicateCount > 0` 时，预览区才允许返回结果投射，且其入口固定为 `projection.entry='auto'`。
6. 当 `duplicateCount = 0` 时，预览区不得返回只包含当前文件的投射结果；系统必须保持或恢复底部结果面板隐藏态，而不是展示单文件标签。
7. 预览区工作台必须支持 `preview.continuousCall.enabled` 标准选项；开启后，切换预览文件并进入 `ready` 态时自动触发查重。
8. 对同一预览文件、同一 `searchScope` 与同一请求签名，持续调用命中历史成功或失败记录时必须静默跳过；手动调用仍必须强制执行并生成新结果项。
9. 若某个预览文件已有保留的成功重复结果，且此前因切换到“无重复文件”而关闭了底部结果面板，则切回该文件时系统必须重新激活对应结果标签。

### 5.2 工作区查重

1. `workspace` 作用域下，`data.findDuplicateFiles` 必须基于当前目标集合批量查重。
2. 工作区查重不得隐式补索引；`missing` 与 `stale` 种子必须显式计入结果覆盖率，而不是静默忽略。
3. 对 `missing` 种子，不得伪造旧命中；结果中必须以“需索引”状态可见返回。
4. 对 `stale` 种子，允许先以旧索引召回候选，但最终保留结果前必须对“种子 + 命中项”双方执行当前特征二次校验。
5. 多个种子若最终落入同一 `assetId`，工作区结果中必须只产生一个重复组（Duplicate Group）。
6. 工作区查重若最终存在至少一个重复组，结果投射入口固定为 `projection.entry='auto'`；若不存在重复组，则不得返回空投射，也不得因本次调用自动打开结果标签。

### 5.3 工作区显式索引

1. 手动索引能力只对工作区开放，不得在预览区暴露。
2. 工作区显式索引动作文案固定为：`索引当前目标文件`。
3. 该动作的目标集合固定复用工作区种子规则：已选优先，否则当前可见。
4. 该动作只允许处理 `missing | stale` 文件；`fresh` 文件必须返回 `skipped`，不得重复建档。

### 5.4 重复组快捷选择规则

1. 当底部结果标签来自 `data.findDuplicateFiles`，且 `projection.ordering.mode='group_contiguous'` 并具备稳定 `groupId` 时，界面必须显示“重复组快捷选择规则”。
2. 快捷选择规则的勾选语义固定为：`已选 = 待处理项`，而不是“保留项”。
3. 首期全局规则条固定提供：
   - `保留最新`
   - `保留最旧`
   - `保留当前文件/首项`
   - `清空全部`
4. `保留最新` 必须在每组中保留 `lastModifiedMs` 最大的文件不勾选，并将其余文件设为待处理项；时间相同或缺失时，必须回退到当前组内显示顺序。
5. `保留最旧` 必须在每组中保留 `lastModifiedMs` 最小的文件不勾选，并将其余文件设为待处理项；时间相同或缺失时，必须回退到当前组内显示顺序。
6. `保留当前文件/首项` 必须优先保留 `isCurrentFile=true` 的文件；若组内不存在当前文件，则保留该组当前显示顺序中的首项，其余文件设为待处理项。
7. 点击任一保留规则后，系统必须立即覆盖当前重复文件结果标签内全部重复组的选择态；用户后续手动改单个文件选择时，该手动结果必须保留，直到再次点击全局规则。
8. `清空全部` 必须清空当前重复文件结果标签内全部勾选，并清除“当前激活的保留规则”记忆。
9. 每个重复组必须提供轻量组头，并至少显示：
   - 组序号或组标题
   - 组内文件数
   - 当前已勾选待处理项数
   - `重应用本组`
   - `清空本组`
10. `重应用本组` 必须按“当前激活的保留规则”只对这一组重新生成待处理项选择，不得重新查重、不得请求后端、不得影响其他组。
11. 当当前不存在激活的保留规则时，`重应用本组` 必须保持禁用。
12. `清空本组` 只允许清空当前组的待处理项勾选，不得影响其他组，也不得清除当前激活的保留规则记忆。
13. 当前活动表面上的现有删除/还原等工作区工具必须继续消费这些勾选结果；首期不得新增重复文件专用删除按钮。

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
5. `file` 作用域工作台必须额外声明：
   - `key='preview.continuousCall.enabled'`
   - `type='boolean'`
   - `defaultValue=false`

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
- `projection?`

其中：

1. `target` 必须表示当前文件，且需带 `isCurrentFile=true`。
2. `indexing` 至少包含：
   - `strategy: 'implicit_current_file'`
   - `targetStatus: 'fresh' | 'reindexed'`
3. 当 `duplicateCount > 0` 时，`projection` 必须符合 `111-local-file-browser` 的通用投射契约。
4. 当 `duplicateCount = 0` 时，`projection` 必须省略。

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
- `projection?`

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
4. 当 `duplicateGroupCount > 0` 时，工作区 `projection.ordering.mode` 固定为 `group_contiguous`。
5. 当 `duplicateGroupCount = 0` 时，`projection` 必须省略。

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
13. `FR-ADD-13` 工作区查重在存在至少一个重复组时，必须自动打开对应结果标签。
14. `FR-ADD-14` 预览区重复文件工具必须支持 `preview.continuousCall.enabled` 标准持续调用能力。
15. `FR-ADD-15` 重复文件工具的持续调用请求签名必须包含 `searchScope` 等所有 sendToTool 选项值。
16. `FR-ADD-16` 同 `tool + file + requestSignature` 命中历史成功或失败记录时，持续调用必须静默跳过；手动调用不得跳过。
17. `FR-ADD-17` 当查重结果不存在任何重复项时，系统不得生成只包含当前文件或空列表的投射结果。
18. `FR-ADD-18` 当重复文件工具的最新成功结果不存在任何重复项时，系统必须自动关闭该工具已有的底部结果标签。
19. `FR-ADD-19` 当用户返回到已存在成功重复结果的文件上下文时，系统必须允许重新激活该文件既有结果标签，不得因历史“已处理”标记而保持关闭。
20. `FR-ADD-20` 重复文件结果标签在 `group_contiguous + groupId` 场景下，必须提供“待处理项”语义的全局快捷选择规则条。
21. `FR-ADD-21` 全局快捷规则首期必须至少支持 `保留最新`、`保留最旧`、`保留当前文件/首项` 与 `清空全部`。
22. `FR-ADD-22` 任一保留规则执行后，系统必须按组批量改写当前重复文件结果标签的待处理项选择态。
23. `FR-ADD-23` `清空全部` 执行后，系统必须清空当前重复文件结果标签的全部待处理项，并清除当前激活的保留规则记忆。
24. `FR-ADD-24` 每个重复组必须提供 `重应用本组` 与 `清空本组` 两个组级动作。
25. `FR-ADD-25` `重应用本组` 必须只按最近一次激活的保留规则重算当前组的选择态，不得触发重新查重或影响其他组。
26. `FR-ADD-26` 当不存在当前激活的保留规则时，`重应用本组` 必须禁用。
27. `FR-ADD-27` 快捷选择规则不得引入新的后端接口或新的 `projection` payload 字段。

## 9. 验收标准 (AC)

1. `AC-ADD-01` 预览当前文件已存在新鲜索引时，执行查重可直接返回“当前文件 + 其重复副本”。
2. `AC-ADD-02` 预览当前文件无索引时，执行查重会先补建该文件索引，再返回重复结果。
3. `AC-ADD-03` 预览当前文件索引过期时，执行查重会先刷新该文件索引，再返回重复结果。
4. `AC-ADD-04` 工作区有选中文件时，只基于选中文件形成种子；无选中时，基于当前可见文件形成种子。
5. `AC-ADD-05` 工作区存在 `missing` 种子时，结果会增加 `needsIndexingCount` 与逐项 `skippedSeeds`，而不是静默忽略该文件。
6. `AC-ADD-06` 工作区存在 `stale` 种子且旧索引命中已失效时，二次校验后该失效命中不会继续出现在最终结果中。
7. `AC-ADD-07` 多个工作区种子命中同一 `assetId` 时，最终只返回一个重复组。
8. `AC-ADD-08` 执行工作区 `索引当前目标文件` 时，仅 `missing/stale` 文件被实际建档；已是新鲜索引的文件返回 `skipped`。
9. `AC-ADD-09` 工作区查重结果存在至少一个重复组时，底部结果标签会自动打开；当不存在重复组时，本次调用不会自动切换到底部结果标签。
10. `AC-ADD-10` 预览区开启持续调用后，切换到新的可预览文件并进入 `ready` 态时会自动执行重复文件查重。
11. `AC-ADD-11` 持续调用开启后，若同文件与同 `search.scope` 已存在成功或失败结果，则本次自动调用静默跳过，不重复新增结果项。
12. `AC-ADD-12` 在持续调用开启状态下，用户手动再次点击“重复文件”仍会强制执行并新增一条结果项。
13. `AC-ADD-13` 预览区查重未命中任何重复副本时，底部结果面板不会显示只包含当前文件的结果标签；若此前存在该工具旧标签，会被自动关闭。
14. `AC-ADD-14` 工作区查重未命中任何重复组时，不会返回空结果标签；若此前存在该工具旧标签，会被自动关闭。
15. `AC-ADD-15` 预览区从“无重复文件”切回到已有成功重复结果的文件后，即使本次持续调用因历史命中而静默跳过，底部结果面板仍会重新打开该文件既有结果标签。
16. `AC-ADD-16` 打开重复文件结果标签后，点击 `保留最新` 时，每组仅最新文件保持未选，其余文件统一变为待处理项。
17. `AC-ADD-17` 打开重复文件结果标签后，点击 `保留最旧` 时，每组仅最旧文件保持未选，其余文件统一变为待处理项。
18. `AC-ADD-18` 打开重复文件结果标签后，点击 `保留当前文件/首项` 时，存在 `isCurrentFile` 的组优先保留当前文件；不存在时保留该组首项。
19. `AC-ADD-19` 点击 `清空全部` 后，当前重复文件结果标签内所有待处理项勾选都会被清空，且 `重应用本组` 进入禁用状态。
20. `AC-ADD-20` 在执行全局保留规则后，用户手动改单个文件或单个组的勾选不会影响其他组；再次点击任一全局保留规则时，会重新覆盖全部组。
21. `AC-ADD-21` 点击某组的 `重应用本组` 后，仅该组恢复到当前激活保留规则的选择结果，其他组保持不变。
22. `AC-ADD-22` 点击某组的 `清空本组` 后，仅该组勾选被清空，其他组与当前激活保留规则记忆保持不变。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 查询作用域默认值固定为 `global`。
2. 工作区显式索引动作名称固定为 `索引当前目标文件`。
3. 预览区隐式索引只允许作用于“当前文件”这一单文件目标。
4. `data.findDuplicateFiles` 虽可能触发预览区单文件补索引，但对外工具语义仍保持只读查重。
5. 本专题不新增快捷键。
6. 重复文件快捷选择规则的“已选”始终表示“待处理项”。

## 11. 关联主题 (Related Specs)

- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 本地文件浏览器：[`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 统一回收站虚拟路由：[`../122-unified-trash-route/spec.md`](../122-unified-trash-route/spec.md)
