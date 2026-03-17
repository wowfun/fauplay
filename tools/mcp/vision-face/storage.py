import math
import sqlite3
import time
import uuid
from array import array
from pathlib import Path
from typing import Any

from protocol import MCPError

SCHEMA_VERSION = 1
DB_DIRNAME = ".fauplay"
DB_FILENAME = "faces.v1.sqlite"
EMBEDDING_DIM = 512


def now_ts() -> int:
    return int(time.time() * 1000)


def to_embedding_blob(values: list[float]) -> bytes:
    if len(values) != EMBEDDING_DIM:
        raise MCPError("MCP_INVALID_PARAMS", f"embedding length must be {EMBEDDING_DIM}")
    arr = array("f", values)
    return arr.tobytes()


def from_embedding_blob(blob: bytes) -> list[float]:
    arr = array("f")
    arr.frombytes(blob)
    return list(arr)


def cosine_distance(left: list[float], right: list[float]) -> float:
    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right):
        dot += a * b
        left_norm += a * a
        right_norm += b * b
    if left_norm <= 0.0 or right_norm <= 0.0:
        return 1.0
    similarity = dot / (math.sqrt(left_norm) * math.sqrt(right_norm))
    similarity = min(1.0, max(-1.0, similarity))
    return 1.0 - similarity


