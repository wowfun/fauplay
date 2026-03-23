# 116 Configurable Shortcuts 可配置快捷键规范

## 1. 目的 (Purpose)

定义 Fauplay 快捷键配置化能力契约，确保：

1. 当前全部已存在快捷键从硬编码常量迁移为可配置 JSON。
2. 快捷键默认值、全局覆盖与 root 覆盖遵循统一 app-owned 配置链。
3. 侧栏预览、全屏预览、网格导航与应用级快捷键的既有语义与优先级保持不变。
4. 配置非法、覆盖缺失或 Gateway 离线时，系统能够局部降级而不阻断核心浏览。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 默认快捷键迁移到 `src/config/shortcuts.json`。
2. 全局覆盖 `~/.fauplay/global/shortcuts.json` 与 root 覆盖 `<root>/.fauplay/shortcuts.json`。
3. 快捷键字符串 DSL、三层合并、局部容错与冲突告警。
4. Gateway 只读接口，用于读取全局快捷键配置文件。
5. 运行时 shortcut store / hook 与现有监听逻辑接线。
6. 快捷键文档与运行时配置矩阵同步。
7. 为现有逻辑标签 `key + value` 提供数据驱动的预览态绑定快捷键。

范围外：

1. 新增新的快捷键动作或新的交互语义。
2. `<leader>`、多段序列、chord、录制式快捷键编辑 UI。
3. 物理键位 `code:*` 语法与键盘布局无关匹配。
4. 快捷键冲突管理专用 UI 面板。

## 3. 配置路径与来源 (Config Sources)

1. `shortcuts` 属于 app-owned 文件型运行时配置域。
2. `shortcuts` 明确属于 root-scoped 域，解析顺序固定为：
   - `src/config/shortcuts.json`
   - `~/.fauplay/global/shortcuts.json`
   - `<root>/.fauplay/shortcuts.json`
3. 只有当前 root 上下文存在时，系统才允许读取 root 层配置。
4. 当 `root=~` 时，`~/.fauplay/shortcuts.json` 仍视为 root 层，`~/.fauplay/global/shortcuts.json` 仍视为全局层。
5. 配置查找必须按精确文件路径执行，不得递归扫描整个 `.fauplay/` 目录。

## 4. 文件格式与 DSL 契约 (File Format & DSL)

### 4.1 JSON 结构

1. 配置文件根对象固定为：
   - `ShortcutConfigFileV1 { version: 1; keybinds: Record<string, string[] | "none"> }`
2. `version` 为必填，v1 固定值为 `1`。
3. `keybinds` 为必填对象；key 只允许：
   - 已定义的内建 `ShortcutActionId`
   - 动态逻辑标签 action id：`tag:${key}=${value}`
4. v1 的内建 `ShortcutActionId` 固定覆盖当前全部既有动作，采用扁平 `snake_case` 命名。

### 4.2 内建 Action Id 清单

1. `app_open_directory`
2. `app_navigate_up`
3. `preview_toggle_autoplay`
4. `preview_toggle_playback_order`
5. `preview_toggle_video_play_pause`
6. `preview_seek_backward`
7. `preview_seek_forward`
8. `preview_cycle_video_playback_rate`
9. `preview_soft_delete`
10. `preview_annotation_assign_digit`
11. `preview_open_annotation_tag_editor`
12. `preview_prev`
13. `preview_next`
14. `preview_close`
15. `grid_select_all`
16. `grid_clear_selection`
17. `grid_move_right`
18. `grid_move_left`
19. `grid_move_down`
20. `grid_move_up`
21. `grid_page_down`
22. `grid_page_up`
23. `grid_open_selected`

### 4.3 动态逻辑标签 Action Id

1. 逻辑标签快捷键固定使用 `tag:` 命名空间，格式为：
   - `tag:${key}=${value}`
