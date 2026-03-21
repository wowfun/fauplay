# Tag Core v2 参考文档

## 1. 目标

1. 以 `file + tag + file_tag` 作为统一标签核心模型。
2. 其他业务表仅保留必要实体：`face/face_embedding/person/person_face`。
3. 不引入任何 `*_tag_ext` 扩展表。

## 2. 核心关系

1. `file` 记录文件实体。
2. `tag` 记录标签身份（去重维度为 `key + value + source`）。
3. `file_tag` 记录文件与标签绑定，并承载绑定时间与可选评分。
4. 人脸业务以 `person_face` 为人物归属真源，再投影到 `vision.face` 文件标签。

## 3. 契约级 DDL

```sql
CREATE TABLE IF NOT EXISTS file (
  id TEXT PRIMARY KEY,
  relativePath TEXT NOT NULL UNIQUE,
  fileSizeBytes INTEGER,
  fileMtimeMs INTEGER,
  bindingFp TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tag (
  id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (key, value, source)
);

CREATE TABLE IF NOT EXISTS file_tag (
  fileId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  appliedAt INTEGER NOT NULL,
  score REAL,
  PRIMARY KEY (fileId, tagId),
  FOREIGN KEY (fileId) REFERENCES file(id) ON DELETE CASCADE,
  FOREIGN KEY (tagId) REFERENCES tag(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face (
  id TEXT PRIMARY KEY,
  fileId TEXT NOT NULL,
  x1 REAL NOT NULL,
  y1 REAL NOT NULL,
  x2 REAL NOT NULL,
  y2 REAL NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'unassigned',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (fileId) REFERENCES file(id) ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS idx_file_relative_path ON file(relativePath);
CREATE INDEX IF NOT EXISTS idx_tag_source_key_value ON tag(source, key, value);
CREATE INDEX IF NOT EXISTS idx_file_tag_tag_id ON file_tag(tagId);
CREATE INDEX IF NOT EXISTS idx_file_tag_applied_at ON file_tag(appliedAt);
CREATE INDEX IF NOT EXISTS idx_face_file_id ON face(fileId);
CREATE INDEX IF NOT EXISTS idx_person_face_person_id ON person_face(personId);
```

## 4. 删除对象

以下表在 v2 中不再保留：

1. `annotation_record`
2. `face_job_state`
3. `annotation_tag_ext`
4. `face_tag_ext`
5. `classification_tag_ext`

## 5. 标签语义

1. `meta.annotation`：`key=fieldKey`、`value=fieldValue`。
2. `vision.face`：`key='person'`、`value=personName`。
3. `ml.classify`：`key='class'`、`value=label`，`score` 写入 `file_tag.score`。
4. 同名人物允许存在；文件级 `vision.face` 标签在名字维度合并。

## 6. 接口行为映射

1. 本地数据写接口统一为：
   - `PUT /v1/file-annotations`
   - `PATCH /v1/files/relative-paths`
   - `POST /v1/file-bindings/reconciliations`
   - `POST /v1/file-bindings/cleanups`
2. 下线 `/v1/local-data/*` 与 `POST /v1/annotations/*` 全部路径。
3. `/v1/data/tags/*` 的时间语义以 `file_tag.appliedAt` 为准。
4. 人脸接口路径不变，但内部流程不依赖 `face_job_state`。

## 7. 迁移策略

1. 检测到旧结构时，直接重建数据库（不做备份）。
2. `person.name` 不设唯一约束，允许同名。
3. `score` 作为 `file_tag` 通用可空列，当前仅 `ml.classify` 使用。

## 8. 验收场景

1. 新 root 首次访问自动创建 v2 结构，且不存在被移除的表。
2. `file-annotations` 同文件同字段重复写入时，只保留一个当前值绑定。
3. 分类落库后 `file_tag.score` 可查询，非分类标签 `score` 为 `NULL`。
4. 人脸检测/聚类/改名/合并后，文件级 `vision.face` 标签与 `person_face` 结果一致。
5. 同名人物存在时，标签按名字合并，不保证人物级可区分过滤。
6. 旧接口 `refresh-bindings/cleanup-orphans` 返回下线错误（或 404）。