def ensure_db(root_path: Path) -> sqlite3.Connection:
    db_dir = root_path / DB_DIRNAME
    db_dir.mkdir(parents=True, exist_ok=True)
    db_path = db_dir / DB_FILENAME
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # DELETE mode is more stable on mounted filesystems (e.g. /mnt/* in WSL).
    conn.execute("PRAGMA journal_mode = DELETE")
    current_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if current_version == 0:
        create_schema(conn)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
        current_version = SCHEMA_VERSION
    if current_version != SCHEMA_VERSION:
        raise MCPError("FACE_DB_MIGRATION_FAILED", f"unsupported schemaVersion: {current_version}")
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS face (
          id TEXT PRIMARY KEY,
          assetPath TEXT NOT NULL,
          x1 REAL NOT NULL,
          y1 REAL NOT NULL,
          x2 REAL NOT NULL,
          y2 REAL NOT NULL,
          score REAL NOT NULL,
          status TEXT NOT NULL DEFAULT 'unassigned',
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS face_embedding (
          faceId TEXT PRIMARY KEY,
          dim INTEGER NOT NULL DEFAULT 512,
          embedding BLOB NOT NULL,
          FOREIGN KEY(faceId) REFERENCES face(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS person (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          featureFaceId TEXT,
          faceCount INTEGER NOT NULL DEFAULT 0,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          FOREIGN KEY(featureFaceId) REFERENCES face(id)
        );

        CREATE TABLE IF NOT EXISTS person_face (
          personId TEXT NOT NULL,
          faceId TEXT NOT NULL UNIQUE,
          assignedBy TEXT NOT NULL,
          assignedAt INTEGER NOT NULL,
          PRIMARY KEY(personId, faceId),
          FOREIGN KEY(personId) REFERENCES person(id) ON DELETE CASCADE,
          FOREIGN KEY(faceId) REFERENCES face(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS face_job_state (
          faceId TEXT PRIMARY KEY,
          detectStatus TEXT NOT NULL,
          clusterStatus TEXT NOT NULL,
          deferred INTEGER NOT NULL DEFAULT 0,
          attempts INTEGER NOT NULL DEFAULT 0,
          lastErrorCode TEXT,
          lastRunAt INTEGER NOT NULL,
          nextRunAt INTEGER,
          FOREIGN KEY(faceId) REFERENCES face(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_face_asset_path ON face(assetPath);
        CREATE INDEX IF NOT EXISTS idx_face_status ON face(status);
        CREATE INDEX IF NOT EXISTS idx_person_face_person_id ON person_face(personId);
        CREATE INDEX IF NOT EXISTS idx_face_job_state_cluster ON face_job_state(clusterStatus, deferred);
        """
    )


def refresh_person_cache(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        UPDATE person
        SET faceCount = (
          SELECT COUNT(*)
          FROM person_face
          WHERE person_face.personId = person.id
        ),
        updatedAt = ?
        """,
        (now_ts(),),
    )
    conn.execute(
        """
        UPDATE person
        SET featureFaceId = (
          SELECT faceId
          FROM person_face
          WHERE person_face.personId = person.id
          ORDER BY assignedAt ASC
          LIMIT 1
        )
        WHERE featureFaceId IS NULL OR featureFaceId NOT IN (
          SELECT faceId FROM person_face WHERE person_face.personId = person.id
        )
        """
    )


def update_face_assignment_status(conn: sqlite3.Connection) -> None:
    ts = now_ts()
    conn.execute(
        """
        UPDATE face
        SET status = 'assigned', updatedAt = ?
        WHERE id IN (SELECT faceId FROM person_face)
        """,
        (ts,),
    )
    conn.execute(
        """
        UPDATE face
        SET status = 'unassigned', updatedAt = ?
        WHERE id NOT IN (SELECT faceId FROM person_face)
          AND status != 'deferred'
        """,
        (ts,),
    )


def normalize_people_rows(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for row in rows:
        items.append(
            {
                "personId": row["id"],
                "name": row["name"],
                "faceCount": int(row["faceCount"] or 0),
                "featureFaceId": row["featureFaceId"],
                "featureAssetPath": row["featureAssetPath"],
                "updatedAt": row["updatedAt"],
            }
        )
    return items


def choose_person_for_face(
    current_face_id: str,
    current_embedding: list[float],
    all_embeddings: list[dict[str, Any]],
    max_distance: float,
) -> tuple[list[dict[str, Any]], str | None]:
    matches: list[dict[str, Any]] = []
    for candidate in all_embeddings:
        distance = cosine_distance(current_embedding, candidate["embedding"])
        if distance <= max_distance:
            matches.append(
                {
                    "faceId": candidate["faceId"],
                    "personId": candidate["personId"],
                    "distance": distance,
                }
            )
    matches.sort(key=lambda item: item["distance"])

    person_id: str | None = None
    for item in matches:
        if item["faceId"] == current_face_id:
            continue
        if isinstance(item["personId"], str) and item["personId"]:
            person_id = item["personId"]
            break

    return matches, person_id


def save_detected_faces(
    conn: sqlite3.Connection,
    relative_path: str,
    face_payloads: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    created_faces: list[dict[str, Any]] = []
    ts = now_ts()

    with conn:
        existing_rows = conn.execute("SELECT id FROM face WHERE assetPath = ?", (relative_path,)).fetchall()
        existing_face_ids = [str(row["id"]) for row in existing_rows]
        if existing_face_ids:
            placeholders = ",".join(["?"] * len(existing_face_ids))
            conn.execute(
                f"UPDATE person SET featureFaceId = NULL WHERE featureFaceId IN ({placeholders})",
                existing_face_ids,
            )
        for row in existing_rows:
            conn.execute("DELETE FROM face WHERE id = ?", (row["id"],))

        for payload in face_payloads:
            box = payload.get("boundingBox") if isinstance(payload, dict) else None
            embedding = payload.get("embedding") if isinstance(payload, dict) else None
            if not isinstance(box, dict) or not isinstance(embedding, list):
                continue

            try:
                x1 = float(box["x1"])
                y1 = float(box["y1"])
                x2 = float(box["x2"])
                y2 = float(box["y2"])
                score = float(payload.get("score", 0.0))
                embedding_blob = to_embedding_blob([float(item) for item in embedding])
            except (KeyError, ValueError, TypeError):
                continue

            face_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO face(id, assetPath, x1, y1, x2, y2, score, status, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'unassigned', ?, ?)
                """,
                (face_id, relative_path, x1, y1, x2, y2, score, ts, ts),
            )
            conn.execute(
                """
                INSERT INTO face_embedding(faceId, dim, embedding)
                VALUES (?, ?, ?)
                """,
                (face_id, EMBEDDING_DIM, embedding_blob),
            )
            conn.execute(
                """
                INSERT INTO face_job_state(faceId, detectStatus, clusterStatus, deferred, attempts, lastErrorCode, lastRunAt, nextRunAt)
                VALUES (?, 'success', 'pending', 0, 0, NULL, ?, NULL)
                ON CONFLICT(faceId) DO UPDATE SET
                  detectStatus = 'success',
                  clusterStatus = 'pending',
                  deferred = 0,
                  lastErrorCode = NULL,
                  lastRunAt = excluded.lastRunAt
                """,
                (face_id, ts),
            )
            created_faces.append(
                {
                    "faceId": face_id,
                    "assetPath": relative_path,
                    "boundingBox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "score": score,
                    "personId": None,
                    "status": "unassigned",
                }
            )

        update_face_assignment_status(conn)
        refresh_person_cache(conn)
        conn.execute("DELETE FROM person WHERE id NOT IN (SELECT personId FROM person_face)")

    return created_faces
