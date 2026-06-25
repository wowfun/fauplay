use std::fs;

use crate::{RootMoveBatchFailureReason, RootMoveBatchItem};

use super::fail_root_move_batch_item;

pub(super) fn commit_root_move_batch_items(items: &mut [RootMoveBatchItem]) {
    for item in items {
        if !item.ok || item.skipped {
            continue;
        }
        let Some(target_absolute_path) = item.next_absolute_path.as_ref() else {
            fail_root_move_batch_item(
                item,
                RootMoveBatchFailureReason::InvalidTarget,
                "Root Move Batch target was not planned",
            );
            continue;
        };
        if target_absolute_path.exists() {
            fail_root_move_batch_item(
                item,
                RootMoveBatchFailureReason::TargetExists,
                "Root Move Batch target already exists",
            );
            continue;
        }
        if let Err(error) = fs::rename(&item.absolute_path, target_absolute_path) {
            fail_root_move_batch_item(
                item,
                RootMoveBatchFailureReason::MutationFailed,
                &format!("Root Move Batch failed: {error}"),
            );
        }
    }
}
