use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    RootRelativePath, RootTrashFailureReason, RootTrashMutationItem, RootTrashMutationResponse,
    RootTrashRequest, RuntimeError,
};

use super::paths::{
    allocate_deduped_path, restore_target_path_for, root_relative_path_from_absolute,
    root_trash_path_for,
};
use crate::fs::{is_empty_root_relative_path, is_inside_root_trash, is_supported_mutation_source};

pub(crate) fn move_to_root_trash(
    request: RootTrashRequest,
) -> Result<RootTrashMutationResponse, RuntimeError> {
    mutate_root_trash(request, RootTrashOperation::MoveToTrash)
}

pub(crate) fn restore_from_root_trash(
    request: RootTrashRequest,
) -> Result<RootTrashMutationResponse, RuntimeError> {
    mutate_root_trash(request, RootTrashOperation::Restore)
}

#[derive(Debug, Clone, Copy)]
enum RootTrashOperation {
    MoveToTrash,
    Restore,
}

struct RootTrashPlan {
    item: RootTrashMutationItem,
}

fn mutate_root_trash(
    request: RootTrashRequest,
    operation: RootTrashOperation,
) -> Result<RootTrashMutationResponse, RuntimeError> {
    let mut reserved_target_paths = HashSet::new();
    let mut plans = request
        .root_relative_paths
        .into_iter()
        .map(|root_relative_path| {
            build_root_trash_plan(
                &request.root_path,
                root_relative_path,
                operation,
                &mut reserved_target_paths,
            )
        })
        .collect::<Vec<_>>();

    if !request.dry_run {
        commit_root_trash_plans(&mut plans);
    }

    let items = plans.into_iter().map(|plan| plan.item).collect::<Vec<_>>();
    let completed = items.iter().filter(|item| item.ok).count();
    let total = items.len();

    Ok(RootTrashMutationResponse {
        dry_run: request.dry_run,
        total,
        completed,
        failed: total - completed,
        items,
    })
}

