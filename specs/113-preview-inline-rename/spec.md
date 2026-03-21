# 113 Preview Inline Rename 预览标题点击重命名规范

## 1. 目的 (Purpose)

定义 Fauplay 预览区“点击文件名重命名”能力契约，统一侧栏预览与全屏预览的交互语义、调用顺序与失败降级行为。

## 2. 关键术语 (Terminology)

- 标题重命名（Inline Rename）
- 预演（Dry-run）
- 提交执行（Commit）
- 目标路径对齐校验（Expected Path Validation）
- 预览回绑（Preview Rebind）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 预览面板与全屏预览标题点击进入重命名编辑态。
2. 复用 `fs.batchRename` 实现单文件重命名。
3. 固定 `dry-run -> 结果校验 -> commit` 执行链路。
4. 重命名成功后的目录刷新与预览目标回绑。
5. 网关离线或工具缺失时禁用并提示原因。

范围外：

1. 扩展名编辑。
2. 新增后端单文件重命名工具。
3. 本地文件写入降级（绕过网关）。
4. 新增快捷键。

## 4. 用户可见行为契约 (User-visible Contract)

1. 在预览标题区点击文件名可进入编辑态；仅允许编辑文件名主体（不含扩展名）。
2. 编辑态交互：
   - `Enter` 提交
   - 输入框失焦提交
   - `Esc` 取消并退出编辑态
3. 提交中必须禁用重复提交与重复进入编辑态。
4. 当网关离线或 `fs.batchRename` 不可用时，标题重命名入口必须不可用并可见提示原因。
5. 重名策略为“严格失败”：若预演结果目标路径与期望路径不一致（例如自动去重 ` (1)`），必须提示“目标名称已存在”并终止，不得提交。
6. 重命名成功后必须刷新当前目录，并优先将预览绑定到重命名后的新路径，避免回退到目录首个文件。
7. 上述行为在侧栏预览与全屏预览必须一致。
8. 编辑态输入框必须使用标题区可用宽度，不得退回浏览器默认 `20ch` 宽度导致长文件名编辑困难。
9. 当预览遍历模式为随机时，重命名成功后仍必须保持当前文件选中/预览，不得跳转到媒体列表首项。
10. `confirm=true` 且提交成功后，系统必须自动触发路径重绑（`batchRebindPaths`），保持 `fileId` 与标签/人脸关联稳定。
11. 若自动重绑失败，前端应保持“重命名已成功”结果，并展示后处理告警（不回滚文件名）。

## 5. 工具调用契约 (Tool Call Contract)

固定使用 `fs.batchRename`，且单次仅处理当前预览文件：

1. Dry-run：
   - `confirm=false`
   - `relativePaths=[当前文件相对路径]`
2. 结果校验：
   - 读取首个 `item.nextRelativePath`
   - 必须严格等于 `parentDir + "/" + nextBaseName + originalExt`
3. Commit：
   - 仅当校验通过时执行 `confirm=true`
   - 参数与 dry-run 保持同构
4. 任一阶段失败必须可见反馈；dry-run 校验不通过不得进入 commit。

## 6. 失败与降级行为 (Failure & Degradation)

1. 空名、仅空白名、包含路径分隔符的输入必须前置校验失败，不触发工具调用。
2. 工具上下文缺失（`rootHandle/rootId`）时必须阻断重命名并提示“工具上下文不完整”。
3. 网关离线或工具缺失时，入口禁用并提示“重命名能力不可用（网关离线或未注册 fs.batchRename）”。
4. 提交阶段若出现并发冲突（例如目标已存在）必须提示失败，不得静默回退。

## 7. 功能需求 (FR)

1. `FR-PIR-01` 预览标题必须支持点击进入重命名编辑态（仅文件名主体可编辑）。
2. `FR-PIR-02` 编辑态必须支持 `Enter` 提交、失焦提交、`Esc` 取消。
3. `FR-PIR-03` 重命名必须执行 `dry-run -> 目标路径校验 -> commit` 固定链路。
4. `FR-PIR-04` 校验不通过（含自动去重）必须终止并提示“目标名称已存在”。
5. `FR-PIR-05` 网关离线/工具缺失时必须禁用入口并提示原因。
6. `FR-PIR-06` 成功后必须刷新目录并优先回绑到重命名后的文件路径。
7. `FR-PIR-07` 侧栏预览与全屏预览行为必须同构一致。
8. `FR-PIR-08` 编辑态输入框必须占满标题区可用宽度，以支持长文件名编辑场景。
9. `FR-PIR-09` 随机遍历模式下，重命名成功后必须保持当前文件为激活预览目标。
10. `FR-PIR-10` 单文件改名提交成功后必须触发路径重绑，且 `fileId` 保持稳定。
11. `FR-PIR-11` 重绑失败不得回滚已完成的文件重命名。

## 8. 验收标准 (AC)

1. `AC-PIR-01` 在侧栏预览点击标题改名成功后，网格显示新文件名且预览仍为该文件。
2. `AC-PIR-02` 在全屏预览同样可改名，成功后仍停留同一文件内容。
3. `AC-PIR-03` 输入与同目录已有文件重名时，提示“目标名称已存在”，不发生重命名。
4. `AC-PIR-04` `Enter`、失焦、`Esc` 三种交互语义符合契约。
5. `AC-PIR-05` 网关离线时入口不可用且可见原因提示。
6. `AC-PIR-06` 非法输入不触发重命名，原文件保持不变。
7. `AC-PIR-07` 当文件名主体超过 `40` 字符时，进入编辑态输入框仍覆盖标题区可用宽度，不出现默认窄输入框。
8. `AC-PIR-08` 随机遍历模式下对当前媒体文件重命名成功后，预览目标保持为重命名后的同一文件，不跳转到首项。
9. `AC-PIR-09` 改名成功后，`file` 表对应 `relativePath` 被更新，原 `fileId` 下的标注/人脸仍可查询。
10. `AC-PIR-10` 人工构造重绑失败时，文件名保持新值且界面提示后处理告警。

## 9. 公共接口与类型影响 (Public Interfaces & Types)

1. 预览侧 mutation 回调签名升级为可选参数：
   - `onMutationCommitted?: (params?: { preferredPreviewPath?: string }) => void | Promise<void>`
2. `PreviewTitleRow` 新增可编辑相关输入输出接口（可编辑开关、提交、取消、错误、忙碌态）。
3. `usePreviewTraversal` 新增“按路径优先回绑预览目标”公开能力，用于刷新后维持同一预览文件。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. 本专题不新增快捷键，不修改 `src/config/shortcuts.ts` 与 `docs/shortcuts.md`。
2. 文件扩展名保持不变，重命名仅作用于主体名。
3. 继续复用网关能力模型，不引入本地写入降级路径。

## 11. 关联主题 (Related Specs)

- UI 基线：[`../003-ui-ux/spec.md`](../003-ui-ux/spec.md)
- 预览播放：[`../100-preview-playback/spec.md`](../100-preview-playback/spec.md)
- 插件运行时：[`../105-plugin-runtime-interaction/spec.md`](../105-plugin-runtime-interaction/spec.md)
- 批量重命名：[`../106-batch-rename-workspace/spec.md`](../106-batch-rename-workspace/spec.md)
