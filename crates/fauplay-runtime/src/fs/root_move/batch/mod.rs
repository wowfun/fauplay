use std::collections::HashSet;

use crate::{
    RootMoveBatchFailureReason, RootMoveBatchItem, RootMoveBatchRequest, RootMoveBatchResponse,
    RuntimeError,
};

mod commit;
mod planning;
mod rule;

use commit::commit_root_move_batch_items;
use planning::{build_root_move_batch_item, root_base_name};
use rule::CompiledRootMoveRule;

pub(crate) fn move_root_path_batch(
    request: RootMoveBatchRequest,
) -> Result<RootMoveBatchResponse, RuntimeError> {
    let compiled_rule = CompiledRootMoveRule::new(&request.rule)?;
    let root_base_name = root_base_name(&request.root_path);
    let mut reserved_target_paths = HashSet::new();
    let mut counter_value = request.rule.counter_start;
    let mut items = Vec::new();

    for root_relative_path in request.source_root_relative_paths {
        let (item, next_counter_value) = build_root_move_batch_item(
            &request.root_path,
            root_relative_path,
            &compiled_rule,
            counter_value,
            &root_base_name,
            &mut reserved_target_paths,
        );
        counter_value = next_counter_value;
        items.push(item);
    }

    if !request.dry_run {
        commit_root_move_batch_items(&mut items);
    }

    let total = items.len();
    let moved = items.iter().filter(|item| item.ok && !item.skipped).count();
    let skipped = items.iter().filter(|item| item.skipped).count();
    let failed = total - moved - skipped;

    Ok(RootMoveBatchResponse {
        dry_run: request.dry_run,
        total,
        moved,
        skipped,
        failed,
        items,
    })
}

fn fail_root_move_batch_item(
    item: &mut RootMoveBatchItem,
    reason: RootMoveBatchFailureReason,
    error: &str,
) {
    item.ok = false;
    item.skipped = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}
