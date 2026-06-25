use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::{
    AnnotationTagOption, AnnotationTagOptionsRequest, AnnotationTagOptionsResponse,
    FileAnnotationMatchMode, FileAnnotationQueryRequest, FileAnnotationQueryResponse, RuntimeError,
};

use super::super::file_annotation_records::{
    FileAnnotationRecord, annotation_tag_key, file_annotation_file_from_record,
    file_annotations_path, read_file_annotation_records,
};
use super::super::{root_path_key, root_relative_path_key};

const UNANNOTATED_TAG_KEY: &str = "__ANNOTATION_UNANNOTATED__";

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

struct AnnotationTagOptionEntry {
    key: String,
    value: String,
    source: String,
    file_count: usize,
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
