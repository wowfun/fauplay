use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::{
    GlobalTrashEntry, GlobalTrashFailureReason, GlobalTrashListRequest, GlobalTrashListResponse,
    GlobalTrashMoveItem, GlobalTrashMoveRequest, GlobalTrashMoveResponse, GlobalTrashRestoreItem,
    GlobalTrashRestoreRequest, GlobalTrashRestoreResponse, RuntimeError,
};

use super::{GLOBAL_CONFIG_FOLDER_NAME, modified_ms, now_ms, number_value, string_value};

const GLOBAL_TRASH_FOLDER_NAME: &str = "recycle";
const GLOBAL_TRASH_META_FILENAME: &str = "items.json";
static GLOBAL_TRASH_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn list_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashListRequest,
) -> Result<GlobalTrashListResponse, RuntimeError> {
    let path = global_trash_metadata_path(runtime_home_path);

    let Some(items) = read_global_trash_metadata(&path)? else {
        return Ok(global_trash_paged_response(
            Vec::new(),
            request.entry_limit,
            request.entry_offset,
        ));
    };

    let mut entries = Vec::new();
    for item in &items {
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

pub(crate) fn global_trash_file_path(
    runtime_home_path: &Path,
    recycle_id: &str,
) -> Result<Option<PathBuf>, RuntimeError> {
    let recycle_id = recycle_id.trim();
    if recycle_id.is_empty() {
        return Ok(None);
    }

    let path = global_trash_metadata_path(runtime_home_path);
    let Some(items) = read_global_trash_metadata(&path)? else {
        return Ok(None);
    };

    let Some(entry) = items
        .iter()
        .find(|item| string_value(item.get("recycleId")).as_deref() == Some(recycle_id))
        .and_then(global_trash_entry_from_value)
    else {
        return Ok(None);
    };

    let Some(stored_path) =
        canonical_global_trash_file_path(runtime_home_path, &entry.absolute_path)
    else {
        return Ok(None);
    };

    Ok(stored_path.is_file().then_some(stored_path))
}

pub(crate) fn move_to_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashMoveRequest,
) -> Result<GlobalTrashMoveResponse, RuntimeError> {
    let metadata_path = global_trash_metadata_path(runtime_home_path);
    let mut meta_items = read_global_trash_metadata(&metadata_path)?.unwrap_or_default();
    let mut response_items = Vec::new();
    let mut reserved_target_paths = HashSet::new();

    for absolute_path in request.absolute_paths {
        let mut item = build_global_trash_move_item(
            runtime_home_path,
            absolute_path,
            &mut reserved_target_paths,
        );

        if item.ok && !request.dry_run {
            commit_global_trash_move_item(&mut item);
            if item.ok {
                let deleted_at_ms = item.deleted_at_ms.unwrap_or_else(now_ms);
                meta_items.push(global_trash_metadata_value(
                    runtime_home_path,
                    &item,
                    deleted_at_ms,
                ));
            }
        }

        response_items.push(item);
    }

    if !request.dry_run && response_items.iter().any(|item| item.ok) {
        write_global_trash_metadata(&metadata_path, &meta_items)?;
    }

    let total = response_items.len();
    let moved = response_items.iter().filter(|item| item.ok).count();

    Ok(GlobalTrashMoveResponse {
        dry_run: request.dry_run,
        total,
        moved,
        failed: total - moved,
        items: response_items,
    })
}

pub(crate) fn restore_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashRestoreRequest,
) -> Result<GlobalTrashRestoreResponse, RuntimeError> {
    let path = global_trash_metadata_path(runtime_home_path);
    let metadata_was_loaded = path.exists();
    let mut meta_items = read_global_trash_metadata(&path)?.unwrap_or_default();
    let mut reserved_target_paths = HashSet::new();
    let mut response_items = Vec::new();

    for recycle_id in request.recycle_ids {
        let recycle_id = recycle_id.trim().to_owned();
        let Some(meta_index) = meta_items.iter().position(|item| {
            string_value(item.get("recycleId")).as_deref() == Some(recycle_id.as_str())
        }) else {
            response_items.push(failed_global_trash_restore_item(
                recycle_id,
                PathBuf::new(),
                PathBuf::new(),
                GlobalTrashFailureReason::RecycleItemNotFound,
                "Global Trash Entry was not found",
            ));
            continue;
        };

        let meta_item = meta_items[meta_index].clone();
        let mut item =
            build_global_trash_restore_item(recycle_id, &meta_item, &mut reserved_target_paths);

        if item.ok && !request.dry_run {
            commit_global_trash_restore_item(&mut item);
            if item.ok {
                meta_items.remove(meta_index);
            }
        }

        response_items.push(item);
    }

    if metadata_was_loaded && !request.dry_run && response_items.iter().any(|item| item.ok) {
        let next_raw = serde_json::to_string(&meta_items)
            .map_err(|error| RuntimeError::invalid_runtime_home_file(&path, &error.to_string()))?;
        fs::write(&path, next_raw).map_err(|source| RuntimeError::write_file(&path, source))?;
    }

    let total = response_items.len();
    let restored = response_items.iter().filter(|item| item.ok).count();

    Ok(GlobalTrashRestoreResponse {
        dry_run: request.dry_run,
        total,
        restored,
        failed: total - restored,
        items: response_items,
    })
}

