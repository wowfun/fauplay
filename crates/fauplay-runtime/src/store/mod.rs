//! Persistent runtime state owned by the Fauplay Runtime.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::{
    AnnotationTag, AnnotationTagOption, AnnotationTagOptionsRequest, AnnotationTagOptionsResponse,
    FileAnnotationFile, FileAnnotationMatchMode, FileAnnotationMutationResponse,
    FileAnnotationPathRebindFailureReason, FileAnnotationPathRebindItem,
    FileAnnotationPathRebindRequest, FileAnnotationPathRebindResponse, FileAnnotationQueryRequest,
    FileAnnotationQueryResponse, FileAnnotationReadRequest, FileAnnotationReadResponse,
    FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, FileIndexEnsureItem, FileIndexEnsureRequest,
    FileIndexEnsureResponse, FileIndexFailureReason, GlobalShortcutConfigResponse,
    GlobalTrashEntry, GlobalTrashFailureReason, GlobalTrashListRequest, GlobalTrashListResponse,
    GlobalTrashMoveItem, GlobalTrashMoveRequest, GlobalTrashMoveResponse, GlobalTrashRestoreItem,
    GlobalTrashRestoreRequest, GlobalTrashRestoreResponse, MissingFileCleanupImpact,
    MissingFileCleanupRequest, MissingFileCleanupResponse, RootRelativePath, RuntimeError,
};

const GLOBAL_CONFIG_FOLDER_NAME: &str = "global";
const SHORTCUTS_CONFIG_FILENAME: &str = "shortcuts.json";
const FILE_INDEX_FILENAME: &str = "file-index.v1.json";
const FILE_ANNOTATIONS_FILENAME: &str = "file-annotations.v1.json";
const ANNOTATION_TAG_SOURCE: &str = "meta.annotation";
const UNANNOTATED_TAG_KEY: &str = "__ANNOTATION_UNANNOTATED__";
const GLOBAL_TRASH_FOLDER_NAME: &str = "recycle";
const GLOBAL_TRASH_META_FILENAME: &str = "items.json";
static GLOBAL_TRASH_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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

pub(crate) fn list_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashListRequest,
) -> Result<GlobalTrashListResponse, RuntimeError> {
    let path = global_trash_metadata_path(runtime_home_path);

    let Some(items) = read_global_trash_metadata(&path)? else {
        return Ok(global_trash_paged_response(
            Vec::new(),
            request.entry_limit,
            request.entry_offset,
        ));
    };

    let mut entries = Vec::new();
    for item in &items {
        if let Some(entry) = global_trash_entry_from_value(item) {
            if entry.absolute_path.is_file() {
                entries.push(entry);
            }
        }
    }

    entries.sort_by(|left, right| {
        right
            .deleted_at_ms
            .cmp(&left.deleted_at_ms)
            .then_with(|| left.absolute_path.cmp(&right.absolute_path))
    });

    Ok(global_trash_paged_response(
        entries,
        request.entry_limit,
        request.entry_offset,
    ))
}

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

pub(crate) fn move_to_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashMoveRequest,
) -> Result<GlobalTrashMoveResponse, RuntimeError> {
    let metadata_path = global_trash_metadata_path(runtime_home_path);
    let mut meta_items = read_global_trash_metadata(&metadata_path)?.unwrap_or_default();
    let mut response_items = Vec::new();
    let mut reserved_target_paths = HashSet::new();

    for absolute_path in request.absolute_paths {
        let mut item = build_global_trash_move_item(
            runtime_home_path,
            absolute_path,
            &mut reserved_target_paths,
        );

        if item.ok && !request.dry_run {
            commit_global_trash_move_item(&mut item);
            if item.ok {
                let deleted_at_ms = item.deleted_at_ms.unwrap_or_else(now_ms);
                meta_items.push(global_trash_metadata_value(
                    runtime_home_path,
                    &item,
                    deleted_at_ms,
                ));
            }
        }

        response_items.push(item);
    }

    if !request.dry_run && response_items.iter().any(|item| item.ok) {
        write_global_trash_metadata(&metadata_path, &meta_items)?;
    }

    let total = response_items.len();
    let moved = response_items.iter().filter(|item| item.ok).count();

    Ok(GlobalTrashMoveResponse {
        dry_run: request.dry_run,
        total,
        moved,
        failed: total - moved,
        items: response_items,
    })
}