2. 外部配置必须采用所见即所得的原始字符串语法；`key/value` 中的中文、空格与常见特殊字符可直接写入，不得要求用户手工做 percent-encoding。
3. 解析时必须固定按以下顺序处理：
   - 去掉 `tag:` 前缀
   - 按第一个 `=` 分割 `key` 与 `value`
   - 对两侧分别执行 `trim`
4. 以下情况必须视为该动态 action id 非法并忽略：
   - 缺少 `=`
   - `key` 或 `value` 为空
5. `key` 不得原样包含分隔符 `=`；`value` 可以包含额外的 `=`，因为解析固定只按第一个 `=` 分割。
6. 中文、空格与常见特殊字符可以直接写入；例如：
   - `tag:person=张三`
   - `tag:person=Alice Smith`
   - `tag:note=foo=bar/#1`
   - `tag:scene=室内 人像`
7. 外部配置只需要遵守 JSON 本身的字符串转义规则；除 JSON 转义外，v1 不再要求额外 percent-encoding。

### 4.4 字符串 DSL

1. 单个绑定以字符串表示，例如：`mod+o`、`space`、`delete`、`#`。
2. 每个 action 使用 `string[]` 表示一个或多个候选绑定。
3. `"none"` 表示显式禁用该 action。
4. v1 只支持单次组合键；每个绑定必须恰好包含一个非修饰键 token。
5. 支持的修饰键至少包括：
   - `mod`
   - `ctrl`
   - `meta`
   - `alt`
   - `shift`
6. `mod` 语义固定为“主修饰键”，运行时映射到 `Ctrl/Cmd` 匹配。
7. 特殊键名称采用 OpenCode 风格，至少兼容：
   - `return` / `enter`
   - `escape` / `esc`
   - `backspace`
   - `space`
   - `delete`
   - `left` / `arrowleft`
   - `right` / `arrowright`
   - `up` / `arrowup`
   - `down` / `arrowdown`
   - `pageup`
   - `pagedown`
8. 字母与数字键按字符语义匹配；`[`、`]` 等默认键位同样按字符语义匹配。
9. v1 不支持：
   - `code:*`
   - `<leader>`
   - 多段序列
   - 一个绑定中出现多个非修饰键

## 5. 合并、加载与降级契约 (Merge / Loading / Degradation)

### 5.1 合并规则

1. 三层优先级固定为：default < global < root。
2. 合并粒度固定为 action 级；更高层一旦声明某个 action（含动态 `tag:` action），即整项替换其绑定列表。
3. 未声明的 action 必须继承上一层有效值。
4. `"none"` 参与合并，表示最终禁用该 action。

### 5.2 加载规则

1. 应用启动后必须立即使用默认配置，使快捷键可即时生效。
2. 全局层通过 Gateway 异步读取，读取完成后必须热更新当前绑定，无需刷新页面。
3. root 层在当前 root 上下文可用时，通过 `FileSystemDirectoryHandle` 异步读取，读取完成后必须热更新当前绑定。
4. root 切换时必须重新解析 root 层，并恢复对应 root 的最终合并结果。
5. v1 不要求文件系统监听或自动热重载；配置文件修改后，至少在刷新页面或切换 root 后可重新生效。
6. 动态 `tag:` action 是否最终生效，除配置解析外，还必须以当前 `/v1/data/tags/options` 返回的逻辑标签快照为准；目标 `key/value` 当前不存在时，该 action 必须视为未激活。

### 5.3 容错与告警

1. 容错策略固定为局部容错。
2. 非法 JSON、非法字段、未知 action id、非法 DSL token 只影响对应 layer / action。
3. 受影响 action 必须回退到上一层有效值；不得导致整套快捷键失效。
4. 未知字段与未知 action id 必须被忽略，并输出非阻断 warning。
5. 当前逻辑标签快照中不存在的动态 `tag:` action 必须被忽略并输出 warning；当快照后续刷新并出现该逻辑标签时，该 action 可在同一会话内变为生效。
6. 当两个 action 最终解析为同一绑定时，系统必须允许继续运行，但输出冲突 warning。
7. warning 以日志/控制台为主；v1 不要求独立 UI 提示面板。