fn global_trash_metadata_path(runtime_home_path: &Path) -> PathBuf {
    global_trash_storage_root_path(runtime_home_path)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join(GLOBAL_TRASH_META_FILENAME)
}

fn global_trash_storage_root_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path.join(GLOBAL_CONFIG_FOLDER_NAME)
}

fn global_trash_files_path(runtime_home_path: &Path) -> PathBuf {
    global_trash_storage_root_path(runtime_home_path)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join("files")
}

fn canonical_global_trash_file_path(runtime_home_path: &Path, path: &Path) -> Option<PathBuf> {
    let storage_root = fs::canonicalize(global_trash_files_path(runtime_home_path)).ok()?;
    let stored_path = fs::canonicalize(path).ok()?;

    stored_path.starts_with(storage_root).then_some(stored_path)
}

fn read_global_trash_metadata(path: &Path) -> Result<Option<Vec<serde_json::Value>>, RuntimeError> {
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

fn write_global_trash_metadata(
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

fn next_global_trash_recycle_id(runtime_home_path: &Path, source_absolute_path: &Path) -> String {
    let seed = now_nanos();
    let process_id = std::process::id();

    loop {
        let sequence = GLOBAL_TRASH_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let recycle_id = format!("{seed:x}-{process_id:x}-{sequence:x}");
        let stored_file_path = global_trash_files_path(runtime_home_path)
            .join(stored_file_name_for(&recycle_id, source_absolute_path));
        if !stored_file_path.exists() {
            return recycle_id;
        }
    }
}

fn stored_file_name_for(recycle_id: &str, source_absolute_path: &Path) -> String {
    match source_absolute_path
        .extension()
        .and_then(|value| value.to_str())
    {
        Some(extension) if !extension.is_empty() => format!("{recycle_id}.{extension}"),
        _ => recycle_id.to_owned(),
    }
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

fn build_global_trash_move_item(
    runtime_home_path: &Path,
    absolute_path: PathBuf,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> GlobalTrashMoveItem {
    match fs::symlink_metadata(&absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return failed_global_trash_move_item(
                absolute_path,
                GlobalTrashFailureReason::SourceNotFound,
                "Global Trash move source was not found",
            );
        }
        Err(error) => {
            return failed_global_trash_move_item(
                absolute_path,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to inspect Global Trash move source: {error}"),
            );
        }
        Ok(metadata) if !metadata.is_file() => {
            return failed_global_trash_move_item(
                absolute_path,
                GlobalTrashFailureReason::UnsupportedKind,
                "Global Trash only supports files",
            );
        }
        Ok(_) => {}
    };

    let recycle_id = next_global_trash_recycle_id(runtime_home_path, &absolute_path);
    let candidate_path = global_trash_files_path(runtime_home_path)
        .join(stored_file_name_for(&recycle_id, &absolute_path));
    let next_absolute_path =
        allocate_deduped_path(&absolute_path, &candidate_path, reserved_target_paths);

    GlobalTrashMoveItem {
        absolute_path,
        next_absolute_path: Some(next_absolute_path),
        recycle_id,
        deleted_at_ms: Some(now_ms()),
        ok: true,
        reason: None,
        error: None,
    }
}

fn commit_global_trash_move_item(item: &mut GlobalTrashMoveItem) {
    let Some(target_absolute_path) = item.next_absolute_path.clone() else {
        fail_global_trash_move_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash target path was not planned",
        );
        return;
    };

    if let Some(parent) = target_absolute_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            fail_global_trash_move_item(
                item,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to create Global Trash target directory: {error}"),
            );
            return;
        }
    }

    if target_absolute_path.exists() && target_absolute_path != item.absolute_path {
        fail_global_trash_move_item(
            item,
            GlobalTrashFailureReason::TargetExists,
            "Global Trash target path already exists",
        );
        return;
    }

    if let Err(error) = move_file(&item.absolute_path, &target_absolute_path) {
        fail_global_trash_move_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            &format!("Global Trash move failed: {error}"),
        );
    }
}

