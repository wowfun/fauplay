#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

MCP_PROTOCOL_VERSION = "2025-11-05"
SERVER_NAME = "fauplay-timm-classifier"
SERVER_VERSION = "0.3.0"

DEFAULT_TOP_K = 5
DEFAULT_MIN_SCORE = 0.0
DEFAULT_MAX_ITEMS = 256
DEFAULT_BATCH_SIZE = 64
MAX_TOP_K = 20
MAX_BATCH_ITEMS = 1024
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
WINDOWS_ABS_PATTERN = re.compile(r"^[a-zA-Z]:[\\/]")


class MCPError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def create_jsonrpc_error(code: int, message: str, data_code: str | None = None) -> dict:
    error = {"code": code, "message": message}
    if data_code:
        error["data"] = {"code": data_code}
    return error


def to_jsonrpc_error(error: Exception) -> dict:
    if isinstance(error, MCPError):
        if error.code == "MCP_INVALID_REQUEST":
            return create_jsonrpc_error(-32600, str(error), "MCP_INVALID_REQUEST")
        if error.code == "MCP_METHOD_NOT_FOUND":
            return create_jsonrpc_error(-32601, str(error), "MCP_METHOD_NOT_FOUND")
        if error.code == "MCP_INVALID_PARAMS":
            return create_jsonrpc_error(-32602, str(error), "MCP_INVALID_PARAMS")
        if error.code == "MCP_TOOL_NOT_FOUND":
            return create_jsonrpc_error(-32601, str(error), "MCP_TOOL_NOT_FOUND")
        return create_jsonrpc_error(-32000, str(error), error.code)

    return create_jsonrpc_error(-32000, str(error) or "Server error", "MCP_TOOL_CALL_FAILED")


