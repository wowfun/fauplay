use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{
    AnnotationTag, AnnotationTagOption, AnnotationTagOptionsRequest, AnnotationTagOptionsResponse,
    FileAnnotationFile, FileAnnotationMatchMode, FileAnnotationMutationResponse,
    FileAnnotationPathRebindFailureReason, FileAnnotationPathRebindItem,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, FileAnnotationQueryRequest,
    FileAnnotationQueryResponse, FileAnnotationReadRequest, FileAnnotationReadResponse,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, MissingFileCleanupImpact, MissingFileCleanupRequest,
    MissingFileCleanupResponse, RootRelativePath, RuntimeError,
};

use super::file_index::{file_index_path, read_file_index_records, write_file_index_records};
use super::{
    GLOBAL_CONFIG_FOLDER_NAME, file_annotation_absolute_path, now_ms, number_value, root_path_key,
    root_relative_path_key, string_value,
};

const FILE_ANNOTATIONS_FILENAME: &str = "file-annotations.v1.json";
const ANNOTATION_TAG_SOURCE: &str = "meta.annotation";
const UNANNOTATED_TAG_KEY: &str = "__ANNOTATION_UNANNOTATED__";

pub(crate) fn set_file_annotation_value(
    runtime_home_path: &Path,
    request: FileAnnotationSetValueRequest,
) -> Result<FileAnnotationMutationResponse, RuntimeError> {
    let key = trim_required("key", &request.key)?;
    let value = trim_required("value", &request.value)?;
    let absolute_path =
        file_annotation_absolute_path(&request.root_path, &request.root_relative_path)?;
    ensure_file_annotation_target(&absolute_path)?;

    let metadata_path = file_annotations_path(runtime_home_path);
    let mut records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let root_relative_path_key = root_relative_path_key(&request.root_relative_path);
    let now = now_ms();
    let record_index =
        ensure_file_annotation_record(&mut records, root_path_key, root_relative_path_key);
    let record = &mut records[record_index];

    record
        .tags
        .retain(|tag| !(tag.source == ANNOTATION_TAG_SOURCE && tag.key == key));
    record.tags.push(AnnotationTagRecord {
        key: key.clone(),
        value: value.clone(),
        source: ANNOTATION_TAG_SOURCE.to_owned(),
        applied_at_ms: now,
    });
    sort_annotation_tag_records(&mut record.tags);
    write_file_annotation_records(&metadata_path, &records)?;

    Ok(FileAnnotationMutationResponse {
        root_relative_path: request.root_relative_path,
        absolute_path,
        key,
        value,
        source: request.source,
    })
}

pub(crate) fn bind_file_annotation_tag(
    runtime_home_path: &Path,
    request: FileAnnotationTagBindingRequest,
) -> Result<FileAnnotationTagMutationResponse, RuntimeError> {
    let key = trim_required("key", &request.key)?;
    let value = trim_required("value", &request.value)?;
    let absolute_path =
        file_annotation_absolute_path(&request.root_path, &request.root_relative_path)?;
    ensure_file_annotation_target(&absolute_path)?;

    let metadata_path = file_annotations_path(runtime_home_path);
    let mut records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let root_relative_path_key = root_relative_path_key(&request.root_relative_path);
    let now = now_ms();
    let record_index =
        ensure_file_annotation_record(&mut records, root_path_key, root_relative_path_key);
    let record = &mut records[record_index];

    record.tags.retain(|tag| {
        !(tag.source == ANNOTATION_TAG_SOURCE && tag.key == key && tag.value == value)
    });
    record.tags.push(AnnotationTagRecord {
        key: key.clone(),
        value: value.clone(),
        source: ANNOTATION_TAG_SOURCE.to_owned(),
        applied_at_ms: now,
    });
    sort_annotation_tag_records(&mut record.tags);
    write_file_annotation_records(&metadata_path, &records)?;

    Ok(FileAnnotationTagMutationResponse {
        root_relative_path: request.root_relative_path,
        absolute_path,
        key,
        value,
        source: ANNOTATION_TAG_SOURCE.to_owned(),
    })
}

