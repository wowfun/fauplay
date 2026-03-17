import os
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from inference import ImmichFaceInference
from protocol import MCPError
from storage import (
    choose_person_for_face,
    ensure_db,
    from_embedding_blob,
    normalize_people_rows,
    now_ts,
    refresh_person_cache,
    save_detected_faces,
    update_face_assignment_status,
)

WINDOWS_ABS_PATTERN = re.compile(r"^[a-zA-Z]:[\\/]")
DEFAULT_PAGE = 1
DEFAULT_SIZE = 50
DEFAULT_CLUSTER_LIMIT = 100
MAX_PAGE_SIZE = 500


def is_windows_abs_path(path_str: str) -> bool:
    return bool(WINDOWS_ABS_PATTERN.match(path_str))


def normalize_root_path(raw_root_path: str) -> str:
    root_path = raw_root_path.strip()
    if os.name != "nt" and is_windows_abs_path(root_path):
        try:
            completed = subprocess.run(
                ["wslpath", "-u", root_path],
                check=True,
                capture_output=True,
                text=True,
            )
            converted = completed.stdout.strip()
            if converted:
                return converted
        except Exception:
            return root_path
    return root_path


def resolve_root_path(value: object) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise MCPError("MCP_INVALID_PARAMS", "rootPath is required")

    root_path = Path(normalize_root_path(value))
    if not root_path.is_absolute():
        raise MCPError("MCP_INVALID_PARAMS", "rootPath must be an absolute path")

    try:
        return root_path.resolve()
    except Exception as error:
        raise MCPError("MCP_INVALID_PARAMS", f"rootPath is invalid: {error}") from error


def normalize_relative_path(value: object, field_name: str = "relativePath") -> str:
    if not isinstance(value, str) or not value.strip():
        raise MCPError("MCP_INVALID_PARAMS", f"{field_name} is required")

    normalized = [segment for segment in value.replace("\\", "/").split("/") if segment and segment != "."]
    if not normalized:
        raise MCPError("MCP_INVALID_PARAMS", f"{field_name} is invalid")
    if any(segment == ".." for segment in normalized):
        raise MCPError("MCP_INVALID_PARAMS", f"{field_name} contains unsafe segments")

    return "/".join(normalized)


def resolve_relative_path_within_root(root_path: Path, relative_path: str) -> Path:
    target = root_path.joinpath(*relative_path.split("/")).resolve()
    try:
        target.relative_to(root_path)
    except ValueError as error:
        raise MCPError("MCP_INVALID_PARAMS", "relativePath escapes rootPath") from error
    return target


def parse_operation(value: object) -> str:
    valid = {
        "detectAsset",
        "clusterPending",
        "listPeople",
        "renamePerson",
        "mergePeople",
        "listAssetFaces",
    }
    if not isinstance(value, str) or value not in valid:
        raise MCPError("MCP_INVALID_PARAMS", f"operation must be one of: {', '.join(sorted(valid))}")
    return value