## 6. 运行时与 Gateway 契约 (Runtime & Gateway Contract)

### 6.1 前端运行时

1. 前端必须提供统一 shortcut store / hook，作为快捷键快照的唯一运行时读取入口。
2. 现有组件不得再把 `src/config/shortcuts.ts` 当作静态配置真源直接消费。
3. `src/config/shortcuts.ts` 保留为解析、归一化、action 映射与类型定义入口。
4. 现有快捷键匹配器继续消费规范化后的 `ShortcutBinding[]`；事件处理优先级与输入焦点保护保持不变。
5. 预览态快捷键在侧栏与全屏预览下的语义必须继续保持一致。
6. 前端必须额外产出规范化后的 `ResolvedPreviewTagShortcut[]`，仅包含“动态 action id 语法合法且当前存在于逻辑标签快照中”的逻辑标签快捷键。
7. 逻辑标签快捷键仅作用于当前预览文件；触发后必须复用 `bindAnnotationTag` 写路径，写入来源固定为 `meta.annotation`。
8. 当前文件已拥有 `meta.annotation(key,value)` 时，对应逻辑标签快捷键必须表现为幂等 no-op。
9. 当逻辑标签快捷键与现有预览快捷键冲突且该逻辑标签快捷键当前激活时，逻辑标签快捷键优先；仅当其当前未激活时，原预览快捷键才可继续响应。

### 6.2 Gateway 只读接口

1. Gateway 必须新增只读 HTTP 接口：`GET /v1/config/shortcuts`。
2. 该接口固定读取 `~/.fauplay/global/shortcuts.json`。
3. 文件缺失时必须返回“缺失但可跳过”的成功结果，不得把缺失视为致命错误。
4. 文件存在但 JSON 非法时，必须返回可读错误，供前端记录 warning 并回退默认层。
5. 该接口不读取 root 层配置，不递归扫描目录，不参与 tool-owned 配置覆盖。
6. Gateway 启动日志必须打印当前 shortcuts 配置文件路径；v1 至少打印全局层 `~/.fauplay/global/shortcuts.json`，并明确区分 `loaded`、`missing, skipped` 与 `invalid JSON` 状态。

## 7. 功能需求 (FR)

1. `FR-CS-01` 系统必须将快捷键默认真源迁移为 `src/config/shortcuts.json`。
2. `FR-CS-02` 系统必须支持 `~/.fauplay/global/shortcuts.json` 作为全局覆盖层。
3. `FR-CS-03` 系统必须支持 `<root>/.fauplay/shortcuts.json` 作为 root 覆盖层。
4. `FR-CS-04` `shortcuts` 域必须被显式定义为 root-scoped app-owned 配置域。
5. `FR-CS-05` 外部配置文件必须采用 `version + keybinds` 的 v1 JSON 结构。
6. `FR-CS-06` 外部 action id 必须采用扁平 `snake_case`，内部再映射回现有 `app / preview / grid` 语义。
7. `FR-CS-07` v1 DSL 必须支持单次组合键、`mod` 别名与 OpenCode 风格特殊键名称。
8. `FR-CS-08` v1 DSL 不得支持 `code:*`、`<leader>` 或多段序列。
9. `FR-CS-09` 合并策略必须为 action 级整项替换，未声明 action 继承上一层有效值。
10. `FR-CS-10` `"none"` 必须可显式禁用单个 action。
11. `FR-CS-11` 系统必须先启用默认配置，再异步加载 global/root 覆盖并热更新。
12. `FR-CS-12` 非法配置必须按 action / layer 粒度降级，不得阻断核心浏览与预览。
13. `FR-CS-13` 最终绑定冲突必须只告警不阻断。
14. `FR-CS-14` Gateway 必须提供 `GET /v1/config/shortcuts` 只读接口。
15. `FR-CS-15` 当前全部既有快捷键动作必须被纳入配置化范围；此外系统必须支持通过动态 `tag:` action 为逻辑标签配置预览态绑定快捷键。
16. `FR-CS-16` 动态 `tag:` action 只能绑定已存在于当前逻辑标签快照中的 `key + value`，不得借快捷键创建新标签。
17. `FR-CS-17` 因 v1 只支持字符键，默认 `[`、`]` 等键位必须按字符语义匹配；该限制需在文档中明确说明。
18. `FR-CS-18` Gateway 控制台必须在启动时打印 shortcuts 配置文件来源与状态，便于排查当前实际读取的配置文件。

