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

use super::global_trash_records::{
    canonical_global_trash_file_path, global_trash_entry_from_value, global_trash_files_path,
    global_trash_metadata_path, global_trash_metadata_value, path_value,
    read_global_trash_metadata, stored_file_name_for, write_global_trash_metadata,
};
use super::{now_ms, string_value};

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
        write_global_trash_metadata(&path, &meta_items)?;
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

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
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
