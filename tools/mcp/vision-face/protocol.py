import json
import sys
from typing import Any

MCP_PROTOCOL_VERSION = "2025-11-05"
SERVER_NAME = "fauplay-vision-face"
SERVER_VERSION = "0.2.0"

TOOL_DEFINITIONS = [
    {
        "name": "vision.face",
        "description": "人脸检测、聚类与人物管理",
        "inputSchema": {
            "type": "object",
            "properties": {
                "rootPath": {"type": "string"},
                "operation": {
                    "type": "string",
                    "enum": [
                        "detectAsset",
                        "clusterPending",
                        "listPeople",
                        "renamePerson",
                        "mergePeople",
                        "listAssetFaces",
                    ],
                },
                "relativePath": {"type": "string"},
                "personId": {"type": "string"},
                "name": {"type": "string"},
                "sourcePersonIds": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                },
                "targetPersonId": {"type": "string"},
                "page": {"type": "integer"},
                "size": {"type": "integer"},
                "limit": {"type": "integer"},
                "nightly": {"type": "boolean"},
            },
            "required": ["rootPath", "operation"],
            "additionalProperties": False,
        },
        "annotations": {
            "title": "人脸识别",
            "mutation": True,
            "icon": "user-round-search",
            "scopes": ["file", "workspace"],
            "toolActions": [
                {
                    "key": "listPeople",
                    "label": "人物列表",
                    "description": "读取人物列表",
                    "intent": "primary",
                    "arguments": {"operation": "listPeople", "page": 1, "size": 50},
                },
                {
                    "key": "clusterPending",
                    "label": "执行聚类",
                    "description": "处理未分配或 deferred 人脸",
                    "intent": "accent",
                    "arguments": {"operation": "clusterPending", "nightly": False},
                },
            ],
        },
    }
]


class MCPError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def create_jsonrpc_error(code: int, message: str, data_code: str | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data_code:
        error["data"] = {"code": data_code}
    return error


def to_jsonrpc_error(error: Exception) -> dict[str, Any]:
    if isinstance(error, MCPError):
        if error.code == "MCP_INVALID_REQUEST":
            return create_jsonrpc_error(-32600, str(error), error.code)
        if error.code == "MCP_METHOD_NOT_FOUND":
            return create_jsonrpc_error(-32601, str(error), error.code)
        if error.code == "MCP_INVALID_PARAMS":
            return create_jsonrpc_error(-32602, str(error), error.code)
        if error.code == "MCP_TOOL_NOT_FOUND":
            return create_jsonrpc_error(-32601, str(error), error.code)
        return create_jsonrpc_error(-32000, str(error), error.code)

    return create_jsonrpc_error(-32000, str(error) or "Server error", "MCP_TOOL_CALL_FAILED")


def parse_jsonrpc_request(payload: object) -> dict[str, Any]:
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


def write_jsonrpc(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()
