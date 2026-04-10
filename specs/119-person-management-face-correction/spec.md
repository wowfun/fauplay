# 119 Person Management & Face Correction 人物管理与人脸纠错规范

## 1. 目的 (Purpose)

定义 Fauplay 的人物管理（Person Management）与人脸纠错（Face Correction）契约，确保：

1. 人物级管理与 face 级纠错分层清晰，但共享同一套人物真源。
2. 人物归属（`face -> person` assignment）的单一真源（Single Source of Truth）固定为 `person_face`，不得通过标签覆盖实现纠错。
3. 后台自动聚类与前台人工纠错可并存，且人工纠错优先级高于自动聚类。
4. 人物空间默认全局（global），并支持显式切换到当前 Root（root-scoped）查询。
5. 跨 Root 的人物整理可通过稳定的人脸裁切（face crop）读取能力完成，不依赖当前文件预览上下文。

## 2. 关键术语 (Terminology)

- 人物级管理（Person-level Management）
- face 级纠错（Face-level Correction）
- 人物归属（Face-to-Person Assignment）
- 单一真源（Single Source of Truth）
- 人工未归属（Manual Unassigned）
- 误检/忽略（Ignored Face）
- 待聚类（Deferred Face）
- 全局人物空间（Global People Space）
- Root 作用域查询（Root-scoped Query）
- 人脸裁切（Face Crop）
- 视频来源人脸（Video-origin Face）
- 采样帧时间点（Frame Timestamp）

## 3. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 人物级管理：重命名、合并、查看详情。
2. face 级纠错：移到已有人物、新建人物并移入、人工移出、误检忽略、恢复、重新交还自动聚类。
3. 人物工作台三段式信息架构：`人物`、`未归属`、`误检/忽略`。
4. 预览区单脸快修与人物详情批量整理。
5. 跨 Root 人脸卡片渲染所需的 Gateway 裁切接口。
6. 视频抽样 face 进入人物工作台并复用既有纠错流程。

范围外：

1. 手工框选新增/修改人脸框。
2. 普通用户可见的“同资产重检并继承旧 faceId”流程。
3. 全量重聚类优化与类中心（cluster centroid）持久化。

## 4. 核心语义 (Core Semantics)

1. 人物（Person）不是固定类中心，而是“当前已归属 faces 的动态集合”。
2. face 级纠错的主语义固定为“修改 `face -> person` 归属”，而不是“修改 `vision.face` 标签”。
3. `person_face` 是已归属人物的唯一真源；`vision.face` 资产标签仅是投影结果。
4. `manual_unassigned` 表示“用户明确移出当前人物，暂不交还自动聚类”。
5. `ignored` 表示“误检/忽略，后续默认不再参与人物管理与自动聚类”。
6. `deferred` 表示“自动流程暂不确定，可继续参与后续自动聚类”。
7. 自动聚类只能处理 `unassigned | deferred`；不得自动改写 `manual_unassigned | ignored`。

## 5. 数据与状态契约 (Data / State Contract)

1. 不新增表；继续沿用 `face`、`face_embedding`、`person`、`person_face`。
2. `face` 可同时表示图片 face 与视频采样帧 face；两者共用同一人物空间与纠错接口。
3. `person_face.assignedBy` 必须支持：
   - `auto`
   - `manual`
   - `merge`
4. `face.status` 必须支持：
   - `assigned`
   - `unassigned`
   - `deferred`
   - `manual_unassigned`
   - `ignored`
5. 视频 face 需额外携带 `mediaType='video'` 与 `frameTsMs`；图片 face 固定为 `mediaType='image'` 且 `frameTsMs=NULL`。
6. 状态流转约束：
   - 人工归属到某人物：写入/更新 `person_face`，`assignedBy='manual'`，`face.status='assigned'`
   - 人工移出：删除 `person_face`，`face.status='manual_unassigned'`
   - 误检忽略：删除 `person_face`，`face.status='ignored'`
   - 恢复误检：`face.status='manual_unassigned'`
   - 重新交还自动聚类：仅允许从 `manual_unassigned -> deferred`
7. 任何改变有效人物归属的写请求都必须：
   - 事务提交
   - 刷新人物缓存
   - 同步受影响资产的 `vision.face(person=...)` 标签投影

## 6. Gateway HTTP 接口契约 (HTTP Contract)

保留：

