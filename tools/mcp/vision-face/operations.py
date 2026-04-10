import os
import re
import subprocess
from pathlib import Path
from typing import Any

from inference import ImmichFaceInference
from protocol import MCPError

WINDOWS_ABS_PATTERN = re.compile(r"^[a-zA-Z]:[\\/]")
SUPPORTED_OPERATIONS = {
    "detectAsset",
    "detectAssets",
    "clusterPending",
    "listPeople",
    "renamePerson",
    "mergePeople",
    "listAssetFaces",
}


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
    if not isinstance(value, str) or value not in SUPPORTED_OPERATIONS:
        raise MCPError("MCP_INVALID_PARAMS", f"operation must be one of: {', '.join(sorted(SUPPORTED_OPERATIONS))}")
    return value


class VisionFaceService:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.inference = ImmichFaceInference(config)

    def handle_tool_call(self, args: dict[str, Any]) -> dict[str, Any]:
        operation = parse_operation(args.get("operation"))
        if operation != "detectAsset":
            raise MCPError(
                "MCP_TOOL_CALL_FAILED",
                (
                    f"operation '{operation}' has moved to Gateway HTTP API; "
                    "use /v1/faces/* endpoints instead"
                ),
            )

        return self.op_detect_asset(args)

    def op_detect_asset(self, args: dict[str, Any]) -> dict[str, Any]:
        root_path = resolve_root_path(args.get("rootPath"))
        relative_path = normalize_relative_path(args.get("relativePath"))
        absolute_path = resolve_relative_path_within_root(root_path, relative_path)
        if not absolute_path.exists() or not absolute_path.is_file():
            raise MCPError("MCP_INVALID_PARAMS", f"asset not found: {relative_path}")

        face_payloads = self.inference.detect_asset(absolute_path)

        return {
            "ok": True,
            "assetPath": relative_path,
            "detected": len(face_payloads),
            "faces": face_payloads,
        }
