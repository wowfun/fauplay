# 115 Facial Recognition 人脸识别规范

## 1. 目的 (Purpose)

定义 Fauplay 人脸识别能力在 Gateway 统一数据层下的契约：

1. 检测与 embedding 推理由插件提供，并同时覆盖图片与视频抽帧输入。
2. 聚类、人物归属、人物管理、人脸纠错、持久化由 Gateway 执行。
3. 人脸与人物数据统一持久化在全局数据库 `faudb.sqlite`。
4. 人脸与人物关系统一以 `assetId` 为业务真源；同内容文件的多路径位置共享同一套人脸结果。

## 2. 范围与非目标 (In Scope / Out of Scope)

范围内：

1. 单资产检测并产出检测框与 embedding；视频资产通过抽帧后产出代表性 faces。
2. Gateway 侧全局增量聚类、人物命名、人物合并、face 级纠错。
3. 预览人脸框展示、单脸纠错与人物详情查询（含显示/隐藏切换）。
4. 统一标签系统的人物标签写入（`source=vision.face`）。

范围外：

1. 手工框选编辑。
2. `sha256` 人工校验与全局管理流程。
3. 全量重聚类优化。

## 3. 架构契约 (Architecture Contract)

1. `vision-face` 插件仅负责推理，不得执行 SQLite DDL/DML。
2. Gateway 为人脸与人物数据唯一写入者。
3. 前端人脸流程统一调用 Gateway HTTP 接口。
4. `vision-face` 默认运行配置文件固定为 `tools/mcp/vision-face/config.json`；独立运行可显式传 `--config <path>`，显式传入时只读取该文件。
5. 插件不得自动读取 `~/.fauplay/global/vision-face.json` 作为内建覆盖层。

## 4. 数据与存储契约 (SQLite Contract)

### 4.1 路径与隔离

1. 数据库路径固定为：`${HOME}/.fauplay/global/faudb.sqlite`。
2. 全应用共享单一全局库；`rootPath` 仅作为文件级请求的路径解析与过滤条件。

### 4.2 最小表契约

必须存在：

1. `asset`
2. `file`
3. `face`
4. `face_embedding`
5. `person`
6. `person_face`
7. `tag`
8. `asset_tag`

约束：

1. `face.assetId` 必须关联 `asset.id`。
2. `person_face.faceId` 唯一，保证一脸一人物。
3. 向量格式保持 `float32 blob`。
4. 不再持久化 `face_job_state`。
5. 普通人脸与人物查询默认仅返回活跃资产（`asset.deletedAt IS NULL`）。
6. `face.mediaType` 必须支持 `image | video`。
7. `face.frameTsMs` 对图片 face 固定为 `NULL`；对视频 face 表示采样帧时间点（毫秒）。

### 4.3 标签投影契约（`vision.face`）

1. 资产级人物标签必须由 `person_face` 关系投影生成。
2. 标签格式固定为：`source=vision.face`、`key='person'`、`value=person.name`。
3. 同名人物允许存在；资产级标签在名字维度合并，不保证人物级可区分过滤。
4. file-centered 查询必须把资产级 `vision.face` 标签展开到每个可见 `file`，且公开结果不依赖 `fileId`。
5. `rename-person`、`merge-people` 与所有 face correction mutation 后，相关资产及其所有可见文件结果的 `vision.face` 标签必须同步更新。

## 5. Gateway HTTP 接口契约 (HTTP Contract)

1. `POST /v1/faces/detect-asset`
2. `POST /v1/faces/cluster-pending`
3. `POST /v1/faces/list-people`
4. `POST /v1/faces/rename-person`
5. `POST /v1/faces/merge-people`
6. `POST /v1/faces/list-asset-faces`
7. `POST /v1/faces/list-review-faces`
8. `POST /v1/faces/suggest-people`
9. `POST /v1/faces/assign-faces`
10. `POST /v1/faces/create-person-from-faces`
11. `POST /v1/faces/unassign-faces`
12. `POST /v1/faces/ignore-faces`
13. `POST /v1/faces/restore-ignored-faces`
14. `POST /v1/faces/requeue-faces`
15. `GET /v1/faces/crops/:faceId`

输入参数语义：

1. `detect-asset` 与文件上下文 `list-asset-faces` 继续通过 `rootPath + relativePath` 解析到 `absolutePath -> file -> asset`。
2. `detect-asset` 必须支持可选 `runCluster?: boolean`；为 `true` 时检测写入后需在同一次请求内串行补跑一次 `cluster-pending`，且视频资产不得因单个陌生 face 直接创建新人导致人物爆炸。
3. face 查询与检测返回项必须支持 `mediaType: 'image' | 'video'` 与 `frameTsMs: number | null`。
4. `GET /v1/faces/crops/:faceId` 不新增新路由；当目标为视频 face 时，必须按 `frameTsMs` 截帧后再裁切。
5. `list-people` 与人物上下文 `list-asset-faces` 必须支持显式 `scope: 'global' | 'root'`；`scope='root'` 时 `rootPath` 必填。
6. `rename-person`、`merge-people` 与 face correction mutation 默认工作在全局人物空间，不按当前 root 隔离。

