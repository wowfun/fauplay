# 121 Projected File Grid 结果投射文件网格规范

## 1. 目的 (Purpose)

定义 Fauplay 的通用结果投射（Result Projection）与结果模式（Result Mode）契约，确保：

1. 工具结果可在不伪装成目录枚举的前提下，把一组文件投射到工作区网格中展示。
2. 结果投射声明来自具体结果 payload，而不是 `tools/list` 静态注解。
3. 进入结果模式后，网格、选择、预览遍历与工作区动作目标统一以投射列表为准。
4. 跨 Root 的文件投射可基于 `absolutePath` 完成延迟预览与内容读取，不依赖当前 `rootHandle`。

## 2. 关键术语 (Terminology)

- 结果投射（Result Projection）
- 结果模式（Result Mode）
- 投射所有者（Projection Owner）
- 进入方式（Projection Entry）
- 投射文件（Projection File）
- 混排排序（Mixed Ordering）
- 组连续排序（Group-contiguous Ordering）
- 显示路径（Display Path）
- 绝对路径原生读取（Absolute-path Native Fetch）

术语值映射：

1. 进入方式固定为：`auto | manual`。
2. 排序模式固定为：`listed | group_contiguous | mixed`。
3. 投射文件预览能力值复用：`image | video | text | unsupported`。

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. `tools/call.result` 中的通用 `projection` 结构。
2. 工作区结果模式的进入、替换、退出与恢复语义。
3. 结果模式下网格、选择、预览遍历与工作区动作目标的一致性。
4. 基于 `absolutePath` 的缩略图、正文与文件内容延迟读取接口。
5. 结果 payload 中声明排序模式与显示顺序语义。

范围外：

1. 各具体工具的业务含义与查询逻辑。
2. 统一回收站的数据存储与恢复语义（归属 `122`）。
3. 目录浏览模式下的普通文件枚举与过滤实现细节。
4. 把所有现有 mutation 工具都升级为跨 Root 可执行目标。

## 4. 核心语义 (Core Semantics)

1. 结果投射固定绑定到“某一条具体结果项”，而不是绑定到工具名、工作台实例或目录上下文。
2. 同一工作区上下文在任意时刻最多只允许一个激活中的结果投射；激活新投射时，必须替换旧投射。
3. 当激活结果投射后，工作区网格的数据源切换为 `projection.files[]`，而不是当前目录枚举结果。
4. 结果模式下，文件选择、范围选择、主预览打开、上一项/下一项遍历与工作区动作目标集合都必须以当前投射顺序为准。
5. 结果模式退出后，系统必须恢复到目录浏览模式原本的数据源与选择语义。
6. 对无法以当前工具契约消费的投射目标，系统不得伪造 `relativePath` 或 Root 上下文；工具可见性与可执行性必须按真实输入能力降级。

## 5. 用户可见行为契约 (User-visible Contract)

1. 结果项若返回 `projection.entry='auto'`，成功完成后必须自动进入结果模式。
2. 结果项若返回 `projection.entry='manual'`，结果面板必须保留显式进入入口；未进入前，网格继续保持目录浏览模式。
3. 结果模式退出条件固定为：
   - 路径导航成功
   - 顶部筛选条件变化
   - 用户手动关闭结果模式
4. 结果模式下，工作区网格不得展示目录项；投射列表固定为文件列表。
5. 投射文件的显示路径必须遵循：
   - 有 `sourceRootPath + sourceRelativePath` 时，优先显示 Root 相对路径。
   - 否则显示 `absolutePath`。
6. 工作区投射结果若声明 `ordering.mode='group_contiguous'`，同组文件必须连续显示，不得被其他组打断。
7. 投射结果若声明 `ordering.mode='mixed'`，系统必须按 payload 已声明的排序口径混排展示，不得在前端擅自改为分组分段。

## 6. 投射 payload 契约 (Projection Payload Contract)

`tools/call.result` 顶层可选返回：

```json
{
  "projection": {
    "id": "duplicates:workspace:1742880000000",
    "title": "重复文件",
    "entry": "manual",
    "ordering": {
      "mode": "group_contiguous",
      "keys": ["groupRank:asc", "lastModifiedMs:desc", "displayPath:asc"]
    },
    "files": []
  }
}
```

约束：

1. `projection` 必须位于结果 payload 顶层，不得仅通过 `tools/list.annotations` 静态声明。
2. `projection.id` 必须在“该结果项”范围内稳定可引用。
3. `projection.title` 用于结果模式的标题与可见上下文。
4. `projection.entry` 只能为 `auto | manual`。
5. `projection.ordering.mode` 只能为：
   - `listed`：按 `files[]` 原序展示
   - `group_contiguous`：按组连续展示
   - `mixed`：按同一扁平序列混排展示