pub(crate) fn restore_global_trash(
    runtime_home_path: &Path,
    request: GlobalTrashRestoreRequest,
) -> Result<GlobalTrashRestoreResponse, RuntimeError> {
    let path = global_trash_metadata_path(runtime_home_path);
    let metadata_was_loaded = path.exists();
    let mut meta_items = read_global_trash_metadata(&path)?.unwrap_or_default();
    let mut reserved_target_paths = HashSet::new();
    let mut response_items = Vec::new();

    for recycle_id in request.recycle_ids {
        let recycle_id = recycle_id.trim().to_owned();
        let Some(meta_index) = meta_items.iter().position(|item| {
            string_value(item.get("recycleId")).as_deref() == Some(recycle_id.as_str())
        }) else {
            response_items.push(failed_global_trash_restore_item(
                recycle_id,
                PathBuf::new(),
                PathBuf::new(),
                GlobalTrashFailureReason::RecycleItemNotFound,
                "Global Trash Entry was not found",
            ));
            continue;
        };

        let meta_item = meta_items[meta_index].clone();
        let mut item =
            build_global_trash_restore_item(recycle_id, &meta_item, &mut reserved_target_paths);

        if item.ok && !request.dry_run {
            commit_global_trash_restore_item(&mut item);
            if item.ok {
                meta_items.remove(meta_index);
            }
        }

        response_items.push(item);
    }

    if metadata_was_loaded && !request.dry_run && response_items.iter().any(|item| item.ok) {
        let next_raw = serde_json::to_string(&meta_items)
            .map_err(|error| RuntimeError::invalid_runtime_home_file(&path, &error.to_string()))?;
        fs::write(&path, next_raw).map_err(|source| RuntimeError::write_file(&path, source))?;
    }

    let total = response_items.len();
    let restored = response_items.iter().filter(|item| item.ok).count();

    Ok(GlobalTrashRestoreResponse {
        dry_run: request.dry_run,
        total,
        restored,
        failed: total - restored,
        items: response_items,
    })
}

#[derive(Debug, Clone)]
struct FileIndexRecord {
    root_path: String,
    root_relative_path: String,
    absolute_path: String,
    size: u64,
    last_modified_ms: Option<u64>,
    indexed_at_ms: u64,
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

fn file_index_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path
        .join(GLOBAL_CONFIG_FOLDER_NAME)
        .join(FILE_INDEX_FILENAME)
}

fn read_file_index_records(path: &Path) -> Result<Vec<FileIndexRecord>, RuntimeError> {
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

fn write_file_index_records(path: &Path, records: &[FileIndexRecord]) -> Result<(), RuntimeError> {
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
    root_relative_path: RootRelativePath,
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

fn root_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
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

fn root_relative_path_key(path: &RootRelativePath) -> String {
    path.as_path()
        .iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
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

fn global_trash_metadata_path(runtime_home_path: &Path) -> PathBuf {
    global_trash_storage_root_path(runtime_home_path)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join(GLOBAL_TRASH_META_FILENAME)
}

fn global_trash_storage_root_path(runtime_home_path: &Path) -> PathBuf {
    runtime_home_path.join(GLOBAL_CONFIG_FOLDER_NAME)
}

fn global_trash_files_path(runtime_home_path: &Path) -> PathBuf {
    global_trash_storage_root_path(runtime_home_path)
        .join(GLOBAL_TRASH_FOLDER_NAME)
        .join("files")
}

fn canonical_global_trash_file_path(runtime_home_path: &Path, path: &Path) -> Option<PathBuf> {
    let storage_root = fs::canonicalize(global_trash_files_path(runtime_home_path)).ok()?;
    let stored_path = fs::canonicalize(path).ok()?;

    stored_path.starts_with(storage_root).then_some(stored_path)
}

fn read_global_trash_metadata(path: &Path) -> Result<Option<Vec<serde_json::Value>>, RuntimeError> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(RuntimeError::read_file(path, error)),
    };

    let value = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    let Some(items) = value.as_array() else {
        return Err(RuntimeError::invalid_runtime_home_file(
            path,
            "Global Trash metadata must be an array",
        ));
    };

    Ok(Some(items.clone()))
}

fn write_global_trash_metadata(
    path: &Path,
    items: &[serde_json::Value],
) -> Result<(), RuntimeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| RuntimeError::write_file(parent, source))?;
    }
    let raw = serde_json::to_string(items)
        .map_err(|error| RuntimeError::invalid_runtime_home_file(path, &error.to_string()))?;
    fs::write(path, raw).map_err(|source| RuntimeError::write_file(path, source))
}

