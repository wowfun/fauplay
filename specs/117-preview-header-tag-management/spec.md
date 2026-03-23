# 117 Preview Header Logical Tag Management 预览头部逻辑标签管理规范

## 1. 目的 (Purpose)

定义 Fauplay 预览头部标签管理能力契约，确保：

1. 预览头部标签按逻辑身份 `key + value` 聚合展示，而非按 `source` 分裂显示。
2. 当同一逻辑标签同时存在 `meta.annotation` 与派生来源时，前端以 `meta.annotation` 作为代表来源。
3. 用户在预览头部点击 `+` 选择派生来源标签时，系统等价为“为同一 `key + value` 额外补一条 `meta.annotation` 绑定”，而不删除派生来源。
4. 用户在预览头部点击 `-` 时，仅移除该逻辑标签的 `meta.annotation` 来源绑定，不影响派生来源。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 预览头部标签的逻辑聚合展示与来源优先级。
2. 预览头部的标签删除与新增绑定交互。
3. 逻辑标签候选列表与输入筛选。
4. 预览侧栏与全屏预览的一致行为。
5. 预览头部“绑定逻辑标签”入口的 `#` 快捷键打开语义。
6. 预览头部与工作区顶部过滤共享“按 `key + value` 去重”的读侧语义。
7. 配置化逻辑标签快捷键对当前预览文件的直接绑定语义。

范围外：

1. 派生来源标签本身的人工编辑或删除。
2. 自由创建全新标签（非候选选择）。
3. 通过快捷键自由创建不存在于候选中的全新逻辑标签。

## 3. 用户可见行为契约 (User-visible Contract)

1. 预览头部标签必须按 `key + value` 聚合展示；同一文件同一逻辑标签的多来源结果只显示一个标签。
2. 当逻辑标签同时包含 `meta.annotation` 与其他来源时，展示态与可编辑性以 `meta.annotation` 为主。
3. 仅拥有派生来源的逻辑标签必须可见，但不得显示删除入口。
4. 点击 `-` 的语义固定为“仅删除该逻辑标签的 `meta.annotation` 来源”：
   - 若仍存在派生来源，标签继续显示并切换为只读。
   - 若不存在其他来源，标签从头部消失。
5. 点击 `+` 后必须进入输入态，并展示逻辑标签候选列表。
6. 候选列表默认显示全库所有逻辑标签，包含派生来源标签。
7. 输入字符仅用于筛选候选，用户必须从候选中选择，不允许自由创建新标签。
8. 当前文件已拥有 `meta.annotation` 来源的逻辑标签不得再出现在候选中；仅有派生来源的同名逻辑标签必须继续可选。
9. 绑定成功后，当前逻辑标签立即变为可删除态；解绑成功后，标签显示必须即时更新，不要求切换文件触发刷新。
10. 上述行为在侧栏预览与全屏预览必须一致。
11. 预览切换到某个文件时，系统必须立即按文件粒度强制刷新该文件标签，直接从数据库读取最新标签信息；读取不得阻塞预览主体渲染，可先展示已有快照并在返回后刷新头部标签。
12. 当预览打开且焦点不在输入控件中时，用户按 `#` 必须等价于点击 `+`，直接打开逻辑标签绑定输入态并复用同一候选加载流程。
13. 当侧栏预览与全屏预览同时存在时，`#` 只能由当前激活表现面响应；v1 固定优先全屏预览，禁止两个预览头部同时打开标签输入态。
14. 当配置化逻辑标签快捷键命中当前已存在于候选中的 `key + value` 时，系统必须直接为当前预览文件补一条 `meta.annotation` 绑定；语义等价于在头部候选列表中选中同一逻辑标签。

## 4. 逻辑标签聚合契约 (Logical Tag Contract)

1. 逻辑标签身份固定为：`logicalKey = encodeURIComponent(key) + '=' + encodeURIComponent(value)`。
2. 逻辑标签对象至少包含：
   - `tagKey`
   - `key`
   - `value`
   - `sources[]`
   - `hasMetaAnnotation`
   - `representativeSource`
3. `sources[]` 为该逻辑标签在当前聚合范围内的去重来源集合。
4. `hasMetaAnnotation = true` 时，`representativeSource` 必须固定为 `meta.annotation`。
5. `hasMetaAnnotation = false` 时，`representativeSource` 必须按稳定顺序选择；v1 默认按 `source` 字典序。
6. 工作区顶部过滤与候选计数必须按逻辑标签去重；同一文件同一逻辑标签的多来源结果只计一次。

## 5. Gateway / Tool 契约 (Gateway / Tool Contract)

1. 读接口继续复用：
   - `POST /v1/data/tags/file`
   - `POST /v1/data/tags/options`
   - `POST /v1/data/tags/query`
2. 上述读接口返回的多来源标签结果，前端必须保留完整 `key/value/source/appliedAt` 信息，再在前端聚合为逻辑标签。
3. `local.data` 新增两个 operation：
   - `bindAnnotationTag`
   - `unbindAnnotationTag`
4. `bindAnnotationTag`
   - 输入：`rootPath, relativePath, key, value`
   - 语义：仅为该逻辑标签新增一条 `source=meta.annotation` 绑定，不删除任何同名派生来源
5. `unbindAnnotationTag`
   - 输入：`rootPath, relativePath, key, value`
   - 语义：仅移除该逻辑标签的 `source=meta.annotation` 绑定，不删除任何派生来源