## 6. 聚类契约 (Incremental Clustering)

1. 相似判定：余弦距离 `<= maxDistance`。
2. 核心点判定：匹配数 `>= minFaces`。
3. 分配顺序：优先已有人物 -> 否则新建人物 -> 否则 deferred。
4. 聚类与归属变更必须事务提交。
5. 聚类与人物管理默认在全部活跃资产范围内运行，不以当前 root 作为隔离边界。
6. 自动聚类仅处理 `face.status IN ('unassigned', 'deferred')`，不得自动改写 `manual_unassigned` 与 `ignored`。
7. 图片手动 `detect-asset(runCluster=true)` 可使用即时创建策略；视频手动 `detect-asset(runCluster=true)` 必须使用保守聚类策略，优先归到已有人物或强证据人物，证据不足时保持 `deferred/unassigned` 进入人工整理。

## 7. 功能需求 (FR)

1. `FR-FACE-01` 人脸数据必须持久化到 `faudb.sqlite`。
2. `FR-FACE-02` 插件不得直写人脸/人物表。
3. `FR-FACE-03` 所有人脸记录必须统一关联 `assetId`。
4. `FR-FACE-04` 系统必须提供上述 Gateway HTTP 人脸接口。
5. `FR-FACE-05` 人物命名/合并后，列表与预览展示必须一致。
6. `FR-FACE-06` 人物归属应同步写入统一标签模型（`source=vision.face`）。
7. `FR-FACE-07` 系统不得依赖 `face_job_state` 作为流程状态真源。
8. `FR-FACE-08` 预览区必须提供“人脸框显示/隐藏”显式开关，且开关状态需持久化到 `localStorage`（键：`fauplay:preview-face-bbox-visible`）。
9. `FR-FACE-09` 人脸框开关默认值必须为“隐藏”，并在侧栏预览与全屏预览间保持一致。
10. `FR-FACE-10` 人脸框显示状态仅影响前端覆盖层渲染，不得作为后台检测/识别（`detect-asset/list-asset-faces/cluster-pending/list-people`）的门控条件。
11. `FR-FACE-11` 预览文件的人脸检测/识别完成后，当前预览头部标签必须在同一预览会话内即时同步，无需切换文件。
12. `FR-FACE-12` 同内容文件位于不同路径时，所有可见路径必须共享同一套人脸框、人物归属与人物标签结果。
13. `FR-FACE-13` 人脸归属的单一真源必须是 `person_face`；前端与 Gateway 不得通过写 `vision.face` 标签直接实现人物纠错。
14. `FR-FACE-14` `person_face.assignedBy` 必须支持 `auto | manual | merge`。
15. `FR-FACE-15` `face.status` 必须支持 `assigned | unassigned | deferred | manual_unassigned | ignored`。
16. `FR-FACE-16` 系统必须提供 face 级纠错 HTTP 接口，至少支持 assign/create-person/unassign/ignore/restore/requeue。
17. `FR-FACE-17` 人物详情区必须支持基于 face crop 的批量纠错，不得仅停留在关联文件汇总。
18. `FR-FACE-18` 点击预览人脸框时，系统必须支持进入单脸纠错，而不是仅允许跳转人物详情。
19. `FR-FACE-19` 系统必须提供跨 Root 可读的人脸裁切接口，用于全局人物整理。
20. `FR-FACE-20` 改变人物有效归属的 mutation 后，人物缓存与 `vision.face` 标签投影必须同步刷新。
21. `FR-FACE-21` 系统必须支持对视频资产进行按时长自适应抽帧检测，并将抽样结果与图片 face 一并纳入同一人物空间。
22. `FR-FACE-22` 视频检测结果必须支持视频内去重与单资产候选上限，避免同一视频的近重复 faces 大量写入数据库。
23. `FR-FACE-23` 视频来源 faces 必须支持通过现有 `face crop` 接口渲染到人物工作台，并可执行既有纠错动作。
24. `FR-FACE-24` v1 视频人脸识别必须为文件级手动触发，不得在打开视频预览时自动启动。
25. `FR-FACE-25` v1 不得在视频播放器中渲染时序人脸框覆盖层。

## 8. 验收标准 (AC)

