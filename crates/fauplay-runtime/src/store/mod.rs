//! Persistent runtime state owned by the Fauplay Runtime.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{GlobalShortcutConfigResponse, RootRelativePath, RuntimeError};

mod file_annotation_records;
mod file_annotations;
mod file_index;
mod global_trash;
mod global_trash_records;
mod local_root_bindings;
mod remembered_devices;
mod remote_published_roots;

pub(crate) use file_annotations::{
    bind_file_annotation_tag, cleanup_missing_files, list_annotation_tag_options,
    query_file_annotations, read_file_annotation, rebind_file_annotation_paths,
    set_file_annotation_value, unbind_file_annotation_tag,
};
pub(crate) use file_index::ensure_file_index_entries;
pub(crate) use global_trash::{
    global_trash_file_path, list_global_trash, move_to_global_trash, restore_global_trash,
};
pub(crate) use local_root_bindings::{list_local_root_bindings, upsert_local_root_binding};
pub(crate) use remembered_devices::{
    list_remembered_devices, rename_remembered_device, revoke_all_remembered_devices,
    revoke_remembered_device,
};
pub(crate) use remote_published_roots::sync_remote_published_roots;

const GLOBAL_CONFIG_FOLDER_NAME: &str = "global";
const SHORTCUTS_CONFIG_FILENAME: &str = "shortcuts.json";

pub(crate) fn load_global_shortcut_config(
    runtime_home_path: &Path,
) -> Result<GlobalShortcutConfigResponse, RuntimeError> {
    let path = runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(SHORTCUTS_CONFIG_FILENAME);

    match fs::read_to_string(&path) {
        Ok(config_json) => {
            serde_json::from_str::<serde_json::Value>(&config_json)
                .map_err(|error| RuntimeError::invalid_config(&path, &error.to_string()))?;

            Ok(GlobalShortcutConfigResponse {
                loaded: true,
                path,
                config_json: Some(config_json),
            })
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(GlobalShortcutConfigResponse {
            loaded: false,
            path,
            config_json: None,
        }),
        Err(error) => Err(RuntimeError::read_file(&path, error)),
    }
}

fn root_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn root_relative_path_key(path: &RootRelativePath) -> String {
    path.as_path()
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn file_annotation_absolute_path(
    root_path: &Path,
    root_relative_path: &RootRelativePath,
) -> Result<PathBuf, RuntimeError> {
    let absolute_path = root_path.join(root_relative_path.as_path());
    if absolute_path.starts_with(root_path) {
        Ok(absolute_path)
    } else {
        Err(RuntimeError::invalid_file_annotation(
            "Root-relative Path must stay within the Local Root",
        ))
    }
}

fn string_value(value: Option<&serde_json::Value>) -> Option<String> {
    value?.as_str().map(str::trim).map(ToOwned::to_owned)
}

fn number_value(value: Option<&serde_json::Value>) -> Option<u64> {
    let value = value?;
    if let Some(value) = value.as_u64() {
        return Some(value);
    }
    let value = value.as_f64()?;
    value.is_finite().then_some(value.max(0.0).trunc() as u64)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn modified_ms(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

pub(crate) fn resolve_default_runtime_home_path() -> PathBuf {
    if let Some(path) = std::env::var_os("FAUPLAY_HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return path;
    }

    if let Some(home) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return home.join(".fauplay");
    }

    if let Some(profile) = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        return profile.join(".fauplay");
    }

    PathBuf::from(".fauplay")
}
