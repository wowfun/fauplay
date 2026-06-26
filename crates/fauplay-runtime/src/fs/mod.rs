use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::RootRelativePath;

mod duplicates;
mod listing;
mod metadata;
mod root_move;
mod root_trash;

pub(crate) use duplicates::find_duplicate_files;
pub(in crate::fs) use listing::collect_flattened_file_entries;
pub(crate) use listing::list_local_directory;
pub(crate) use metadata::{read_file_metadata, read_file_metadata_at_path};
pub(crate) use root_move::{move_root_path, move_root_path_batch};
use root_trash::ROOT_TRASH_FOLDER_NAME;
pub(crate) use root_trash::{list_root_trash, move_to_root_trash, restore_from_root_trash};

const RESERVED_FOLDER_NAMES: &[&str] = &[ROOT_TRASH_FOLDER_NAME];

pub(crate) fn modified_timestamp_ms(metadata: &fs::Metadata) -> Option<u64> {
    let duration = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}

pub(super) fn is_supported_mutation_source(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    metadata.is_file() || metadata.is_dir()
}

pub(super) fn is_empty_root_relative_path(root_relative_path: &RootRelativePath) -> bool {
    root_relative_path.as_path().as_os_str().is_empty()
}

pub(super) fn is_inside_root_trash(root_relative_path: &RootRelativePath) -> bool {
    root_relative_path
        .as_path()
        .starts_with(ROOT_TRASH_FOLDER_NAME)
}

fn is_reserved_folder_name(name: &str) -> bool {
    RESERVED_FOLDER_NAMES.contains(&name)
}
