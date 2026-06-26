//! Plugin and MCP coordination inside the Fauplay Runtime.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

const MCP_PROTOCOL_VERSION: &str = "2025-11-05";

#[derive(Debug, Clone, Default)]
pub(crate) struct McpSessions {
    inner: Arc<Mutex<McpSessionStore>>,
}

#[derive(Debug, Default)]
struct McpSessionStore {
    next_session_number: u64,
    sessions: HashMap<String, McpSessionState>,
}

#[derive(Debug)]
struct McpSessionState {
    initialized: bool,
    client_ready: bool,
}

#[derive(Debug)]
pub(crate) struct McpHttpResponse {
    pub(crate) session_id: Option<String>,
    pub(crate) body: Option<Value>,
}

#[derive(Debug)]
struct McpRequest {
    id: Option<Value>,
    is_notification: bool,
    method: String,
    params: Value,
}

#[derive(Debug)]
struct McpRuntimeError {
    code: McpRuntimeErrorCode,
    message: String,
}

#[derive(Debug, Clone, Copy)]
enum McpRuntimeErrorCode {
    InvalidRequest,
    MethodNotFound,
    InvalidParams,
    ToolNotFound,
}

impl McpSessions {
    pub(crate) fn handle_request(
        &self,
        session_id: Option<&str>,
        payload: Value,
    ) -> McpHttpResponse {
        let request = match parse_json_rpc_request(payload) {
            Ok(request) => request,
            Err(error) => return json_rpc_error_response(None, false, error),
        };

        match self.handle_json_rpc_request(session_id, &request) {
            Ok(response) => response,
            Err(error) => {
                json_rpc_error_response(request.id.clone(), request.is_notification, error)
            }
        }
    }

    fn handle_json_rpc_request(
        &self,
        session_id: Option<&str>,
        request: &McpRequest,
    ) -> Result<McpHttpResponse, McpRuntimeError> {
        match request.method.as_str() {
            "initialize" => Ok(self.initialize_response(request)),
            "notifications/initialized" => {
                let session_id = self.mark_client_ready(session_id)?;
                Ok(json_rpc_result_response(
                    request,
                    Some(session_id),
                    json!({}),
                ))
            }
            "tools/list" => {
                let session_id = self.require_client_ready_session(session_id)?;
                Ok(json_rpc_result_response(
                    request,
                    Some(session_id),
                    json!({ "tools": [] }),
                ))
            }
            "tools/call" => {
                self.require_client_ready_session(session_id)?;
                let tool_name = request
                    .params
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        McpRuntimeError::new(
                            McpRuntimeErrorCode::InvalidParams,
                            "params.name is required for tools/call",
                        )
                    })?;

                let tool_args = request.params.get("arguments");
                if !tool_args.is_some_and(Value::is_object) {
                    return Err(McpRuntimeError::new(
                        McpRuntimeErrorCode::InvalidParams,
                        "params.arguments must be an object",
                    ));
                }

                Err(McpRuntimeError::new(
                    McpRuntimeErrorCode::ToolNotFound,
                    format!("Unknown tool: {tool_name}"),
                ))
            }
            _ => Err(McpRuntimeError::new(
                McpRuntimeErrorCode::MethodNotFound,
                format!("Unsupported MCP method: {}", request.method),
            )),
        }
    }

    fn initialize_response(&self, request: &McpRequest) -> McpHttpResponse {
        let session_id = self.create_session();
        json_rpc_result_response(
            request,
            Some(session_id),
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {},
                },
                "serverInfo": {
                    "name": "fauplay-runtime",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            }),
        )
    }

    fn create_session(&self) -> String {
        let mut store = self.inner.lock().expect("MCP session store should lock");
        store.next_session_number += 1;
        let session_id = format!("runtime-{}", store.next_session_number);
        store.sessions.insert(
            session_id.clone(),
            McpSessionState {
                initialized: true,
                client_ready: false,
            },
        );
        session_id
    }

    fn mark_client_ready(&self, session_id: Option<&str>) -> Result<String, McpRuntimeError> {
        let session_id = non_empty_session_id(session_id)?;
        let mut store = self.inner.lock().expect("MCP session store should lock");
        let Some(state) = store.sessions.get_mut(session_id) else {
            return Err(missing_session_error());
        };
        if !state.initialized {
            return Err(McpRuntimeError::new(
                McpRuntimeErrorCode::InvalidRequest,
                "initialize is required before initialized notification",
            ));
        }
        state.client_ready = true;
        Ok(session_id.to_owned())
    }

    fn require_client_ready_session(
        &self,
        session_id: Option<&str>,
    ) -> Result<String, McpRuntimeError> {
        let session_id = non_empty_session_id(session_id)?;
        let store = self.inner.lock().expect("MCP session store should lock");
        let Some(state) = store.sessions.get(session_id) else {
            return Err(missing_session_error());
        };
        if !state.initialized || !state.client_ready {
            return Err(McpRuntimeError::new(
                McpRuntimeErrorCode::InvalidRequest,
                "Client must complete initialize lifecycle",
            ));
        }
        Ok(session_id.to_owned())
    }
}