pub(crate) fn unbind_file_annotation_tag(
    runtime_home_path: &Path,
    request: FileAnnotationTagBindingRequest,
) -> Result<FileAnnotationTagMutationResponse, RuntimeError> {
    let key = trim_required("key", &request.key)?;
    let value = trim_required("value", &request.value)?;
    let absolute_path =
        file_annotation_absolute_path(&request.root_path, &request.root_relative_path)?;

    let metadata_path = file_annotations_path(runtime_home_path);
    let mut records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let root_relative_path_key = root_relative_path_key(&request.root_relative_path);

    if let Some(record) = records.iter_mut().find(|record| {
        record.root_path == root_path_key && record.root_relative_path == root_relative_path_key
    }) {
        record.tags.retain(|tag| {
            !(tag.source == ANNOTATION_TAG_SOURCE && tag.key == key && tag.value == value)
        });
    }
    records.retain(|record| !record.tags.is_empty());
    write_file_annotation_records(&metadata_path, &records)?;

    Ok(FileAnnotationTagMutationResponse {
        root_relative_path: request.root_relative_path,
        absolute_path,
        key,
        value,
        source: ANNOTATION_TAG_SOURCE.to_owned(),
    })
}

pub(crate) fn read_file_annotation(
    runtime_home_path: &Path,
    request: FileAnnotationReadRequest,
) -> Result<FileAnnotationReadResponse, RuntimeError> {
    let metadata_path = file_annotations_path(runtime_home_path);
    let records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let root_relative_path_key = root_relative_path_key(&request.root_relative_path);
    let absolute_path =
        file_annotation_absolute_path(&request.root_path, &request.root_relative_path)?;

    let Some(record) = records.iter().find(|record| {
        record.root_path == root_path_key && record.root_relative_path == root_relative_path_key
    }) else {
        return Ok(FileAnnotationReadResponse { file: None });
    };

    if record.tags.is_empty() || !absolute_path.is_file() {
        return Ok(FileAnnotationReadResponse { file: None });
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

    Ok(FileAnnotationReadResponse {
        file: Some(FileAnnotationFile {
            root_relative_path: request.root_relative_path,
            absolute_path,
            tags,
        }),
    })
}

pub(crate) fn list_annotation_tag_options(
    runtime_home_path: &Path,
    request: AnnotationTagOptionsRequest,
) -> Result<AnnotationTagOptionsResponse, RuntimeError> {
    let metadata_path = file_annotations_path(runtime_home_path);
    let records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = request.root_path.as_deref().map(root_path_key);
    let mut option_entries = HashMap::<String, AnnotationTagOptionEntry>::new();

    for record in records
        .iter()
        .filter(|record| root_path_matches(root_path_key.as_deref(), record))
    {
        let mut file_tag_keys = HashSet::new();
        for tag in &record.tags {
            let tag_key = annotation_tag_key(&tag.key, &tag.value);
            if !file_tag_keys.insert(tag_key.clone()) {
                continue;
            }
            let entry = option_entries
                .entry(tag_key)
                .or_insert_with(|| AnnotationTagOptionEntry {
                    key: tag.key.clone(),
                    value: tag.value.clone(),
                    source: tag.source.clone(),
                    file_count: 0,
                });
            entry.file_count += 1;
        }
    }

    let mut items = option_entries
        .into_iter()
        .map(|(tag_key, entry)| AnnotationTagOption {
            tag_key,
            key: entry.key,
            value: entry.value,
            source: entry.source,
            file_count: entry.file_count,
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        left.key
            .cmp(&right.key)
            .then_with(|| left.value.cmp(&right.value))
            .then_with(|| left.source.cmp(&right.source))
    });

    Ok(AnnotationTagOptionsResponse { items })
}

pub(crate) fn query_file_annotations(
    runtime_home_path: &Path,
    request: FileAnnotationQueryRequest,
) -> Result<FileAnnotationQueryResponse, RuntimeError> {
    let metadata_path = file_annotations_path(runtime_home_path);
    let records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = request.root_path.as_deref().map(root_path_key);
    let mut items = records
        .iter()
        .filter(|record| root_path_matches(root_path_key.as_deref(), record))
        .filter(|record| file_annotation_record_matches_query(record, &request))
        .filter_map(file_annotation_file_from_record)
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        root_relative_path_key(&left.root_relative_path)
            .cmp(&root_relative_path_key(&right.root_relative_path))
    });

    let page = request.page.max(1);
    let size = request.size.clamp(1, 5000);
    let total = items.len();
    let offset = page.saturating_sub(1).saturating_mul(size).min(total);
    let end = offset.saturating_add(size).min(total);
    let paged_items = items[offset..end].to_vec();

    Ok(FileAnnotationQueryResponse {
        page,
        size,
        total,
        items: paged_items,
    })
}