## 8. 验收标准 (AC)

1. `AC-CS-01` 未提供 global/root 配置文件时，启动后所有快捷键行为与迁移前保持一致。
2. `AC-CS-02` 仅在 `~/.fauplay/global/shortcuts.json` 覆盖单个 action 时，其他 action 继续继承默认绑定。
3. `AC-CS-03` 当前 root 存在 `<root>/.fauplay/shortcuts.json` 时，root 覆盖优先于 global；切换到其他 root 后恢复对应 root 的结果。
4. `AC-CS-04` 某个 action 配置为 `"none"` 后，该 action 不再触发匹配。
5. `AC-CS-05` global 或 root 文件存在未知 action id、非法 token 或非法字段时，仅受影响 action 回退上一层有效值，其他动作继续可用。
6. `AC-CS-06` Gateway 离线、global 文件缺失、root 文件缺失或 root 文件不可读时，系统回退可用默认值，不阻断目录浏览、预览和网格导航。
7. `AC-CS-07` 两个 action 配置为同一绑定时，系统输出 warning，但应用仍可继续运行，最终事件处理顺序保持现有优先级。
8. `AC-CS-08` 应用首次加载时默认快捷键立即可用；global/root 覆盖返回后，当前会话绑定可热更新，无需刷新页面。
9. `AC-CS-09` `GET /v1/config/shortcuts` 在全局文件缺失时返回“missing, skipped”语义；全局文件 JSON 非法时返回明确错误。
10. `AC-CS-10` `docs/shortcuts.md` 能同时说明默认快捷键与三层配置覆盖路径。
11. `AC-CS-11` 当 `keybinds` 中存在 `tag:person=张三` 且当前逻辑标签快照包含 `person=张三` 时，当前预览文件按下该绑定会新增 `meta.annotation(person=张三)`。
12. `AC-CS-12` 当 `tag:` action 中的 `value` 含中文、空格、`=`, `%`, `#`, `?`, `/` 等常见字符时，原始字符串版本可直接解析；系统不得要求用户手工做 percent-encoding。
13. `AC-CS-13` 当动态 `tag:` action 与现有预览快捷键使用同一绑定时，只要该逻辑标签快捷键当前激活，就必须优先响应逻辑标签绑定；若当前未激活，则原预览快捷键继续工作。
14. `AC-CS-14` Gateway 启动后，控制台会打印当前 shortcuts 配置文件路径；当全局文件缺失时显示 `missing, skipped`，当文件 JSON 非法时显示 `invalid JSON`，且两种情况都不阻断 Gateway 启动。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. 专题目录固定为 `116-configurable-shortcuts`。
2. `src/config/shortcuts.json` 必须完整列出当前全部默认快捷键动作。
3. `docs/shortcuts.md` 记录默认快捷键，不追踪用户本机的实时合并结果。
4. `src/config/shortcuts.ts` 与 `docs/shortcuts.md` 仍需同步维护，但 `shortcuts.ts` 的职责改为解析/归一化入口，而非默认配置真源。

## 10. 关联主题 (Related Specs)

- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 本地运行时配置参考：[`../005-local-data-contracts/runtime-config-reference.md`](../005-local-data-contracts/runtime-config-reference.md)
- 预览播放：[`../100-preview-playback/spec.md`](../100-preview-playback/spec.md)
- 网格多选：[`../103-grid-multi-selection/spec.md`](../103-grid-multi-selection/spec.md)
- 预览头部逻辑标签管理：[`../117-preview-header-tag-management/spec.md`](../117-preview-header-tag-management/spec.md)