1. `POST /v1/faces/detect-asset`
2. `POST /v1/faces/cluster-pending`
3. `POST /v1/faces/list-people`
4. `POST /v1/faces/rename-person`
5. `POST /v1/faces/merge-people`
6. `POST /v1/faces/list-asset-faces`

新增：

1. `POST /v1/faces/list-review-faces`
2. `POST /v1/faces/suggest-people`
3. `POST /v1/faces/assign-faces`
4. `POST /v1/faces/create-person-from-faces`
5. `POST /v1/faces/unassign-faces`
6. `POST /v1/faces/ignore-faces`
7. `POST /v1/faces/restore-ignored-faces`
8. `POST /v1/faces/requeue-faces`
9. `GET /v1/faces/crops/:faceId?size=160&padding=0.35`

### 5.1 查询接口

1. `listPeople`
   - 输入：`scope: 'global' | 'root'`、`rootPath?`、`query?`、`page`、`size`
   - 当 `scope='root'` 时，`rootPath` 必填
   - `faceCount` 返回当前作用域计数；同时返回 `globalFaceCount` 供 UI 显示全局上下文
2. `listAssetFaces`
   - 文件上下文查询继续使用 `rootPath + relativePath`
   - 人物上下文查询增加 `scope: 'global' | 'root'`，`scope='root'` 时 `rootPath` 必填
   - 返回项需支持 `mediaType` 与 `frameTsMs`
3. `listReviewFaces`
   - 输入：`scope`、`rootPath?`、`bucket: 'unassigned' | 'ignored'`、`page`、`size`
   - `bucket='unassigned'` 必须包含 `unassigned | deferred | manual_unassigned`
   - 排序固定为：`manual_unassigned` 优先，其次 `deferred`，再其次 `unassigned`；同状态内按 `updatedAt DESC`
4. `suggestPeople`
   - 输入：`faceId`、`candidateSize?`
   - v1 只支持单脸建议；批量 UI 使用最后聚焦脸作为建议锚点
   - 返回候选项必须包含 `personId`、`name`、`score` 或 `distance`、以及一个 `supportingFace`
   - `supportingFace` 若来自视频，需保留 `frameTsMs`

### 5.2 批量写接口

1. 所有写接口均采用“一次请求 = 一种动作 + 一个目标”语义。
2. 输入统一接受 `faceIds[]`。
3. 写接口允许部分成功，响应统一返回：
   - `total`
   - `succeeded`
   - `failed`
   - `items[]`
4. 每个 `items[]` 至少包含：
   - `faceId`
   - `ok`
   - `previousStatus`
   - `previousPersonId?`
   - `nextStatus`
   - `nextPersonId?`
   - `reasonCode?`
   - `error?`
5. 稳定错误码至少包含：
   - `FACE_NOT_FOUND`
   - `PERSON_NOT_FOUND`
   - `FACE_ALREADY_ASSIGNED_TO_TARGET`
   - `FACE_ALREADY_IGNORED`
   - `FACE_STATE_CONFLICT`

## 7. 用户可见行为契约 (User-visible Contract)

1. 人物工作台必须提供三个一级视图：
   - `人物`
   - `未归属`
   - `误检/忽略`
2. 人物工作台顶部必须提供作用域切换：
   - `全局`
   - `当前 Root`
3. 现有“人物详情关联图片列表”必须替换为基于人脸裁切（face crop）的卡片网格。
4. 人脸卡片至少展示：
   - 裁切图
   - 选中态
   - 识别分数（score）
   - 来源路径
   - 当 face 来自视频时，额外展示采样时间点
5. 工作台必须支持多选批量整理，且允许混合来源 faces 一次执行同一动作。
6. 预览区点击任意脸框后，必须打开 face 纠错面板，而不是仅在已归属时跳转人物详情。
7. 预览纠错面板至少提供：
   - 当前人物信息
   - 推荐人物
   - 人物搜索
   - 新建人物
   - 移出为未归属
   - 标记忽略
   - 打开人物详情