1. `AC-FACE-01` `detect-asset` 后可查询到人脸框数据。
2. `AC-FACE-02` `cluster-pending` 后，同人物可在全局活跃资产范围内归并。
3. `AC-FACE-03` `rename-person` 与 `merge-people` 后查询结果立即一致。
4. `AC-FACE-04` 重启后全局库可恢复人脸与人物数据。
5. `AC-FACE-05` 人脸流程后，资产级 `vision.face` 标签与 `person_face` 关系一致。
6. `AC-FACE-06` 旧 `faces.v1.sqlite` 与旧 per-root `faudb.v1.sqlite` 存在时，新流程不读取且不崩溃。
7. `AC-FACE-07` 首次进入预览（无持久化值）时不显示人脸框；用户显式开启后刷新页面仍保持开启。
8. `AC-FACE-08` 侧栏预览与全屏预览切换时，人脸框开关状态一致且实时生效。
9. `AC-FACE-09` 在图片预览中关闭人脸框后，后台仍可继续执行检测/识别流程并更新人物归属；再次开启时可直接展示最新识别结果。
10. `AC-FACE-10` 自动 `detect-asset/cluster-pending` 或预览内手动 `vision.face` 成功后，当前文件预览标签在一次异步刷新内可见，不依赖切换文件触发。
11. `AC-FACE-11` 同内容文件在不同路径下出现时，这些 file-centered 结果可看到同一套人脸框与人物信息。
12. `AC-FACE-12` 将某张已归属 face 从人物 A 移到人物 B 后，人物列表、人脸详情与预览头部 `vision.face` 标签结果保持一致。
13. `AC-FACE-13` 将某张已归属 face 移出后，其状态变为 `manual_unassigned`，且不会在后台自动聚类中立刻被改回。
14. `AC-FACE-14` 将 face 标记为 `ignored` 后，其不会继续出现在普通未归属自动整理流程中。
15. `AC-FACE-15` 恢复 `ignored` face 后，其状态变为 `manual_unassigned`。
16. `AC-FACE-16` 对 `manual_unassigned` face 执行 requeue 后，其状态变为 `deferred`，可再次参与自动聚类。
17. `AC-FACE-17` 人物工作台可在 `人物 / 未归属 / 误检/忽略` 之间切换，并支持 `全局 / 当前 Root` 作用域切换。
18. `AC-FACE-18` 预览中点击任意脸框时可进入单脸纠错，并支持目标人物选择或建新人。
19. `AC-FACE-19` 跨 Root 的 face 卡片可通过裁切接口显示并执行纠错，不依赖当前 root 下主预览成功打开。
20. `AC-FACE-20` 对视频文件手动执行 `detect-asset(runCluster=true)` 后，视频可产出带 `mediaType='video'` 与 `frameTsMs` 的 face 记录；若匹配已有人物或达到保守聚类证据要求，则在同一预览会话内看到人物标签刷新，否则进入待整理。
21. `AC-FACE-21` 同一视频内多个相近采样帧命中同一人物时，最终落库 face 数会经视频内去重收敛，而不是逐帧全量写入。
22. `AC-FACE-22` 人物工作台中的视频来源 face 卡片可通过 `GET /v1/faces/crops/:faceId` 正常显示裁切图并执行纠错。
23. `AC-FACE-23` 打开视频预览后，系统不会像图片预览那样自动触发检测，也不会在播放器上显示时序脸框。

## 9. 默认值与一致性约束 (Defaults & Consistency)

1. v1 运行时配置：`modelName/minScore/maxDistance/minFaces` 保持既有语义。
2. 写请求事务化，失败可回滚。
3. 错误码前缀保持 `FACE_`。
4. `localStorage` 不可用时允许降级为仅会话内状态，且默认仍为隐藏。
5. “即时同步”语义为同一预览会话内完成一次文件级标签快照刷新即可，不要求阻塞 UI。
6. 普通人物与人脸查询默认排除软删除资产；软删除资产仅为未来全局管理/校验接口预留。
7. face correction mutation 默认允许部分成功，并返回逐项结果。
8. v1 视频抽帧默认值固定为：`videoShortIntervalMs = 3000`、`videoShortMaxDurationMs = 60000`、`videoMaxFrames = 20`；短视频从 `0s` 起每 `3s` 采样，长视频采 `0%, 5%, ... 95%` 共 20 个时间点。
9. v1 视频无法读取可信 duration 时，使用递增间隔 fallback：时间点为 `0s, 1s, 3s, 6s, 10s, 15s...`，最多 20 帧，首次取帧失败即停止。
10. v1 视频检测默认收敛参数固定为：`videoMinScore = 0.80`、`videoDedupeMaxDistance = 0.40`、`videoMaxFacesPerAsset = 20`。
11. v1 视频识别入口固定为预览文件级手动动作；不新增自动检测与视频时序 overlay。

## 10. 关联主题 (Related Specs)

- 基础数据契约：[`../005-local-data-contracts/spec.md`](../005-local-data-contracts/spec.md)
- 本地数据管理插件：[`../114-local-data-plugin/spec.md`](../114-local-data-plugin/spec.md)
- 契约基线：[`../002-contracts/spec.md`](../002-contracts/spec.md)