6. `projection.ordering.keys[]` 为可选声明，采用 `<field>:<direction>` 字符串形式。
7. `projection.files[]` 最小字段固定为：
   - `absolutePath`
   - `name`
   - `previewKind`
   - `displayPath`
   - `sourceType`
8. `projection.files[]` 建议补充字段：
   - `mimeType`
   - `size`
   - `lastModifiedMs`
   - `sourceRootPath`
   - `sourceRelativePath`
   - `groupId`
   - `groupRank`
   - `isCurrentFile`
   - `deletedAt`

## 7. 数据读取与跨 Root 预览契约 (Data Fetch Contract)

1. 投射文件不得直接在结果 payload 中内联大体积二进制内容。
2. 投射 payload 只携带网格与轻量预览所需的基础字段；缩略图、正文与文件内容必须按需延迟读取。
3. Gateway 必须提供基于 `absolutePath` 的读取链路：
   - `GET /v1/files/content?absolutePath=...`
   - `GET /v1/files/thumbnail?absolutePath=...&sizePreset=...`
   - `POST /v1/files/text-preview`
4. `POST /v1/files/text-preview` 输入必须至少支持：
   - `absolutePath`
   - `sizeLimitBytes?`
5. 上述绝对路径读取接口的失败必须可见，但不得破坏结果模式下其他文件的浏览与选择。

## 8. 功能需求 (FR)

1. `FR-PFG-01` 系统必须允许具体结果项通过顶层 `projection` 把文件集合投射到工作区网格中。
2. `FR-PFG-02` `projection` 的声明源必须是结果 payload，而不是 `tools/list` 静态注解。
3. `FR-PFG-03` 系统必须支持 `auto | manual` 两种结果模式进入方式。
4. `FR-PFG-04` 同一工作区上下文必须只允许一个激活中的结果投射。
5. `FR-PFG-05` 进入结果模式后，网格、选择、预览遍历与工作区动作目标必须统一切换到投射列表语义。
6. `FR-PFG-06` 路径导航、筛选变化与手动关闭必须退出结果模式并恢复目录浏览。
7. `FR-PFG-07` `projection.files[]` 必须采用“基础字段内联 + 重内容延迟读取”的混合模型。
8. `FR-PFG-08` 系统必须支持基于 `absolutePath` 的跨 Root 文件缩略图、正文与内容读取。
9. `FR-PFG-09` 结果 payload 必须可声明排序模式；当前前端不得忽略 `mixed` 与 `group_contiguous` 语义。
10. `FR-PFG-10` 对无法由当前工具契约消费的投射目标，系统必须降级禁用，而不是伪造路径参数继续执行。

## 9. 验收标准 (AC)

1. `AC-PFG-01` 某条成功结果返回 `projection.entry='auto'` 后，工作区网格会立即切换为该投射列表。
2. `AC-PFG-02` 某条成功结果返回 `projection.entry='manual'` 后，目录网格保持不变，直到用户显式进入该结果模式。
3. `AC-PFG-03` 激活结果模式后，键盘上一项/下一项遍历顺序与网格可见顺序保持一致。
4. `AC-PFG-04` 激活结果模式后，`Shift` 范围选择以投射列表顺序工作，而不是以目录原始顺序工作。
5. `AC-PFG-05` 导航到其他路径、修改顶部筛选或手动关闭结果模式后，网格恢复为目录浏览模式。
6. `AC-PFG-06` 跨 Root 投射文件可通过 `absolutePath` 成功显示缩略图或正文，无需依赖当前 `rootHandle`。
7. `AC-PFG-07` 当投射声明 `ordering.mode='group_contiguous'` 时，同组文件连续显示且不会被其他组穿插。
8. `AC-PFG-08` 当投射声明 `ordering.mode='mixed'` 且 `keys=['deletedAt:desc','sourceType:asc']` 时，前端按该混排口径展示而不是拆成来源分段。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 结果模式的默认数据源为目录浏览；只有在存在激活中的 `projection` 时才切换。
2. `projection.entry` 缺失时不得隐式推断为 `auto`；客户端必须按“无结果投射”处理。
3. `projection.ordering.mode` 缺失时，默认按 `listed` 解释。
4. 显示路径始终遵循“Root 相对优先，否则绝对路径”的单一规则。
5. 本专题不新增快捷键。

## 11. 关联主题 (Related Specs)

- 协议契约：[`../002-contracts/spec.md`](../002-contracts/spec.md)
- 插件运行时交互：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 本地文件浏览器：[`../111-local-file-browser/spec.md`](../111-local-file-browser/spec.md)
- 资产级重复文件检测：[`../120-asset-duplicate-detection/spec.md`](../120-asset-duplicate-detection/spec.md)
- 统一回收站虚拟路由：[`../122-unified-trash-route/spec.md`](../122-unified-trash-route/spec.md)