8. 跨 Root 卡片必须通过 `/v1/faces/crops/:faceId` 渲染，并保持可纠错；v1 不要求这些卡片一定能打开当前 Root 之外的主预览面板。
9. 从预览纠错面板打开人物详情时，人物管理抽屉必须可见且可交互；若当前处于全屏预览，人物管理抽屉必须覆盖在全屏预览之上。
10. 人物视图中的“搜索人物名”只得更新人物列表，不得触发人物工作台全量刷新；输入需做短延迟去抖，避免同一轮键入产生请求风暴或导致 Gateway 超时。
11. 来自预览的“打开人物详情”定位仅作为当前打开会话的初始人物或后续显式再次跳转目标；进入人物工作台后，用户必须能够手动切换到其他人物，且不得被后台列表刷新自动改回。
12. 人物级合并必须以“当前人物并入目标人物”为交互方向：当前正在查看的人物是 source，用户选择的目标人物是 target；目标候选必须展示可识别的代表脸或占位、人物名与数量上下文，避免只凭名称合并。
13. v1 视频来源 faces 仅进入人物工作台与纠错面板，不要求在视频播放器内显示可点击的时序脸框。
14. 人物详情 face 网格必须与文件网格共享选择交互语义：普通单击单选，`Ctrl/Cmd + 单击` 切换多选，`Shift + 单击` 按当前排序范围选择，并支持从网格空白区域发起鼠标框选。
15. 人物详情 face 卡片不得在正文中重复展示“已归属/未归属/人物名称”等当前视图已隐含的信息；这些信息可保留在辅助文本或可访问性标签中。
16. 双击当前 Root 内的 face 卡片必须打开来源文件到右侧预览栏，并保持人物工作台打开且不改变当前 face 选择；跨 Root、绝对路径或缺失来源路径的 face 可提示不可跳转。
17. 人物工作台必须支持将当前已选 faces 的源图片/视频投射到底部结果面板；投射文件列表按源文件去重，保持当前 face 网格中首次出现顺序，投射后自动关闭人物工作台，并让右侧预览与上一项/下一项遍历跟随该投射标签。

## 8. 功能需求 (FR)

1. `FR-PMFC-01` 系统必须同时提供人物级管理与 face 级纠错两层能力。
2. `FR-PMFC-02` 人工纠错不得通过写覆盖标签实现，必须直接修改 `person_face` 与 `face.status`。
3. `FR-PMFC-03` 自动聚类只能处理 `unassigned | deferred`，不得自动改写 `manual_unassigned | ignored`。
4. `FR-PMFC-04` 人物空间默认必须是全局查询，并支持显式切换到当前 Root 查询。
5. `FR-PMFC-05` 人物详情视图必须基于人脸裁切卡片而非文件路径汇总。
6. `FR-PMFC-06` 预览区点击任意脸框时必须可进入单脸纠错。
7. `FR-PMFC-07` 系统必须支持把选中 faces 批量移到已有人物。
8. `FR-PMFC-08` 系统必须支持基于选中 faces 批量新建人物，且允许空名称。
9. `FR-PMFC-09` 系统必须支持把已归属 face 移到 `manual_unassigned`。
10. `FR-PMFC-10` 系统必须支持把 face 标记为 `ignored`，并支持恢复到 `manual_unassigned`。
11. `FR-PMFC-11` 系统必须支持显式把 `manual_unassigned` 重新交还自动聚类，状态转为 `deferred`。
12. `FR-PMFC-12` 任一改变有效归属的 mutation 后，人物计数、人物列表、人脸详情与 `vision.face` 标签必须保持一致。
13. `FR-PMFC-13` 系统必须提供跨 Root 可读的人脸裁切接口，用于全局人物整理。
14. `FR-PMFC-14` 视频来源 faces 必须可在人物工作台中展示为可选择、可批量整理的 face 卡片。
15. `FR-PMFC-15` 视频来源 face 卡片必须显示采样时间点，便于区分同一视频中的不同代表脸。
16. `FR-PMFC-16` 视频即时识别中证据不足的陌生 faces 必须保留为待整理状态，不得因单次视频识别直接制造大量新人。
17. `FR-PMFC-17` 人物级合并必须把当前人物作为 source、用户选择的人物作为 target，并在执行前让用户看见目标人物的代表脸或占位。
18. `FR-PMFC-18` 人物详情 face 网格与文件网格必须复用共享选择交互实现，避免 Ctrl/Cmd、Shift 与鼠标框选语义分叉。
19. `FR-PMFC-19` 人物详情必须支持双击当前 Root face 跳转来源文件预览，且不得改变当前 face 多选状态。
20. `FR-PMFC-20` 人物详情必须支持把已选 faces 的源文件投射为现有 `ResultProjection` 文件列表，并复用底部结果面板的预览遍历语义。

## 9. 验收标准 (AC)