pub(crate) fn rebind_file_annotation_paths(
    runtime_home_path: &Path,
    request: FileAnnotationPathRebindRequest,
) -> Result<FileAnnotationPathRebindResponse, RuntimeError> {
    let metadata_path = file_annotations_path(runtime_home_path);
    let mut records = read_file_annotation_records(&metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let mut items = Vec::new();

    for mapping in request.mappings {
        let from_root_relative_path_key = root_relative_path_key(&mapping.from_root_relative_path);
        let to_root_relative_path_key = root_relative_path_key(&mapping.to_root_relative_path);

        if from_root_relative_path_key == to_root_relative_path_key {
            items.push(FileAnnotationPathRebindItem {
                from_root_relative_path: mapping.from_root_relative_path,
                to_root_relative_path: mapping.to_root_relative_path,
                ok: true,
                skipped: true,
                reason: Some(FileAnnotationPathRebindFailureReason::NoChange),
                error: None,
            });
            continue;
        }

        let target_absolute_path =
            file_annotation_absolute_path(&request.root_path, &mapping.to_root_relative_path)?;
        if !target_absolute_path.is_file() {
            items.push(FileAnnotationPathRebindItem {
                from_root_relative_path: mapping.from_root_relative_path,
                to_root_relative_path: mapping.to_root_relative_path,
                ok: false,
                skipped: false,
                reason: Some(FileAnnotationPathRebindFailureReason::TargetNotFound),
                error: Some("target path was not found".to_owned()),
            });
            continue;
        }

        let Some(source_index) = records.iter().position(|record| {
            record.root_path == root_path_key
                && record.root_relative_path == from_root_relative_path_key
        }) else {
            items.push(FileAnnotationPathRebindItem {
                from_root_relative_path: mapping.from_root_relative_path,
                to_root_relative_path: mapping.to_root_relative_path,
                ok: false,
                skipped: false,
                reason: Some(FileAnnotationPathRebindFailureReason::SourceNotFound),
                error: Some("source File Annotation was not found".to_owned()),
            });
            continue;
        };

        let mut source_record = records.remove(source_index);
        source_record.root_relative_path = to_root_relative_path_key.clone();
        if let Some(target_record) = records.iter_mut().find(|record| {
            record.root_path == root_path_key
                && record.root_relative_path == to_root_relative_path_key
        }) {
            merge_annotation_tags(&mut target_record.tags, source_record.tags);
        } else {
            records.push(source_record);
        }

        items.push(FileAnnotationPathRebindItem {
            from_root_relative_path: mapping.from_root_relative_path,
            to_root_relative_path: mapping.to_root_relative_path,
            ok: true,
            skipped: false,
            reason: None,
            error: None,
        });
    }

    if items.iter().any(|item| item.ok && !item.skipped) {
        write_file_annotation_records(&metadata_path, &records)?;
    }

    let total = items.len();
    let updated = items.iter().filter(|item| item.ok && !item.skipped).count();
    let skipped = items.iter().filter(|item| item.skipped).count();
    let failed = total - updated - skipped;

    Ok(FileAnnotationPathRebindResponse {
        total,
        updated,
        skipped,
        failed,
        items,
    })
}

pub(crate) fn cleanup_missing_files(
    runtime_home_path: &Path,
    request: MissingFileCleanupRequest,
) -> Result<MissingFileCleanupResponse, RuntimeError> {
    let annotation_metadata_path = file_annotations_path(runtime_home_path);
    let index_metadata_path = file_index_path(runtime_home_path);
    let mut annotation_records = read_file_annotation_records(&annotation_metadata_path)?;
    let mut index_records = read_file_index_records(&index_metadata_path)?;
    let root_path_key = root_path_key(&request.root_path);
    let mut missing_root_relative_paths = Vec::new();
    let mut missing_absolute_paths = Vec::new();
    let mut seen_missing_paths = HashSet::new();
    let mut missing_annotation_indexes = HashSet::new();
    let mut missing_index_indexes = HashSet::new();
    let mut annotation_tags = 0;

    for (index, record) in annotation_records.iter().enumerate() {
        if record.root_path != root_path_key {
            continue;
        }
        let Ok(root_relative_path) = RootRelativePath::try_from(record.root_relative_path.as_str())
        else {
            continue;
        };
        let absolute_path = file_annotation_absolute_path(&request.root_path, &root_relative_path)?;
        if absolute_path.is_file() {
            continue;
        }

        annotation_tags += record.tags.len();
        if seen_missing_paths.insert(root_relative_path.to_string()) {
            missing_root_relative_paths.push(root_relative_path);
            missing_absolute_paths.push(absolute_path);
        }
        missing_annotation_indexes.insert(index);
    }

    for (index, record) in index_records.iter().enumerate() {
        if record.root_path != root_path_key {
            continue;
        }
        let Ok(root_relative_path) = RootRelativePath::try_from(record.root_relative_path.as_str())
        else {
            continue;
        };
        let absolute_path = file_annotation_absolute_path(&request.root_path, &root_relative_path)?;
        if absolute_path.is_file() {
            continue;
        }

        if seen_missing_paths.insert(root_relative_path.to_string()) {
            missing_root_relative_paths.push(root_relative_path);
            missing_absolute_paths.push(absolute_path);
        }
        missing_index_indexes.insert(index);
    }

    if request.confirm && !missing_annotation_indexes.is_empty() {
        let mut next_index = 0;
        annotation_records.retain(|_| {
            let keep = !missing_annotation_indexes.contains(&next_index);
            next_index += 1;
            keep
        });
        write_file_annotation_records(&annotation_metadata_path, &annotation_records)?;
    }

    if request.confirm && !missing_index_indexes.is_empty() {
        let mut next_index = 0;
        index_records.retain(|_| {
            let keep = !missing_index_indexes.contains(&next_index);
            next_index += 1;
            keep
        });
        write_file_index_records(&index_metadata_path, &index_records)?;
    }

    let removed = if request.confirm {
        missing_annotation_indexes.len() + missing_index_indexes.len()
    } else {
        0
    };

    Ok(MissingFileCleanupResponse {
        dry_run: !request.confirm,
        missing_root_relative_paths,
        missing_absolute_paths,
        impact: MissingFileCleanupImpact {
            file_annotations: missing_annotation_indexes.len(),
            annotation_tags,
            file_index_entries: missing_index_indexes.len(),
        },
        removed,
    })
}

#[derive(Debug, Clone)]
struct FileAnnotationRecord {
    root_path: String,
    root_relative_path: String,
    tags: Vec<AnnotationTagRecord>,
}

#[derive(Debug, Clone)]
struct AnnotationTagRecord {
    key: String,
    value: String,
    source: String,
    applied_at_ms: u64,
}

struct AnnotationTagOptionEntry {
    key: String,
    value: String,
    source: String,
    file_count: usize,
}

fn file_annotations_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(FILE_ANNOTATIONS_FILENAME)
}