6. Gateway HTTP 新增：
   - `POST /v1/file-annotations/tags/bind`
   - `POST /v1/file-annotations/tags/unbind`
7. 现有 `setAnnotationValue` 继续保持“同字段覆盖写入”语义，不承担本专题的逻辑标签补来源能力。

## 6. 功能需求 (FR)

1. `FR-PHT-01` 预览头部标签展示必须按 `key + value` 聚合。
2. `FR-PHT-02` 当同一逻辑标签同时包含 `meta.annotation` 与派生来源时，前端必须以 `meta.annotation` 代表该逻辑标签。
3. `FR-PHT-03` 仅含派生来源的逻辑标签必须可见但只读。
4. `FR-PHT-04` 删除逻辑标签时，只允许移除 `meta.annotation` 来源，不得删除派生来源。
5. `FR-PHT-05` 新增标签时，候选列表必须包含派生来源逻辑标签，且选择后等价为新增同名 `meta.annotation` 来源。
6. `FR-PHT-06` 当前文件已拥有 `meta.annotation` 来源的逻辑标签不得重复出现在候选列表。
7. `FR-PHT-07` 工作区顶部过滤与预览头部标签必须共用“逻辑标签去重”读侧语义。
8. `FR-PHT-08` 预览头部的新增/删除结果必须在同一预览会话内即时同步。
9. `FR-PHT-09` 预览切换文件时必须发起一次文件级强制标签查询（`/v1/data/tags/file`），不得仅依赖先前缓存命中决定是否跳过读库。
10. `FR-PHT-10` 系统必须支持预览态 `#` 快捷键打开逻辑标签绑定面板，语义与点击 `+` 完全一致，不得直接提交绑定。
11. `FR-PHT-11` 输入控件聚焦时，`#` 不得触发预览头部标签绑定快捷键。
12. `FR-PHT-12` 当侧栏预览与全屏预览同时存在时，`#` 必须只由一个预览表现面处理；v1 固定全屏优先、侧栏让出 owner。
13. `FR-PHT-13` 当 `shortcuts.json` 配置了合法且当前存在于逻辑标签候选中的动态 `tag:` action 时，预览态必须支持直接绑定该逻辑标签到当前文件。
14. `FR-PHT-14` 配置化逻辑标签快捷键触发时，必须复用 `bindAnnotationTag` 语义，仅新增 `meta.annotation` 来源，不得走 `setAnnotationValue`。
15. `FR-PHT-15` 当前文件已拥有同名 `meta.annotation(key,value)` 时，配置化逻辑标签快捷键必须幂等 no-op。

## 7. 验收标准 (AC)

1. `AC-PHT-01` 同一文件同时收到 `vision.face(person=Alice)` 与 `meta.annotation(person=Alice)` 时，头部仅显示一个 `person: Alice` 标签，且该标签可删除。
2. `AC-PHT-02` 删除上述标签后，仅移除 `meta.annotation(person=Alice)`；若 `vision.face(person=Alice)` 仍在，头部标签保留并变为只读。
3. `AC-PHT-03` 同一文件仅存在派生来源 `key + value` 时，头部标签可见但不显示 `-`。
4. `AC-PHT-04` 点击 `+` 时，来自派生来源的同名逻辑标签仍出现在候选中；选中后，该标签切换为可删除态。
5. `AC-PHT-05` 当前文件已存在 `meta.annotation(key,value)` 时，该逻辑标签不会再次出现在候选中，即使仍存在其他来源。
6. `AC-PHT-06` 工作区顶部过滤按 `key + value` 生效；同一文件同一逻辑标签拥有多个来源时不会重复匹配或重复计数。
7. `AC-PHT-07` 侧栏预览与全屏预览的展示、删除、补来源与错误反馈行为一致。
8. `AC-PHT-08` 当用户重新预览一个先前已看过的文件时，系统仍会再次读取该文件最新标签；若数据库中的标签已变化，头部标签会在本次预览会话内刷新到最新结果。
9. `AC-PHT-09` 仅侧栏预览打开时，按 `#` 会打开当前文件的逻辑标签绑定面板并聚焦输入框。
10. `AC-PHT-10` 侧栏预览与全屏预览同时存在时，按 `#` 只会打开全屏预览头部的标签输入态，不会同时打开侧栏输入态。
11. `AC-PHT-11` 当标签候选输入框、重命名输入框或其他输入控件聚焦时，按 `#` 不会触发标签绑定快捷键。
12. `AC-PHT-12` 当当前项不可管理标签、`local.data` 不可用或标签 mutation 进行中时，按 `#` 不会打开绑定面板，也不会抛出未处理错误。
13. `AC-PHT-13` 当 `shortcuts.json` 将某个现有逻辑标签配置为快捷键后，在当前预览文件按下该键会直接补一条同名 `meta.annotation` 绑定，且头部标签在刷新后变为可删除态。
14. `AC-PHT-14` 当同一绑定同时命中配置化逻辑标签快捷键与预览内建快捷键时，只要该逻辑标签快捷键当前激活，就优先执行逻辑标签绑定。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. 本专题新增一个预览态快捷键：`#` 用于打开逻辑标签绑定面板；`src/config/shortcuts.ts` 与 `docs/shortcuts.md` 必须保持一致。
2. 逻辑标签显示默认使用 `key: value` 文案；来源摘要可作为辅助信息展示，但不得改变逻辑标签身份。
3. 本专题不允许自由创建新标签；所有新增必须来自候选选择。

## 9. 关联主题 (Related Specs)

- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
