# Tag Core 全局资产参考文档

## 1. 目标

1. 以 `asset + file + tag + asset_tag` 作为统一标签核心模型。
2. 其他业务表仅保留必要实体：`face/face_embedding/person/person_face`。
3. 不引入 `root`、`asset_fingerprint` 或任何 `*_tag_ext` 扩展表。
4. 全局 SQLite 真源固定为 `${HOME}/.fauplay/global/faudb.sqlite`。

## 2. 核心关系

1. `asset` 记录内容实体，是标签、人脸、分类的统一业务真源。
2. `file` 记录物理位置实体，以 `absolutePath` 表示当前有效位置。
3. `tag` 记录标签身份（去重维度为 `key + value + source`）。
4. `asset_tag` 记录资产与标签绑定，并承载绑定时间与可选评分。
5. 人脸业务以 `person_face` 为人物归属真源，再投影到 `vision.face` 资产标签；`face.status` 用于表达自动待处理、人工移出与忽略状态；file-centered 查询会把资产标签展开到每个可见 `file`。

## 3. 契约级 DDL

```sql
CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fpMethod TEXT NOT NULL,
  sha256 TEXT,
  deletedAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (size, fingerprint, fpMethod)
);

CREATE TABLE IF NOT EXISTS file (
  absolutePath TEXT PRIMARY KEY,
  assetId TEXT NOT NULL,
  fileMtimeMs INTEGER,
  lastSeenAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (assetId) REFERENCES asset(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tag (
  id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (key, value, source)
);

CREATE TABLE IF NOT EXISTS asset_tag (
  assetId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  appliedAt INTEGER NOT NULL,
  score REAL,
  PRIMARY KEY (assetId, tagId),
  FOREIGN KEY (assetId) REFERENCES asset(id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES tag(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face (
  id TEXT PRIMARY KEY,
  assetId TEXT NOT NULL,
  x1 REAL NOT NULL,
  y1 REAL NOT NULL,
  x2 REAL NOT NULL,
  y2 REAL NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'unassigned',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (assetId) REFERENCES asset(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face_embedding (
  faceId TEXT PRIMARY KEY,
  dim INTEGER NOT NULL DEFAULT 512,
  embedding BLOB NOT NULL,
  FOREIGN KEY (faceId) REFERENCES face(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  featureFaceId TEXT,
  faceCount INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (featureFaceId) REFERENCES face(id)
);

CREATE TABLE IF NOT EXISTS person_face (
  personId TEXT NOT NULL,
  faceId TEXT NOT NULL UNIQUE,
  assignedBy TEXT NOT NULL,
  assignedAt INTEGER NOT NULL,
  PRIMARY KEY (personId, faceId),
  FOREIGN KEY (personId) REFERENCES person(id) ON DELETE CASCADE,
  FOREIGN KEY (faceId) REFERENCES face(id) ON DELETE CASCADE
);
```

推荐索引：

```sql
CREATE INDEX IF NOT EXISTS idx_file_asset_id ON file(assetId);
CREATE INDEX IF NOT EXISTS idx_tag_source_key_value ON tag(source, key, value);
CREATE INDEX IF NOT EXISTS idx_asset_tag_tag_id ON asset_tag(tagId);
CREATE INDEX IF NOT EXISTS idx_asset_tag_applied_at ON asset_tag(appliedAt);
CREATE INDEX IF NOT EXISTS idx_face_asset_id ON face(assetId);
CREATE INDEX IF NOT EXISTS idx_person_face_person_id ON person_face(personId);
CREATE INDEX IF NOT EXISTS idx_asset_deleted_at ON asset(deletedAt);
```

## 4. 删除对象

以下对象在全局资产模型中不再保留：

1. `root`
2. `annotation_record`
3. `face_job_state`
4. `asset_fingerprint`
5. `file_tag`
6. `annotation_tag_ext`
7. `face_tag_ext`
8. `classification_tag_ext`

## 5. 标签语义

1. `meta.annotation`：`key=fieldKey`、`value=fieldValue`，写入 `asset_tag`。
2. `vision.face`：`key='person'`、`value=personName`，按 `person_face` 投影到资产标签。
3. `ml.classify`：`key='class'`、`value=label`，`score` 写入 `asset_tag.score`。
4. 同名人物允许存在；资产级 `vision.face` 标签在名字维度合并。
5. face correction 必须直接修改 `person_face + face.status`；`vision.face` 标签只允许作为投影结果同步，不得被当作纠错写入真源。

## 6. 接口行为映射

1. 本地数据写接口统一为：
   - `PUT /v1/file-annotations`
   - `PATCH /v1/files/relative-paths`
   - `POST /v1/files/missing/cleanups`
2. 上述接口继续接收 `rootPath + relativePath`，Gateway 内部统一解析为 `absolutePath` 再读写 `file -> asset`。
3. `/v1/data/tags/*` 的时间语义以 `asset_tag.appliedAt` 为准。
4. 普通查询默认仅返回 `asset.deletedAt IS NULL` 的活跃资产。
5. 人脸接口路径不变，但内部流程不依赖 `face_job_state`，且默认工作在全局人物空间。
6. `list-people` 与人物上下文 `list-asset-faces` 支持显式 `scope: 'global' | 'root'`。
7. 人脸 mutation 接口统一返回批量摘要与逐项结果，允许部分成功。

## 7. 迁移策略

1. 检测到旧结构时，直接重建全局数据库（不做备份）。
2. 不读取、不导入旧 `<root>/.fauplay/faudb.v1.sqlite`。
3. `person.name` 不设唯一约束，允许同名。
4. `score` 作为 `asset_tag` 通用可空列，当前仅 `ml.classify` 使用。
5. `sha256` 仅预留为可空字段，不在 v1 设计其生成流程或管理接口。

## 8. 验收场景

1. 首次访问自动创建全局结构，且不存在被移除的表。
2. 同一物理文件从重叠 root 打开两次时，只存在一条 `file(absolutePath)`。
3. `file-annotations` 同资产同字段重复写入时，只保留一个当前值绑定。
4. 分类落库后 `asset_tag.score` 可查询，非分类标签 `score` 为 `NULL`。
5. 人脸检测/聚类/改名/合并/纠错后，资产级 `vision.face` 标签与 `person_face` 结果一致。
6. 同内容文件位于不同路径时，file-centered 查询会返回多条 `file`，但这些结果共享同一套资产标签与人脸数据。
7. 缺失路径清理只删除不存在的 `file.absolutePath` 行；当最后一个 `file` 消失时，`asset` 进入软删除；同内容文件再次出现时，原 `asset` 自动复活。
8. `manual_unassigned` 与 `ignored` face 不会被后台自动聚类直接改写；只有 `unassigned` 与 `deferred` 会进入自动聚类候选集。