fn read_file_annotation_records(path: &Path) -> Result<Vec<FileAnnotationRecord>, RuntimeError> {
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

fn write_file_annotation_records(
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

fn ensure_file_annotation_record(
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

fn trim_required(field_name: &str, value: &str) -> Result<String, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_file_annotation(&format!(
            "{field_name} is required"
        )));
    }
    Ok(value.to_owned())
}

fn root_path_matches(root_path: Option<&str>, record: &FileAnnotationRecord) -> bool {
    root_path.is_none_or(|root_path| record.root_path == root_path)
}

fn file_annotation_record_matches_query(
    record: &FileAnnotationRecord,
    request: &FileAnnotationQueryRequest,
) -> bool {
    let tag_keys = record
        .tags
        .iter()
        .map(|tag| annotation_tag_key(&tag.key, &tag.value))
        .collect::<HashSet<_>>();
    let include_tag_keys = request
        .include_tag_keys
        .iter()
        .map(|tag_key| tag_key.trim())
        .filter(|tag_key| !tag_key.is_empty())
        .collect::<Vec<_>>();
    let exclude_tag_keys = request
        .exclude_tag_keys
        .iter()
        .map(|tag_key| tag_key.trim())
        .filter(|tag_key| !tag_key.is_empty())
        .collect::<Vec<_>>();

    let include_matched = if include_tag_keys.is_empty() {
        true
    } else {
        match request.include_match_mode {
            FileAnnotationMatchMode::And => include_tag_keys
                .iter()
                .all(|tag_key| file_matches_annotation_tag(&tag_keys, tag_key)),
            FileAnnotationMatchMode::Or => include_tag_keys
                .iter()
                .any(|tag_key| file_matches_annotation_tag(&tag_keys, tag_key)),
        }
    };

    include_matched
        && !exclude_tag_keys
            .iter()
            .any(|tag_key| file_matches_annotation_tag(&tag_keys, tag_key))
}

