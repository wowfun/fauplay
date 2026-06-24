use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    FileIndexEnsureItem, FileIndexEnsureRequest, FileIndexEnsureResponse, FileIndexFailureReason,
    RuntimeError,
};

use super::{
    GLOBAL_CONFIG_FOLDER_NAME, file_annotation_absolute_path, modified_ms, now_ms, number_value,
    root_path_key, root_relative_path_key, string_value,
};

const FILE_INDEX_FILENAME: &str = "file-index.v1.json";

pub(crate) fn ensure_file_index_entries(
    runtime_home_path: &Path,
    request: FileIndexEnsureRequest,
) -> Result<FileIndexEnsureResponse, RuntimeError> {
    let metadata_path = file_index_path(runtime_home_path);
    let mut records = read_file_index_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let mut items = Vec::with_capacity(request.root_relative_paths.len());
    let mut indexed = 0;
    let mut skipped = 0;
    let mut failed = 0;

    for root_relative_path in request.root_relative_paths {
        let absolute_path = file_annotation_absolute_path(&request.root_path, &root_relative_path)?;
        let metadata = match fs::symlink_metadata(&absolute_path) {
            Ok(metadata) if metadata.is_file() => metadata,
            Ok(_) => {
                failed += 1;
                items.push(file_index_failed_item(
                    root_relative_path,
                    Some(absolute_path),
                    FileIndexFailureReason::NotFile,
                    "target path must be a file",
                ));
                continue;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                failed += 1;
                items.push(file_index_failed_item(
                    root_relative_path,
                    Some(absolute_path),
                    FileIndexFailureReason::SourceNotFound,
                    "source file was not found",
                ));
                continue;
            }
            Err(error) => {
                failed += 1;
                items.push(file_index_failed_item(
                    root_relative_path,
                    Some(absolute_path),
                    FileIndexFailureReason::IndexFailed,
                    &format!("failed to inspect source file: {error}"),
                ));
                continue;
            }
        };
        let size = metadata.len();
        let last_modified_ms = modified_ms(&metadata);
        let root_relative_path_key = root_relative_path_key(&root_relative_path);

        if let Some(record) = records.iter().find(|record| {
            record.root_path == root_path_key
                && record.root_relative_path == root_relative_path_key
                && record.size == size
                && record.last_modified_ms == last_modified_ms
        }) {
            skipped += 1;
            items.push(FileIndexEnsureItem {
                root_relative_path,
                absolute_path: Some(PathBuf::from(&record.absolute_path)),
                size: Some(record.size),
                last_modified_ms: record.last_modified_ms,
                ok: true,
                skipped: true,
                reason: Some(FileIndexFailureReason::IndexFresh),
                error: None,
            });
            continue;
        }

        let indexed_at_ms = now_ms();
        if let Some(record) = records.iter_mut().find(|record| {
            record.root_path == root_path_key && record.root_relative_path == root_relative_path_key
        }) {
            record.absolute_path = absolute_path.display().to_string();
            record.size = size;
            record.last_modified_ms = last_modified_ms;
            record.indexed_at_ms = indexed_at_ms;
        } else {
            records.push(FileIndexRecord {
                root_path: root_path_key.clone(),
                root_relative_path: root_relative_path_key,
                absolute_path: absolute_path.display().to_string(),
                size,
                last_modified_ms,
                indexed_at_ms,
            });
        }

        indexed += 1;
        items.push(FileIndexEnsureItem {
            root_relative_path,
            absolute_path: Some(absolute_path),
            size: Some(size),
            last_modified_ms,
            ok: true,
            skipped: false,
            reason: None,
            error: None,
        });
    }

    if indexed > 0 {
        write_file_index_records(&metadata_path, &records)?;
    }

    Ok(FileIndexEnsureResponse {
        total: items.len(),
        indexed,
        skipped,
        failed,
        items,
    })
}

#[derive(Debug, Clone)]
pub(super) struct FileIndexRecord {
    pub(super) root_path: String,
    pub(super) root_relative_path: String,
    pub(super) absolute_path: String,
    pub(super) size: u64,
    pub(super) last_modified_ms: Option<u64>,
    pub(super) indexed_at_ms: u64,
}

pub(super) fn file_index_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(FILE_INDEX_FILENAME)
}

pub(super) fn read_file_index_records(path: &Path) -> Result<Vec<FileIndexRecord>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let files = value
        .get("files")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| RuntimeError::invalid_runtime_home_file(path, "files must be an array"))?;

    let mut records = Vec::new();
    for item in files {
        let Some(object) = item.as_object() else {
            continue;
        };
        let Some(root_path) =
            string_value(object.get("rootPath")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(root_relative_path) =
            string_value(object.get("rootRelativePath")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(absolute_path) =
            string_value(object.get("absolutePath")).filter(|value| !value.is_empty())
        else {
            continue;
        };
        let size = number_value(object.get("size")).unwrap_or(0);
        let last_modified_ms = number_value(object.get("lastModifiedMs"));
        let indexed_at_ms = number_value(object.get("indexedAt")).unwrap_or(0);

        records.push(FileIndexRecord {
            root_path,
            root_relative_path,
            absolute_path,
            size,
            last_modified_ms,
            indexed_at_ms,
        });
    }

    Ok(records)
}

pub(super) fn write_file_index_records(
    path: &Path,
    records: &[FileIndexRecord],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let files = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "rootPath": record.root_path,
                "rootRelativePath": record.root_relative_path,
                "absolutePath": record.absolute_path,
                "size": record.size,
                "lastModifiedMs": record.last_modified_ms,
                "indexedAt": record.indexed_at_ms,
            })
        })
        .collect::<Vec<_>>();
    let raw = serde_json::to_string(&serde_json::json!({
        "version": 1,
        "files": files,
    }))
    .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;

    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn file_index_failed_item(
    root_relative_path: crate::RootRelativePath,
    absolute_path: Option<PathBuf>,
    reason: FileIndexFailureReason,
    error: &str,
) -> FileIndexEnsureItem {
    FileIndexEnsureItem {
        root_relative_path,
        absolute_path,
        size: None,
        last_modified_ms: None,
        ok: false,
        skipped: false,
        reason: Some(reason),
        error: Some(error.to_owned()),
    }
}
