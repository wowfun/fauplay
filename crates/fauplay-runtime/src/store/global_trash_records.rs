use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{GlobalTrashEntry, GlobalTrashMoveItem, RuntimeError};

use super::{GLOBAL_CONFIG_FOLDER_NAME, modified_ms, number_value, string_value};

const GLOBAL_TRASH_FOLDER_NAME: &str = "recycle";
const GLOBAL_TRASH_META_FILENAME: &str = "items.json";

pub(super) fn global_trash_metadata_path(runtime_home_path: &Path) -> PathBuf {
    global_trash_storage_root_path(runtime_home_path)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join(GLOBAL_TRASH_META_FILENAME)
}

pub(super) fn global_trash_storage_root_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path.join(GLOBAL_CONFIG_FOLDER_NAME)
}

pub(super) fn global_trash_files_path(runtime_home_path: &Path) -> PathBuf {
    global_trash_storage_root_path(runtime_home_path)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join("files")
}

pub(super) fn canonical_global_trash_file_path(
    runtime_home_path: &Path,
    path: &Path,
) -> Option<PathBuf> {
    let storage_root = fs::canonicalize(global_trash_files_path(runtime_home_path)).ok()?;
    let stored_path = fs::canonicalize(path).ok()?;

    stored_path.starts_with(storage_root).then_some(stored_path)
}

pub(super) fn read_global_trash_metadata(
    path: &Path,
) -> Result<Option<Vec<serde_json::Value>>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let Some(items) = value.as_array() else {
        return Err(RuntimeError::invalid_runtime_home_file(
            path,
            "Global Trash metadata must be an array",
        ));
    };

    Ok(Some(items.clone()))
}

pub(super) fn write_global_trash_metadata(
    path: &Path,
    items: &[serde_json::Value],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }
    let raw = serde_json::to_string(items)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

pub(super) fn global_trash_entry_from_value(value: &serde_json::Value) -> Option<GlobalTrashEntry> {
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

pub(super) fn global_trash_metadata_value(
    runtime_home_path: &Path,
    item: &GlobalTrashMoveItem,
    deleted_at_ms: u64,
) -> serde_json::Value {
    let name = item
        .absolute_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let stored_absolute_path = item
        .next_absolute_path
        .as_ref()
        .unwrap_or(&item.absolute_path);

    serde_json::json!({
        "recycleId": item.recycle_id,
        "storageRootPath": global_trash_storage_root_path(runtime_home_path).display().to_string(),
        "storedAbsolutePath": stored_absolute_path.display().to_string(),
        "originalAbsolutePath": item.absolute_path.display().to_string(),
        "originalRootPath": null,
        "name": name,
        "size": fs::metadata(stored_absolute_path).map(|metadata| metadata.len()).unwrap_or(0),
        "mimeType": mime_type_for_name(name),
        "deletedAt": deleted_at_ms,
        "createdAt": deleted_at_ms,
        "updatedAt": deleted_at_ms,
    })
}

pub(super) fn stored_file_name_for(recycle_id: &str, source_absolute_path: &Path) -> String {
    match source_absolute_path
        .extension()
        .and_then(|value| value.to_str())
    {
        Some(extension) if !extension.is_empty() => format!("{recycle_id}.{extension}"),
        _ => recycle_id.to_owned(),
    }
}

pub(super) fn path_value(value: &serde_json::Value) -> Option<PathBuf> {
    string_value(Some(value))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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