def parse_positive_int(value: object, field_name: str, default: int, maximum: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise MCPError("MCP_INVALID_PARAMS", f"{field_name} must be an integer")
    if value < 1:
        raise MCPError("MCP_INVALID_PARAMS", f"{field_name} must be >= 1")
    return min(value, maximum)


class VisionFaceService:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.inference = ImmichFaceInference(config)

    def handle_tool_call(self, args: dict[str, Any]) -> dict[str, Any]:
        operation = parse_operation(args.get("operation"))
        if operation == "listPeople":
            return self.op_list_people(args)
        if operation == "listAssetFaces":
            return self.op_list_asset_faces(args)
        if operation == "renamePerson":
            return self.op_rename_person(args)
        if operation == "mergePeople":
            return self.op_merge_people(args)
        if operation == "clusterPending":
            return self.op_cluster_pending(args)
        if operation == "detectAsset":
            return self.op_detect_asset(args)
        raise MCPError("MCP_INVALID_PARAMS", f"Unsupported operation: {operation}")

    def op_list_people(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        page = parse_positive_int(args.get("page"), "page", DEFAULT_PAGE, 100000)
        size = parse_positive_int(args.get("size"), "size", DEFAULT_SIZE, MAX_PAGE_SIZE)
        offset = (page - 1) * size

        conn = ensure_db(root_path)
        try:
            total = int(conn.execute("SELECT COUNT(*) FROM person").fetchone()[0])
            rows = conn.execute(
                """
                SELECT
                  person.*,
                  face.assetPath AS featureAssetPath
                FROM person
                LEFT JOIN face ON face.id = person.featureFaceId
                ORDER BY person.faceCount DESC, person.updatedAt DESC, person.createdAt DESC
                LIMIT ? OFFSET ?
                """,
                (size, offset),
            ).fetchall()
            return {
                "ok": True,
                "page": page,
                "size": size,
                "total": total,
                "items": normalize_people_rows(rows),
            }
        finally:
            conn.close()

    def op_list_asset_faces(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        person_id = args.get("personId")
        relative_path_raw = args.get("relativePath")
        if not isinstance(person_id, str) and not isinstance(relative_path_raw, str):
            raise MCPError("MCP_INVALID_PARAMS", "listAssetFaces requires relativePath or personId")

        conn = ensure_db(root_path)
        try:
            if isinstance(person_id, str) and person_id.strip():
                rows = conn.execute(
                    """
                    SELECT
                      face.id,
                      face.assetPath,
                      face.x1,
                      face.y1,
                      face.x2,
                      face.y2,
                      face.score,
                      face.status,
                      person_face.personId
                    FROM face
                    INNER JOIN person_face ON person_face.faceId = face.id
                    WHERE person_face.personId = ?
                    ORDER BY face.updatedAt DESC
                    """,
                    (person_id.strip(),),
                ).fetchall()
            else:
                relative_path = normalize_relative_path(relative_path_raw)
                rows = conn.execute(
                    """
                    SELECT
                      face.id,
                      face.assetPath,
                      face.x1,
                      face.y1,
                      face.x2,
                      face.y2,
                      face.score,
                      face.status,
                      person_face.personId
                    FROM face
                    LEFT JOIN person_face ON person_face.faceId = face.id
                    WHERE face.assetPath = ?
                    ORDER BY face.x1 ASC
                    """,
                    (relative_path,),
                ).fetchall()

            items: list[dict[str, Any]] = []
            for row in rows:
                items.append(
                    {
                        "faceId": row["id"],
                        "assetPath": row["assetPath"],
                        "boundingBox": {
                            "x1": row["x1"],
                            "y1": row["y1"],
                            "x2": row["x2"],
                            "y2": row["y2"],
                        },
                        "score": row["score"],
                        "status": row["status"],
                        "personId": row["personId"],
                    }
                )
            return {"ok": True, "total": len(items), "items": items}
        finally:
            conn.close()

    def op_rename_person(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        person_id = args.get("personId")
        name = args.get("name")
        if not isinstance(person_id, str) or not person_id.strip():
            raise MCPError("MCP_INVALID_PARAMS", "personId is required")
        if not isinstance(name, str):
            raise MCPError("MCP_INVALID_PARAMS", "name is required")

        conn = ensure_db(root_path)
        try:
            ts = now_ts()
            cursor = conn.execute(
                "UPDATE person SET name = ?, updatedAt = ? WHERE id = ?",
                (name.strip(), ts, person_id.strip()),
            )
            if cursor.rowcount == 0:
                raise MCPError("MCP_INVALID_PARAMS", f"person not found: {person_id}")
            conn.commit()

            row = conn.execute(
                """
                SELECT
                  person.*,
                  face.assetPath AS featureAssetPath
                FROM person
                LEFT JOIN face ON face.id = person.featureFaceId
                WHERE person.id = ?
                """,
                (person_id.strip(),),
            ).fetchone()
            if row is None:
                raise MCPError("MCP_TOOL_CALL_FAILED", "person update failed")
            return {"ok": True, "person": normalize_people_rows([row])[0]}
        finally:
            conn.close()

    def op_merge_people(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        target_person_id = args.get("targetPersonId")
        source_person_ids = args.get("sourcePersonIds")
        if not isinstance(target_person_id, str) or not target_person_id.strip():
            raise MCPError("MCP_INVALID_PARAMS", "targetPersonId is required")
        if not isinstance(source_person_ids, list) or len(source_person_ids) == 0:
            raise MCPError("MCP_INVALID_PARAMS", "sourcePersonIds is required")

        target_person_id = target_person_id.strip()
        valid_sources = [
            item.strip()
            for item in source_person_ids
            if isinstance(item, str) and item.strip() and item.strip() != target_person_id
        ]
        if len(valid_sources) == 0:
            raise MCPError("MCP_INVALID_PARAMS", "sourcePersonIds must contain at least one non-target personId")

        conn = ensure_db(root_path)
        merged_sources: list[str] = []
        skipped_sources: list[str] = []
        try:
            target_exists = conn.execute("SELECT 1 FROM person WHERE id = ?", (target_person_id,)).fetchone()
            if target_exists is None:
                raise MCPError("MCP_INVALID_PARAMS", f"target person not found: {target_person_id}")

            ts = now_ts()
            with conn:
                for source_id in valid_sources:
                    exists = conn.execute("SELECT 1 FROM person WHERE id = ?", (source_id,)).fetchone()
                    if exists is None:
                        skipped_sources.append(source_id)
                        continue

                    conn.execute(
                        """
                        UPDATE person_face
                        SET personId = ?, assignedBy = 'merge', assignedAt = ?
                        WHERE personId = ?
                        """,
                        (target_person_id, ts, source_id),
                    )
                    conn.execute("DELETE FROM person WHERE id = ?", (source_id,))
                    merged_sources.append(source_id)

                update_face_assignment_status(conn)
                refresh_person_cache(conn)

            return {
                "ok": True,
                "targetPersonId": target_person_id,
                "merged": len(merged_sources),
                "sourcePersonIds": merged_sources,
                "skippedSourcePersonIds": skipped_sources,
            }
        finally:
            conn.close()

    def op_cluster_pending(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        limit = parse_positive_int(args.get("limit"), "limit", DEFAULT_CLUSTER_LIMIT, 2000)
        max_distance = float(self.config["maxDistance"])
        min_faces = int(self.config["minFaces"])

        conn = ensure_db(root_path)
        try:
            rows = conn.execute(
                """
                SELECT
                  face.id,
                  face.status,
                  face_embedding.embedding
                FROM face
                INNER JOIN face_embedding ON face_embedding.faceId = face.id
                WHERE face.status IN ('unassigned', 'deferred')
                ORDER BY face.updatedAt ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

            if len(rows) == 0:
                return {
                    "ok": True,
                    "processed": 0,
                    "assigned": 0,
                    "createdPersons": 0,
                    "deferred": 0,
                    "skipped": 0,
                    "failed": 0,
                }

            all_rows = conn.execute(
                """
                SELECT
                  face.id AS faceId,
                  face_embedding.embedding AS embedding,
                  person_face.personId AS personId
                FROM face
                INNER JOIN face_embedding ON face_embedding.faceId = face.id
                LEFT JOIN person_face ON person_face.faceId = face.id
                """
            ).fetchall()

            all_embeddings = [
                {
                    "faceId": row["faceId"],
                    "embedding": from_embedding_blob(row["embedding"]),
                    "personId": row["personId"],
                }
                for row in all_rows
            ]

            processed = 0
            assigned = 0
            created_persons = 0
            deferred = 0
            skipped = 0
            failed = 0

            with conn:
                for row in rows:
                    processed += 1
                    face_id = row["id"]
                    current_embedding = from_embedding_blob(row["embedding"])
                    matches, matched_person_id = choose_person_for_face(
                        current_face_id=face_id,
                        current_embedding=current_embedding,
                        all_embeddings=all_embeddings,
                        max_distance=max_distance,
                    )
                    is_core = len(matches) >= min_faces
                    person_id = matched_person_id

                    if person_id is None and is_core:
                        person_id = str(uuid.uuid4())
                        ts = now_ts()
                        conn.execute(
                            """
                            INSERT INTO person(id, name, featureFaceId, faceCount, createdAt, updatedAt)
                            VALUES (?, '', ?, 0, ?, ?)
                            """,
                            (person_id, face_id, ts, ts),
                        )
                        created_persons += 1

                    if person_id is not None:
                        ts = now_ts()
                        conn.execute(
                            """
                            INSERT INTO person_face(personId, faceId, assignedBy, assignedAt)
                            VALUES (?, ?, 'auto', ?)
                            ON CONFLICT(faceId) DO UPDATE SET
                              personId = excluded.personId,
                              assignedBy = 'auto',
                              assignedAt = excluded.assignedAt
                            """,
                            (person_id, face_id, ts),
                        )
                        conn.execute(
                            "UPDATE face SET status = 'assigned', updatedAt = ? WHERE id = ?",
                            (ts, face_id),
                        )
                        conn.execute(
                            """
                            INSERT INTO face_job_state(faceId, detectStatus, clusterStatus, deferred, attempts, lastErrorCode, lastRunAt, nextRunAt)
                            VALUES (?, 'success', 'assigned', 0, 0, NULL, ?, NULL)
                            ON CONFLICT(faceId) DO UPDATE SET
                              clusterStatus = 'assigned',
                              deferred = 0,
                              lastErrorCode = NULL,
                              lastRunAt = excluded.lastRunAt
                            """,
                            (face_id, ts),
                        )
                        for item in all_embeddings:
                            if item["faceId"] == face_id:
                                item["personId"] = person_id
                                break
                        assigned += 1
                    else:
                        ts = now_ts()
                        conn.execute(
                            "UPDATE face SET status = 'deferred', updatedAt = ? WHERE id = ?",
                            (ts, face_id),
                        )
                        conn.execute(
                            """
                            INSERT INTO face_job_state(faceId, detectStatus, clusterStatus, deferred, attempts, lastErrorCode, lastRunAt, nextRunAt)
                            VALUES (?, 'success', 'deferred', 1, 0, NULL, ?, NULL)
                            ON CONFLICT(faceId) DO UPDATE SET
                              clusterStatus = 'deferred',
                              deferred = 1,
                              lastErrorCode = NULL,
                              lastRunAt = excluded.lastRunAt
                            """,
                            (face_id, ts),
                        )
                        deferred += 1

                update_face_assignment_status(conn)
                refresh_person_cache(conn)

            return {
                "ok": True,
                "processed": processed,
                "assigned": assigned,
                "createdPersons": created_persons,
                "deferred": deferred,
                "skipped": skipped,
                "failed": failed,
            }
        finally:
            conn.close()

    def op_detect_asset(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        relative_path = normalize_relative_path(args.get("relativePath"))
        absolute_path = resolve_relative_path_within_root(root_path, relative_path)
        if not absolute_path.exists() or not absolute_path.is_file():
            raise MCPError("MCP_INVALID_PARAMS", f"asset not found: {relative_path}")

        face_payloads = self.inference.detect_asset(absolute_path)

        conn = ensure_db(root_path)
        try:
            created_faces = save_detected_faces(conn, relative_path, face_payloads)
        finally:
            conn.close()

        return {
            "ok": True,
            "assetPath": relative_path,
            "detected": len(face_payloads),
            "created": len(created_faces),
            "updated": 0,
            "skipped": max(0, len(face_payloads) - len(created_faces)),
            "faces": created_faces,
        }
