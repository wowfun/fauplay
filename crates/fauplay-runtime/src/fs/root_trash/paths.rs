use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::RootRelativePath;

use super::ROOT_TRASH_FOLDER_NAME;

pub(super) fn allocate_deduped_path(
    source_absolute_path: &Path,
    candidate_absolute_path: &Path,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> PathBuf {
    let mut attempt_path = candidate_absolute_path.to_path_buf();
    let mut suffix_index = 1;

    while attempt_path != source_absolute_path
        && (reserved_target_paths.contains(&attempt_path) || attempt_path.exists())
    {
        attempt_path = path_with_dedupe_suffix(candidate_absolute_path, suffix_index);
        suffix_index += 1;
    }

    reserved_target_paths.insert(attempt_path.clone());
    attempt_path
}

pub(super) fn root_trash_path_for(root_relative_path: &RootRelativePath) -> RootRelativePath {
    RootRelativePath::try_from(
        PathBuf::from(ROOT_TRASH_FOLDER_NAME).join(root_relative_path.as_path()),
    )
    .expect("Root Trash target path should stay inside the Local Root")
}

pub(super) fn restore_target_path_for(
    root_relative_path: &RootRelativePath,
) -> Option<RootRelativePath> {
    let restored_path = root_relative_path
        .as_path()
        .strip_prefix(ROOT_TRASH_FOLDER_NAME)
        .ok()?;
    if restored_path.as_os_str().is_empty() {
        return None;
    }
    RootRelativePath::try_from(restored_path.to_path_buf()).ok()
}

pub(super) fn root_relative_path_from_absolute(
    root_path: &Path,
    absolute_path: &Path,
) -> RootRelativePath {
    let relative_path = absolute_path
        .strip_prefix(root_path)
        .expect("Root Trash target path should stay inside the Local Root");
    RootRelativePath::try_from(relative_path.to_path_buf())
        .expect("Root Trash target path should be Root-relative")
}

fn path_with_dedupe_suffix(path: &Path, suffix_index: usize) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let extension = path.extension().and_then(|value| value.to_str());
    let name = match extension {
        Some(extension) if !extension.is_empty() => {
            format!("{stem} ({suffix_index}).{extension}")
        }
        _ => format!("{stem} ({suffix_index})"),
    };

    parent.join(name)
}