def parse_jsonrpc_request(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise MCPError("MCP_INVALID_REQUEST", "Invalid JSON-RPC request payload")
    if payload.get("jsonrpc") != "2.0":
        raise MCPError("MCP_INVALID_REQUEST", 'jsonrpc must be "2.0"')

    method = payload.get("method")
    if not isinstance(method, str) or not method:
        raise MCPError("MCP_INVALID_REQUEST", "method is required")

    params = payload.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise MCPError("MCP_INVALID_REQUEST", "params must be an object")

    return {
        "id": payload.get("id"),
        "method": method,
        "params": params,
        "is_notification": "id" not in payload,
    }


def write_jsonrpc(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


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


def parse_top_k(value: object) -> int:
    if value is None:
        return DEFAULT_TOP_K
    if isinstance(value, bool) or not isinstance(value, int):
        raise MCPError("MCP_INVALID_PARAMS", "topK must be an integer")
    if value < 1 or value > MAX_TOP_K:
        raise MCPError("MCP_INVALID_PARAMS", f"topK must be in range [1, {MAX_TOP_K}]")
    return value


def parse_min_score(value: object) -> float:
    if value is None:
        return DEFAULT_MIN_SCORE
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MCPError("MCP_INVALID_PARAMS", "minScore must be a number")
    score = float(value)
    if score < 0.0 or score > 1.0:
        raise MCPError("MCP_INVALID_PARAMS", "minScore must be in range [0, 1]")
    return score


def parse_max_items(value: object) -> int:
    if value is None:
        return DEFAULT_MAX_ITEMS
    if isinstance(value, bool) or not isinstance(value, int):
        raise MCPError("MCP_INVALID_PARAMS", "maxItems must be an integer")
    if value < 1 or value > MAX_BATCH_ITEMS:
        raise MCPError("MCP_INVALID_PARAMS", f"maxItems must be in range [1, {MAX_BATCH_ITEMS}]")
    return value


def parse_batch_size(value: object) -> int:
    if value is None:
        return DEFAULT_BATCH_SIZE
    if isinstance(value, bool) or not isinstance(value, int):
        raise MCPError("MCP_TOOL_CALL_FAILED", "batch_size must be an integer")
    if value <= 0:
        raise MCPError("MCP_TOOL_CALL_FAILED", "batch_size must be greater than 0")
    return value


def resolve_image_path(root_path: object, relative_path: object) -> Path:
    if not isinstance(root_path, str) or not root_path.strip():
        raise MCPError("MCP_INVALID_PARAMS", "rootPath is required")
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise MCPError("MCP_INVALID_PARAMS", "relativePath is required")

    normalized_relative = relative_path.replace("\\", "/")
    segments = [segment for segment in normalized_relative.split("/") if segment and segment != "."]
    if not segments:
        raise MCPError("MCP_INVALID_PARAMS", "relativePath is invalid")
    if any(segment == ".." for segment in segments):
        raise MCPError("MCP_INVALID_PARAMS", "relativePath contains unsafe segments")

    root_path_value = normalize_root_path(root_path)
    root = Path(root_path_value).expanduser()
    if not root.is_absolute():
        raise MCPError("MCP_INVALID_PARAMS", "rootPath must be an absolute path")

    root_resolved = root.resolve()
    target = root_resolved.joinpath(*segments).resolve()
    try:
        target.relative_to(root_resolved)
    except ValueError as error:
        raise MCPError("MCP_INVALID_PARAMS", "relativePath escapes rootPath") from error

    if not target.exists() or not target.is_file():
        raise MCPError("MCP_INVALID_PARAMS", f"image file not found: {relative_path}")
    if target.suffix.lower() not in IMAGE_EXTENSIONS:
        raise MCPError("MCP_INVALID_PARAMS", f"unsupported image extension: {target.suffix}")

    return target


def resolve_model_dir_path(config_dir: Path, model_dir_raw: str) -> Path:
    model_dir = Path(model_dir_raw)
    if not model_dir.is_absolute():
        model_dir = (config_dir / model_dir).resolve()
    else:
        model_dir = model_dir.resolve()
    return model_dir


def load_model_name(model_dir: Path) -> str:
    model_name = model_dir.name
    config_path = model_dir / "config.json"
    if not config_path.exists() or not config_path.is_file():
        raise MCPError("MCP_TOOL_CALL_FAILED", f"model config not found: {config_path}")

    try:
        with config_path.open("r", encoding="utf-8") as fh:
            model_cfg = json.load(fh)
    except Exception as error:
        raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to parse model config: {error}") from error

    if isinstance(model_cfg, dict):
        for key in ("_name_or_path", "architecture", "model_type"):
            value = model_cfg.get(key)
            if isinstance(value, str) and value.strip():
                model_name = value.strip()
                break

    return model_name


def normalize_predictions(raw: object, min_score: float) -> list[dict[str, Any]]:
    candidates: list[object]
    if isinstance(raw, dict):
        candidates = [raw]
    elif isinstance(raw, list):
        candidates = raw
    else:
        return []

    predictions: list[dict[str, Any]] = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        label = item.get("label")
        score_value = item.get("score")
        if not isinstance(label, str):
            continue
        if isinstance(score_value, bool) or not isinstance(score_value, (int, float)):
            continue
        score = float(score_value)
        if score < min_score:
            continue
        predictions.append({"label": label, "score": score})

    predictions.sort(key=lambda entry: entry["score"], reverse=True)
    return predictions


def normalize_batch_predictions(raw: object, expected_count: int, min_score: float) -> list[list[dict[str, Any]]]:
    if not isinstance(raw, list):
        raise MCPError("MCP_TOOL_CALL_FAILED", "invalid pipeline batch output")

    if expected_count == 1 and (len(raw) == 0 or isinstance(raw[0], dict)):
        return [normalize_predictions(raw, min_score)]

    if len(raw) != expected_count:
        raise MCPError("MCP_TOOL_CALL_FAILED", "invalid pipeline batch output size")

    result: list[list[dict[str, Any]]] = []
    for item in raw:
        result.append(normalize_predictions(item, min_score))
    return result


class TimmClassifier:
    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.config = self.load_plugin_config(config_path)

        self.pipeline = None
        self.pil_image = None
        self.device_name = "cpu"
        self.model_loaded = False

    def load_plugin_config(self, config_path: Path) -> dict[str, Any]:
        if not config_path.exists() or not config_path.is_file():
            raise MCPError("MCP_TOOL_CALL_FAILED", f"config file not found: {config_path}")

        try:
            with config_path.open("r", encoding="utf-8") as fh:
                parsed = json.load(fh)
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to parse plugin config: {error}") from error

        if not isinstance(parsed, dict):
            raise MCPError("MCP_TOOL_CALL_FAILED", "config root must be an object")

        model_dir_raw = parsed.get("modelDir")
        if not isinstance(model_dir_raw, str) or not model_dir_raw.strip():
            raise MCPError("MCP_TOOL_CALL_FAILED", "modelDir must be a non-empty string")

        device = parsed.get("device", "auto")
        if device not in {"auto", "cpu", "cuda"}:
            raise MCPError("MCP_TOOL_CALL_FAILED", 'device must be one of: "auto", "cpu", "cuda"')

        batch_size = parse_batch_size(parsed.get("batch_size"))

        model_dir = resolve_model_dir_path(config_path.parent, model_dir_raw.strip())
        if not model_dir.exists() or not model_dir.is_dir():
            raise MCPError("MCP_TOOL_CALL_FAILED", f"modelDir not found: {model_dir}")

        model_name = load_model_name(model_dir)

        return {
            "modelDir": str(model_dir),
            "device": device,
            "batch_size": batch_size,
            "modelName": model_name,
        }

    def resolve_device(self, torch: Any) -> tuple[int, str]:
        requested_device = self.config["device"]
        cuda_available = bool(getattr(torch, "cuda", None) and torch.cuda.is_available())

        if requested_device == "cuda":
            if not cuda_available:
                raise MCPError("MCP_TOOL_CALL_FAILED", "CUDA requested but not available")
            return 0, "cuda"
        if requested_device == "cpu":
            return -1, "cpu"
        if cuda_available:
            return 0, "cuda"
        return -1, "cpu"

    def ensure_loaded(self) -> None:
        if self.model_loaded:
            return

        try:
            import torch
            from PIL import Image
            from transformers import AutoImageProcessor, AutoModelForImageClassification
            from transformers.pipelines import ImageClassificationPipeline
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"missing Python dependencies: {error}") from error

        device_index, device_name = self.resolve_device(torch)

        try:
            model = AutoModelForImageClassification.from_pretrained(self.config["modelDir"]).eval()
            image_processor = AutoImageProcessor.from_pretrained(self.config["modelDir"])
            self.pipeline = ImageClassificationPipeline(
                model=model,
                image_processor=image_processor,
                device=device_index,
            )
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to initialize ImageClassificationPipeline: {error}") from error

        self.pil_image = Image
        self.device_name = device_name
        self.model_loaded = True

    def classify_image_obj(self, image: Any, top_k: int, min_score: float) -> list[dict[str, Any]]:
        self.ensure_loaded()
        assert self.pipeline is not None
        try:
            raw = self.pipeline(image, top_k=top_k)
        except Exception as error:
            raise MCPError("MCP_TOOL_CALL_FAILED", f"failed to classify image: {error}") from error
        return normalize_predictions(raw, min_score)

    def classify_path(self, image_path: Path, top_k: int, min_score: float) -> list[dict[str, Any]]:
        self.ensure_loaded()
        assert self.pil_image is not None
        try:
            with self.pil_image.open(image_path) as img:
                rgb = img.convert("RGB").copy()
        except Exception as error:
            raise MCPError("MCP_INVALID_PARAMS", f"failed to decode image: {image_path}") from error

        return self.classify_image_obj(rgb, top_k, min_score)

    def classify_image(self, params: dict[str, Any]) -> dict[str, Any]:
        root_path = params.get("rootPath")
        relative_path = params.get("relativePath")
        top_k = parse_top_k(params.get("topK"))
        min_score = parse_min_score(params.get("minScore"))

        target = resolve_image_path(root_path, relative_path)
        start = time.perf_counter()
        predictions = self.classify_path(target, top_k, min_score)
        timing_ms = round((time.perf_counter() - start) * 1000, 3)

        return {
            "model": self.config["modelName"],
            "device": self.device_name,
            "timingMs": timing_ms,
            "predictions": predictions,
        }

    def classify_batch(self, params: dict[str, Any]) -> dict[str, Any]:
        root_path = params.get("rootPath")
        relative_paths = params.get("relativePaths")
        top_k = parse_top_k(params.get("topK"))
        min_score = parse_min_score(params.get("minScore"))
        max_items = parse_max_items(params.get("maxItems"))

        if not isinstance(root_path, str) or not root_path.strip():
            raise MCPError("MCP_INVALID_PARAMS", "rootPath is required")
        if not isinstance(relative_paths, list) or not all(isinstance(item, str) for item in relative_paths):
            raise MCPError("MCP_INVALID_PARAMS", "relativePaths must be string[]")
        if len(relative_paths) == 0:
            raise MCPError("MCP_INVALID_PARAMS", "relativePaths must not be empty")
        if len(relative_paths) > max_items:
            raise MCPError("MCP_INVALID_PARAMS", f"relativePaths exceeds maxItems ({max_items})")

        self.ensure_loaded()
        assert self.pil_image is not None
        assert self.pipeline is not None

        items: list[dict[str, Any]] = []
        valid_items: list[dict[str, Any]] = []
        succeeded = 0
        failed = 0
        start = time.perf_counter()

        for relative_path in relative_paths:
            try:
                target = resolve_image_path(root_path, relative_path)
                with self.pil_image.open(target) as img:
                    rgb = img.convert("RGB").copy()
                valid_items.append({"relativePath": relative_path, "image": rgb})
            except MCPError as error:
                items.append({"relativePath": relative_path, "ok": False, "error": str(error)})
                failed += 1
            except Exception:
                items.append(
                    {
                        "relativePath": relative_path,
                        "ok": False,
                        "error": f"failed to decode image: {relative_path}",
                    }
                )
                failed += 1

        if valid_items:
            try:
                raw_batch = self.pipeline(
                    [entry["image"] for entry in valid_items],
                    top_k=top_k,
                    batch_size=self.config["batch_size"],
                )
                prediction_groups = normalize_batch_predictions(raw_batch, len(valid_items), min_score)

                for entry, predictions in zip(valid_items, prediction_groups):
                    items.append(
                        {
                            "relativePath": entry["relativePath"],
                            "ok": True,
                            "predictions": predictions,
                        }
                    )
                    succeeded += 1
            except Exception:
                for entry in valid_items:
                    try:
                        predictions = self.classify_image_obj(entry["image"], top_k, min_score)
                        items.append(
                            {
                                "relativePath": entry["relativePath"],
                                "ok": True,
                                "predictions": predictions,
                            }
                        )
                        succeeded += 1
                    except Exception as error:
                        items.append(
                            {
                                "relativePath": entry["relativePath"],
                                "ok": False,
                                "error": str(error),
                            }
                        )
                        failed += 1

        timing_ms = round((time.perf_counter() - start) * 1000, 3)
        return {
            "model": self.config["modelName"],
            "device": self.device_name,
            "timingMs": timing_ms,
            "succeeded": succeeded,
            "failed": failed,
            "items": items,
        }


TOOL_DEFINITIONS = [
    {
        "name": "ml.classifyImage",
        "description": "Classify one image with HuggingFace ImageClassificationPipeline",
        "inputSchema": {
            "type": "object",
            "properties": {
                "rootPath": {"type": "string"},
                "relativePath": {"type": "string"},
                "topK": {"type": "integer", "minimum": 1, "maximum": 20},
                "minScore": {"type": "number", "minimum": 0, "maximum": 1},
            },
            "required": ["rootPath", "relativePath"],
            "additionalProperties": False,
        },
        "annotations": {
            "title": "图像分类",
            "mutation": False,
            "icon": "image",
            "scopes": ["file"],
            "toolOptions": [
                {
                    "key": "preview.continuousCall.enabled",
                    "label": "持续调用",
                    "type": "boolean",
                    "defaultValue": False,
                    "description": "切换预览文件后自动触发图像分类",
                }
            ],
        },
    },
    {
        "name": "ml.classifyBatch",
        "description": "Classify multiple images with HuggingFace ImageClassificationPipeline",
        "inputSchema": {
            "type": "object",
            "properties": {
                "rootPath": {"type": "string"},
                "relativePaths": {"type": "array", "items": {"type": "string"}},
                "topK": {"type": "integer", "minimum": 1, "maximum": 20},
                "minScore": {"type": "number", "minimum": 0, "maximum": 1},
                "maxItems": {"type": "integer", "minimum": 1, "maximum": 1024},
            },
            "required": ["rootPath", "relativePaths"],
            "additionalProperties": False,
        },
        "annotations": {
            "title": "批量图像分类",
            "mutation": False,
            "icon": "images",
            "scopes": ["workspace"],
        },
    },
]


def handle_request(request: dict[str, Any], classifier: TimmClassifier) -> dict[str, Any] | None:
    method = request["method"]
    params = request["params"]

    if method == "initialize":
        return {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }

    if method == "notifications/initialized":
        return None

    if method == "tools/list":
        return {"tools": TOOL_DEFINITIONS}

    if method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments")
        if not isinstance(tool_name, str) or not tool_name:
            raise MCPError("MCP_INVALID_PARAMS", "params.name is required for tools/call")
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            raise MCPError("MCP_INVALID_PARAMS", "params.arguments must be an object")

        if tool_name == "ml.classifyImage":
            return classifier.classify_image(arguments)
        if tool_name == "ml.classifyBatch":
            return classifier.classify_batch(arguments)
        raise MCPError("MCP_TOOL_NOT_FOUND", f"Unsupported tool: {tool_name}")

    raise MCPError("MCP_METHOD_NOT_FOUND", f"Unsupported MCP method: {method}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fauplay timm classification MCP server")
    parser.add_argument(
        "--config",
        type=str,
        default="tools/mcp/timm-classifier/config.json",
        help="Path to timm classifier config file",
    )
    return parser.parse_args()


class FallbackClassifier:
    def __init__(self, error_message: str, config_path: Path):
        self.error_message = error_message
        self.config = {
            "modelName": f"invalid-config:{config_path.name}",
        }

    def classify_image(self, _params: dict[str, Any]) -> dict[str, Any]:
        raise MCPError("MCP_TOOL_CALL_FAILED", self.error_message)

    def classify_batch(self, _params: dict[str, Any]) -> dict[str, Any]:
        raise MCPError("MCP_TOOL_CALL_FAILED", self.error_message)


def main() -> int:
    args = parse_args()
    config_path = Path(args.config).expanduser().resolve()

    try:
        classifier: TimmClassifier | FallbackClassifier = TimmClassifier(config_path)
    except Exception as error:
        classifier = FallbackClassifier(str(error), config_path)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request_id = None
        is_notification = False
        try:
            payload = json.loads(line)
            request = parse_jsonrpc_request(payload)
            request_id = request["id"]
            is_notification = request["is_notification"]

            result = handle_request(request, classifier)
            if is_notification:
                continue

            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": result if result is not None else {},
                }
            )
        except json.JSONDecodeError:
            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": create_jsonrpc_error(-32700, "Parse error", "MCP_PARSE_ERROR"),
                }
            )
        except Exception as error:
            if is_notification:
                continue
            write_jsonrpc(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": to_jsonrpc_error(error),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
