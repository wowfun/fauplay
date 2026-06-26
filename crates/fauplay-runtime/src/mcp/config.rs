use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{McpRuntimeError, McpRuntimeErrorCode};

const DEFAULT_MCP_CONFIG_PATH: &str = "src/config/mcp.json";
const GLOBAL_CONFIG_FOLDER_NAME: &str = "global";
const MCP_CONFIG_FILENAME: &str = "mcp.json";

#[derive(Debug, Clone)]
pub(super) struct McpConfig {
    pub(super) servers: Vec<McpServerEntry>,
}

#[derive(Debug, Clone)]
pub(super) struct McpServerEntry {
    pub(super) source_label: String,
    pub(super) command: String,
    pub(super) args: Vec<String>,
    pub(super) cwd: Option<PathBuf>,
    pub(super) env: HashMap<String, String>,
    pub(super) call_timeout_ms: u64,
    pub(super) init_timeout_ms: u64,
}

pub(crate) fn resolve_default_mcp_config_path() -> PathBuf {
    if let Some(path) = std::env::var_os("FAUPLAY_MCP_CONFIG_PATH")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return path;
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(DEFAULT_MCP_CONFIG_PATH)
}

pub(super) fn load_mcp_config(
    config_path: &Path,
    runtime_home_path: &Path,
) -> Result<McpConfig, McpRuntimeError> {
    let base_config = read_mcp_config_file(config_path, true)?;
    let global_config = read_mcp_config_file(&global_mcp_config_path(runtime_home_path), true)?;
    let config = merge_mcp_config(base_config.as_ref(), global_config.as_ref());
    let project_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    Ok(McpConfig {
        servers: parse_mcp_servers(&config, &project_dir),
    })
}

fn global_mcp_config_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(MCP_CONFIG_FILENAME)
}

fn read_mcp_config_file(
    path: &Path,
    allow_missing: bool,
) -> Result<Option<Value>, McpRuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if allow_missing && error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(McpRuntimeError::new(
                McpRuntimeErrorCode::ConfigError,
                format!("Failed to read MCP config: {} ({error})", path.display()),
            ));
        }
    };

    let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| {
        McpRuntimeError::new(
            McpRuntimeErrorCode::ConfigError,
            format!("Invalid JSON in MCP config: {} ({error})", path.display()),
        )
    })?;
    if !parsed.is_object() {
        return Err(McpRuntimeError::new(
            McpRuntimeErrorCode::ConfigError,
            format!("MCP config root must be an object: {}", path.display()),
        ));
    }

    Ok(Some(parsed))
}

fn merge_mcp_config(base_config: Option<&Value>, override_config: Option<&Value>) -> Value {
    let mut merged = object_clone(base_config).unwrap_or_default();
    let Some(override_object) = object_clone(override_config) else {
        return Value::Object(merged);
    };

    for (key, value) in &override_object {
        if key != "servers" {
            merged.insert(key.clone(), value.clone());
        }
    }

    let base_servers = merged
        .get("servers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let override_servers = override_object
        .get("servers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    if !base_servers.is_empty() || !override_servers.is_empty() {
        let mut servers = base_servers;
        for (name, override_entry) in override_servers {
            let next_entry = match (
                servers.get(&name).and_then(Value::as_object),
                override_entry.as_object(),
            ) {
                (Some(base_entry), Some(override_entry)) => {
                    let mut merged_entry = base_entry.clone();
                    for (key, value) in override_entry {
                        merged_entry.insert(key.clone(), value.clone());
                    }
                    Value::Object(merged_entry)
                }
                _ => override_entry,
            };
            servers.insert(name, next_entry);
        }
        merged.insert("servers".to_owned(), Value::Object(servers));
    }

    Value::Object(merged)
}

fn object_clone(value: Option<&Value>) -> Option<serde_json::Map<String, Value>> {
    value.and_then(Value::as_object).cloned()
}

fn parse_mcp_servers(config: &Value, project_dir: &Path) -> Vec<McpServerEntry> {
    let Some(servers) = config.get("servers").and_then(Value::as_object) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for (name, entry) in servers {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        if entry.get("disabled").and_then(Value::as_bool) == Some(true) {
            continue;
        }

        let transport = entry
            .get("type")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("stdio");
        if transport != "stdio" {
            continue;
        }

        let Some(command) = entry
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
        else {
            continue;
        };

        entries.push(McpServerEntry {
            source_label: name.clone(),
            command,
            args: string_array(entry.get("args")),
            cwd: entry
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|cwd| resolve_cwd(project_dir, cwd)),
            env: string_record(entry.get("env")),
            call_timeout_ms: positive_u64(entry.get("callTimeoutMs")).unwrap_or(5000),
            init_timeout_ms: positive_u64(entry.get("initTimeoutMs")).unwrap_or(2000),
        });
    }

    entries
}

fn resolve_cwd(project_dir: &Path, cwd: &str) -> PathBuf {
    let path = PathBuf::from(cwd);
    if path.is_absolute() {
        path
    } else {
        project_dir.join(path)
    }
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

fn string_record(value: Option<&Value>) -> HashMap<String, String> {
    let Some(object) = value.and_then(Value::as_object) else {
        return HashMap::new();
    };

    object
        .iter()
        .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
        .collect()
}

fn positive_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(Value::as_u64).filter(|value| *value > 0)
}
