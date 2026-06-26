use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    RemoteAccessConfigResponse, RemoteAccessConfigSource, RemoteAccessRoot,
    RemoteAccessTokenVerifyRequest, RuntimeError,
};

use super::{GLOBAL_CONFIG_FOLDER_NAME, list_resolved_remote_published_roots};

const DEFAULT_REMOTE_ACCESS_CONFIG_PATH: &str = "src/config/remote-access.json";
const REMOTE_ACCESS_CONFIG_FILENAME: &str = "remote-access.json";
const GLOBAL_ENV_FILENAME: &str = ".env";
const DEFAULT_REMOTE_ACCESS_CONFIG_JSON: &str =
    r#"{"enabled":true,"rootSource":"local-browser-sync","roots":[]}"#;

pub(crate) fn load_remote_access_config(
    runtime_home_path: &Path,
) -> Result<RemoteAccessConfigResponse, RuntimeError> {
    let default_config_path = PathBuf::from(DEFAULT_REMOTE_ACCESS_CONFIG_PATH);
    let global_config_path = runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(REMOTE_ACCESS_CONFIG_FILENAME);
    let global_env_path = runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(GLOBAL_ENV_FILENAME);

    let (default_config, default_loaded) =
        read_remote_access_config_or_default(&default_config_path)?;
    let (global_config, global_loaded) = read_optional_remote_access_config(&global_config_path)?;
    let merged = merge_remote_access_config(&default_config, global_config.as_ref());
    let root_source = normalize_root_source(merged.get("rootSource"));
    let token = read_remote_access_token(&global_env_path)?;
    let auth_configured = !token.is_empty();
    let configured = merged.get("enabled").and_then(serde_json::Value::as_bool) == Some(true);
    let roots = if root_source == "local-browser-sync" {
        list_resolved_remote_published_roots(runtime_home_path)?
            .items
            .into_iter()
            .map(|item| RemoteAccessRoot {
                id: item.id,
                label: item.label,
                path: item.absolute_path,
                real_path: item.real_path,
            })
            .collect()
    } else {
        resolve_manual_roots(merged.get("roots"))?
    };

    let config_sources = vec![
        RemoteAccessConfigSource {
            label: "default".to_owned(),
            path: default_config_path.clone(),
            loaded: default_loaded,
        },
        RemoteAccessConfigSource {
            label: "global".to_owned(),
            path: global_config_path.clone(),
            loaded: global_loaded,
        },
        RemoteAccessConfigSource {
            label: "global-env".to_owned(),
            path: global_env_path.clone(),
            loaded: global_env_path.exists(),
        },
    ];
    let fingerprint = remote_access_fingerprint(&config_sources);

    Ok(RemoteAccessConfigResponse {
        enabled: configured && auth_configured,
        configured,
        auth_configured,
        root_source,
        roots,
        config_sources,
        fingerprint,
    })
}

pub(crate) fn verify_remote_access_token(
    runtime_home_path: &Path,
    request: RemoteAccessTokenVerifyRequest,
) -> Result<bool, RuntimeError> {
    let token = read_remote_access_token(
        &runtime_home_path
            .join(GLOBAL_CONFIG_FOLDER_NAME)
            .join(GLOBAL_ENV_FILENAME),
    )?;
    Ok(constant_time_eq(
        token.trim().as_bytes(),
        request.bearer_token.trim().as_bytes(),
    ) && !token.trim().is_empty())
}

fn read_remote_access_config_or_default(
    path: &Path,
) -> Result<(serde_json::Value, bool), RuntimeError> {
    match fs::read_to_string(path) {
        Ok(raw) => parse_remote_access_config(path, &raw).map(|config| (config, true)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            parse_remote_access_config(path, DEFAULT_REMOTE_ACCESS_CONFIG_JSON)
                .map(|config| (config, false))
        }
        Err(error) => Err(RuntimeError::read_file(path, error)),
    }
}