1. `AC-PMFC-01` 在预览中点击一个已归属 face 后，可将其移动到另一个已有人物。
2. `AC-PMFC-02` 在预览中点击一个未归属 face 后，可直接创建未命名人物并完成归属。
3. `AC-PMFC-03` 从某人物中移出 face 后，该 face 进入 `manual_unassigned`，且不会被后台自动聚类立即改回。
4. `AC-PMFC-04` 将 `ignored` face 恢复后，其状态为 `manual_unassigned`，而不是自动重新归属。
5. `AC-PMFC-05` 对 `manual_unassigned` face 执行重新交还自动聚类后，其状态变为 `deferred`。
6. `AC-PMFC-06` 人物工作台可在 `人物 / 未归属 / 误检/忽略` 三个一级视图间切换。
7. `AC-PMFC-07` 人物工作台可在 `全局 / 当前 Root` 两种作用域间切换，且计数与结果同步变化。
8. `AC-PMFC-08` 人物详情支持多选 faces 并一次移动到同一目标人物。
9. `AC-PMFC-09` `未归属` 视图可同时展示 `manual_unassigned`、`deferred`、`unassigned`，且徽标可区分。
10. `AC-PMFC-10` 全局视图中的跨 Root faces 可正常显示裁切图并执行纠错动作。
11. `AC-PMFC-11` 在全屏预览中从人脸纠错面板打开人物详情时，人物管理抽屉覆盖显示在全屏预览之上，且关闭人物管理后仍可返回原全屏预览。
12. `AC-PMFC-12` 在人物工作台中连续输入人物名搜索时，只刷新人物列表查询，不会重复刷新人物详情与当前人脸网格，也不会因请求风暴导致页面持续闪动。
13. `AC-PMFC-13` 从预览打开某人物详情后，用户仍可点击人物列表切换到其他人物；后续列表刷新或搜索结果更新不得自动跳回最初打开的人物。
14. `AC-PMFC-14` 视频文件识别后，人物工作台可看到该视频产出的 face 卡片，并支持与图片来源 faces 一样执行批量纠错。
15. `AC-PMFC-15` 视频来源 face 卡片会显示 `mm:ss` 级时间点文本，但不会要求播放器同步跳转或显示时序 bbox。
16. `AC-PMFC-16` 对视频执行保守即时识别后，未能稳定匹配的人脸会出现在未归属/待整理视图中，可由用户手动归属或创建人物。
17. `AC-PMFC-17` 打开人物 A 的详情后，选择人物 B 的目标卡片并执行合并，请求语义为 `target=B, source=[A]`；合并后 A 消失，当前详情切换到 B。
18. `AC-PMFC-18` 人物详情 face 卡片不再显示“已归属/未归属/人物名”等冗余正文信息，但仍显示 score、来源路径与视频时间点。
19. `AC-PMFC-19` 人物详情 face 网格中的普通单击、`Ctrl/Cmd + 单击`、`Shift + 单击` 与鼠标框选结果和文件网格选择语义一致，批量纠错动作使用正确的选中 face 集合。
20. `AC-PMFC-20` 双击当前 Root 内 face 后，右侧预览栏打开其来源文件，人物工作台保持打开，双击前的 face 选择集合保持不变；跨 Root 或无来源路径时仅显示不可跳转提示。
21. `AC-PMFC-21` 选中多张 face 后执行“投射源文件”，人物工作台自动关闭，底部结果面板打开并激活“人脸来源”投射标签；同一源文件只出现一次，右侧预览与上一项/下一项遍历仅在该投射列表内移动。

## 10. 默认值与一致性约束 (Defaults & Consistency)

1. v1 不新增普通用户可见的“同资产重新检测并继承旧 faceId”能力。
2. 同一请求内的批量 mutation 默认允许部分成功，不采用全成全败策略。
3. `person.name` 允许为空；空名人物的展示名由 UI 或投影层回退为稳定占位名。
4. 本专题不修改快捷键配置契约，也不新增快捷键。
5. v1 不新增“视频播放器时间轴脸框”或“按时间点回放定位”交互。

## 11. 关联主题 (Related Specs)

- 人脸识别：[`../115-facial-recognition/spec.md`](../115-facial-recognition/spec.md)
- 本地数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 预览头部逻辑标签管理：[`../117-preview-header-tag-management/spec.md`](../117-preview-header-tag-management/spec.md)
