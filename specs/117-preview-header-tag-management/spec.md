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
5. 预览头部与工作区顶部过滤共享“按 `key + value` 去重”的读侧语义。

范围外：

1. 派生来源标签本身的人工编辑或删除。
2. 自由创建全新标签（非候选选择）。
3. 快捷键变更。

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

## 7. 验收标准 (AC)

1. `AC-PHT-01` 同一文件同时收到 `vision.face(person=Alice)` 与 `meta.annotation(person=Alice)` 时，头部仅显示一个 `person: Alice` 标签，且该标签可删除。
2. `AC-PHT-02` 删除上述标签后，仅移除 `meta.annotation(person=Alice)`；若 `vision.face(person=Alice)` 仍在，头部标签保留并变为只读。
3. `AC-PHT-03` 同一文件仅存在派生来源 `key + value` 时，头部标签可见但不显示 `-`。
4. `AC-PHT-04` 点击 `+` 时，来自派生来源的同名逻辑标签仍出现在候选中；选中后，该标签切换为可删除态。
5. `AC-PHT-05` 当前文件已存在 `meta.annotation(key,value)` 时，该逻辑标签不会再次出现在候选中，即使仍存在其他来源。
6. `AC-PHT-06` 工作区顶部过滤按 `key + value` 生效；同一文件同一逻辑标签拥有多个来源时不会重复匹配或重复计数。
7. `AC-PHT-07` 侧栏预览与全屏预览的展示、删除、补来源与错误反馈行为一致。

## 8. 默认值与一致性约束 (Defaults & Consistency)

1. 本专题不新增快捷键，不修改 `src/config/shortcuts.ts` 与 `docs/shortcuts.md`。
2. 逻辑标签显示默认使用 `key: value` 文案；来源摘要可作为辅助信息展示，但不得改变逻辑标签身份。
3. 本专题不允许自由创建新标签；所有新增必须来自候选选择。

## 9. 关联主题 (Related Specs)

- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
