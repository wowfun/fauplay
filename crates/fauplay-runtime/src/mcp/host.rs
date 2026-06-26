use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::{McpRuntimeError, McpRuntimeErrorCode, config, stdio};

#[derive(Clone)]
pub(super) struct McpHost {
    pub(super) runtime_home_path: PathBuf,
    pub(super) config_path: PathBuf,
    state: Arc<Mutex<McpHostState>>,
}

#[derive(Default)]
struct McpHostState {
    registry: Option<McpToolRegistry>,
}

struct McpToolRegistry {
    tools: Vec<Value>,
    tool_map: HashMap<String, usize>,
    clients: Vec<stdio::StdioMcpClient>,
}

impl McpHost {
    pub(super) fn new(runtime_home_path: PathBuf, config_path: PathBuf) -> Self {
        Self {
            runtime_home_path,
            config_path,
            state: Arc::new(Mutex::new(McpHostState::default())),
        }
    }

    pub(super) fn list_tools(&self) -> Result<Vec<Value>, McpRuntimeError> {
        self.with_registry(|registry| Ok(registry.tools.clone()))
    }

    pub(super) fn call_tool(
        &self,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value, McpRuntimeError> {
        self.with_registry(|registry| registry.call_tool(tool_name, arguments))
    }

    fn with_registry<T>(
        &self,
        action: impl FnOnce(&mut McpToolRegistry) -> Result<T, McpRuntimeError>,
    ) -> Result<T, McpRuntimeError> {
        let mut state = self.state.lock().expect("MCP host registry should lock");
        if state.registry.is_none() {
            state.registry = Some(McpToolRegistry::load(
                &self.runtime_home_path,
                &self.config_path,
            )?);
        }

        action(
            state
                .registry
                .as_mut()
                .expect("MCP host registry should be initialized"),
        )
    }
}

impl McpToolRegistry {
    fn load(runtime_home_path: &Path, config_path: &Path) -> Result<Self, McpRuntimeError> {
        let config = config::load_mcp_config(config_path, runtime_home_path)?;
        let mut clients = Vec::new();
        let mut tools = Vec::new();
        let mut tool_map = HashMap::new();

        for entry in config.servers {
            let mut client = stdio::StdioMcpClient::new(entry);
            let source_label = client.source_label().to_owned();
            let server_tools = client.list_tools()?;
            let client_index = clients.len();

            for tool in server_tools {
                let normalized = normalize_tool(&source_label, tool)?;
                let name = normalized
                    .get("name")
                    .and_then(Value::as_str)
                    .expect("normalized MCP tool should include a name")
                    .to_owned();
                if tool_map.contains_key(&name) {
                    return Err(McpRuntimeError::new(
                        McpRuntimeErrorCode::RuntimeError,
                        format!("Duplicate tool name: {name}"),
                    ));
                }

                tool_map.insert(name, client_index);
                tools.push(normalized);
            }

            clients.push(client);
        }

        tools.sort_by(|left, right| {
            let left_name = left.get("name").and_then(Value::as_str).unwrap_or("");
            let right_name = right.get("name").and_then(Value::as_str).unwrap_or("");
            left_name.cmp(right_name)
        });

        Ok(Self {
            tools,
            tool_map,
            clients,
        })
    }

    fn call_tool(&mut self, tool_name: &str, arguments: Value) -> Result<Value, McpRuntimeError> {
        let Some(client_index) = self.tool_map.get(tool_name).copied() else {
            return Err(McpRuntimeError::new(
                McpRuntimeErrorCode::ToolNotFound,
                format!("Unknown tool: {tool_name}"),
            ));
        };

        self.clients[client_index].call_tool(tool_name, arguments)
    }
}

fn normalize_tool(source_label: &str, tool: Value) -> Result<Value, McpRuntimeError> {
    let Some(tool_object) = tool.as_object() else {
        return Err(invalid_tool_error(source_label));
    };
    let Some(name) = tool_object
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(invalid_tool_error(source_label));
    };

    let annotations = tool_object.get("annotations").and_then(Value::as_object);
    let annotation_title = annotations
        .and_then(|annotations| annotations.get("title"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let title = tool_object
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(annotation_title)
        .unwrap_or(name);

    let mut normalized = serde_json::Map::new();
    normalized.insert("name".to_owned(), Value::String(name.to_owned()));
    normalized.insert("title".to_owned(), Value::String(title.to_owned()));
    normalized.insert(
        "description".to_owned(),
        Value::String(
            tool_object
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        ),
    );
    normalized.insert(
        "inputSchema".to_owned(),
        tool_object
            .get("inputSchema")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| json!({ "type": "object" })),
    );

    if let Some(annotations) = normalize_tool_annotations(annotations) {
        normalized.insert("annotations".to_owned(), annotations);
    }

    Ok(Value::Object(normalized))
}

fn invalid_tool_error(source_label: &str) -> McpRuntimeError {
    McpRuntimeError::new(
        McpRuntimeErrorCode::InvalidParams,
        format!("MCP server {source_label} returned a tool with invalid name"),
    )
}

fn normalize_tool_annotations(
    annotations: Option<&serde_json::Map<String, Value>>,
) -> Option<Value> {
    let annotations = annotations?;
    let mut normalized = serde_json::Map::new();

    if let Some(title) = annotations
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalized.insert("title".to_owned(), Value::String(title.to_owned()));
    }
    if let Some(mutation) = annotations.get("mutation").and_then(Value::as_bool) {
        normalized.insert("mutation".to_owned(), Value::Bool(mutation));
    }
    if let Some(icon) = annotations
        .get("icon")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalized.insert("icon".to_owned(), Value::String(icon.to_owned()));
    }
    let scopes = string_array(annotations.get("scopes"));
    if !scopes.is_empty() {
        normalized.insert(
            "scopes".to_owned(),
            Value::Array(scopes.into_iter().map(Value::String).collect()),
        );
    }
    let tool_options = object_array(annotations.get("toolOptions"));
    if !tool_options.is_empty() {
        normalized.insert("toolOptions".to_owned(), Value::Array(tool_options));
    }
    let tool_actions = object_array(annotations.get("toolActions"));
    if !tool_actions.is_empty() {
        normalized.insert("toolActions".to_owned(), Value::Array(tool_actions));
    }

    (!normalized.is_empty()).then_some(Value::Object(normalized))
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn object_array(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.is_object())
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}