fn parse_json_rpc_request(payload: Value) -> Result<McpRequest, McpRuntimeError> {
    let Some(object) = payload.as_object() else {
        return Err(McpRuntimeError::new(
            McpRuntimeErrorCode::InvalidRequest,
            "Invalid JSON-RPC request payload",
        ));
    };

    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err(McpRuntimeError::new(
            McpRuntimeErrorCode::InvalidRequest,
            "jsonrpc must be \"2.0\"",
        ));
    }

    let method = object
        .get("method")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            McpRuntimeError::new(McpRuntimeErrorCode::InvalidRequest, "method is required")
        })?;

    Ok(McpRequest {
        id: object.get("id").cloned(),
        is_notification: !object.contains_key("id"),
        method: method.to_owned(),
        params: object
            .get("params")
            .filter(|params| params.is_object())
            .cloned()
            .unwrap_or_else(|| json!({})),
    })
}

fn json_rpc_result_response(
    request: &McpRequest,
    session_id: Option<String>,
    result: Value,
) -> McpHttpResponse {
    McpHttpResponse {
        session_id,
        body: if request.is_notification {
            None
        } else {
            Some(json!({
                "jsonrpc": "2.0",
                "id": request.id.clone().unwrap_or(Value::Null),
                "result": result,
            }))
        },
    }
}

fn json_rpc_error_response(
    id: Option<Value>,
    is_notification: bool,
    error: McpRuntimeError,
) -> McpHttpResponse {
    if is_notification {
        return McpHttpResponse {
            session_id: None,
            body: None,
        };
    }

    McpHttpResponse {
        session_id: None,
        body: Some(json!({
            "jsonrpc": "2.0",
            "id": id.unwrap_or(Value::Null),
            "error": {
                "code": error.code.json_rpc_code(),
                "message": error.message,
                "data": {
                    "code": error.code.runtime_code(),
                },
            },
        })),
    }
}

fn non_empty_session_id(session_id: Option<&str>) -> Result<&str, McpRuntimeError> {
    session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(missing_session_error)
}

fn missing_session_error() -> McpRuntimeError {
    McpRuntimeError::new(
        McpRuntimeErrorCode::InvalidRequest,
        "Missing or invalid mcp-session-id header",
    )
}

impl McpRuntimeError {
    fn new(code: McpRuntimeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl McpRuntimeErrorCode {
    fn json_rpc_code(self) -> i32 {
        match self {
            Self::InvalidRequest => -32600,
            Self::MethodNotFound => -32601,
            Self::InvalidParams => -32602,
            Self::ToolNotFound => -32000,
        }
    }

    fn runtime_code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "MCP_INVALID_REQUEST",
            Self::MethodNotFound => "MCP_METHOD_NOT_FOUND",
            Self::InvalidParams => "MCP_INVALID_PARAMS",
            Self::ToolNotFound => "MCP_TOOL_NOT_FOUND",
        }
    }
}