fn next_global_trash_recycle_id(runtime_home_path: &Path, source_absolute_path: &Path) -> String {
    let seed = now_nanos();
    let process_id = std::process::id();

    loop {
        let sequence = GLOBAL_TRASH_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let recycle_id = format!("{seed:x}-{process_id:x}-{sequence:x}");
        let stored_file_path = global_trash_files_path(runtime_home_path)
            .join(stored_file_name_for(&recycle_id, source_absolute_path));
        if !stored_file_path.exists() {
            return recycle_id;
        }
    }
}

fn stored_file_name_for(recycle_id: &str, source_absolute_path: &Path) -> String {
    match source_absolute_path
        .extension()
        .and_then(|value| value.to_str())
    {
        Some(extension) if !extension.is_empty() => format!("{recycle_id}.{extension}"),
        _ => recycle_id.to_owned(),
    }
}

fn global_trash_paged_response(
    entries: Vec<GlobalTrashEntry>,
    entry_limit: Option<usize>,
    entry_offset: usize,
) -> GlobalTrashListResponse {
    let start = entry_offset.min(entries.len());
    let limit = entry_limit.unwrap_or(entries.len());
    let end = start.saturating_add(limit).min(entries.len());
    let is_truncated = end < entries.len();
    let next_offset = is_truncated.then_some(end);

    GlobalTrashListResponse {
        entries: entries[start..end].to_vec(),
        is_truncated,
        next_offset,
    }
}

fn global_trash_entry_from_value(value: &serde_json::Value) -> Option<GlobalTrashEntry> {
    let object = value.as_object()?;
    let absolute_path = path_value(object.get("storedAbsolutePath")?)?;
    let recycle_id = string_value(object.get("recycleId")).unwrap_or_default();
    let name = string_value(object.get("name"))
        .filter(|value| !value.is_empty())
        .or_else(|| {
            absolute_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
        })?;
    let original_absolute_path = string_value(object.get("originalAbsolutePath"))
        .map(PathBuf::from)
        .unwrap_or_default();
    let metadata = fs::metadata(&absolute_path).ok();
    let size = number_value(object.get("size"))
        .or_else(|| metadata.as_ref().map(std::fs::Metadata::len))
        .unwrap_or(0);
    let deleted_at_ms = number_value(object.get("deletedAt")).unwrap_or(0);
    let mime_type = string_value(object.get("mimeType"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| mime_type_for_name(&name).to_owned());
    let preview_kind = preview_kind_for_name(&name).to_owned();
    let display_path = string_value(object.get("originalAbsolutePath"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| absolute_path.display().to_string());
    let last_modified_ms = metadata.as_ref().and_then(modified_ms);

    Some(GlobalTrashEntry {
        name,
        absolute_path,
        original_absolute_path,
        recycle_id,
        size,
        mime_type,
        preview_kind,
        display_path,
        last_modified_ms,
        deleted_at_ms,
    })
}

fn build_global_trash_move_item(
    runtime_home_path: &Path,
    absolute_path: PathBuf,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> GlobalTrashMoveItem {
    match fs::symlink_metadata(&absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return failed_global_trash_move_item(
                absolute_path,
                GlobalTrashFailureReason::SourceNotFound,
                "Global Trash move source was not found",
            );
        }
        Err(error) => {
            return failed_global_trash_move_item(
                absolute_path,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to inspect Global Trash move source: {error}"),
            );
        }
        Ok(metadata) if !metadata.is_file() => {
            return failed_global_trash_move_item(
                absolute_path,
                GlobalTrashFailureReason::UnsupportedKind,
                "Global Trash only supports files",
            );
        }
        Ok(_) => {}
    };

    let recycle_id = next_global_trash_recycle_id(runtime_home_path, &absolute_path);
    let candidate_path = global_trash_files_path(runtime_home_path)
        .join(stored_file_name_for(&recycle_id, &absolute_path));
    let next_absolute_path =
        allocate_deduped_path(&absolute_path, &candidate_path, reserved_target_paths);

    GlobalTrashMoveItem {
        absolute_path,
        next_absolute_path: Some(next_absolute_path),
        recycle_id,
        deleted_at_ms: Some(now_ms()),
        ok: true,
        reason: None,
        error: None,
    }
}

fn commit_global_trash_move_item(item: &mut GlobalTrashMoveItem) {
    let Some(target_absolute_path) = item.next_absolute_path.clone() else {
        fail_global_trash_move_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash target path was not planned",
        );
        return;
    };

    if let Some(parent) = target_absolute_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            fail_global_trash_move_item(
                item,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to create Global Trash target directory: {error}"),
            );
            return;
        }
    }

    if target_absolute_path.exists() && target_absolute_path != item.absolute_path {
        fail_global_trash_move_item(
            item,
            GlobalTrashFailureReason::TargetExists,
            "Global Trash target path already exists",
        );
        return;
    }

    if let Err(error) = move_file(&item.absolute_path, &target_absolute_path) {
        fail_global_trash_move_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            &format!("Global Trash move failed: {error}"),
        );
    }
}

