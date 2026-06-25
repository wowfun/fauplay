use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    GlobalTrashFailureReason, GlobalTrashRestoreItem, GlobalTrashRestoreRequest,
    GlobalTrashRestoreResponse, RuntimeError,
};

use super::super::global_trash_records::{
    global_trash_metadata_path, path_value, read_global_trash_metadata, write_global_trash_metadata,
};
use super::super::string_value;
use super::paths::allocate_deduped_path;

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
