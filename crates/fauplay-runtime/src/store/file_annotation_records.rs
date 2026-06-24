use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{AnnotationTag, FileAnnotationFile, RootRelativePath, RuntimeError};

use super::{GLOBAL_CONFIG_FOLDER_NAME, file_annotation_absolute_path, number_value, string_value};

const FILE_ANNOTATIONS_FILENAME: &str = "file-annotations.v1.json";
pub(super) const ANNOTATION_TAG_SOURCE: &str = "meta.annotation";

#[derive(Debug, Clone)]
pub(super) struct FileAnnotationRecord {
    pub(super) root_path: String,
    pub(super) root_relative_path: String,
    pub(super) tags: Vec<AnnotationTagRecord>,
}

#[derive(Debug, Clone)]
pub(super) struct AnnotationTagRecord {
    pub(super) key: String,
    pub(super) value: String,
    pub(super) source: String,
    pub(super) applied_at_ms: u64,
}

pub(super) fn file_annotations_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(FILE_ANNOTATIONS_FILENAME)
}

pub(super) fn read_file_annotation_records(
    path: &Path,
) -> Result<Vec<FileAnnotationRecord>, RuntimeError> {
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
        let tags = object
            .get("tags")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(annotation_tag_record_from_value)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if tags.is_empty() {
            continue;
        }

        records.push(FileAnnotationRecord {
            root_path,
            root_relative_path,
            tags,
        });
    }

    Ok(records)
}

pub(super) fn write_file_annotation_records(
    path: &Path,
    records: &[FileAnnotationRecord],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }

    let files = records
        .iter()
        .filter(|record| !record.tags.is_empty())
        .map(|record| {
            let tags = record
                .tags
                .iter()
                .map(|tag| {
                    serde_json::json!({
                        "key": tag.key,
                        "value": tag.value,
                        "source": tag.source,
                        "appliedAt": tag.applied_at_ms,
                    })
                })
                .collect::<Vec<_>>();
            serde_json::json!({
                "rootPath": record.root_path,
                "rootRelativePath": record.root_relative_path,
                "tags": tags,
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

pub(super) fn ensure_file_annotation_record(
    records: &mut Vec<FileAnnotationRecord>,
    root_path: String,
    root_relative_path: String,
) -> usize {
    if let Some(index) = records.iter().position(|record| {
        record.root_path == root_path && record.root_relative_path == root_relative_path
    }) {
        return index;
    }

    records.push(FileAnnotationRecord {
        root_path,
        root_relative_path,
        tags: Vec::new(),
    });
    records.len() - 1
}

pub(super) fn file_annotation_file_from_record(
    record: &FileAnnotationRecord,
) -> Option<FileAnnotationFile> {
    let root_path = PathBuf::from(&record.root_path);
    let root_relative_path = RootRelativePath::try_from(record.root_relative_path.as_str()).ok()?;
    let absolute_path = file_annotation_absolute_path(&root_path, &root_relative_path).ok()?;
    if !absolute_path.is_file() {
        return None;
    }

    let mut tags = record
        .tags
        .iter()
        .map(|tag| AnnotationTag {
            key: tag.key.clone(),
            value: tag.value.clone(),
            source: tag.source.clone(),
            applied_at_ms: tag.applied_at_ms,
        })
        .collect::<Vec<_>>();
    sort_annotation_tags(&mut tags);

    Some(FileAnnotationFile {
        root_relative_path,
        absolute_path,
        tags,
    })
}

pub(super) fn annotation_tag_key(key: &str, value: &str) -> String {
    format!("{}={}", percent_encode(key), percent_encode(value))
}

pub(super) fn sort_annotation_tag_records(tags: &mut [AnnotationTagRecord]) {
    tags.sort_by(|left, right| {
        right
            .applied_at_ms
            .cmp(&left.applied_at_ms)
            .then_with(|| left.source.cmp(&right.source))
            .then_with(|| left.key.cmp(&right.key))
            .then_with(|| left.value.cmp(&right.value))
    });
}

pub(super) fn merge_annotation_tags(
    target: &mut Vec<AnnotationTagRecord>,
    source: Vec<AnnotationTagRecord>,
) {
    for source_tag in source {
        target.retain(|target_tag| {
            !(target_tag.source == source_tag.source
                && target_tag.key == source_tag.key
                && target_tag.value == source_tag.value)
        });
        target.push(source_tag);
    }
    sort_annotation_tag_records(target);
}

pub(super) fn sort_annotation_tags(tags: &mut [AnnotationTag]) {
    tags.sort_by(|left, right| {
        right
            .applied_at_ms
            .cmp(&left.applied_at_ms)
            .then_with(|| left.source.cmp(&right.source))
            .then_with(|| left.key.cmp(&right.key))
            .then_with(|| left.value.cmp(&right.value))
    });
}

fn annotation_tag_record_from_value(value: &serde_json::Value) -> Option<AnnotationTagRecord> {
    let object = value.as_object()?;
    let key = string_value(object.get("key")).filter(|value| !value.is_empty())?;
    let value = string_value(object.get("value")).filter(|value| !value.is_empty())?;
    let source = string_value(object.get("source")).filter(|value| !value.is_empty())?;
    let applied_at_ms = number_value(object.get("appliedAt"))
        .or_else(|| number_value(object.get("updatedAt")))
        .unwrap_or(0);

    Some(AnnotationTagRecord {
        key,
        value,
        source,
        applied_at_ms,
    })
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}
