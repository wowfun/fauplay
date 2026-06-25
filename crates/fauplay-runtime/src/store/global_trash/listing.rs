use std::path::Path;

use crate::{GlobalTrashEntry, GlobalTrashListRequest, GlobalTrashListResponse, RuntimeError};

use super::super::global_trash_records::{
    global_trash_entry_from_value, global_trash_metadata_path, read_global_trash_metadata,
};

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