fn global_trash_metadata_value(
    runtime_home_path: &Path,
    item: &GlobalTrashMoveItem,
    deleted_at_ms: u64,
) -> serde_json::Value {
    let name = item
        .absolute_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let stored_absolute_path = item
        .next_absolute_path
        .as_ref()
        .unwrap_or(&item.absolute_path);

    serde_json::json!({
        "recycleId": item.recycle_id,
        "storageRootPath": global_trash_storage_root_path(runtime_home_path).display().to_string(),
        "storedAbsolutePath": stored_absolute_path.display().to_string(),
        "originalAbsolutePath": item.absolute_path.display().to_string(),
        "originalRootPath": null,
        "name": name,
        "size": fs::metadata(stored_absolute_path).map(|metadata| metadata.len()).unwrap_or(0),
        "mimeType": mime_type_for_name(name),
        "deletedAt": deleted_at_ms,
        "createdAt": deleted_at_ms,
        "updatedAt": deleted_at_ms,
    })
}

fn failed_global_trash_move_item(
    absolute_path: PathBuf,
    reason: GlobalTrashFailureReason,
    error: &str,
) -> GlobalTrashMoveItem {
    GlobalTrashMoveItem {
        absolute_path,
        next_absolute_path: None,
        recycle_id: String::new(),
        deleted_at_ms: None,
        ok: false,
        reason: Some(reason),
        error: Some(error.to_owned()),
    }
}

fn fail_global_trash_move_item(
    item: &mut GlobalTrashMoveItem,
    reason: GlobalTrashFailureReason,
    error: &str,
) {
    item.ok = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn build_global_trash_restore_item(
    recycle_id: String,
    meta_item: &serde_json::Value,
    reserved_target_paths: &mut HashSet<PathBuf>,
) -> GlobalTrashRestoreItem {
    let Some(stored_absolute_path) = meta_item.get("storedAbsolutePath").and_then(path_value)
    else {
        return failed_global_trash_restore_item(
            recycle_id,
            PathBuf::new(),
            PathBuf::new(),
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash metadata is missing storedAbsolutePath",
        );
    };
    let Some(original_absolute_path) = meta_item.get("originalAbsolutePath").and_then(path_value)
    else {
        return failed_global_trash_restore_item(
            recycle_id,
            stored_absolute_path,
            PathBuf::new(),
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash metadata is missing originalAbsolutePath",
        );
    };

    let target_absolute_path = match fs::symlink_metadata(&stored_absolute_path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return failed_global_trash_restore_item(
                recycle_id,
                stored_absolute_path,
                original_absolute_path,
                GlobalTrashFailureReason::SourceNotFound,
                "Global Trash stored file was not found",
            );
        }
        Err(error) => {
            return failed_global_trash_restore_item(
                recycle_id,
                stored_absolute_path,
                original_absolute_path,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to inspect Global Trash stored file: {error}"),
            );
        }
        Ok(metadata) if !metadata.is_file() => {
            return failed_global_trash_restore_item(
                recycle_id,
                stored_absolute_path,
                original_absolute_path,
                GlobalTrashFailureReason::UnsupportedKind,
                "Global Trash only supports files",
            );
        }
        Ok(_) => allocate_deduped_path(
            &stored_absolute_path,
            &original_absolute_path,
            reserved_target_paths,
        ),
    };

    GlobalTrashRestoreItem {
        recycle_id,
        absolute_path: stored_absolute_path,
        original_absolute_path,
        next_absolute_path: Some(target_absolute_path),
        ok: true,
        reason: None,
        error: None,
    }
}

