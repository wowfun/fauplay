//! Persistent runtime state owned by the Fauplay Runtime.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    GlobalShortcutConfigResponse, GlobalTrashEntry, GlobalTrashListRequest,
    GlobalTrashListResponse, RuntimeError,
};

const GLOBAL_CONFIG_FOLDER_NAME: &str = "global";
const SHORTCUTS_CONFIG_FILENAME: &str = "shortcuts.json";
const GLOBAL_TRASH_FOLDER_NAME: &str = "recycle";
const GLOBAL_TRASH_META_FILENAME: &str = "items.json";

pub(crate) fn load_global_shortcut_config(
    runtime_home_path: &Path,
) -> Result<GlobalShortcutConfigResponse, RuntimeError> {
    let path = runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(SHORTCUTS_CONFIG_FILENAME);

    match fs::read_to_string(&path) {
        Ok(config_json) => {
            serde_json::from_str::<serde_json::Value>(&config_json)
                .map_err(|error| RuntimeError::invalid_config(&path, &error.to_string()))?;

            Ok(GlobalShortcutConfigResponse {
                loaded: true,
                path,
                config_json: Some(config_json),
            })
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(GlobalShortcutConfigResponse {
            loaded: false,
            path,
            config_json: None,
        }),
        Err(error) => Err(RuntimeError::read_file(&path, error)),
    }
}

pub(crate) fn list_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashListRequest,
) -> Result<GlobalTrashListResponse, RuntimeError> {
    let path = runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join(GLOBAL_TRASH_META_FILENAME);

    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(global_trash_paged_response(
                Vec::new(),
                request.entry_limit,
                request.entry_offset,
            ));
        }
        Err(error) => return Err(RuntimeError::read_file(&path, error)),
    };

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(&path, &error.to_string()))?;
    let Some(items) = value.as_array() else {
        return Err(RuntimeError::invalid_runtime_home_file(
            &path,
            "Global Trash metadata must be an array",
        ));
    };

    let mut entries = Vec::new();
    for item in items {
        if let Some(entry) = global_trash_entry_from_value(item) {
            if entry.absolute_path.is_file() {
                entries.push(entry);
            }
        }
    }

    entries.sort_by(|left, right| {
        right
            .deleted_at_ms
            .cmp(&left.deleted_at_ms)
            .then_with(|| left.absolute_path.cmp(&right.absolute_path))
    });

    Ok(global_trash_paged_response(
        entries,
        request.entry_limit,
        request.entry_offset,
    ))
}

fn global_trash_paged_response(
    entries: Vec<GlobalTrashEntry>,
    entry_limit: Option<usize>,
    entry_offset: usize,
) -> GlobalTrashListResponse {
    let start = entry_offset.min(entries.len());
    let limit = entry_limit.unwrap_or(entries.len());
    let end = start.saturating_add(limit).min(entries.len());
    let is_truncated = end < entries.len();
    let next_offset = is_truncated.then_some(end);

    GlobalTrashListResponse {
        entries: entries[start..end].to_vec(),
        is_truncated,
        next_offset,
    }
}

fn global_trash_entry_from_value(value: &serde_json::Value) -> Option<GlobalTrashEntry> {
    let object = value.as_object()?;
    let absolute_path = path_value(object.get("storedAbsolutePath")?)?;
    let recycle_id = string_value(object.get("recycleId")).unwrap_or_default();
    let name = string_value(object.get("name"))
        .filter(|value| !value.is_empty())
        .or_else(|| {
            absolute_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })?;
    let original_absolute_path = string_value(object.get("originalAbsolutePath"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let metadata = fs::metadata(&absolute_path).ok();
    let size = number_value(object.get("size"))
        .or_else(|| metadata.as_ref().map(std::fs::Metadata::len))
        .unwrap_or(0);
    let deleted_at_ms = number_value(object.get("deletedAt")).unwrap_or(0);
    let mime_type = string_value(object.get("mimeType"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| mime_type_for_name(&name).to_owned());
    let preview_kind = preview_kind_for_name(&name).to_owned();
    let display_path = string_value(object.get("originalAbsolutePath"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| absolute_path.display().to_string());
    let last_modified_ms = metadata.as_ref().and_then(modified_ms);

    Some(GlobalTrashEntry {
        name,
        absolute_path,
        original_absolute_path,
        recycle_id,
        size,
        mime_type,
        preview_kind,
        display_path,
        last_modified_ms,
        deleted_at_ms,
    })
}

fn string_value(value: Option<&serde_json::Value>) -> Option<String> {
    value?.as_str().map(str::trim).map(ToOwned::to_owned)
}

fn path_value(value: &serde_json::Value) -> Option<PathBuf> {
    string_value(Some(value))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn number_value(value: Option<&serde_json::Value>) -> Option<u64> {
    let value = value?;
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    let value = value.as_f64()?;
    value.is_finite().then_some(value.max(0.0).trunc() as u64)
}

fn modified_ms(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn preview_kind_for_name(name: &str) -> &'static str {
    match extension_for_name(name).as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" | "avif" => "image",
        "mp4" | "webm" | "mov" | "avi" | "mkv" | "ogg" => "video",
        "txt" | "md" | "markdown" | "json" | "yaml" | "yml" | "xml" | "csv" | "log" | "js"
        | "jsx" | "ts" | "tsx" | "css" | "scss" | "less" | "html" | "htm" | "py" | "sh"
        | "bash" | "zsh" | "ini" | "conf" | "toml" | "sql" | "c" | "cc" | "cpp" | "h" | "hpp"
        | "java" | "go" | "rs" | "vue" | "svelte" => "text",
        _ => "unsupported",
    }
}

fn mime_type_for_name(name: &str) -> &'static str {
    match extension_for_name(name).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "ogg" => "video/ogg",
        "txt" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "jsx" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        _ => "application/octet-stream",
    }
}

fn extension_for_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub(crate) fn resolve_default_runtime_home_path() -> PathBuf {
    if let Some(path) = std::env::var_os("FAUPLAY_HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return path;
    }

    if let Some(home) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return home.join(".fauplay");
    }

    if let Some(profile) = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return profile.join(".fauplay");
    }

    PathBuf::from(".fauplay")
}