fn global_trash_metadata_value(
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

fn failed_global_trash_move_item(
    absolute_path: PathBuf,
    reason: GlobalTrashFailureReason,
    error: &str,
) -> GlobalTrashMoveItem {
    GlobalTrashMoveItem {
        absolute_path,
        next_absolute_path: None,
        recycle_id: String::new(),
        deleted_at_ms: None,
        ok: false,
        reason: Some(reason),
        error: Some(error.to_owned()),
    }
}

fn fail_global_trash_move_item(
    item: &mut GlobalTrashMoveItem,
    reason: GlobalTrashFailureReason,
    error: &str,
) {
    item.ok = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn build_global_trash_restore_item(
    recycle_id: String,
    meta_item: &serde_json::Value,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> GlobalTrashRestoreItem {
    let Some(stored_absolute_path) = meta_item.get("storedAbsolutePath").and_then(path_value)
    else {
        return failed_global_trash_restore_item(
            recycle_id,
            PathBuf::new(),
            PathBuf::new(),
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash metadata is missing storedAbsolutePath",
        );
    };
    let Some(original_absolute_path) = meta_item.get("originalAbsolutePath").and_then(path_value)
    else {
        return failed_global_trash_restore_item(
            recycle_id,
            stored_absolute_path,
            PathBuf::new(),
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash metadata is missing originalAbsolutePath",
        );
    };

    let target_absolute_path = match fs::symlink_metadata(&stored_absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return failed_global_trash_restore_item(
                recycle_id,
                stored_absolute_path,
                original_absolute_path,
                GlobalTrashFailureReason::SourceNotFound,
                "Global Trash stored file was not found",
            );
        }
        Err(error) => {
            return failed_global_trash_restore_item(
                recycle_id,
                stored_absolute_path,
                original_absolute_path,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to inspect Global Trash stored file: {error}"),
            );
        }
        Ok(metadata) if !metadata.is_file() => {
            return failed_global_trash_restore_item(
                recycle_id,
                stored_absolute_path,
                original_absolute_path,
                GlobalTrashFailureReason::UnsupportedKind,
                "Global Trash only supports files",
            );
        }
        Ok(_) => allocate_deduped_path(
            &stored_absolute_path,
            &original_absolute_path,
            reserved_target_paths,
        ),
    };

    GlobalTrashRestoreItem {
        recycle_id,
        absolute_path: stored_absolute_path,
        original_absolute_path,
        next_absolute_path: Some(target_absolute_path),
        ok: true,
        reason: None,
        error: None,
    }
}

fn commit_global_trash_restore_item(item: &mut GlobalTrashRestoreItem) {
    let Some(target_absolute_path) = item.next_absolute_path.clone() else {
        fail_global_trash_restore_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash restore target path was not planned",
        );
        return;
    };

    if let Some(parent) = target_absolute_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            fail_global_trash_restore_item(
                item,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to create Global Trash restore target directory: {error}"),
            );
            return;
        }
    }

    if target_absolute_path.exists() && target_absolute_path != item.absolute_path {
        fail_global_trash_restore_item(
            item,
            GlobalTrashFailureReason::TargetExists,
            "Global Trash restore target path already exists",
        );
        return;
    }

    if let Err(error) = fs::rename(&item.absolute_path, &target_absolute_path) {
        fail_global_trash_restore_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            &format!("Global Trash restore failed: {error}"),
        );
    }
}

fn failed_global_trash_restore_item(
    recycle_id: String,
    absolute_path: PathBuf,
    original_absolute_path: PathBuf,
    reason: GlobalTrashFailureReason,
    error: &str,
) -> GlobalTrashRestoreItem {
    GlobalTrashRestoreItem {
        recycle_id,
        absolute_path,
        original_absolute_path,
        next_absolute_path: None,
        ok: false,
        reason: Some(reason),
        error: Some(error.to_owned()),
    }
}

fn fail_global_trash_restore_item(
    item: &mut GlobalTrashRestoreItem,
    reason: GlobalTrashFailureReason,
    error: &str,
) {
    item.ok = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn path_value(value: &serde_json::Value) -> Option<PathBuf> {
    string_value(Some(value))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
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

fn allocate_deduped_path(
    source_absolute_path: &Path,
    candidate_absolute_path: &Path,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> PathBuf {
    let mut attempt_path = candidate_absolute_path.to_path_buf();
    let mut suffix_index = 1;

    while attempt_path != source_absolute_path
        && (reserved_target_paths.contains(&attempt_path) || attempt_path.exists())
    {
        attempt_path = path_with_dedupe_suffix(candidate_absolute_path, suffix_index);
        suffix_index += 1;
    }

    reserved_target_paths.insert(attempt_path.clone());
    attempt_path
}

fn path_with_dedupe_suffix(path: &Path, suffix_index: usize) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let extension = path.extension().and_then(|value| value.to_str());
    let name = match extension {
        Some(extension) if !extension.is_empty() => {
            format!("{stem} ({suffix_index}).{extension}")
        }
        _ => format!("{stem} ({suffix_index})"),
    };

    parent.join(name)
}

fn move_file(source_absolute_path: &Path, target_absolute_path: &Path) -> io::Result<()> {
    match fs::rename(source_absolute_path, target_absolute_path) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source_absolute_path, target_absolute_path)?;
            if let Err(remove_error) = fs::remove_file(source_absolute_path) {
                let _ = fs::remove_file(target_absolute_path);
                return Err(remove_error);
            }
            Ok(())
        }
    }
}
