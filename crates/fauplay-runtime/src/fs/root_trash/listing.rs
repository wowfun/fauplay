use std::fs;
use std::path::Path;

use crate::{
    RootRelativePath, RootTrashEntry, RootTrashListRequest, RootTrashListResponse, RuntimeError,
};

use super::{ROOT_TRASH_FOLDER_NAME, paths::restore_target_path_for};
use crate::fs::modified_timestamp_ms;

pub(crate) fn list_root_trash(
    request: RootTrashListRequest,
) -> Result<RootTrashListResponse, RuntimeError> {
    let trash_root_path = request.root_path.join(ROOT_TRASH_FOLDER_NAME);
    if !trash_root_path.exists() {
        return Ok(root_trash_paged_response(
            Vec::new(),
            request.entry_offset,
            request.entry_limit,
        ));
    }

    let mut entries = Vec::new();
    collect_root_trash_entries(
        &request.root_path,
        &trash_root_path,
        &RootRelativePath::try_from(ROOT_TRASH_FOLDER_NAME)
            .expect("Root Trash folder should be Root-relative"),
        &mut entries,
    )?;
    entries.sort_by(|left, right| {
        left.root_relative_path
            .to_string()
            .cmp(&right.root_relative_path.to_string())
    });

    Ok(root_trash_paged_response(
        entries,
        request.entry_offset,
        request.entry_limit,
    ))
}

fn root_trash_paged_response(
    entries: Vec<RootTrashEntry>,
    entry_offset: usize,
    entry_limit: Option<usize>,
) -> RootTrashListResponse {
    let total_entries = entries.len();
    let start = entry_offset.min(total_entries);
    let end = match entry_limit {
        Some(limit) => start.saturating_add(limit).min(total_entries),
        None => total_entries,
    };
    let is_truncated = end < total_entries;
    let next_offset = is_truncated.then_some(end);

    RootTrashListResponse {
        entries: entries[start..end].to_vec(),
        is_truncated,
        next_offset,
    }
}

fn collect_root_trash_entries(
    root_path: &Path,
    directory_path: &Path,
    root_relative_path: &RootRelativePath,
    entries: &mut Vec<RootTrashEntry>,
) -> Result<(), RuntimeError> {
    for entry_result in fs::read_dir(directory_path)
        .map_err(|source| RuntimeError::read_directory(directory_path, source))?
    {
        let entry = entry_result
            .map_err(|source| RuntimeError::read_directory_entry(directory_path, source))?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_root_relative_path = root_relative_path.child(&name);

        if file_type.is_dir() {
            collect_root_trash_entries(root_path, &entry_path, &child_root_relative_path, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;
        let Some(original_root_relative_path) = restore_target_path_for(&child_root_relative_path)
        else {
            continue;
        };
        let timestamp_ms = modified_timestamp_ms(&metadata);

        entries.push(RootTrashEntry {
            name,
            absolute_path: entry_path,
            original_absolute_path: root_path.join(original_root_relative_path.as_path()),
            root_relative_path: child_root_relative_path,
            original_root_relative_path,
            size: metadata.len(),
            last_modified_ms: timestamp_ms,
            deleted_at_ms: timestamp_ms,
        });
    }

    Ok(())
}