fn build_root_trash_plan(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    operation: RootTrashOperation,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> RootTrashPlan {
    match operation {
        RootTrashOperation::MoveToTrash => {
            build_move_to_root_trash_plan(root_path, root_relative_path, reserved_target_paths)
        }
        RootTrashOperation::Restore => {
            build_restore_from_root_trash_plan(root_path, root_relative_path, reserved_target_paths)
        }
    }
}

fn build_move_to_root_trash_plan(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> RootTrashPlan {
    let source_absolute_path = root_path.join(root_relative_path.as_path());

    if is_empty_root_relative_path(&root_relative_path) || is_inside_root_trash(&root_relative_path)
    {
        return failed_root_trash_plan(
            root_relative_path,
            source_absolute_path,
            RootTrashFailureReason::InvalidSource,
            "Root Trash move source must be user content outside .trash",
        );
    }

    if !is_supported_mutation_source(&source_absolute_path) {
        return missing_or_unsupported_root_trash_plan(root_relative_path, source_absolute_path);
    }

    let candidate_root_relative_path = root_trash_path_for(&root_relative_path);
    let candidate_absolute_path = root_path.join(candidate_root_relative_path.as_path());
    let target_absolute_path = allocate_deduped_path(
        &source_absolute_path,
        &candidate_absolute_path,
        reserved_target_paths,
    );
    let target_root_relative_path =
        root_relative_path_from_absolute(root_path, &target_absolute_path);

    ok_root_trash_plan(
        root_relative_path,
        source_absolute_path,
        target_root_relative_path,
        target_absolute_path,
    )
}

fn build_restore_from_root_trash_plan(
    root_path: &Path,
    root_relative_path: RootRelativePath,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> RootTrashPlan {
    let source_absolute_path = root_path.join(root_relative_path.as_path());

    let Some(restored_root_relative_path) = restore_target_path_for(&root_relative_path) else {
        return failed_root_trash_plan(
            root_relative_path,
            source_absolute_path,
            RootTrashFailureReason::InvalidSource,
            "Root Trash restore source must be under .trash",
        );
    };

    if !is_supported_mutation_source(&source_absolute_path) {
        return missing_or_unsupported_root_trash_plan(root_relative_path, source_absolute_path);
    }

    let candidate_absolute_path = root_path.join(restored_root_relative_path.as_path());
    let target_absolute_path = allocate_deduped_path(
        &source_absolute_path,
        &candidate_absolute_path,
        reserved_target_paths,
    );
    let target_root_relative_path =
        root_relative_path_from_absolute(root_path, &target_absolute_path);

    ok_root_trash_plan(
        root_relative_path,
        source_absolute_path,
        target_root_relative_path,
        target_absolute_path,
    )
}

fn commit_root_trash_plans(plans: &mut [RootTrashPlan]) {
    for plan in plans {
        if !plan.item.ok {
            continue;
        }
        let Some(target_absolute_path) = plan.item.next_absolute_path.clone() else {
            fail_root_trash_item(
                &mut plan.item,
                RootTrashFailureReason::MutationFailed,
                "Root Trash target path was not planned",
            );
            continue;
        };

        if let Some(parent) = target_absolute_path.parent() {
            if let Err(error) = fs::create_dir_all(parent) {
                fail_root_trash_item(
                    &mut plan.item,
                    RootTrashFailureReason::MutationFailed,
                    &format!("failed to create Root Trash target directory: {error}"),
                );
                continue;
            }
        }

        if target_absolute_path.exists() && target_absolute_path != plan.item.absolute_path {
            fail_root_trash_item(
                &mut plan.item,
                RootTrashFailureReason::TargetExists,
                "Root Trash target path already exists",
            );
            continue;
        }

        if let Err(error) = fs::rename(&plan.item.absolute_path, &target_absolute_path) {
            fail_root_trash_item(
                &mut plan.item,
                RootTrashFailureReason::MutationFailed,
                &format!("Root Trash move failed: {error}"),
            );
        }
    }
}

fn ok_root_trash_plan(
    root_relative_path: RootRelativePath,
    absolute_path: PathBuf,
    next_root_relative_path: RootRelativePath,
    next_absolute_path: PathBuf,
) -> RootTrashPlan {
    RootTrashPlan {
        item: RootTrashMutationItem {
            root_relative_path,
            next_root_relative_path: Some(next_root_relative_path),
            absolute_path,
            next_absolute_path: Some(next_absolute_path),
            ok: true,
            reason: None,
            error: None,
        },
    }
}

fn failed_root_trash_plan(
    root_relative_path: RootRelativePath,
    absolute_path: PathBuf,
    reason: RootTrashFailureReason,
    error: &str,
) -> RootTrashPlan {
    RootTrashPlan {
        item: RootTrashMutationItem {
            root_relative_path,
            next_root_relative_path: None,
            absolute_path,
            next_absolute_path: None,
            ok: false,
            reason: Some(reason),
            error: Some(error.to_owned()),
        },
    }
}

fn fail_root_trash_item(
    item: &mut RootTrashMutationItem,
    reason: RootTrashFailureReason,
    error: &str,
) {
    item.ok = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn missing_or_unsupported_root_trash_plan(
    root_relative_path: RootRelativePath,
    absolute_path: PathBuf,
) -> RootTrashPlan {
    match fs::symlink_metadata(&absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => failed_root_trash_plan(
            root_relative_path,
            absolute_path,
            RootTrashFailureReason::SourceNotFound,
            "Root Trash source was not found",
        ),
        Err(error) => failed_root_trash_plan(
            root_relative_path,
            absolute_path,
            RootTrashFailureReason::MutationFailed,
            &format!("failed to inspect Root Trash source: {error}"),
        ),
        Ok(_) => failed_root_trash_plan(
            root_relative_path,
            absolute_path,
            RootTrashFailureReason::UnsupportedKind,
            "Root Trash only supports files and directories",
        ),
    }
}
