use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::{
    DirectoryEntry, DirectoryEntryKind, ListDirectoryRequest, ListDirectoryResponse,
    RootRelativePath, RuntimeError,
};

const RESERVED_FOLDER_NAMES: &[&str] = &[".trash"];

pub(crate) fn list_local_directory(
    request: ListDirectoryRequest,
) -> Result<ListDirectoryResponse, RuntimeError> {
    let directory_path = request.root_path.join(request.root_relative_path.as_path());
    let mut entries = Vec::new();

    if request.flattened {
        collect_flattened_file_entries(&directory_path, &request.root_relative_path, &mut entries)?;
        entries.sort_by(|left, right| {
            left.root_relative_path
                .to_string()
                .cmp(&right.root_relative_path.to_string())
        });
        return Ok(paged_response(
            entries,
            request.entry_offset,
            request.entry_limit,
        ));
    }

    collect_immediate_entries(&directory_path, &request.root_relative_path, &mut entries)?;
    entries.sort_by(|left, right| {
        directory_entry_kind_rank(left.kind)
            .cmp(&directory_entry_kind_rank(right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(paged_response(
        entries,
        request.entry_offset,
        request.entry_limit,
    ))
}

fn paged_response(
    entries: Vec<DirectoryEntry>,
    entry_offset: usize,
    entry_limit: Option<usize>,
) -> ListDirectoryResponse {
    let total_entries = entries.len();
    let start = entry_offset.min(total_entries);
    let end = match entry_limit {
        Some(limit) => start.saturating_add(limit).min(total_entries),
        None => total_entries,
    };
    let is_truncated = end < total_entries;
    let next_offset = is_truncated.then_some(end);

    ListDirectoryResponse {
        entries: entries[start..end].to_vec(),
        is_truncated,
        next_offset,
    }
}

fn collect_immediate_entries(
    directory_path: &Path,
    root_relative_path: &RootRelativePath,
    entries: &mut Vec<DirectoryEntry>,
) -> Result<(), RuntimeError> {
    for entry_result in fs::read_dir(&directory_path)
        .map_err(|source| RuntimeError::read_directory(&directory_path, source))?
    {
        let entry = entry_result
            .map_err(|source| RuntimeError::read_directory_entry(&directory_path, source))?;
        let file_type = entry
            .file_type()
            .map_err(|source| RuntimeError::read_directory_entry(&entry.path(), source))?;

        let kind = if file_type.is_dir() {
            DirectoryEntryKind::Directory
        } else if file_type.is_file() {
            DirectoryEntryKind::File
        } else {
            continue;
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        if kind == DirectoryEntryKind::Directory && is_reserved_folder_name(&name) {
            continue;
        }

        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;

        entries.push(DirectoryEntry {
            root_relative_path: root_relative_path.child(&name),
            name,
            kind,
            is_empty: if kind == DirectoryEntryKind::Directory {
                Some(is_directory_empty(&entry_path)?)
            } else {
                None
            },
            size: if kind == DirectoryEntryKind::File {
                Some(metadata.len())
            } else {
                None
            },
            last_modified_ms: modified_timestamp_ms(&metadata),
        });
    }

    Ok(())
}

fn collect_flattened_file_entries(
    directory_path: &Path,
    root_relative_path: &RootRelativePath,
    entries: &mut Vec<DirectoryEntry>,
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
            if is_reserved_folder_name(&name) {
                continue;
            }
            collect_flattened_file_entries(&entry_path, &child_root_relative_path, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|source| RuntimeError::read_directory_entry(&entry_path, source))?;

        entries.push(DirectoryEntry {
            root_relative_path: child_root_relative_path,
            name,
            kind: DirectoryEntryKind::File,
            is_empty: None,
            size: Some(metadata.len()),
            last_modified_ms: modified_timestamp_ms(&metadata),
        });
    }

    Ok(())
}

fn is_reserved_folder_name(name: &str) -> bool {
    RESERVED_FOLDER_NAMES.contains(&name)
}

fn directory_entry_kind_rank(kind: DirectoryEntryKind) -> u8 {
    match kind {
        DirectoryEntryKind::Directory => 0,
        DirectoryEntryKind::File => 1,
    }
}

fn is_directory_empty(path: &Path) -> Result<bool, RuntimeError> {
    let mut entries =
        fs::read_dir(path).map_err(|source| RuntimeError::read_directory(path, source))?;
    Ok(entries
        .next()
        .transpose()
        .map_err(|source| RuntimeError::read_directory_entry(path, source))?
        .is_none())
}

fn modified_timestamp_ms(metadata: &fs::Metadata) -> Option<u64> {
    let duration = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}