fn read_optional_remote_access_config(
    path: &Path,
) -> Result<(Option<serde_json::Value>, bool), RuntimeError> {
    match fs::read_to_string(path) {
        Ok(raw) => parse_remote_access_config(path, &raw).map(|config| (Some(config), true)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok((None, false)),
        Err(error) => Err(RuntimeError::read_file(path, error)),
    }
}

fn parse_remote_access_config(path: &Path, raw: &str) -> Result<serde_json::Value, RuntimeError> {
    let value = serde_json::from_str::<serde_json::Value>(raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    if !value.is_object() {
        return Err(RuntimeError::invalid_runtime_home_file(
            path,
            "remote-access config root must be an object",
        ));
    }
    Ok(value)
}

fn merge_remote_access_config(
    base: &serde_json::Value,
    override_config: Option<&serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut merged = base.as_object().cloned().unwrap_or_default();
    let Some(override_object) = override_config.and_then(serde_json::Value::as_object) else {
        return merged;
    };

    for (key, value) in override_object {
        if key == "roots" {
            continue;
        }
        merged.insert(key.clone(), value.clone());
    }
    if let Some(roots) = override_object
        .get("roots")
        .and_then(serde_json::Value::as_array)
    {
        merged.insert("roots".to_owned(), serde_json::Value::Array(roots.clone()));
    }
    merged
}

fn normalize_root_source(value: Option<&serde_json::Value>) -> String {
    if value.and_then(serde_json::Value::as_str) == Some("local-browser-sync") {
        "local-browser-sync".to_owned()
    } else {
        "manual".to_owned()
    }
}

fn resolve_manual_roots(
    value: Option<&serde_json::Value>,
) -> Result<Vec<RemoteAccessRoot>, RuntimeError> {
    let Some(items) = value.and_then(serde_json::Value::as_array) else {
        return Ok(Vec::new());
    };
    let mut seen_ids = HashSet::new();
    let mut roots = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            return Err(RuntimeError::runtime_capability(
                "remote-access roots must contain objects",
            ));
        };
        let id = trimmed_string(object.get("id"));
        let label = trimmed_string(object.get("label"));
        let raw_path = trimmed_string(object.get("path"));
        if id.is_empty() || label.is_empty() || raw_path.is_empty() {
            return Err(RuntimeError::runtime_capability(
                "remote-access root entries require id, label and path",
            ));
        }
        if !seen_ids.insert(id.clone()) {
            return Err(RuntimeError::runtime_capability(format!(
                "duplicate Remote Root id: {id}",
            )));
        }

        let path = PathBuf::from(&raw_path);
        if !path.is_absolute() {
            return Err(RuntimeError::runtime_capability(
                "remote-access root path must be absolute",
            ));
        }
        let metadata =
            fs::metadata(&path).map_err(|error| RuntimeError::read_file(&path, error))?;
        if !metadata.is_dir() {
            return Err(RuntimeError::runtime_capability(
                "remote-access root path must be a directory",
            ));
        }
        let real_path =
            fs::canonicalize(&path).map_err(|error| RuntimeError::read_file(&path, error))?;
        roots.push(RemoteAccessRoot {
            id,
            label,
            path: normalize_path(path),
            real_path: normalize_path(real_path),
        });
    }

    Ok(roots)
}

fn trimmed_string(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_owned()
}

fn normalize_path(path: PathBuf) -> PathBuf {
    PathBuf::from(path.to_string_lossy().replace('\\', "/"))
}

fn read_remote_access_token(global_env_path: &Path) -> Result<String, RuntimeError> {
    if let Some(token) = read_remote_access_token_from_env_file(global_env_path)? {
        return Ok(token);
    }
    Ok(std::env::var("FAUPLAY_REMOTE_ACCESS_TOKEN")
        .unwrap_or_default()
        .trim()
        .to_owned())
}

fn read_remote_access_token_from_env_file(path: &Path) -> Result<Option<String>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };
    Ok(parse_env_file_value(&raw, "FAUPLAY_REMOTE_ACCESS_TOKEN")
        .map(|value| value.trim().to_owned()))
}

fn parse_env_file_value(raw: &str, target_key: &str) -> Option<String> {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    for line in raw.lines() {
        let mut working = line.trim_start();
        let trimmed = working.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(rest) = working.strip_prefix("export ") {
            working = rest;
        }
        let Some((key, raw_value)) = working.split_once('=') else {
            continue;
        };
        if key.trim() != target_key {
            continue;
        }
        return Some(parse_env_value(raw_value));
    }
    None
}

fn parse_env_value(raw_value: &str) -> String {
    let trimmed = raw_value.trim_start();
    if let Some(rest) = trimmed.strip_prefix('"') {
        return parse_double_quoted_env_value(rest);
    }
    if let Some(rest) = trimmed.strip_prefix('\'') {
        return rest
            .split_once('\'')
            .map(|(value, _)| value)
            .unwrap_or(rest)
            .to_owned();
    }
    let value = trimmed
        .split_once(" #")
        .map(|(value, _)| value)
        .unwrap_or(trimmed);
    value.trim_end().to_owned()
}

fn parse_double_quoted_env_value(value: &str) -> String {
    let mut decoded = String::new();
    let mut chars = value.chars();
    while let Some(next) = chars.next() {
        if next == '"' {
            break;
        }
        if next != '\\' {
            decoded.push(next);
            continue;
        }
        match chars.next() {
            Some('n') => decoded.push('\n'),
            Some('r') => decoded.push('\r'),
            Some('t') => decoded.push('\t'),
            Some(other) => decoded.push(other),
            None => decoded.push('\\'),
        }
    }
    decoded
}

fn remote_access_fingerprint(sources: &[RemoteAccessConfigSource]) -> String {
    sources
        .iter()
        .map(|source| {
            let file_fingerprint = fs::metadata(&source.path)
                .ok()
                .and_then(|metadata| {
                    let size = metadata.len();
                    let modified_ms = metadata
                        .modified()
                        .ok()?
                        .duration_since(std::time::UNIX_EPOCH)
                        .ok()?
                        .as_millis();
                    Some(format!("{size}:{modified_ms}"))
                })
                .unwrap_or_else(|| "missing".to_owned());
            format!("{}:{file_fingerprint}", source.label)
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let max_len = left.len().max(right.len());
    let mut diff = left.len() ^ right.len();
    for index in 0..max_len {
        let left_byte = left.get(index).copied().unwrap_or(0);
        let right_byte = right.get(index).copied().unwrap_or(0);
        diff |= usize::from(left_byte ^ right_byte);
    }
    diff == 0
}
