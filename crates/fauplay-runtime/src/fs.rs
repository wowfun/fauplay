use std::fs;

use crate::{
    DirectoryEntry, DirectoryEntryKind, ListDirectoryRequest, ListDirectoryResponse, RuntimeError,
};

const RESERVED_FOLDER_NAMES: &[&str] = &[".trash"];

pub(crate) fn list_local_directory(
    request: ListDirectoryRequest,
) -> Result<ListDirectoryResponse, RuntimeError> {
    let directory_path = request.root_path.join(request.root_relative_path.as_path());
    let mut entries = Vec::new();

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

        entries.push(DirectoryEntry {
            root_relative_path: request.root_relative_path.child(&name),
            name,
            kind,
        });
    }

    entries.sort_by(|left, right| {
        directory_entry_kind_rank(left.kind)
            .cmp(&directory_entry_kind_rank(right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(ListDirectoryResponse { entries })
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
