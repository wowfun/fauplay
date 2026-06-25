use std::path::{Path, PathBuf};

use crate::RuntimeError;

use super::super::global_trash_records::{
    canonical_global_trash_file_path, global_trash_entry_from_value, global_trash_metadata_path,
    read_global_trash_metadata,
};
use super::super::string_value;

pub(crate) fn global_trash_file_path(
    runtime_home_path: &Path,
    recycle_id: &str,
) -> Result<Option<PathBuf>, RuntimeError> {
    let recycle_id = recycle_id.trim();
    if recycle_id.is_empty() {
        return Ok(None);
    }

    let path = global_trash_metadata_path(runtime_home_path);
    let Some(items) = read_global_trash_metadata(&path)? else {
        return Ok(None);
    };

    let Some(entry) = items
        .iter()
        .find(|item| string_value(item.get("recycleId")).as_deref() == Some(recycle_id))
        .and_then(global_trash_entry_from_value)
    else {
        return Ok(None);
    };

    let Some(stored_path) =
        canonical_global_trash_file_path(runtime_home_path, &entry.absolute_path)
    else {
        return Ok(None);
    };

    Ok(stored_path.is_file().then_some(stored_path))
}