fn file_matches_annotation_tag(tag_keys: &HashSet<String>, tag_key: &str) -> bool {
    if tag_key == UNANNOTATED_TAG_KEY {
        return tag_keys.is_empty();
    }
    tag_keys.contains(tag_key)
}

fn file_annotation_file_from_record(record: &FileAnnotationRecord) -> Option<FileAnnotationFile> {
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

fn annotation_tag_key(key: &str, value: &str) -> String {
    format!("{}={}", percent_encode(key), percent_encode(value))
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

fn ensure_file_annotation_target(absolute_path: &Path) -> Result<(), RuntimeError> {
    match fs::symlink_metadata(absolute_path) {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(RuntimeError::invalid_file_annotation(
            "target path must be a file",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Err(
            RuntimeError::invalid_file_annotation("target path was not found"),
        ),
        Err(error) => Err(RuntimeError::read_file(absolute_path, error)),
    }
}

fn sort_annotation_tag_records(tags: &mut [AnnotationTagRecord]) {
    tags.sort_by(|left, right| {
        right
            .applied_at_ms
            .cmp(&left.applied_at_ms)
            .then_with(|| left.source.cmp(&right.source))
            .then_with(|| left.key.cmp(&right.key))
            .then_with(|| left.value.cmp(&right.value))
    });
}

fn merge_annotation_tags(target: &mut Vec<AnnotationTagRecord>, source: Vec<AnnotationTagRecord>) {
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

fn sort_annotation_tags(tags: &mut [AnnotationTag]) {
    tags.sort_by(|left, right| {
        right
            .applied_at_ms
            .cmp(&left.applied_at_ms)
            .then_with(|| left.source.cmp(&right.source))
            .then_with(|| left.key.cmp(&right.key))
            .then_with(|| left.value.cmp(&right.value))
    });
}
