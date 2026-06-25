use std::fs;
use std::io;
use std::path::Path;

use crate::{
    FileAnnotationMutationResponse, FileAnnotationSetValueRequest, FileAnnotationTagBindingRequest,
    FileAnnotationTagMutationResponse, RuntimeError,
};

use super::super::file_annotation_records::{
    ANNOTATION_TAG_SOURCE, AnnotationTagRecord, ensure_file_annotation_record,
    file_annotations_path, read_file_annotation_records, sort_annotation_tag_records,
    write_file_annotation_records,
};
use super::super::{file_annotation_absolute_path, now_ms, root_path_key, root_relative_path_key};

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

fn trim_required(field_name: &str, value: &str) -> Result<String, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_file_annotation(&format!(
            "{field_name} is required"
        )));
    }
    Ok(value.to_owned())
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