fn commit_global_trash_restore_item(item: &mut GlobalTrashRestoreItem) {
    let Some(target_absolute_path) = item.next_absolute_path.clone() else {
        fail_global_trash_restore_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            "Global Trash restore target path was not planned",
        );
        return;
    };

    if let Some(parent) = target_absolute_path.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            fail_global_trash_restore_item(
                item,
                GlobalTrashFailureReason::MutationFailed,
                &format!("failed to create Global Trash restore target directory: {error}"),
            );
            return;
        }
    }

    if target_absolute_path.exists() && target_absolute_path != item.absolute_path {
        fail_global_trash_restore_item(
            item,
            GlobalTrashFailureReason::TargetExists,
            "Global Trash restore target path already exists",
        );
        return;
    }

    if let Err(error) = fs::rename(&item.absolute_path, &target_absolute_path) {
        fail_global_trash_restore_item(
            item,
            GlobalTrashFailureReason::MutationFailed,
            &format!("Global Trash restore failed: {error}"),
        );
    }
}

fn failed_global_trash_restore_item(
    recycle_id: String,
    absolute_path: PathBuf,
    original_absolute_path: PathBuf,
    reason: GlobalTrashFailureReason,
    error: &str,
) -> GlobalTrashRestoreItem {
    GlobalTrashRestoreItem {
        recycle_id,
        absolute_path,
        original_absolute_path,
        next_absolute_path: None,
        ok: false,
        reason: Some(reason),
        error: Some(error.to_owned()),
    }
}

fn fail_global_trash_restore_item(
    item: &mut GlobalTrashRestoreItem,
    reason: GlobalTrashFailureReason,
    error: &str,
) {
    item.ok = false;
    item.reason = Some(reason);
    item.error = Some(error.to_owned());
}

fn string_value(value: Option<&serde_json::Value>) -> Option<String> {
    value?.as_str().map(str::trim).map(ToOwned::to_owned)
}

fn path_value(value: &serde_json::Value) -> Option<PathBuf> {
    string_value(Some(value))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
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

fn preview_kind_for_name(name: &str) -> &'static str {
    match extension_for_name(name).as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" | "avif" => "image",
        "mp4" | "webm" | "mov" | "avi" | "mkv" | "ogg" => "video",
        "txt" | "md" | "markdown" | "json" | "yaml" | "yml" | "xml" | "csv" | "log" | "js"
        | "jsx" | "ts" | "tsx" | "css" | "scss" | "less" | "html" | "htm" | "py" | "sh"
        | "bash" | "zsh" | "ini" | "conf" | "toml" | "sql" | "c" | "cc" | "cpp" | "h" | "hpp"
        | "java" | "go" | "rs" | "vue" | "svelte" => "text",
        _ => "unsupported",
    }
}

fn mime_type_for_name(name: &str) -> &'static str {
    match extension_for_name(name).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "ogg" => "video/ogg",
        "txt" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "jsx" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        _ => "application/octet-stream",
    }
}

fn extension_for_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn allocate_deduped_path(
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

fn move_file(source_absolute_path: &Path, target_absolute_path: &Path) -> io::Result<()> {
    match fs::rename(source_absolute_path, target_absolute_path) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(source_absolute_path, target_absolute_path)?;
            if let Err(remove_error) = fs::remove_file(source_absolute_path) {
                let _ = fs::remove_file(target_absolute_path);
                return Err(remove_error);
            }
            Ok(())
        }
    }
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
