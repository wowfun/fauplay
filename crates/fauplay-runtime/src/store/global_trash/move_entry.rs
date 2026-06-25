use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::{
    GlobalTrashFailureReason, GlobalTrashMoveItem, GlobalTrashMoveRequest, GlobalTrashMoveResponse,
    RuntimeError,
};

use super::super::global_trash_records::{
    global_trash_files_path, global_trash_metadata_path, global_trash_metadata_value,
    read_global_trash_metadata, stored_file_name_for, write_global_trash_metadata,
};
use super::super::now_ms;
use super::paths::allocate_deduped_path;

static GLOBAL_TRASH_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
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
