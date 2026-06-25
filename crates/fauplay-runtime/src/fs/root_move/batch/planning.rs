use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{RootMoveBatchFailureReason, RootMoveBatchItem, RootRelativePath};

use super::super::is_invalid_root_move_source;
use super::{fail_root_move_batch_item, rule::CompiledRootMoveRule};

pub(super) fn build_root_move_batch_item(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    rule: &CompiledRootMoveRule,
    counter_value: i64,
    root_base_name: &str,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> (RootMoveBatchItem, i64) {
    let absolute_path = root_path.join(root_relative_path.as_path());
    let mut item = RootMoveBatchItem {
        root_relative_path,
        next_root_relative_path: None,
        absolute_path,
        next_absolute_path: None,
        ok: true,
        skipped: false,
        reason: None,
        error: None,
    };

    if is_invalid_root_move_source(&item.root_relative_path) {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::InvalidPath,
            "Root Move Batch source must be user content outside .trash",
        );
        return (item, counter_value);
    }

    match fs::symlink_metadata(&item.absolute_path) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => {
            fail_root_move_batch_item(
                &mut item,
                RootMoveBatchFailureReason::UnsupportedKind,
                "Root Move Batch only supports files",
            );
            return (item, counter_value);
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fail_root_move_batch_item(
                &mut item,
                RootMoveBatchFailureReason::SourceNotFound,
                "Root Move Batch source was not found",
            );
            return (item, counter_value);
        }
        Err(error) => {
            fail_root_move_batch_item(
                &mut item,
                RootMoveBatchFailureReason::MutationFailed,
                &format!("failed to inspect Root Move Batch source: {error}"),
            );
            return (item, counter_value);
        }
    }

    let Some(source_name) = item
        .absolute_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
    else {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::InvalidPath,
            "Root Move Batch source name is invalid",
        );
        return (item, counter_value);
    };

    let target_name = match rule.render_target_name(
        &source_name,
        &item.root_relative_path,
        counter_value,
        root_base_name,
    ) {
        Ok(target_name) => target_name,
        Err(error) => {
            fail_root_move_batch_item(&mut item, RootMoveBatchFailureReason::InvalidTarget, &error);
            return (item, counter_value);
        }
    };
    let next_counter_value = counter_value.saturating_add(rule.counter_step());

    let Some(parent_path) = item.absolute_path.parent() else {
        fail_root_move_batch_item(
            &mut item,
            RootMoveBatchFailureReason::InvalidPath,
            "Root Move Batch source parent is invalid",
        );
        return (item, next_counter_value);
    };
    let candidate_absolute_path = parent_path.join(target_name);
    let target_absolute_path = allocate_deduped_root_move_target_path(
        &item.absolute_path,
        &candidate_absolute_path,
        reserved_target_paths,
    );

    let next_root_relative_path =
        match try_root_relative_path_from_absolute(root_path, &target_absolute_path) {
            Some(path) => path,
            None => {
                fail_root_move_batch_item(
                    &mut item,
                    RootMoveBatchFailureReason::InvalidTarget,
                    "Root Move Batch target escapes the Local Root",
                );
                return (item, next_counter_value);
            }
        };

    item.next_root_relative_path = Some(next_root_relative_path);
    item.next_absolute_path = Some(target_absolute_path.clone());
    if target_absolute_path == item.absolute_path {
        item.skipped = true;
        item.reason = Some(RootMoveBatchFailureReason::NoChange);
    }
    reserved_target_paths.insert(target_absolute_path);

    (item, next_counter_value)
}

pub(super) fn root_base_name(root_path: &Path) -> String {
    root_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| root_path.display().to_string())
}

fn allocate_deduped_root_move_target_path(
    source_absolute_path: &Path,
    candidate_absolute_path: &Path,
    reserved_target_paths: &HashSet<PathBuf>,
) -> PathBuf {
    let Some(parent) = candidate_absolute_path.parent() else {
        return candidate_absolute_path.to_path_buf();
    };
    let stem = candidate_absolute_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = candidate_absolute_path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    let mut attempt_path = candidate_absolute_path.to_path_buf();
    let mut suffix_index = 1;

    loop {
        if attempt_path == source_absolute_path {
            return attempt_path;
        }
        if !reserved_target_paths.contains(&attempt_path) && !attempt_path.exists() {
            return attempt_path;
        }

        attempt_path = parent.join(format!("{stem} ({suffix_index}){extension}"));
        suffix_index += 1;
    }
}

fn try_root_relative_path_from_absolute(
    root_path: &Path,
    absolute_path: &Path,
) -> Option<RootRelativePath> {
    let relative_path = absolute_path.strip_prefix(root_path).ok()?.to_path_buf();
    RootRelativePath::try_from(relative_path).ok()
}
